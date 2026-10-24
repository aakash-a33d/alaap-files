"""Guards on the training pipeline.

The dataset rules and the policy loader both encode safety decisions. A regression
in either is silent — the model still trains, the API still answers, and the failure
only shows up in production. These tests are the alarm.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml

from alaap_ai.community_moderation.config import policy as policy_config
from alaap_ai.community_moderation.training import calibrate, dataset as ds
from alaap_ai.shared.schemas.moderation import Category


def write(tmp_path: Path, rows: list[dict]) -> Path:
    path = tmp_path / "data.jsonl"
    path.write_text("\n".join(json.dumps(r) for r in rows), encoding="utf-8")
    return path


BENIGN = {"id": "a", "text": "ordinary post", "labels": [], "source": "synthetic"}


# ------------------------------------------------------------- dataset rules

def test_production_data_is_rejected(tmp_path):
    """§12P. The rule that most needs enforcing in code rather than a document."""
    path = write(tmp_path, [{**BENIGN, "source": "production"}])
    with pytest.raises(ds.DatasetError, match="Production data may never be used"):
        ds.load(path)


def test_unknown_label_is_rejected(tmp_path):
    path = write(tmp_path, [{**BENIGN, "labels": ["not_a_category"]}])
    with pytest.raises(ds.DatasetError, match="unknown labels"):
        ds.load(path)


def test_duplicate_id_is_rejected(tmp_path):
    path = write(tmp_path, [BENIGN, {**BENIGN, "text": "different text"}])
    with pytest.raises(ds.DatasetError, match="duplicate id"):
        ds.load(path)


def test_split_is_deterministic(tmp_path):
    rows = [{**BENIGN, "id": f"r{i}", "text": f"post number {i}"} for i in range(200)]
    records = ds.load(write(tmp_path, rows))
    first = {s: [r.id for r in b] for s, b in ds.split(records).items()}
    second = {s: [r.id for r in b] for s, b in ds.split(records).items()}
    assert first == second


def test_identical_text_cannot_span_splits(tmp_path):
    """Annotated twice under different ids, the same text must not leak."""
    rows = [{**BENIGN, "id": f"r{i}", "text": f"post {i % 40}"} for i in range(200)]
    records = ds.load(write(tmp_path, rows))
    ds.assert_no_leakage(ds.split(records))  # must not raise


def test_leakage_detection_actually_fires():
    shared = ds.Record(id="x", text="same text", labels=[], source="synthetic")
    buckets = {"train": [shared], "validation": [shared], "test": []}
    with pytest.raises(ds.DatasetError, match="appear in both"):
        ds.assert_no_leakage(buckets)


def test_rare_categories_get_capped_weight(tmp_path):
    """An uncapped weight on a four-example category produces a model that fires
    on everything similar — which here means blocking people who needed to speak."""
    rows = [{**BENIGN, "id": f"r{i}", "text": f"post {i}"} for i in range(500)]
    rows[0]["labels"] = ["grooming_exploitation"]
    records = ds.load(write(tmp_path, rows))
    assert ds.positive_weights(records, cap=20.0)["grooming_exploitation"] == 20.0


# ------------------------------------------------------------- calibration

def test_sweep_respects_the_precision_floor():
    # Heavily overlapping scores: high recall is only reachable at low precision.
    scores = [0.9] * 10 + [0.8] * 40 + [0.2] * 50
    truth = [1] * 10 + [0] * 40 + [0] * 50
    point = calibrate.sweep(scores, truth, beta=2.0, min_precision=0.9)
    assert point.precision >= 0.9


def test_sweep_favours_recall_at_high_beta():
    scores = [0.9, 0.8, 0.7, 0.6, 0.55] + [0.5, 0.3, 0.2, 0.1, 0.05]
    truth = [1, 1, 1, 1, 1] + [0, 0, 0, 0, 0]
    high = calibrate.sweep(scores, truth, beta=3.0, min_precision=0.5)
    low = calibrate.sweep(scores, truth, beta=0.5, min_precision=0.5)
    assert high.threshold <= low.threshold


# ------------------------------------------------------------- policy loader

def test_defaults_are_flagged_as_uncalibrated():
    assert not policy_config.defaults().calibrated
    assert policy_config.load(None).source == "defaults"


def test_category_failing_its_precision_floor_is_demoted(tmp_path):
    """A category that cannot hit its precision floor must not block content.
    Demotion to human review is automatic, not a reviewer's judgement call."""
    path = tmp_path / "thresholds.yaml"
    path.write_text(
        yaml.safe_dump(
            {
                "version": 1,
                "model_version": "t",
                "categories": {
                    "hate_speech": {
                        "threshold": 0.4,
                        "action": "block",
                        "calibrated": True,
                        "meets_precision_floor": False,
                    },
                    "threats_intimidation": {
                        "threshold": 0.6,
                        "action": "block",
                        "calibrated": True,
                        "meets_precision_floor": True,
                    },
                    # Never swept — too few positives to sweep with. The
                    # threshold is an arbitrary default, so it must not block.
                    "stalking_doxxing": {
                        "threshold": 0.5,
                        "action": "block",
                        "calibrated": False,
                        "support": 0,
                    },
                },
            }
        ),
        encoding="utf-8",
    )
    loaded = policy_config.load(path)
    assert loaded.actions[Category.HATE_SPEECH] == "review"
    assert loaded.actions[Category.THREATS_INTIMIDATION] == "block"
    assert loaded.thresholds[Category.HATE_SPEECH] == 0.4
    assert loaded.calibrated

    # An uncalibrated block-tier category blocked posts at an arbitrary 0.5,
    # because only `meets_precision_floor` was checked and a category that was
    # never swept has no such key. Ten categories are in that state today.
    assert loaded.actions[Category.STALKING_DOXXING] == "review"


def test_thresholds_are_refused_for_a_different_model(tmp_path):
    """A threshold is a cut point on one model's score distribution and does not
    transfer to another's.

    The regression this guards: a1-v1 calibrated `bullying_harassment` to 0.97,
    the lexicon baseline saturates at 0.95, and loading the former against the
    latter disabled three block-tier categories with no error of any kind.
    """
    path = tmp_path / "thresholds.yaml"
    path.write_text(
        yaml.safe_dump(
            {
                "version": 1,
                "model_version": "a1-v1",
                "categories": {
                    "bullying_harassment": {
                        "threshold": 0.97,
                        "action": "block",
                        "meets_precision_floor": True,
                    }
                },
            }
        ),
        encoding="utf-8",
    )

    matched = policy_config.load(path, model_version="a1-v1")
    assert matched.calibrated
    assert matched.thresholds[Category.BULLYING_HARASSMENT] == 0.97

    for other in ("baseline-lexicon-v0", "a1-v2"):
        mismatched = policy_config.load(path, model_version=other)
        assert not mismatched.calibrated
        assert mismatched.thresholds[Category.BULLYING_HARASSMENT] < 0.95
        assert "a1-v1" in mismatched.note


def test_block_tier_is_reachable_by_the_default_backend():
    """Every block-tier threshold must sit at or below what the loaded model can
    actually emit. A category whose threshold exceeds the scorer's ceiling never
    fires, and silence is indistinguishable from safety."""
    from alaap_ai.community_moderation.pipelines.moderate import ModerationPipeline

    pipeline = ModerationPipeline()
    ceiling = max(pipeline.safety.score("you are worthless and pathetic").values())
    unreachable = [
        c.value
        for c in pipeline.policy.tier("block")
        if pipeline.policy.thresholds[c] > ceiling
    ]
    assert not unreachable, f"block-tier categories that can never fire: {unreachable}"


def test_english_output_is_not_accepted_as_hinglish():
    """A hi-Latn run whose seed pool is almost entirely English gets English
    back, because the generator imitates its examples more readily than it
    follows the language instruction.

    Writing those out stamped `language: "hi-Latn"` is worse than generating
    nothing: the field becomes false, and language-stratified evaluation then
    measures English while reporting Hinglish.

    The markers deliberately exclude romanised Hindi that collides with English
    (`the`, `is`, `me`, `do`, `bas`) — with those in, the first case below
    passed on the strength of `the` + `is`.
    """
    from alaap_ai.community_moderation.training.generate import is_expected_language

    english = [
        "stop the zoloft, it is making you feel numb",
        "bas stop the medication",
        "they told you to take this pill but you are not depressed",
    ]
    hinglish = [
        "ye dawai band kar do, aapko iski zarurat nahi hai",
        "doctor ki baat mat suno, ye goli sirf paisa hai",
        "aap depressed nahi ho, bas thoda stress hai. goli mat lo",
    ]
    for text in english:
        assert not is_expected_language(text, "hi-Latn"), text
    for text in hinglish:
        assert is_expected_language(text, "hi-Latn"), text

    # An English run must not be filtered at all.
    for text in english + hinglish:
        assert is_expected_language(text, "en")


def test_coverage_does_not_claim_an_unreachable_category(tmp_path):
    """`/health` must not report a category as covered when its threshold sits
    above anything the model can emit.

    An operator checks this endpoint to tell "nothing bad happened" apart from
    "nothing can fire". Reporting only what the model can *score* conflated the
    two and reported sixteen covered categories while three never fired.
    """
    from alaap_ai.community_moderation.pipelines.moderate import ModerationPipeline

    path = tmp_path / "thresholds.yaml"
    path.write_text(
        yaml.safe_dump(
            {
                "version": 1,
                # Matches the heuristic, so the file genuinely loads rather than
                # falling back to defaults — the threshold is the thing under test.
                "model_version": "baseline-lexicon-v0",
                "categories": {
                    "bullying_harassment": {
                        "threshold": 0.99,
                        "action": "block",
                        "meets_precision_floor": True,
                    }
                },
            }
        ),
        encoding="utf-8",
    )
    pipeline = ModerationPipeline(
        policy=policy_config.load(path, model_version="baseline-lexicon-v0")
    )
    assert pipeline.policy.calibrated

    coverage = pipeline.coverage
    assert "bullying_harassment" in coverage["unreachable"]
    assert "bullying_harassment" in coverage["uncovered"]
    assert "bullying_harassment" not in coverage["covered"]
    # The union property the API relies on. Three terms, not two: a category can
    # also be scorable and reachable and still never fire, because calibration
    # had too few positives to measure it and the head learned nothing. Six of
    # a1-v10's sixteen are in exactly that state and were being reported as
    # covered.
    assert set(coverage["uncovered"]) == (
        set(coverage["unscorable"])
        | set(coverage["unreachable"])
        | set(coverage["unmeasured"])
    )
    # A rule standing in for a missing head is not coverage, and must never be
    # counted as any.
    assert set(coverage["rule_guarded"]) <= set(coverage["unmeasured"])
    assert not set(coverage["rule_guarded"]) & set(coverage["covered"])


def test_grooming_is_held_out_of_the_block_tier(tmp_path):
    """`grooming_exploitation` calibrates at precision 0.92 / recall 0.99 and
    blocks "how was your weekend?" at 0.990.

    Its 5,923 examples are PAN-12 instant-messenger logs against benign text
    from Wikipedia and news comments, so the model learned *short conversational
    message*. Validation cannot see it — the validation set is the same logs.

    The demotion is applied after the threshold file is read, so recalibrating
    cannot re-enable it by accident.
    """
    path = tmp_path / "thresholds.yaml"
    path.write_text(
        yaml.safe_dump({
            "version": 1,
            "model_version": "t",
            "categories": {
                "grooming_exploitation": {
                    "threshold": 0.62, "action": "block",
                    "calibrated": True, "meets_precision_floor": True,
                },
            },
        }),
        encoding="utf-8",
    )
    loaded = policy_config.load(path)
    # Not enforced in any language. Demotion to review was tried and was not
    # enough — at `review` it still held "how was your weekend?" for a human.
    for language in ("en", "hi-Latn"):
        assert Category.GROOMING_EXPLOITATION not in loaded.enforced_in(language)
        assert Category.GROOMING_EXPLOITATION in loaded.out_of_scope(language)
