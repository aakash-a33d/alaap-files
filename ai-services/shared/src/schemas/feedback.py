"""Feedback on what the AI did.

Two things a member can tell us, and they are about different models:

    ai_response         the supportive reply their post received (B1)
    moderation_verdict  a decision the filter made about their words (A1/A2)

**No message text is stored here.** A feedback record references content by its
public id and carries the verdict, never a copy of what was written. Copying the
text would put community content into a second store with its own retention,
outside the consent scope it was written under — and the text is already in the
community vault, where the retention and deletion rules already reach it.

When a record is later pulled for clinician review, the text is fetched from the
owning service under a purpose check. That is slower and it is the point: it means
a deletion request actually empties the training queue too.

Nothing here trains anything by itself. See docs/ai/feedback-loop.md.
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum

from pydantic import BaseModel, Field


class FeedbackKind(str, Enum):
    AI_RESPONSE = "ai_response"
    MODERATION_VERDICT = "moderation_verdict"


class Rating(str, Enum):
    """Deliberately three, not a five-star scale.

    A star rating invites people to score the AI's writing. These ask the only
    question that matters clinically: did this land well, badly, or do harm.
    `harmful` is separated from `not_helpful` because they need different
    response times — one is a training signal, the other is an incident.
    """

    HELPFUL = "helpful"
    NOT_HELPFUL = "not_helpful"
    HARMFUL = "harmful"


class FeedbackIn(BaseModel):
    kind: FeedbackKind
    rating: Rating

    # The public reference of the post or comment — P-883920, C-1174. Never text.
    target_ref: str = Field(min_length=1, max_length=64)

    # What produced the thing being rated, so a rating can still be attributed
    # after the model is retrained.
    model_id: str = Field(default="", max_length=128)
    model_version: str = Field(default="", max_length=64)

    # For moderation feedback: the decision the member is disagreeing with.
    decision: str | None = Field(default=None, max_length=32)

    surface: str = Field(default="post", pattern="^(post|reply|message)$")

    # Optional free text from the member. Capped short: this is a reason, not a
    # second composer, and it is not moderated before it is stored.
    note: str | None = Field(default=None, max_length=500)


class FeedbackRecord(FeedbackIn):
    received_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    # Every record enters the queue unreviewed and stays that way until a human
    # acts on it. There is no code path that sets this to true automatically.
    reviewed: bool = False
