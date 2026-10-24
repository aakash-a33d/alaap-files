"""Moderation policy: per-category thresholds and actions.

Loaded from `metadata/moderation/thresholds.v1.yaml` when it exists — that file is
written by `training/calibrate.py` and is the source of truth, because a threshold is
policy and policy is reviewed data rather than code (folder-structure.md).

Falls back to built-in defaults so the prototype runs before any model is trained.
The fallback is visible in `Policy.source`, and anything that matters should refuse
to start on `source == "defaults"`.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import yaml

from alaap_ai.shared.schemas.moderation import Category

_DEFAULT_THRESHOLD = 0.55

# Tier assignment mirrors training/config.yaml. Kept here only so the pipeline has
# something coherent to run on before calibration has ever been executed.
_DEFAULT_ACTIONS: dict[Category, str] = {
    Category.SELF_HARM_ENCOURAGEMENT: "block",
    Category.GROOMING_EXPLOITATION: "block",
    Category.SEXUAL_EXPLOITATION: "block",
    Category.THREATS_INTIMIDATION: "block",
    Category.MALWARE_PHISHING: "block",
    Category.SCAMS_FINANCIAL_EXPLOITATION: "block",
    Category.STALKING_DOXXING: "block",
    Category.HATE_SPEECH: "block",
    Category.UNSAFE_MEDICAL_ADVICE: "block",
    Category.BULLYING_HARASSMENT: "block",
    Category.IMPERSONATION: "review",
    Category.EMOTIONAL_DEPENDENCY_PRESSURE: "review",
    Category.RELIGIOUS_COERCION: "review",
    Category.MANIPULATION_COERCION: "reword",
    Category.PASSIVE_AGGRESSIVE_ABUSE: "reword",
    Category.HELP_SEEKING_DISCOURAGEMENT: "reword",
}


# Categories the model is only trustworthy in some languages, and which ones.
#
# A category absent from this map is enforced in every language. A category
# present fires ONLY in the languages listed; elsewhere it is demoted to human
# review, exactly as an uncalibrated category is.
#
# `passive_aggressive_abuse` is here because a1-v10 measures, on held-out text:
#
#     language   recall   precision   benign false-positive rate
#     en          0.781      0.882           0.5%
#     hi-Latn     0.393      0.807           3.8%
#
# English detection works. Hinglish misses 61% of real covert aggression and
# flags benign posts seven times more often, because the two score distributions
# overlap — Hinglish benign sits 13x higher than English benign. The category
# comes from TRAC-2, whose covert-aggression labels are social-media argument
# rather than support-community register, and whose Hinglish half no amount of
# added benign has separated.
#
# Enforcing it globally would put that 3.8% on the users MuRIL was chosen to
# serve. Disabling it entirely would throw away a working English classifier.
# Scoping it does neither.
#
# This is a deliberately uncomfortable mechanism: applying a different bar per
# language is defensible only while it *equalises* outcomes. Revisit it whenever
# `evaluation/run_language_bias.py` passes for a scoped category — at that point
# the scope is no longer protecting anyone and should be removed.
_LANGUAGE_SCOPE: dict[Category, frozenset[str]] = {
    Category.PASSIVE_AGGRESSIVE_ABUSE: frozenset({"en"}),
}

# Categories whose calibration numbers are not trustworthy on this platform's
# text, whatever the threshold file says. Applied after the file is read, so a
# recalibration cannot quietly re-enable one.
#
# `grooming_exploitation` calibrates at precision 0.92 / recall 0.99, the best
# figures of any category — and blocks ordinary conversation:
#
#     0.994   "i dont want to be here anymore"
#     0.990   "how was your weekend?"
#     0.980   "i feel so alone today"
#     0.915   "must be nice, some people have all the luck"
#
# All four exceed the 0.62 threshold, so at block tier a person disclosing
# distress has their post refused and labelled predatory. There is no threshold
# that fixes it: "how was your weekend?" scores 0.990, above three of the four
# real positives it is meant to catch.
#
# The cause is register, not the model. Its 5,923 examples are PAN-12 — 2000s
# instant-messenger logs, short and abbreviated — against benign text from
# Wikipedia talk pages and news comments. `ingest.py` says so in its own
# docstring: "Our surface is posts and replies. Auxiliary data." The model
# learned *short conversational message*, and validation could not see it
# because the validation set is the same chat logs.
#
# Demoting it to human review was tried first and is not enough. At `review` it
# still fired `limited_visibility` on "how was your weekend?" and "i feel so
# alone today" — roughly half of ordinary short posts — which is a review queue
# made of nothing, and a member whose harmless post is held learns to stop
# posting. A signal that fires on a greeting is not a signal being redirected.
#
# So it is not enforced at all. The score still travels in `Verdict.scores` for
# the audit log and for anyone wanting to measure it; it simply decides nothing.
#
# The benign held-out text in `evaluation/run_language_bias.py` shows this
# category at 1.1% on English, which is why nothing caught it: that text is
# Wikipedia talk pages and news comments, long and formal. The platform's
# surface is short conversational messages, which is what PAN-12 is, and on
# short text the rate is closer to half.
#
# Lifting this needs a corpus that separates grooming from register — domain
# examples, or PAN-12 balanced against short conversational benign text — plus a
# probe set for the category, which is the safeguard that was missing.
#
# `sexual_exploitation` is not enforced for a plainer reason: it has no training data
# at all. The corpus contains zero examples of it — not few, none — so whatever the
# model emits for this category is the behaviour of an untrained head, and a severity-5
# block decided by an untrained head is worse than no check. It is listed here rather
# than removed from the Category enum so that the score still travels in
# `Verdict.scores` and the day data arrives, re-enabling it is one line.
#
# Dropped deliberately and temporarily. The gap is recorded in the status document and
# in metadata/moderation/categories/categories.v1.yaml; it must not be mistaken for a
# category that is working quietly.
_NOT_ENFORCED: frozenset[Category] = frozenset({
    Category.GROOMING_EXPLOITATION,
    Category.SEXUAL_EXPLOITATION,
})

# Surfaces where somebody else is on the receiving end.
#
# **A member's own post is not moderated.** Not blocked, not held, not gated, not
# asked to reword. They may say anything, however bleak, angry, bitter or unfair,
# and the AI does not stand between them and saying it. That is the product
# decision, and it is the stronger reading of what the repo already believed —
# `moderation.py` says a post "may be bleak, angry or bitter, and none of that is
# a reason to stop them saying it", but the code only applied that to whether a
# rewrite was mandatory, so a1-v10 still refused:
#
#     blocked  [bullying_harassment]
#       "my boss is a worthless bully and i cant stand another day of it"
#
# Somebody venting about their own life, about a person not on the platform,
# refused outright.
#
# **Crisis detection still runs on every post**, and it is the reason the model
# looks at a post at all. `risk_level` is computed, travels in the Verdict, and
# reaches the safety workflow — but it gates nothing. A person disclosing that
# they are in crisis publishes that disclosure like any other post; the platform
# reacts by reaching them, not by stopping them.
#
# A reply, a comment and a direct message all land on somebody who is usually
# already having a hard day. All sixteen categories apply there.
_ADDRESSED_SURFACES = frozenset({"comment", "message"})


@dataclass(frozen=True)
class Policy:
    thresholds: dict[Category, float]
    actions: dict[Category, str]
    source: str
    model_version: str = "none"
    # Why the fallback happened, when it did. Empty on a clean load.
    note: str = ""

    # Categories calibration could say nothing about: `calibrated: false` in the
    # threshold file, which means the sweep found too few positive validation
    # examples to sweep with and the threshold is an arbitrary 0.5.
    #
    # This is a third and separate thing from the two `coverage` already
    # reports. A category can be scorable by the model and reachable at its
    # threshold and still be **dead** — a1-v10 emits 0.000 for six of these on
    # every input, because their corpus support runs from 1 to 16 examples. The
    # endpoint reported all six as covered.
    #
    # Two consumers: /health, so an operator sees which categories were never
    # measured; and `guardrails.lexical`, whose rules run only for these and
    # therefore retire themselves the day calibration produces a real threshold.
    unmeasured: frozenset[Category] = frozenset()

    @property
    def calibrated(self) -> bool:
        return self.source != "defaults"

    def tier(self, action: str) -> frozenset[Category]:
        return frozenset(c for c, a in self.actions.items() if a == action)

    def enforced_in(self, language: str, surface: str = "comment") -> frozenset[Category]:
        """Categories allowed to fire on this text.

        Three filters, each removing a category from the decision entirely rather
        than making it less likely — a category that cannot be trusted here should
        not be quietly deciding anything here:

          _NOT_ENFORCED     the model is wrong about it on our text at all
          _LANGUAGE_SCOPE   it is only trustworthy in some languages
          _INTERPERSONAL    it needs a recipient, and a new post has none

        The default surface is `comment` — the stricter one — so a caller that
        forgets to pass a surface gets more checking rather than less.
        """
        # A member's own post is not moderated at all. Every category is out of
        # scope; only crisis detection runs, and it gates nothing.
        if surface not in _ADDRESSED_SURFACES:
            return frozenset()
        return frozenset(
            c for c in Category
            if c not in _NOT_ENFORCED
            and language in _LANGUAGE_SCOPE.get(c, frozenset({language}))
        )

    def out_of_scope(self, language: str, surface: str = "comment") -> frozenset[Category]:
        return frozenset(Category) - self.enforced_in(language, surface)


def defaults(note: str = "") -> Policy:
    return Policy(
        thresholds={c: _DEFAULT_THRESHOLD for c in Category},
        actions=dict(_DEFAULT_ACTIONS),
        source="defaults",
        note=note,
        # Nothing has been calibrated, so nothing has been measured. Every
        # category is unmeasured, which is the honest reading of a fallback and
        # also what lets the lexical guardrails run on a fresh clone.
        unmeasured=frozenset(Category),
    )


def load(path: Path | None = None, model_version: str | None = None) -> Policy:
    """Load calibrated policy, or fall back to defaults.

    A category present in the file but flagged `meets_precision_floor: false` is
    demoted to human review regardless of its configured action: a category that
    cannot hit its precision floor must not be allowed to block content.

    `model_version` is the scoring model the thresholds are about to be applied to.
    **A threshold set belongs to the model that produced it.** A threshold is a cut
    point on one model's score distribution and means nothing on another's, so a
    mismatch falls back to defaults rather than applying numbers calibrated for a
    different model.

    This is not hypothetical. a1-v1 calibrated `bullying_harassment` to 0.97,
    `hate_speech` to 0.97 and `grooming_exploitation` to 0.99, while the lexicon
    baseline saturates at 0.95 — so loading a1-v1's thresholds against the default
    heuristic backend silently disabled three block-tier categories. Nothing raised;
    the categories simply never fired.
    """
    if path is None or not path.exists():
        return defaults()

    payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    file_version = str(payload.get("model_version", "unknown"))

    if model_version is not None and model_version != file_version:
        return defaults(
            note=(
                f"{path.name} is calibrated for {file_version!r}, but the loaded "
                f"scoring model is {model_version!r}. Thresholds are not "
                f"transferable between models; using defaults."
            )
        )

    base = defaults()
    thresholds = dict(base.thresholds)
    actions = dict(base.actions)
    # A category absent from the file was not measured either, so this starts
    # full and rows remove themselves from it by proving otherwise.
    unmeasured = set(Category)

    for name, row in (payload.get("categories") or {}).items():
        try:
            category = Category(name)
        except ValueError:
            continue

        thresholds[category] = float(row.get("threshold", _DEFAULT_THRESHOLD))
        action = row.get("action", actions[category])

        if row.get("calibrated", False):
            unmeasured.discard(category)

        # A block-tier category is demoted to human review unless calibration
        # actually established it can block safely. Two ways it fails to:
        #
        #   meets_precision_floor: false   swept, and no threshold reached the
        #                                  precision this category needs
        #   calibrated: false              never swept — too few positive
        #                                  validation examples to sweep with, so
        #                                  the threshold is an arbitrary 0.5
        #
        # Only the first was checked, which left the second blocking posts on a
        # default. calibrate.py already prints "A category that does not meet its
        # precision floor must not be enabled for its configured action. Route it
        # to human review" — this is that instruction, enforced rather than
        # printed.
        #
        # Demotion stops at `review`. `reword` is advisory on a post and is a
        # lighter touch than limited visibility, so escalating it would move the
        # wrong way.
        if action == "block" and not (
            row.get("calibrated", False) and row.get("meets_precision_floor", True)
        ):
            action = "review"

        actions[category] = action

    return Policy(
        thresholds=thresholds,
        actions=actions,
        source=str(path),
        model_version=file_version,
        unmeasured=frozenset(unmeasured),
    )
