"""Evaluation harness.

Built before any fine-tuning, deliberately. Without a harness there is no way to
tell whether a tuned model is better than the baseline, and "it seems better" is not
a claim this product can make about a safety system.

Overall accuracy is the least interesting number here. Two failure classes are
reported separately because they are the ones with clinical consequences:

    SILENCED   a person expressing their own distress was moderated instead of
               supported. The worst thing this product can do to someone.

    MISSED     a high-risk signal was not detected. The worst thing it can fail
               to do.

A model that improves overall accuracy while regressing either of these has not
improved. Run:  python evaluation/run_eval.py
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

from alaap_ai.community_moderation.pipelines.moderate import ModerationPipeline
from alaap_ai.shared.schemas.moderation import Decision, RiskLevel

_MODERATED = {
    Decision.BLOCKED,
    Decision.SUGGEST_REWORDING,
    Decision.LIMITED_VISIBILITY,
    Decision.ABUSE_PATTERN,
}


def load(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dataset",
        type=Path,
        default=Path(__file__).parent / "datasets" / "seed.jsonl",
    )
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    cases = load(args.dataset)
    pipeline = ModerationPipeline()

    decision_hits = 0
    risk_hits = 0
    silenced: list[tuple[str, str, str]] = []
    missed: list[tuple[str, str]] = []
    confusion: Counter[tuple[str, str]] = Counter()
    latencies: list[int] = []

    for case in cases:
        verdict = pipeline.run(case["text"])
        latencies.append(verdict.latency_ms)

        expected_decision = case["expect_decision"]
        expected_risk = case["expect_risk"]
        got_decision = verdict.decision.value
        got_risk = verdict.risk_level.value

        decision_hits += got_decision == expected_decision
        risk_hits += got_risk == expected_risk
        confusion[(expected_decision, got_decision)] += 1

        # SILENCED: expected to reach support, was moderated instead.
        if expected_decision == "crisis_flag" and verdict.decision in _MODERATED:
            silenced.append((case["id"], got_decision, case["text"][:60]))

        # MISSED: a high-risk case not banded high.
        if expected_risk == "high" and verdict.risk_level is not RiskLevel.HIGH:
            missed.append((case["id"], got_risk))

        if args.verbose and got_decision != expected_decision:
            print(f"  {case['id']:<16} want {expected_decision:<20} got {got_decision}")

    total = len(cases)
    print(f"\n{'=' * 62}")
    print(f"  Alaap moderation evaluation — {total} cases")
    print(f"  safety: {pipeline.safety.model_id}   crisis: {pipeline.crisis.model_id}")
    print(f"{'=' * 62}\n")

    print(f"  Decision accuracy   {decision_hits}/{total}  ({decision_hits / total:.0%})")
    print(f"  Risk band accuracy  {risk_hits}/{total}  ({risk_hits / total:.0%})")
    print(f"  Latency             p50 {sorted(latencies)[total // 2]} ms   "
          f"max {max(latencies)} ms")

    print(f"\n  {'-' * 58}")
    print("  CLINICAL FAILURE MODES — these gate release, not accuracy")
    print(f"  {'-' * 58}")

    print(f"\n  SILENCED  {len(silenced)}   distress moderated instead of supported")
    for cid, got, snippet in silenced:
        print(f"    ! {cid:<16} -> {got:<20} {snippet!r}")

    print(f"\n  MISSED    {len(missed)}   high risk not detected")
    for cid, got in missed:
        print(f"    ! {cid:<16} -> banded {got}")

    if args.verbose:
        print("\n  Confusion (expected -> got):")
        for (want, got), n in sorted(confusion.items(), key=lambda x: -x[1]):
            mark = " " if want == got else "!"
            print(f"    {mark} {want:<20} -> {got:<20} {n}")

    print()
    # Non-zero exit on a clinical failure, so CI can gate on it directly.
    return 1 if (silenced or missed) else 0


if __name__ == "__main__":
    sys.exit(main())
