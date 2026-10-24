"""The inline moderation pipeline: A3 → A1 → A2, producing one Verdict.

This is the gate every post and reply passes before publication (§5.3). It runs on
CPU and must stay inside its latency budget, because a user is waiting on it.

Risk level is a separate axis from decision. A post can be both blocked for
harassment and carry a high risk signal, and the safety workflow keys off
`risk_level` — never off `decision == CRISIS_FLAG`. Treating them as one field would
mean a user in crisis who also broke a rule gets the block and not the support.
"""

from __future__ import annotations

import os
import re
import time
from pathlib import Path

from alaap_ai.crisis_triage.models import crisis as crisis_models
from alaap_ai.shared import language
from alaap_ai.shared.redaction import pii
from alaap_ai.shared.schemas.moderation import (
    Category,
    CategoryScore,
    Decision,
    RiskLevel,
    Verdict,
)

from ..config import policy as policy_config
from ..guardrails import lexical
from ..models import safety as safety_models

# ai-services/community-moderation/app/pipelines/ -> repo root
_REPO_ROOT = Path(__file__).resolve().parents[4]

# The threshold set to load, overridable alongside ALAAP_SAFETY_CHECKPOINT:
#
#     ALAAP_SAFETY_BACKEND=transformer
#     ALAAP_SAFETY_CHECKPOINT=../model-store/quantised/a1-v2
#     ALAAP_THRESHOLDS=../metadata/moderation/thresholds.v2.yaml
#
# These two move together. A new checkpoint needs the threshold set calibrated
# for it, and pointing at only one of them is now caught rather than silently
# honoured — policy.load refuses a set whose model_version does not match the
# loaded model and falls back to uncalibrated defaults, which /health reports as
# `thresholds_calibrated: false`.
_THRESHOLDS_PATH = Path(
    os.getenv(
        "ALAAP_THRESHOLDS",
        _REPO_ROOT / "metadata" / "moderation" / "thresholds.v1.yaml",
    )
)

# Thresholds and category actions come from `metadata/moderation/`, written by
# training/calibrate.py. A threshold is policy, and policy is reviewed data rather
# than code. Defaults apply until a model has been calibrated; see config/policy.py.
#
# None of this is ever exposed through the public API (§6.3).

_REASONS: dict[Decision, str] = {
    Decision.ALLOWED: "Your message is ready to post.",
    # Placeholder; the surface decides which of the two lines below is used.
    Decision.SUGGEST_REWORDING: "",
    Decision.LIMITED_VISIBILITY: (
        "This message is under review because it may contain harmful advice."
    ),
    Decision.BLOCKED: (
        "This message was not published because it may cause harm to another person."
    ),
    Decision.CRISIS_FLAG: (
        "It sounds like you are going through something very hard. Support options are "
        "available to you right now."
    ),
}

_PII_GUIDANCE = (
    "This message looks like it contains personal details that could identify you. "
    "Consider removing them before posting."
)

# Surfaces where a rewrite blocks publication. A reply is aimed at another person,
# usually one in distress, so it does not land until it changes. A new post is the
# author describing their own experience and is never gated on tone.
_GATED_SURFACES = frozenset({"comment", "message"})

# Copy differs because the two situations differ. Telling someone to "please revise"
# when the Post button will never enable leaves them stuck; telling someone their
# post "can't be published" when it can is a lie that suppresses them anyway.
_REWORD_REQUIRED = (
    "This reply can't be posted as written. Please rephrase it and try again. "
    "If you think this is a mistake, you can ask for a human review."
)
_REWORD_ADVISORY = (
    "Your post is ready to publish. Before you do, you may want to reword part of "
    "it — see the suggestion below. You can post it either way."
)

# Per-category rewrite guidance. §6.3 requires "safe rewrite guidance", and a single
# generic string does not meet that — telling someone their message "may feel harsh
# or blaming" when they wrote "keep your issues to yourself" explains nothing.
#
# These strings belong in `metadata/moderation/rewording-templates/` before
# production; they are user-facing copy, and copy is reviewed content, not code.
_CATEGORY_GUIDANCE: dict[Category, str] = {
    Category.HELP_SEEKING_DISCOURAGEMENT: (
        "This message discourages someone from sharing or seeking support. People "
        "come here because talking about it helps. If you meant to suggest a "
        "different kind of help, try naming that instead."
    ),
    Category.PASSIVE_AGGRESSIVE_ABUSE: (
        "This message may read as an indirect criticism. Saying what you mean "
        "directly and kindly usually lands better here."
    ),
    Category.MANIPULATION_COERCION: (
        "This message may put pressure on someone through guilt or obligation. "
        "Try expressing how you feel without asking them to prove anything."
    ),
}

# Said when a category fired that has no tailored line yet. Thirteen of the
# sixteen are in that position, and returning nothing for them is not an option
# any more: a reply is not sendable until the writer changes it, so a reply that
# is stopped with no explanation is a closed door and no handle.
_GENERIC_GUIDANCE = (
    "This may land on the person you are answering as a judgement of them rather "
    "than a response to them. Say what you noticed, or what happened to you, and "
    "leave out the verdict on who they are."
)


def _safety_from_env():
    """Pick the backend from the environment.

    The service does not need a code change to move from the lexicon baseline to
    a trained checkpoint:

        ALAAP_SAFETY_BACKEND=transformer
        ALAAP_SAFETY_CHECKPOINT=../model-store/quantised/a1-v1

    Defaults to the heuristic so a fresh clone runs with no model download.
    """
    backend = os.getenv("ALAAP_SAFETY_BACKEND", "heuristic")
    if backend == "transformer":
        checkpoint = os.getenv("ALAAP_SAFETY_CHECKPOINT")
        if not checkpoint:
            raise RuntimeError(
                "ALAAP_SAFETY_BACKEND=transformer needs ALAAP_SAFETY_CHECKPOINT"
            )
        return safety_models.build("transformer", checkpoint=checkpoint)
    return safety_models.build("heuristic")


class ModerationPipeline:
    def __init__(self, safety=None, crisis=None, policy=None) -> None:
        self.safety = safety or _safety_from_env()
        self.crisis = crisis or crisis_models.build()
        # Thresholds are loaded *for* the scoring model that will be measured
        # against them. A set calibrated for another model is refused, because a
        # cut point on one score distribution is meaningless on another's.
        self.policy = policy or policy_config.load(
            _THRESHOLDS_PATH,
            model_version=getattr(self.safety, "calibrated_for", None),
        )

    @property
    def coverage(self) -> dict[str, list[str]]:
        """Which categories are actually enforced, and why the rest are not.

        Surfaced through /health so an operator can see at a glance that some of
        sixteen categories are unenforced, rather than inferring it from the
        absence of verdicts.

        There are **two** independent ways a category goes unenforced, and
        reporting only the first is how this endpoint came to claim sixteen
        covered categories while three block-tier ones could never fire:

          unscorable   the loaded model has no output for it at all
          unreachable  the model scores it, but its threshold sits above the
                       highest score the model can emit, so it never fires

        `uncovered` is the union of the two, so a consumer that routes uncovered
        categories to human review keeps doing the right thing without needing to
        know which kind it is hitting.

        A backend that declares neither `covered` nor `score_ceiling` is assumed to
        answer for everything — that assumption is what made the original bug
        invisible, so it now applies only to a backend that opts out of declaring,
        and both shipped backends declare.
        """
        declared = getattr(self.safety, "covered", None)
        scorable = set(Category) if declared is None else set(declared)
        ceiling = getattr(self.safety, "score_ceiling", 1.0)

        unscorable = set(Category) - scorable
        unreachable = {c for c in scorable if self.policy.thresholds[c] > ceiling}

        # The third way, and the one that was invisible. A category can be
        # scorable by the model and reachable at its threshold and still be dead:
        # a1-v10 emits 0.000 for six of these on every input, because calibration
        # had 1 to 16 examples to work with and recorded `calibrated: false`.
        # Reporting them as covered is the same lie the `unreachable` axis was
        # added to stop.
        #
        # A lexical guardrail stands in for two of them, which is better than
        # nothing and is not detection. It is reported separately so an operator
        # can tell "a regex is watching this" from "a model is".
        #
        # The three axes overlap on purpose and none is subtracted from another:
        # a category can be both unscorable and unmeasured, and the first version
        # of this trimmed `unmeasured` by `unscorable` — which hid every category
        # a rule actually covers, so `rule_guarded` came back empty while the
        # rules were demonstrably firing. `uncovered` is their union and is the
        # field to alert on.
        unmeasured = set(self.policy.unmeasured)
        guarded = unmeasured & set(lexical.COVERED)

        return {
            "covered": sorted(c.value for c in scorable - unreachable - unmeasured),
            "uncovered": sorted(c.value for c in unscorable | unreachable | unmeasured),
            "unscorable": sorted(c.value for c in unscorable),
            "unreachable": sorted(c.value for c in unreachable),
            "unmeasured": sorted(c.value for c in unmeasured),
            "rule_guarded": sorted(c.value for c in guarded),
        }

    def run(self, text: str, surface: str = "post",
            language_hint: str | None = None) -> Verdict:
        started = time.perf_counter()

        findings = pii.detect(text)
        model_scores = self.safety.score(text)

        # Lexical stand-ins, for the categories calibration could say nothing
        # about. a1-v10 emits 0.000 on every input for six of them — including
        # `help_seeking_discouragement`, the category this product added because
        # no generic toxicity list had one, and `self_harm_encouragement`, the
        # category that exists to stop one member pushing another toward harm.
        # Their corpus support runs from 1 to 16 examples.
        #
        # `max` rather than assignment: a model that has an opinion keeps it, and
        # the rules only ever raise a score the model left at zero. The rule set
        # is keyed off `policy.unmeasured`, so a checkpoint that learns one of
        # these silences its rules without anyone editing the guardrail file.
        guard_scores = lexical.score(text, self.policy.unmeasured)
        raw_scores = {
            c: max(model_scores.get(c, 0.0), guard_scores.get(c, 0.0))
            for c in set(model_scores) | set(guard_scores)
        }

        risk_level, _risk_score = self.crisis.score(text)

        # The client may say what language this is; if it does not, work it out.
        # Never trust a hint that contradicts the text — a caller that mislabels
        # Hinglish as English would re-enable exactly the category scoping is
        # there to prevent.
        detected = language.detect(text)
        lang = detected if language_hint is None else (
            language_hint if language_hint == detected else detected
        )
        enforced = self.policy.enforced_in(lang, surface)

        scores = [
            CategoryScore(category=c, score=s, threshold=self.policy.thresholds[c])
            for c, s in raw_scores.items()
        ]
        # A category outside its language scope is dropped before it can decide
        # anything. Its score still travels in `scores` for the audit log, so a
        # reviewer can see what the model thought and why it was not acted on.
        fired = {s.category for s in scores if s.fired and s.category in enforced}

        # Which of those crossed only because a regex matched. The evidence
        # behind a rule hit is that somebody wrote a pattern, and that is enough
        # to ask a person to rephrase but not to refuse them — so a rule-sourced
        # category is capped at human review however its tier is configured.
        #
        # Enforced here rather than by choosing a low `_SCORE`, because the
        # uncalibrated default threshold is 0.55 for every category: under
        # `defaults()` any score that fires at all also clears the block tier,
        # and "nobody would miss you" came back BLOCKED on the strength of a
        # regex. A promise about a person's post cannot rest on a constant in
        # another file happening to stay below a threshold in this one.
        rule_only = {
            c for c in fired if model_scores.get(c, 0.0) < self.policy.thresholds[c]
        }

        decision = self._decide(fired, rule_only, findings, risk_level, surface, text)

        rewrite_required = (
            decision is Decision.SUGGEST_REWORDING and surface in _GATED_SURFACES
        )

        reason = _REASONS[decision]
        if decision is Decision.SUGGEST_REWORDING:
            reason = _REWORD_REQUIRED if rewrite_required else _REWORD_ADVISORY

        # Guidance follows what fired, not what was decided. A reply that is
        # blocked or held needs the explanation at least as much as one asked to
        # reword — more, because it is the one that cannot be sent — and the
        # earlier version emitted guidance only for SUGGEST_REWORDING, so a
        # blocked reply arrived at the composer with an empty panel.
        #
        # `fired` is a set, so it is sorted before the pick: an arbitrary choice
        # among several tailored lines makes the copy on screen depend on hash
        # ordering, which is not something a user-facing string may do.
        guidance = None
        if fired:
            guidance = next(
                (
                    _CATEGORY_GUIDANCE[c]
                    for c in sorted(fired, key=lambda c: c.value)
                    if c in _CATEGORY_GUIDANCE
                ),
                _GENERIC_GUIDANCE,
            )
        elif findings and decision is Decision.SUGGEST_REWORDING:
            guidance = _PII_GUIDANCE

        return Verdict(
            decision=decision,
            risk_level=risk_level,
            scores=scores,
            pii=findings,
            reason=reason,
            rewrite_guidance=guidance,
            rewrite_required=rewrite_required,
            surface=surface,
            language=lang,
            out_of_scope=sorted(self.policy.out_of_scope(lang, surface),
                                key=lambda c: c.value),
            safety_model_id=self.safety.model_id,
            crisis_model_id=self.crisis.model_id,
            latency_ms=int((time.perf_counter() - started) * 1000),
        )

    def _decide(self, fired, rule_only, findings, risk_level: RiskLevel,
                surface: str = "comment", text: str = "") -> Decision:
        # `fired` has already been filtered to the categories in scope for this
        # surface, and for a member's own post that set is empty. So a post can
        # only ever reach CRISIS_FLAG, the PII warning, or ALLOWED — it cannot be
        # blocked, held or gated by any category.
        #
        # **Every moderation outcome outranks the crisis flag for the
        # `decision`**, and the risk level travels independently so the safety
        # workflow still fires on all of them. Only BLOCKED used to outrank it,
        # which meant a reply that was both hostile and distressed came back as
        # CRISIS_FLAG — decision `crisis_flag` carries no rewrite guidance and
        # does not stop anything, so the hostile half published unremarked.
        #
        # The two axes answer different questions. `decision` is what the writer
        # must do about the words in front of them; `risk_level` is what the
        # platform must do about the person. Reaching someone in crisis has never
        # depended on this field, and does not now.
        # A rule may not block a person. A block-tier category it raised on its
        # own drops to human review instead, where a person looks at it.
        if (fired - rule_only) & self.policy.tier("block"):
            return Decision.BLOCKED
        if (fired & self.policy.tier("review")) or (rule_only & self.policy.tier("block")):
            return Decision.LIMITED_VISIBILITY
        if fired & self.policy.tier("reword"):
            return Decision.SUGGEST_REWORDING
        if risk_level in (RiskLevel.HIGH, RiskLevel.MODERATE):
            # Not a sanction. §6.2: "User receives immediate support options;
            # safety workflow begins" — the content still publishes. A person
            # saying they are in crisis is not stopped from saying it.
            return Decision.CRISIS_FLAG
        if findings:
            # Personal data is a warning, never a block. It is the author's own
            # information and their call to publish it.
            return Decision.SUGGEST_REWORDING
        return Decision.ALLOWED
