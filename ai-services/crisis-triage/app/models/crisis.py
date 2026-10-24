"""A2 — the crisis classifier.

A separate model from A1, deliberately. Sharing a base checkpoint is fine; sharing a
head is not. Moderation and crisis carry different clinical governance, different
evaluation gates and different legal exposure, and a moderation retrain must never
silently move a crisis threshold.

The distinction this model draws is the one the product depends on:

    someone expressing distress          -> support, never moderation
    someone encouraging harm in another  -> A1's job, not this one

Getting that backwards in either direction is the worst failure mode available to
this platform.
"""

from __future__ import annotations

import re

from alaap_ai.shared.inference.base import ModelUnavailable
from alaap_ai.shared.schemas.moderation import RiskLevel

# Ordered most severe first. Baseline only — real crisis language is idiomatic,
# euphemistic and culture-specific, which is exactly what a phrase list misses and
# a fine-tuned model must learn.
# Regexes rather than substrings, because inflection matters: a list containing
# "want to die" silently misses "wants to die". That exact gap caused a missed
# high-risk case on the first evaluation run, which is the kind of brittleness the
# fine-tuned model exists to remove.
_HIGH = re.compile(
    r"\b(kill(ing)? (myself|my self)"
    r"|end(ing)? (my life|it all)"
    r"|(don'?t|do not|dont|didn'?t) want to (live|be here)"
    r"|not want to live"
    r"|wants? to die"
    r"|suicid\w*"
    r"|take my own life"
    r"|goodbye forever"
    r"|won'?t be here (tomorrow|much longer)"
    r"|sab khatam"
    r"|jeena nahi chahta)\b",
    re.IGNORECASE,
)

_MODERATE = re.compile(
    r"\b(can'?t go on"
    r"|no reason to live"
    r"|hopeless"
    r"|giving up|give up"
    r"|nothing matters"
    r"|worthless"
    r"|can'?t take it (anymore|any more)"
    r"|trapped"
    r"|burden to everyone"
    r"|ghutan)\b",
    re.IGNORECASE,
)

_LOW = re.compile(
    r"\b(overwhelmed|exhausted|anxious|panic|can'?t sleep|crying|alone|lonely"
    r"|stressed|scared|feeling (low|down))\b",
    re.IGNORECASE,
)

# Directed at someone else, with no self-reference: "you are worthless" is
# harassment for A1 to judge, not a crisis signal about the author. Without this,
# an insult routes a victim's abuser into the crisis workflow.
_SECOND_PERSON = re.compile(r"\b(you|your|you'?re|u)\b", re.IGNORECASE)
_SELF_REFERENCE = re.compile(r"\b(i|i'?m|i'?ve|im|me|my|myself)\b", re.IGNORECASE)

# A plan or a timeframe escalates moderate language to high.
_PLAN = re.compile(
    r"\b(tonight|tomorrow|today|this weekend|pills|rope|bridge|already (?:wrote|written))\b",
    re.IGNORECASE,
)

# Distress reported in the past, or about someone else, is not an active signal.
_PAST_OR_THIRD_PARTY = re.compile(
    r"\b(used to|years ago|back then|my friend|my sister|my brother|"
    r"a friend of mine|someone i know|when i was)\b",
    re.IGNORECASE,
)


class HeuristicCrisisClassifier:
    model_id = "baseline-crisis-v0"

    def score(self, text: str) -> tuple[RiskLevel, float]:
        lowered = text.lower()

        # Addressed at another person with no self-reference: not this model's call.
        if _SECOND_PERSON.search(lowered) and not _SELF_REFERENCE.search(lowered):
            return RiskLevel.NONE, 0.0

        high = bool(_HIGH.search(lowered))
        moderate = bool(_MODERATE.search(lowered))
        low = bool(_LOW.search(lowered))

        attenuated = bool(_PAST_OR_THIRD_PARTY.search(lowered))

        if high:
            if attenuated:
                return RiskLevel.MODERATE, 0.55
            return RiskLevel.HIGH, 0.9 if _PLAN.search(lowered) else 0.8

        if moderate:
            if _PLAN.search(lowered) and not attenuated:
                # Intent plus a timeframe is the escalation that matters most.
                return RiskLevel.HIGH, 0.75
            return RiskLevel.MODERATE, 0.5

        if low:
            return RiskLevel.LOW, 0.3

        return RiskLevel.NONE, 0.0


class TransformerCrisisClassifier:  # pragma: no cover
    """The real backend. Requires clinician sign-off on its risk bands before use."""

    def __init__(self, checkpoint: str = "google/muril-large-cased") -> None:
        self.model_id = checkpoint
        self._pipe = None

    def score(self, text: str) -> tuple[RiskLevel, float]:
        raise ModelUnavailable(
            "the crisis model is gated on clinical-safety-en and clinician-signoff; "
            "see metadata/ai/model-registry"
        )


def build(backend: str = "heuristic", **kwargs):
    if backend == "heuristic":
        return HeuristicCrisisClassifier()
    if backend == "transformer":
        return TransformerCrisisClassifier(**kwargs)
    raise ModelUnavailable(f"unknown crisis backend: {backend!r}")
