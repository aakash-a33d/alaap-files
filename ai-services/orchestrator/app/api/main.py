"""AI orchestrator — the only HTTP surface the backend calls.

Two projections of the same verdict, on two different routes, because they have two
different audiences:

    POST /v1/moderate           public. No scores, no thresholds, no model ids.
    POST /v1/moderate/internal  service-to-service. Full verdict, for audit and eval.

Splitting them at the routing layer rather than by a query flag means a public
response cannot leak internals through a forgotten default.
"""

from __future__ import annotations

import os
from pathlib import Path

from datetime import datetime, timezone

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field

from alaap_ai.community_moderation.pipelines.moderate import ModerationPipeline
from alaap_ai.shared.schemas.feedback import FeedbackIn, FeedbackRecord
from alaap_ai.supportive_response import generate as _supportive
from alaap_ai.shared.service_auth import (
    SignatureError,
    VerifiedCaller,
    secret_from_env,
    verify_request,
)
from alaap_ai.shared.schemas.moderation import (
    ModerationRequest,
    PublicVerdict,
    RiskLevel,
    Verdict,
)

app = FastAPI(
    title="Alaap AI orchestrator",
    version="0.1.0",
    description="Prototype. Baseline models only — not cleared for clinical use.",
)

# The browser calls /v1/moderate directly only in development. In deployment the
# frontend talks to the Privacy Gateway, which calls this service over the
# internal network — this tier is never routed to a browser (§8.1). The allowed
# origins are therefore dev hosts only, and there is no wildcard.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        o.strip()
        for o in os.getenv(
            "ALAAP_DEV_ORIGINS",
            "http://localhost:5173,http://localhost:5174,http://localhost:5175,"
            "http://localhost:5176,http://localhost:5177",
        ).split(",")
        if o.strip()
    ],
    allow_methods=["POST", "GET"],
    allow_headers=["content-type"],
)

_pipeline = ModerationPipeline()

# B1, loaded at import like the moderation policy. `load_policy` refuses a file with no
# `forbidden` rules, so a stripped policy takes the service down here rather than
# silently letting unguarded text through to somebody in distress.
_supportive_policy = _supportive.load_policy()

# Warm the model before the port opens.
#
# A transformer backend loads lazily: the checkpoint reaches the GPU on the FIRST
# inference, not at construction. That made /health answer `ok` while the service could
# not actually return a verdict for the best part of a minute - and a caller with a
# sensible timeout got a timeout, which community-service correctly treats as
# "moderation unavailable" and refuses the reply. So a freshly started orchestrator
# rejected every reply on the platform until something happened to warm it.
#
# Doing this at import means uvicorn binds the port only once a verdict is possible.
# Startup is slower by however long the load takes, which is the honest trade: a
# service that is not ready should not be accepting traffic.
def _warm() -> None:
    import logging
    import time

    log = logging.getLogger("alaap.orchestrator")
    started = time.monotonic()
    try:
        _pipeline.run("warmup", "comment")
    except Exception as exc:  # noqa: BLE001 - never block startup on a warmup failure
        # Log and continue. A backend that cannot answer will fail on the first real
        # request too, and failing HERE would take out the /health route that an
        # operator needs in order to find out why.
        log.warning("model warmup failed: %s", exc)
        return
    log.info("model warm in %.1fs", time.monotonic() - started)


_warm()

# ---------------------------------------------------------------- gateway gate ---
#
# Until the gateway routed to this tier, the port answered anyone who could reach it.
# That is no longer acceptable: an unauthenticated classifier is a free oracle for
# working out what gets past moderation, and /v1/moderate/internal hands back the
# scores and thresholds that make that efficient.
#
# `secret_from_env()` returning None keeps `python ai-services/serve.py` working on a
# laptop with no gateway. It is logged loudly rather than treated as normal, because
# the same absence in a deployment is an open door.

_SERVICE_AUTH_SECRET = secret_from_env()

if _SERVICE_AUTH_SECRET is None:
    import logging

    logging.getLogger("alaap.orchestrator").warning(
        "ALAAP_SERVICE_AUTH_SECRET is unset - /v1 routes are UNAUTHENTICATED. "
        "Development only; the gateway cannot reach this tier in that state."
    )


def require_gateway(request: Request) -> VerifiedCaller | None:
    """Refuse anything that did not come through the Privacy Gateway.

    Logged with the reason, answered without it. A caller learns that it was refused,
    never which check failed - a precise reason is a probing oracle. Same rule the
    Node services follow in requireGateway().
    """
    if _SERVICE_AUTH_SECRET is None:
        return None
    try:
        return verify_request(dict(request.headers), _SERVICE_AUTH_SECRET)
    except SignatureError as exc:
        import logging

        logging.getLogger("alaap.orchestrator").warning(
            "rejected unsigned request: %s %s", exc.reason, request.url.path
        )
        raise HTTPException(status_code=401, detail={"error": {"code": "service_auth_required"}})

# Append-only queue. Prototype storage: in deployment this is a table in the
# community vault owned by moderation-service, not a file next to the model.
_FEEDBACK_QUEUE = Path(
    os.getenv(
        "ALAAP_FEEDBACK_QUEUE",
        Path(__file__).resolve().parents[3] / "evaluation" / "datasets" / "feedback-queue.jsonl",
    )
)


class Health(BaseModel):
    status: str
    safety_model: str
    crisis_model: str
    production_ready: bool
    # Categories the loaded model actually enforces. A model trained on a
    # partial corpus leaves the rest unenforced, and an operator should be able
    # to see that here rather than infer it from an absence of verdicts.
    #
    # `uncovered` is the union of the two breakdowns below. Alert on it.
    covered_categories: list[str]
    uncovered_categories: list[str]
    # The model produces no score for these at all.
    unscorable_categories: list[str] = []
    # The model scores these, but their threshold is above anything it can emit,
    # so they never fire. Indistinguishable from "nothing bad happened" unless
    # it is reported here.
    unreachable_categories: list[str] = []
    # Calibration could say nothing about these — too few positive validation
    # examples to sweep with, so the threshold is an arbitrary default. In
    # a1-v10 six of them are dead: the head emits 0.000 on every input.
    unmeasured_categories: list[str] = []
    # Of those, the ones a lexical rule stands in for. A rule is a stopgap for a
    # missing corpus, not a classifier, and it is reported separately so nobody
    # reads it as coverage.
    rule_guarded_categories: list[str] = []
    # False when the loaded threshold set was not calibrated for the loaded
    # model, which means every category is running on an uncalibrated default.
    thresholds_calibrated: bool = False
    thresholds_source: str = "defaults"


@app.get("/health", response_model=Health)
def health() -> Health:
    coverage = _pipeline.coverage
    return Health(
        status="ok",
        safety_model=_pipeline.safety.model_id,
        crisis_model=_pipeline.crisis.model_id,
        # Baseline backends have passed no evaluation gate. Anything consuming this
        # API in an environment that matters should refuse to start on `false`.
        production_ready=False,
        covered_categories=coverage["covered"],
        uncovered_categories=coverage["uncovered"],
        unscorable_categories=coverage["unscorable"],
        unreachable_categories=coverage["unreachable"],
        unmeasured_categories=coverage["unmeasured"],
        rule_guarded_categories=coverage["rule_guarded"],
        thresholds_calibrated=_pipeline.policy.calibrated,
        thresholds_source=_pipeline.policy.source,
    )


@app.post("/v1/moderate", response_model=PublicVerdict, dependencies=[Depends(require_gateway)])
def moderate(request: ModerationRequest) -> PublicVerdict:
    """The gate. Returns only what a user may safely be told."""
    return _pipeline.run(request.text, request.surface).to_public()


class SupportiveRequest(BaseModel):
    """A post to write one reply to."""

    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=4000)


class SupportiveReply(BaseModel):
    """The reply, or an honest account of why there is none.

    `ok` false is a NORMAL outcome, not an error. The post is published and its peers
    can answer; a missing AI reply is indistinguishable from a quiet thread, which is
    what most threads are anyway.
    """

    ok: bool
    text: str = ""
    # Operational only. Never reaches the member: telling somebody "the AI was going
    # to reply but we stopped it" is worse than the silence it explains.
    refused_by: str = ""
    latency_ms: int = 0
    model: str = ""
    attempts: int = 0


@app.post(
    "/v1/respond",
    response_model=SupportiveReply,
    dependencies=[Depends(require_gateway)],
)
def respond(request: SupportiveRequest) -> SupportiveReply:
    """B1. One supportive reply to a post, run past A1 before it is returned.

    Internal, and deliberately without a gateway path. A member who could call this
    directly would have a free generative endpoint; more to the point, the reply is
    written INTO their thread by community-service, and a route that hands it back
    instead would let somebody fish for a version they liked better.

    A1 runs over B1's own output here rather than in the caller, so that the rule
    ADR-0001 states - "A1 must moderate the AI's own output as well as the users'" -
    holds for every caller rather than for the ones that remember.
    """

    def moderate(text: str) -> tuple[str, list[str]]:
        verdict = _pipeline.run(text, "comment")
        fired = [s.category for s in verdict.scores if s.score >= s.threshold]
        return verdict.decision, fired

    result = _supportive.generate(
        request.text,
        _supportive_policy,
        moderate=moderate,
    )
    return SupportiveReply(
        ok=result.ok,
        text=result.text,
        refused_by=result.refused_by,
        latency_ms=result.latency_ms,
        model=result.model,
        attempts=result.attempts,
    )


@app.post(
    "/api/ai/check",
    response_model=PublicVerdict,
    dependencies=[Depends(require_gateway)],
)
def moderate_via_gateway(request: ModerationRequest) -> PublicVerdict:
    """The same gate, at the path the Privacy Gateway forwards.

    The gateway proxies a request to the upstream under its ORIGINAL path, so a
    service reachable through /api/ai has to answer there. /v1/moderate stays for the
    dev frontend, which talks to this tier directly while the browser path is being
    built; both are the same handler and the same projection.

    Only the public verdict is exposed here, and there is deliberately no gateway path
    for /v1/moderate/internal. That route returns scores, thresholds and model ids -
    routed to a browser it would be a tuning oracle for working out what gets past the
    filter, which is the one thing a moderation API must not hand out.
    """
    return _pipeline.run(request.text, request.surface).to_public()


@app.post("/v1/moderate/internal", response_model=Verdict, dependencies=[Depends(require_gateway)])
def moderate_internal(request: ModerationRequest) -> Verdict:
    """Full verdict for the calling service to audit and store.

    In deployment this route is bound to the internal network only and requires
    service-to-service authentication. It must never be routed through the gateway
    to a browser.
    """
    return _pipeline.run(request.text, request.surface)


class RiskOnly(BaseModel):
    """Crisis signal without the moderation verdict.

    The safety workflow keys off this, not off a CRISIS_FLAG decision — a post can
    be blocked for harming someone else and still come from a person in crisis.
    """

    risk_level: RiskLevel
    model_id: str


@app.post("/v1/triage", response_model=RiskOnly, dependencies=[Depends(require_gateway)])
def triage(request: ModerationRequest) -> RiskOnly:
    """A2 alone. No categories, no decision, nothing the writer is told.

    This is what a member's own post runs through while they type. A post is not
    moderated at all, so asking /v1/moderate for one would be asking a question
    whose answer must be discarded; this route asks only the question the
    platform is allowed to act on.
    """
    level, _score = _pipeline.crisis.score(request.text)
    return RiskOnly(risk_level=level, model_id=_pipeline.crisis.model_id)


class CrisisAlert(BaseModel):
    """Raised to mediation when a member publishes something A2 flagged.

    **Only on publication.** The flag is set while somebody types and it is not
    a record of anything until they press post: a draft that is abandoned, or a
    window that is closed, leaves nothing behind. Detecting distress in words
    nobody chose to say is surveillance, not safety.

    No text. The alert carries the band, the surface and the public reference of
    what was published — enough for a mediator to open the post through the
    platform and reach its author, and not a second copy of somebody's worst
    night sitting in a queue with a different retention policy.

    `extra="forbid"` is the enforcement of that, and it is deliberately not the
    pydantic default. Under the default (`ignore`) a client that started sending
    `text` would have it quietly dropped — the right outcome, reached silently,
    so nobody would learn that the client was trying. Forbidding it turns the
    same attempt into a 422 that a developer sees on the first request.
    """

    model_config = ConfigDict(extra="forbid")

    ref: str = Field(min_length=1, max_length=200)
    surface: str = Field(default="post", pattern="^(post|comment|message)$")
    risk_level: RiskLevel


class CrisisAlertRecord(CrisisAlert):
    raised_at: str
    crisis_model_id: str


class AlertAck(BaseModel):
    raised: bool


# Append-only, same prototype-storage caveat as the feedback queue: in
# deployment this is the safety workflow's own table, and mediation reads it
# from there rather than from a file beside a model.
_SAFETY_QUEUE = Path(
    os.getenv(
        "ALAAP_SAFETY_QUEUE",
        Path(__file__).resolve().parents[3] / "evaluation" / "datasets" / "safety-alerts.jsonl",
    )
)


@app.post("/v1/safety/alert", response_model=AlertAck, status_code=202, dependencies=[Depends(require_gateway)])
def raise_alert(alert: CrisisAlert) -> AlertAck:
    """Put a flagged publication in front of a human. Stops nothing.

    Nothing about this route is visible to the member who triggered it, by
    design: they said what they came to say, it published exactly as written,
    and the platform's response reaches them as a person rather than as an
    interruption to their post.
    """
    if alert.risk_level in (RiskLevel.NONE, RiskLevel.LOW):
        # Not an error — the client is allowed to be wrong about this — but
        # nothing is queued, so a mediator's list stays a list of real signals.
        return AlertAck(raised=False)

    _SAFETY_QUEUE.parent.mkdir(parents=True, exist_ok=True)
    with _SAFETY_QUEUE.open("a", encoding="utf-8", newline="\n") as fh:
        fh.write(
            CrisisAlertRecord(
                **alert.model_dump(),
                raised_at=datetime.now(timezone.utc).isoformat(),
                crisis_model_id=_pipeline.crisis.model_id,
            ).model_dump_json()
            + "\n"
        )
    return AlertAck(raised=True)


class FeedbackAck(BaseModel):
    queued: bool
    # Said back to the member so the interface can be honest about what happens
    # next. "Thanks, the AI will learn from this" would be a lie: nothing here
    # changes a model until a person has looked at it.
    message: str


@app.post("/v1/feedback", response_model=FeedbackAck, status_code=202, dependencies=[Depends(require_gateway)])
def submit_feedback(item: FeedbackIn) -> FeedbackAck:
    """Record what a member thought. Trains nothing.

    Appending to a queue is the entire operation, and that is deliberate. A
    safety classifier that retrained on this endpoint would be trivially
    poisoned: anyone wanting their harassment published submits `not_helpful`
    on correct blocks until the filter yields. The queue is drained by
    clinicians, on a schedule, into a candidate corpus that still has to pass
    the evaluation gate. See docs/ai/feedback-loop.md.
    """
    record = FeedbackRecord(**item.model_dump())

    _FEEDBACK_QUEUE.parent.mkdir(parents=True, exist_ok=True)
    with _FEEDBACK_QUEUE.open("a", encoding="utf-8", newline="\n") as fh:
        fh.write(record.model_dump_json() + "\n")

    return FeedbackAck(
        queued=True,
        message=(
            "Thank you. A person reviews this — it does not change the filter on its own."
        ),
    )
