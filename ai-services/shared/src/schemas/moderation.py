"""The moderation contract.

Two views of every verdict, and the distinction is a product requirement rather than
a convenience:

    Verdict        internal. Carries per-category scores, model ids and thresholds.
                   Goes to the audit log and the evaluation harness.

    PublicVerdict  what a user or moderator sees. Carries the category and general
                   reason, never a score or a threshold.

Architecture §6.3: "Do not reveal exact model thresholds, filtering rules, or evasion
details." A single model that returned scores to the interface would leak the map an
abuser needs to route around the filter.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


class Category(str, Enum):
    """The moderation categories.

    Fifteen come from architecture §6.1. The sixteenth,
    `help_seeking_discouragement`, was added afterwards: §6.1 inherited a category
    list shaped by generic toxicity work, and it has no label for telling someone in
    a mental wellness community to stop sharing. That behaviour attacks the platform's
    core protective function and is one of its most product-specific harms.
    """

    BULLYING_HARASSMENT = "bullying_harassment"
    HATE_SPEECH = "hate_speech"
    THREATS_INTIMIDATION = "threats_intimidation"
    STALKING_DOXXING = "stalking_doxxing"
    MANIPULATION_COERCION = "manipulation_coercion"
    GROOMING_EXPLOITATION = "grooming_exploitation"
    PASSIVE_AGGRESSIVE_ABUSE = "passive_aggressive_abuse"
    SELF_HARM_ENCOURAGEMENT = "self_harm_encouragement"
    UNSAFE_MEDICAL_ADVICE = "unsafe_medical_advice"
    RELIGIOUS_COERCION = "religious_coercion"
    SCAMS_FINANCIAL_EXPLOITATION = "scams_financial_exploitation"
    MALWARE_PHISHING = "malware_phishing"
    SEXUAL_EXPLOITATION = "sexual_exploitation"
    IMPERSONATION = "impersonation"
    EMOTIONAL_DEPENDENCY_PRESSURE = "emotional_dependency_pressure"
    HELP_SEEKING_DISCOURAGEMENT = "help_seeking_discouragement"


class Decision(str, Enum):
    """Architecture §6.2. The only outcomes the pipeline may produce."""

    ALLOWED = "allowed"
    SUGGEST_REWORDING = "suggest_rewording"
    LIMITED_VISIBILITY = "limited_visibility"
    BLOCKED = "blocked"
    CRISIS_FLAG = "crisis_flag"
    ABUSE_PATTERN = "abuse_pattern"


class RiskLevel(str, Enum):
    """Architecture §10. Crisis triage is scored separately from moderation."""

    NONE = "none"
    LOW = "low"
    MODERATE = "moderate"
    HIGH = "high"


class PiiKind(str, Enum):
    PHONE = "phone"
    EMAIL = "email"
    AADHAAR = "aadhaar"
    UPI_VPA = "upi_vpa"
    URL = "url"
    PAN = "pan"


class PiiFinding(BaseModel):
    """A located personal-data leak.

    `text` holds the matched substring so the composer can highlight it in place.
    This object never leaves the user's own request cycle — it is not logged, because
    logging it would write the very identifier we are trying to keep out of the post.
    """

    kind: PiiKind
    start: int
    end: int
    text: str


class CategoryScore(BaseModel):
    category: Category
    score: float = Field(ge=0.0, le=1.0)
    threshold: float = Field(ge=0.0, le=1.0)

    @property
    def fired(self) -> bool:
        return self.score >= self.threshold


class PublicVerdict(BaseModel):
    """The safe projection. Nothing here helps someone evade the filter."""

    decision: Decision
    categories: list[Category] = Field(default_factory=list)
    reason: str = ""
    rewrite_guidance: str | None = None
    pii_kinds: list[PiiKind] = Field(default_factory=list)

    # Whether the rewrite blocks publication, which depends on the surface.
    #
    # A new post is a person describing their own experience. It may be bleak,
    # angry or bitter, and none of that is a reason to stop them saying it — so a
    # rewrite there is advice the author can decline.
    #
    # A reply is aimed at somebody else, usually somebody in distress. There the
    # rewrite is a gate: the message does not land until it changes.
    rewrite_required: bool = False

    appealable: bool = True
    notice: str = (
        "This decision was made by automated safety systems and may be reviewed by a "
        "human moderator."
    )


class Verdict(BaseModel):
    """Internal. Scores, model provenance and timings for audit and evaluation."""

    decision: Decision
    risk_level: RiskLevel = RiskLevel.NONE
    scores: list[CategoryScore] = Field(default_factory=list)
    pii: list[PiiFinding] = Field(default_factory=list)
    reason: str = ""
    rewrite_guidance: str | None = None
    rewrite_required: bool = False
    surface: str = "post"
    # Language the pipeline decided this was, and therefore which
    # categories were allowed to fire. Internal only: the public
    # verdict never exposes it, because "we treated your post as
    # Hinglish" is a filtering rule under architecture §6.3.
    language: str = "en"

    # Categories the model scored but policy did not allow to decide, because
    # they are not trustworthy in this language (policy.py `_LANGUAGE_SCOPE`).
    # Their scores stay in `scores` for the audit log; they are excluded from
    # `fired_categories` so the decision and the user-facing reason agree.
    out_of_scope: list[Category] = Field(default_factory=list)

    safety_model_id: str = ""
    crisis_model_id: str = ""
    latency_ms: int = 0

    @property
    def fired_categories(self) -> list[Category]:
        """Categories that crossed threshold AND were allowed to act.

        The scope filter has to live here rather than only at the decision site.
        `to_public()` reads this property, so a version that ignored scope would
        tell a Hinglish user their post was flagged for passive aggression while
        the decision had already discarded that category — the verdict and its
        stated reason would disagree.
        """
        excluded = set(self.out_of_scope)
        return [s.category for s in self.scores if s.fired and s.category not in excluded]

    def to_public(self) -> PublicVerdict:
        """Project to the view a user may see.

        Scores, thresholds, model ids and PII offsets are all dropped. Only the kind
        of personal data found survives, so the interface can say "this looks like a
        phone number" without echoing the number back into a log.
        """
        return PublicVerdict(
            decision=self.decision,
            categories=self.fired_categories,
            reason=self.reason,
            rewrite_guidance=self.rewrite_guidance,
            pii_kinds=sorted({f.kind for f in self.pii}, key=lambda k: k.value),
            rewrite_required=self.rewrite_required,
            # Appealable exactly when something was stopped. A mandatory rewrite is
            # a soft block, so it needs the appeal route a block gets (§6.3) —
            # otherwise a false positive leaves the responder with no way through.
            #
            # An advisory rewrite stopped nothing, so there is nothing to appeal.
            # ALLOWED likewise. CRISIS_FLAG is a support offer, not a sanction, and
            # the message still publishes.
            appealable=(
                self.decision
                in {Decision.BLOCKED, Decision.LIMITED_VISIBILITY, Decision.ABUSE_PATTERN}
                or (self.decision is Decision.SUGGEST_REWORDING and self.rewrite_required)
            ),
        )


class ModerationRequest(BaseModel):
    text: str = Field(min_length=1, max_length=20_000)
    surface: str = Field(default="post", pattern="^(post|comment|message)$")
    language_hint: str | None = None
