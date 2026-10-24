"""Generalisation probes: does the model know the category, or a proxy for it?

    python evaluation/run_probes.py --checkpoint model-store/quantised/a1-v6 \
        --thresholds ../metadata/moderation/thresholds.v6.yaml

Validation cannot answer this question when a category's validation positives come
from the same generator as its training positives. `unsafe_medical_advice` scored
**precision 1.000 / recall 1.000 in both a1-v4 and a1-v5 while being broken**, in
two different ways:

    a1-v4  learned "mentions psychiatric medication" = harmful.
           "ive been on sertraline for two years and it has helped a lot" -> 0.955.
           Block tier. It would have blocked a person describing recovery.

    a1-v5  learned "second-person imperative" = harmful, after the hard negatives
           that fixed a1-v4 turned out to be almost entirely first-person.
           "talk to your psychiatrist about the dose" -> 0.979.

Each fix installed the next shortcut, and the calibration table reported 1.000 every
time. These probes are hand-written to vary GRAMMATICAL FORM independently of
MEANING, which is the axis the corpus keeps accidentally correlating with the label.
Half are harmful messages wearing benign forms; half are benign messages wearing
harmful ones.

This is a regression guard, not an evaluation set. It is small, it is not
adjudicated, and the person who wrote it also wrote the training data, so it shares
that person's blind spots. It catches shortcuts already seen and buys nothing
against unseen ones. The clinician-authored evaluation set on the critical path in
docs/ai/dataset-sourcing.md §7 step 2 is the thing that actually closes this loop.

Exit code is non-zero if any probe fails, so it can gate a release.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import yaml

from alaap_ai.shared.schemas.moderation import Category

_HERE = Path(__file__).parent
_REPO_ROOT = _HERE.resolve().parents[1]


def load_probes(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def threshold_for(category: Category, thresholds_path: Path | None) -> float:
    """The threshold the model would actually run at.

    Probing at 0.5 when the calibrated threshold is 0.97 measures a model nobody
    will deploy, so the real cut point is used when a threshold file is given.
    """
    if thresholds_path is None or not thresholds_path.exists():
        return 0.5
    payload = yaml.safe_load(thresholds_path.read_text(encoding="utf-8"))
    row = (payload.get("categories") or {}).get(category.value) or {}
    return float(row.get("threshold", 0.5))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", required=True,
                        help="model directory, e.g. model-store/quantised/a1-v6")
    parser.add_argument("--probes", type=Path,
                        default=_HERE / "probes" / "unsafe_medical_advice.jsonl")
    parser.add_argument("--category", default="unsafe_medical_advice")
    parser.add_argument("--thresholds", type=Path, default=None,
                        help="calibrated threshold file; defaults to 0.5 without one")
    args = parser.parse_args()

    from alaap_ai.community_moderation.models import safety

    category = Category(args.category)
    probes = load_probes(args.probes)
    threshold = threshold_for(category, args.thresholds)
    model = safety.build("transformer", checkpoint=args.checkpoint)

    print(f"\n  checkpoint  {args.checkpoint}")
    print(f"  category    {category.value}   threshold {threshold}")
    print(f"  probes      {len(probes)}\n")
    print(f"  {'id':<16}{'form':<15}{'score':>7}{'fires':>7}  result  text")

    failures = []
    for probe in probes:
        score = model.score(probe["text"])[category]
        fires = score >= threshold
        expected = probe["expect"] == "fires"
        ok = fires == expected
        if not ok:
            failures.append((probe, score))
        print(f"  {probe['id']:<16}{probe['form']:<15}{score:>7.3f}"
              f"{('YES' if fires else 'no'):>7}  {'ok  ' if ok else 'FAIL'}"
              f"    {probe['text'][:52]}")

    passed = len(probes) - len(failures)
    print(f"\n  {passed}/{len(probes)} passed")

    if failures:
        print("\n  failures:")
        for probe, score in failures:
            direction = ("missed a harmful message" if probe["expect"] == "fires"
                         else "fired on a benign message")
            print(f"    {probe['id']}  {direction} at {score:.3f}")
            print(f"      {probe['why']}")
        print("\n  A category failing these must not be enabled for its configured\n"
              "  action, whatever the calibration table says about it.\n")
        return 1

    print("\n  No known shortcut is present. This is a floor, not a pass:\n"
          "  it says nothing about shortcuts nobody has thought of yet.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
