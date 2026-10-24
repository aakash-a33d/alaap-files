"""Guards on the crisis-alert route.

The alert is the one thing that crosses from "somebody typed this" to "a human
is told about it", so what it may and may not carry is a privacy decision rather
than a schema detail. These tests are that decision, written down where it
cannot be changed by accident.
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from alaap_ai.orchestrator.api import main as api


@pytest.fixture()
def client(tmp_path, monkeypatch) -> TestClient:
    monkeypatch.setattr(api, "_SAFETY_QUEUE", tmp_path / "safety-alerts.jsonl")
    return TestClient(api.app)


def queued(client) -> list[dict]:
    path = api._SAFETY_QUEUE
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def test_the_alert_carries_no_text(client):
    """A mediator opens the post; they do not read it out of a queue.

    The alert is a pointer, not a copy. A copy would put the worst thing
    somebody ever wrote into a second store with its own retention, its own
    backups and its own access list — none of which the member consented to when
    they posted to a wall they can delete from.
    """
    res = client.post(
        "/v1/safety/alert",
        json={"ref": "cm-1", "surface": "post", "risk_level": "high"},
    )
    assert res.status_code == 202
    assert res.json() == {"raised": True}

    (record,) = queued(client)
    assert record["ref"] == "cm-1"
    assert record["risk_level"] == "high"
    assert set(record) == {"ref", "surface", "risk_level", "raised_at", "crisis_model_id"}


def test_text_is_refused_rather_than_dropped(client):
    """`extra="forbid"`, and not pydantic's default.

    Under the default a client that began sending the post body would have it
    silently discarded — the right outcome, reached in silence, so nobody would
    ever find out the client was sending it. This fails loudly instead.
    """
    res = client.post(
        "/v1/safety/alert",
        json={
            "ref": "cm-2",
            "surface": "post",
            "risk_level": "high",
            "text": "i dont want to be here anymore",
        },
    )
    assert res.status_code == 422
    assert not queued(client)


@pytest.mark.parametrize("level", ["none", "low"])
def test_a_quiet_band_queues_nothing(client, level):
    """Mediation's list has to stay a list of real signals. A client is allowed
    to be wrong about the band; the queue is not."""
    res = client.post(
        "/v1/safety/alert",
        json={"ref": "cm-3", "surface": "post", "risk_level": level},
    )
    assert res.status_code == 202
    assert res.json() == {"raised": False}
    assert not queued(client)


def test_triage_answers_without_a_decision(client):
    """The route a member's own post runs through. It must not return anything
    the interface could turn into a verdict on the post — no categories, no
    decision, no rewrite guidance."""
    res = client.post("/v1/triage", json={"text": "i dont want to be here anymore"})
    assert res.status_code == 200
    assert set(res.json()) == {"risk_level", "model_id"}
