"""Per-category threshold calibration.

The step that gets skipped, and the one that decides whether the model is usable.

A trained multi-label head emits sixteen independent probabilities. Choosing 0.5 for
all of them is an arbitrary decision dressed as a default — it silently sets a
different operating point for every category depending on how rare that category was
in the training data.

This sweeps each category over the validation split and picks the threshold that
maximises F-beta subject to a precision floor, both read from config.yaml. Output is
written to `metadata/moderation/` because a threshold is policy, not code
(folder-structure.md), and it is versioned so a verdict stays explainable after the
next retrain.

Pure stdlib on purpose: this runs in CI without torch installed.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path

import yaml

from alaap_ai.shared.schemas.moderation import Category

DEFAULT_THRESHOLD = 0.5


@dataclass
class Point:
    threshold: float
    precision: float
    recall: float
    f_beta: float
    support: int


def sweep(
    scores: list[float],
    truth: list[int],
    beta: float,
    min_precision: float,
    step: float = 0.01,
) -> Point:
    """Find the best threshold for one category.

    Returns the highest-F-beta point whose precision clears the floor. If no point
    clears it, returns the highest-precision point instead and lets the caller warn:
    silently accepting a threshold below the floor is how a model that blocks
    innocent posts reaches production.
    """
    support = sum(truth)
    candidates: list[Point] = []

    t = 0.0
    while t <= 1.0:
        tp = sum(1 for s, y in zip(scores, truth) if s >= t and y == 1)
        fp = sum(1 for s, y in zip(scores, truth) if s >= t and y == 0)
        fn = sum(1 for s, y in zip(scores, truth) if s < t and y == 1)

        precision = tp / (tp + fp) if (tp + fp) else 1.0
        recall = tp / (tp + fn) if (tp + fn) else 0.0

        b2 = beta * beta
        denom = (b2 * precision) + recall
        f_beta = ((1 + b2) * precision * recall / denom) if denom else 0.0

        candidates.append(Point(round(t, 4), precision, recall, f_beta, support))
        t += step

    eligible = [c for c in candidates if c.precision >= min_precision and c.recall > 0]
    if eligible:
        return max(eligible, key=lambda c: (c.f_beta, c.recall))
    return max(candidates, key=lambda c: (c.precision, c.recall))


def calibrate(
    predictions: dict[str, list[float]],
    labels: dict[str, list[int]],
    config: dict,
) -> tuple[dict, list[str]]:
    cal_cfg = config.get("calibration", {})
    step = float(cal_cfg.get("step", 0.01))
    min_examples = int(cal_cfg.get("min_positive_examples", 20))

    result: dict[str, dict] = {}
    warnings: list[str] = []

    for category in Category:
        name = category.value
        cfg = config["categories"].get(name)
        if cfg is None:
            warnings.append(f"{name}: absent from config; using default threshold")
            result[name] = {"threshold": DEFAULT_THRESHOLD, "action": "review",
                            "calibrated": False}
            continue

        scores = predictions.get(name, [])
        truth = labels.get(name, [])
        support = sum(truth)

        if support < min_examples:
            warnings.append(
                f"{name}: only {support} positive validation examples "
                f"(need {min_examples}); threshold NOT calibrated"
            )
            result[name] = {
                "threshold": DEFAULT_THRESHOLD,
                "action": cfg["action"],
                "calibrated": False,
                "support": support,
            }
            continue

        point = sweep(scores, truth, cfg["beta"], cfg["min_precision"], step)
        met_floor = point.precision >= cfg["min_precision"]
        if not met_floor:
            warnings.append(
                f"{name}: no threshold reaches the {cfg['min_precision']:.2f} "
                f"precision floor (best {point.precision:.2f}). This category is "
                f"NOT ready for its configured action."
            )

        result[name] = {
            "threshold": point.threshold,
            "action": cfg["action"],
            "calibrated": True,
            "precision": round(point.precision, 4),
            "recall": round(point.recall, 4),
            "f_beta": round(point.f_beta, 4),
            "beta": cfg["beta"],
            "min_precision": cfg["min_precision"],
            "meets_precision_floor": met_floor,
            "support": support,
        }

    return result, warnings


def main() -> int:
    parser = argparse.ArgumentParser(description="Calibrate A1 category thresholds.")
    parser.add_argument("--predictions", type=Path, required=True,
                        help="JSON: {category: [score, ...]} on the validation split")
    parser.add_argument("--labels", type=Path, required=True,
                        help="JSON: {category: [0|1, ...]} aligned with predictions")
    parser.add_argument("--config", type=Path,
                        default=Path(__file__).parent / "config.yaml")
    parser.add_argument("--out", type=Path, required=True,
                        help="e.g. metadata/moderation/thresholds.v1.yaml")
    parser.add_argument("--model-id", default="a1-safety-classifier")
    parser.add_argument("--model-version", default="unversioned")
    parser.add_argument("--corpus", type=Path, default=None,
                        help="the training corpus. Given this, generated records "
                             "are dropped from the calibration split — see below.")
    parser.add_argument("--keep-synthetic", action="store_true",
                        help="calibrate on generated records too (not advised)")
    args = parser.parse_args()

    config = yaml.safe_load(args.config.read_text(encoding="utf-8"))
    predictions = json.loads(args.predictions.read_text(encoding="utf-8"))
    labels = json.loads(args.labels.read_text(encoding="utf-8"))

    # Drop generated records before choosing an operating point.
    #
    # A threshold is a cut point on a score distribution, so it inherits whatever
    # that distribution is made of. `unsafe_medical_advice` had ~98% of its
    # validation positives produced by one Qwen3 run, which the model separates
    # almost perfectly, so the F-beta optimum sat at 0.97-0.99 — and real
    # paraphrases scoring 0.94-0.96 fell underneath it. a1-v9 missed three
    # harmful probes that way while reporting precision 1.000.
    #
    # The split is deterministic (dataset.split hashes the text), so the
    # validation order can be reconstructed from the corpus without retraining.
    if args.corpus and not args.keep_synthetic:
        from . import dataset as ds

        val = ds.split(ds.load(args.corpus))["validation"]
        if len(val) != len(next(iter(labels.values()))):
            print(f"  corpus gives {len(val)} validation rows but the predictions "
                  f"have {len(next(iter(labels.values())))}; skipping the filter",
                  file=sys.stderr)
        else:
            keep = [i for i, r in enumerate(val) if not r.id.startswith("gen-")]
            dropped = len(val) - len(keep)
            if dropped:
                predictions = {k: [v[i] for i in keep] for k, v in predictions.items()}
                labels = {k: [v[i] for i in keep] for k, v in labels.items()}
                print(f"  calibrating on {len(keep)} of {len(val)} validation rows "
                      f"({dropped} generated records excluded)\n", file=sys.stderr)

    thresholds, warnings = calibrate(predictions, labels, config)

    payload = {
        "version": 1,
        "model_id": args.model_id,
        "model_version": args.model_version,
        "default_threshold": DEFAULT_THRESHOLD,
        "categories": thresholds,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        "# Generated by community-moderation/training/calibrate.py — do not hand-edit.\n"
        "# Supersede with a new version rather than editing: moderation verdicts\n"
        "# reference the threshold set that produced them.\n\n"
        + yaml.safe_dump(payload, sort_keys=False),
        encoding="utf-8",
    )

    print(f"\n  wrote {args.out}\n")
    print(f"  {'category':<32}{'thr':>6}{'prec':>8}{'rec':>8}  action")
    for name, row in thresholds.items():
        mark = " " if row.get("meets_precision_floor", False) else "!"
        print(f"  {mark} {name:<30}{row['threshold']:>6.2f}"
              f"{row.get('precision', 0):>8.2f}{row.get('recall', 0):>8.2f}"
              f"  {row['action']}")

    if warnings:
        print(f"\n  {len(warnings)} warning(s):")
        for w in warnings:
            print(f"    ! {w}")
        print("\n  A category that does not meet its precision floor must not be\n"
              "  enabled for its configured action. Route it to human review.")
    print()
    return 1 if warnings else 0


if __name__ == "__main__":
    raise SystemExit(main())
