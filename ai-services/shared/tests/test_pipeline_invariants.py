"""Invariants that must hold whichever model sits behind the interface.

These are not accuracy tests. They assert structural properties that a future
fine-tuned checkpoint must not break — the things that would still be bugs at 99%
accuracy.
"""

from __future__ import annotations

import pytest

from alaap_ai.community_moderation.pipelines.moderate import ModerationPipeline
from alaap_ai.shared.redaction import pii
from alaap_ai.shared.schemas.moderation import Category, Decision, PiiKind, RiskLevel


@pytest.fixture(scope="module")
def pipeline() -> ModerationPipeline:
    return ModerationPipeline()


# ---------------------------------------------------------------- PII

def test_verhoeff_accepts_valid_aadhaar():
    assert pii.is_aadhaar("2340 1234 5678")


def test_verhoeff_rejects_order_number():
    """Twelve digits are not an Aadhaar. Without the checksum every order
    number in the community would raise a personal-data warning."""
    assert not pii.is_aadhaar("1234 5678 9012")


def test_aadhaar_rejects_leading_zero_or_one():
    assert not pii.is_aadhaar("0340123456 78")


def test_upi_detected_at_end_of_sentence():
    """Regression: an unbounded lookahead tripped on the sentence's full stop."""
    found = pii.detect("Send it to priya@okaxis if you want to split the cost.")
    assert PiiKind.UPI_VPA in {f.kind for f in found}


def test_email_is_not_reported_as_upi():
    kinds = {f.kind for f in pii.detect("reach me at priya.sharma@example.com")}
    assert PiiKind.EMAIL in kinds
    assert PiiKind.UPI_VPA not in kinds


def test_redact_removes_the_identifier():
    redacted = pii.redact("call me on 9876543210 anytime")
    assert "9876543210" not in redacted
    assert "[phone]" in redacted


# ---------------------------------------------------- disclosure boundary

def test_public_verdict_never_carries_scores(pipeline):
    """§6.3 — thresholds and scores are a map for evading the filter."""
    public = pipeline.run("You are worthless and pathetic").to_public()
    serialised = public.model_dump_json()
    assert "score" not in serialised
    assert "threshold" not in serialised
    assert "model" not in serialised


def test_public_verdict_drops_pii_text(pipeline):
    """The kind survives so the interface can explain itself; the value does not."""
    public = pipeline.run("my number is 9876543210").to_public()
    assert PiiKind.PHONE in public.pii_kinds
    assert "9876543210" not in public.model_dump_json()


# ------------------------------------------------------ clinical safety

@pytest.mark.parametrize(
    "text",
    [
        "I feel worthless most days and I don't know who to talk to.",
        "I don't want to live like this anymore.",
        "Nothing matters and I feel like a burden to everyone.",
    ],
)
def test_distress_is_never_moderated(pipeline, text):
    """The worst failure available to this product: moderating someone for
    describing their own pain."""
    verdict = pipeline.run(text)
    assert verdict.decision not in {
        Decision.BLOCKED,
        Decision.SUGGEST_REWORDING,
        Decision.LIMITED_VISIBILITY,
    }
    assert verdict.risk_level is not RiskLevel.NONE


def test_insult_is_not_a_crisis_signal(pipeline):
    """"You are worthless" is harassment, not the author's distress. Without the
    second-person check this routes a victim's abuser into the crisis queue."""
    verdict = pipeline.run("You are worthless and pathetic, nobody likes you.",
                           surface="comment")
    assert verdict.risk_level is RiskLevel.NONE
    assert verdict.decision is Decision.BLOCKED


def test_risk_survives_a_blocking_decision(pipeline):
    """A person in crisis who also breaks a rule must still reach support.
    The safety workflow keys off risk_level, never off the decision."""
    verdict = pipeline.run(
        "I want to die. Also you are pathetic and nobody likes you.",
        surface="comment",
    )
    assert verdict.decision is Decision.BLOCKED
    assert verdict.risk_level is RiskLevel.HIGH


def test_personal_data_warns_rather_than_blocks(pipeline):
    """It is the author's own information and their call to publish it."""
    verdict = pipeline.run("if anyone wants to talk, reach me on 9876543210")
    assert verdict.decision is Decision.SUGGEST_REWORDING


@pytest.mark.parametrize(
    "text",
    [
        "I feel like you should keep your issues with yourself and not share it",
        "Keep your problems to yourself, nobody wants to read this every day.",
        "Stop airing your problems in public, it is embarrassing for everyone.",
    ],
)
def test_discouraging_disclosure_is_moderated(pipeline, text):
    """The sixteenth category. Telling someone to stop sharing attacks the exact
    behaviour the platform exists to make safe.

    Asserted on a reply. The same words in the member's own post are not
    moderated at all — a post is never gated, and that is deliberate.
    """
    verdict = pipeline.run(text, surface="comment")
    assert Category.HELP_SEEKING_DISCOURAGEMENT in verdict.fired_categories
    assert verdict.decision is Decision.SUGGEST_REWORDING


@pytest.mark.parametrize(
    "text",
    [
        "You should talk to your doctor about this rather than us.",
        "This might get better answers in the medication thread.",
        "I need to step back from this group for a while.",
        "Whatever you choose to share or not share here is entirely up to you.",
    ],
)
def test_redirecting_support_is_not_discouraging_it(pipeline, text):
    """Signposting to better help, routing, and a person's own boundary are all
    protective. The marker is whether support is redirected or withdrawn."""
    verdict = pipeline.run(text)
    assert Category.HELP_SEEKING_DISCOURAGEMENT not in verdict.fired_categories
    assert verdict.decision is Decision.ALLOWED


# ------------------------------------------------- surface-dependent gating

HOSTILE = "Keep your problems to yourself, nobody wants to read this every day."


def test_reply_rewrite_is_mandatory(pipeline):
    """A reply is aimed at another person, usually one in distress. It does not
    land until it changes."""
    verdict = pipeline.run(HOSTILE, surface="comment")
    assert verdict.decision is Decision.SUGGEST_REWORDING
    assert verdict.rewrite_required is True
    assert "can't be posted" in verdict.reason


def test_a_post_is_not_moderated_at_all(pipeline):
    """A new post is the author describing their own experience. It may be bleak,
    angry or bitter, and none of that is a reason to stop them saying it.

    This used to produce an advisory rewrite. It now produces nothing: no
    category is in scope for a member's own post, so the same words that gate a
    reply pass a post untouched. Only crisis detection runs, and it gates
    nothing either.
    """
    verdict = pipeline.run(HOSTILE, surface="post")
    assert verdict.decision is Decision.ALLOWED
    assert verdict.rewrite_required is False
    assert verdict.fired_categories == []


def test_mandatory_rewrite_is_appealable(pipeline):
    """A gate with no appeal route leaves a false positive with no way through."""
    assert pipeline.run(HOSTILE, surface="comment").to_public().appealable is True


def test_advisory_rewrite_is_not_appealable(pipeline):
    """Nothing was stopped, so there is nothing to appeal."""
    assert pipeline.run(HOSTILE, surface="post").to_public().appealable is False


def test_direct_message_is_gated_like_a_reply(pipeline):
    assert pipeline.run(HOSTILE, surface="message").rewrite_required is True


def test_distress_post_is_never_gated(pipeline):
    """The failure this split exists to prevent: someone in pain unable to publish
    because a model disliked their tone."""
    verdict = pipeline.run(
        "Must be nice to have parents who actually listen. I guess some people just "
        "get everything easy.",
        surface="post",
    )
    assert verdict.rewrite_required is False


def test_ordinary_post_passes_untouched(pipeline):
    verdict = pipeline.run(
        "Had a rough week but my sister called and it helped a lot."
    )
    assert verdict.decision is Decision.ALLOWED
    assert verdict.risk_level is RiskLevel.NONE


# ---------------------------------------------- language scoping

def test_hinglish_is_not_judged_by_an_english_only_category(pipeline):
    """`passive_aggressive_abuse` is scoped to English because a1-v10 misses 61%
    of Hinglish covert aggression and flags benign Hinglish seven times more
    often than benign English.

    Scoping means the category is removed from the decision, not merely made
    unlikely — a category that cannot be trusted in a language must not quietly
    decide anything in it.
    """
    from alaap_ai.shared.schemas.moderation import Category

    assert Category.PASSIVE_AGGRESSIVE_ABUSE in pipeline.policy.enforced_in("en")
    assert Category.PASSIVE_AGGRESSIVE_ABUSE not in pipeline.policy.enforced_in("hi-Latn")
    # Language scoping removes it from Hinglish only; `grooming_exploitation` is
    # unenforced in every language for a separate reason (register, not language).
    assert (pipeline.policy.out_of_scope("hi-Latn") - pipeline.policy.out_of_scope("en")
            == {Category.PASSIVE_AGGRESSIVE_ABUSE})


def test_language_is_detected_not_taken_on_trust(pipeline):
    """A caller that mislabels Hinglish as English would re-enable the exact
    behaviour the scope exists to prevent, so the hint never overrides the text."""
    hinglish = "aap kya kar rahe ho, mujhe nahi samajh aaya ki yeh kaise hoga"
    assert pipeline.run(hinglish).language == "hi-Latn"
    assert pipeline.run(hinglish, language_hint="en").language == "hi-Latn"
    assert pipeline.run("i have been feeling low all week").language == "en"


def test_scoped_category_score_still_reaches_the_audit_log(pipeline):
    """Dropping a category from the decision must not hide it from review. The
    score still travels in the internal Verdict so a reviewer can see what the
    model thought and that policy overrode it."""
    from alaap_ai.shared.schemas.moderation import Category

    verdict = pipeline.run("must be nice, aap toh hamesha theek ho na")
    scored = {s.category for s in verdict.scores}
    assert Category.PASSIVE_AGGRESSIVE_ABUSE in scored
    assert Category.PASSIVE_AGGRESSIVE_ABUSE not in verdict.fired_categories


# ------------------------------------------- posts are not replies

def test_venting_in_a_post_is_not_refused(pipeline):
    """a1-v10 blocked "my boss is a worthless bully and i cant stand another day
    of it" as harassment, on a new post.

    That is somebody describing their own life, about a person who is not on the
    platform. Refusing it moderates a member for the tone of their own pain,
    which is the specific failure this product cannot have. Interpersonal
    categories cannot block or hide an unaddressed post; the most they produce
    there is a rewrite the author may decline.
    """
    for text in (
        "my boss is a worthless bully and i cant stand another day of it",
        "i hate everyone in my family right now, they are all selfish and cruel",
    ):
        verdict = pipeline.run(text, surface="post")
        assert verdict.decision not in {Decision.BLOCKED, Decision.LIMITED_VISIBILITY}
        assert not verdict.rewrite_required


def test_even_an_insult_in_a_post_is_not_moderated(pipeline):
    """The rule is the surface, not the wording.

    An earlier attempt kept the check for posts that addressed somebody in the
    second person. That is a defensible design and it is not this one: a member's
    own post is not moderated, full stop. The same words in a reply are blocked
    (test_insult_is_not_a_crisis_signal), which is where the harm actually lands.
    """
    verdict = pipeline.run(
        "you are worthless and pathetic, nobody here likes you", surface="post"
    )
    assert verdict.decision is not Decision.BLOCKED
    assert verdict.fired_categories == []


def test_the_same_words_are_gated_in_a_reply(pipeline):
    """A reply lands on somebody already having a hard day, so the cap never
    applies there — the identical text is treated more strictly."""
    # Phrased to fire on the lexicon baseline as well as a checkpoint, because
    # this file asserts invariants that must hold whichever model is loaded.
    text = "Must be nice. I guess some people just get everything easy."
    post = pipeline.run(text, surface="post")
    reply = pipeline.run(text, surface="comment")
    assert post.decision not in {Decision.BLOCKED, Decision.LIMITED_VISIBILITY}
    assert not post.rewrite_required
    assert reply.rewrite_required


def test_a_post_is_still_read_for_crisis(pipeline):
    """Capping the interpersonal categories must not touch crisis detection —
    that is the one check a new post most needs."""
    verdict = pipeline.run("i dont want to be here anymore", surface="post")
    assert verdict.risk_level is not RiskLevel.NONE
    assert verdict.decision is Decision.CRISIS_FLAG


# ------------------------------------- a reply is gated on what A1 found

def test_a_moderated_reply_is_not_masked_by_the_crisis_flag(pipeline):
    """A reply that is both hostile and distressed must come back as the
    moderation outcome, with the crisis signal beside it.

    CRISIS_FLAG used to outrank everything but BLOCKED. It carries no rewrite
    guidance and stops nothing, so a reply that was hostile *and* distressed
    published its hostility unremarked — the flag effectively laundered it.

    Both axes still answer. `decision` is what the writer must do about the
    words; `risk_level` is what the platform must do about the person, and it is
    untouched by which decision won.
    """
    verdict = pipeline.run(
        "I want to die. Keep your problems to yourself, nobody wants to read this.",
        surface="comment",
    )
    assert verdict.decision is not Decision.CRISIS_FLAG
    assert verdict.rewrite_required is True
    assert verdict.risk_level is RiskLevel.HIGH


def test_anything_that_fires_carries_guidance(pipeline):
    """A reply does not send until it changes, so a reply that is stopped
    without being told what to change is a closed door and no handle.

    Guidance used to be emitted only for SUGGEST_REWORDING, which left every
    blocked and every held reply with an empty panel — the two outcomes where
    the member has least idea what to do.
    """
    for text in (
        "You are worthless and pathetic, nobody likes you.",
        "Keep your problems to yourself, nobody wants to read this every day.",
    ):
        verdict = pipeline.run(text, surface="comment")
        assert verdict.fired_categories
        assert verdict.rewrite_guidance, f"no guidance for {verdict.decision}: {text!r}"


# ------------------------------------------- the lexical guardrails

def test_discouragement_is_caught_without_a_trained_head(pipeline):
    """a1-v10 scores `help_seeking_discouragement` at 0.000 on every input.

    Fifteen examples in the v10 corpus, `support: 0` in the threshold file — the
    head was never trained. What was catching the occasional phrase was
    `passive_aggressive_abuse` firing beside it, at 0.94, on text almost verbatim
    from its own training set: one capital letter moved that score from 0.985 to
    0.385, and "You should keep it to yourself" published unremarked.

    The rule is a stopgap for a missing corpus and it should be deleted the day a
    checkpoint scores the category.
    """
    for text in (
        "You should keep it to yourself",
        "nobody wants to read about this",
        "stop posting about it, deal with it privately",
        "this is just attention seeking",
    ):
        verdict = pipeline.run(text, surface="comment")
        assert Category.HELP_SEEKING_DISCOURAGEMENT in verdict.fired_categories, text
        assert verdict.rewrite_required, text


def test_a_rule_can_ask_for_a_rewrite_and_never_block(pipeline):
    """The evidence behind a guardrail hit is that somebody wrote a regex. That
    is enough to ask a person to rephrase; it is not enough to refuse them.

    `_SCORE` sits below every block-tier threshold for this reason, so a rule
    can never be the thing that produces BLOCKED.
    """
    verdict = pipeline.run("nobody would miss you", surface="comment")
    assert Category.SELF_HARM_ENCOURAGEMENT in verdict.fired_categories
    assert verdict.decision is not Decision.BLOCKED


@pytest.mark.parametrize(
    "text",
    [
        # First person. The rules require the second person precisely so these
        # cannot match — moderating somebody for describing their own despair is
        # the worst failure this product has available to it.
        "there is no point in going on and i am so tired",
        "i want to end it, i really do",
        "i feel like nobody would miss me if i were gone",
        # Redirection and boundaries, not withdrawal of support.
        "You should talk to your doctor about this rather than us.",
        "This might get better answers in the medication thread.",
        "Whatever you choose to share or not share here is entirely up to you.",
        "I need to step back from this group for a while.",
    ],
)
def test_the_rules_cannot_reach_distress_or_signposting(pipeline, text):
    verdict = pipeline.run(text, surface="comment")
    assert Category.SELF_HARM_ENCOURAGEMENT not in verdict.fired_categories, text
    assert Category.HELP_SEEKING_DISCOURAGEMENT not in verdict.fired_categories, text
    assert not verdict.rewrite_required, text


def test_a_calibrated_category_silences_its_own_rules():
    """The rules retire themselves. They run only for categories `Policy` reports
    as unmeasured, so a checkpoint that learns one stops consulting its patterns
    with no edit to the guardrail file — which is the only thing standing between
    "stopgap" and "permanent regex in the moderation path".
    """
    from alaap_ai.community_moderation.guardrails import lexical

    hit = "You should keep it to yourself"
    assert lexical.score(hit, [Category.HELP_SEEKING_DISCOURAGEMENT])
    assert not lexical.score(hit, [])


def test_a_post_that_fires_nothing_carries_no_guidance(pipeline):
    """The other half of the rule. Guidance follows what fired, and on a post
    nothing can fire, so there is nothing to say."""
    verdict = pipeline.run(
        "you are worthless and pathetic, nobody here likes you", surface="post"
    )
    assert verdict.rewrite_guidance is None
