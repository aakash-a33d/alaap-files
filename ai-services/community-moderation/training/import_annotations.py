"""Take an annotated batch back from the vendor, and decide whether to accept it.

The gold items are the whole point. A vendor is paid per item, which means the
incentive runs toward speed, and speed on this material looks like labelling
everything benign — a corpus of "no labels" costs nothing to produce and would
quietly teach the classifier to allow everything.

So a returned batch is scored before it is trusted:

  gold accuracy      did they agree with the adjudicated answers
  benign rate        did they label a plausible share, or wave it all through
  clinical hold      block-tier and crisis labels are set aside for our own
                     clinicians regardless of what the vendor said

A batch under threshold is rejected whole. Partial acceptance sounds reasonable
and is not: if the gold accuracy is 0.6 there is no way to know which 60% of the
rest to keep.

    python -m alaap_ai.community_moderation.training.import_annotations \
        --annotated in/batch-001.done.jsonl \
        --key out/batch-001.key.jsonl \
        --out data/annotated-batch-001.jsonl
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

from alaap_ai.shared.schemas.moderation import Category

VALID = {c.value for c in Category}

# Labels a commercial annotator may apply on their own. Everything else is a
# recommendation that a clinician confirms.
#
# The excluded set is not about competence — it is that a wrong call on these
# either blocks a person in distress or misses somebody in danger, and that
# judgement is the one thing the contract cannot transfer.
VENDOR_DECIDABLE = {
    "bullying_harassment",
    "hate_speech",
    "threats_intimidation",
    "stalking_doxxing",
    "scams_financial_exploitation",
    "malware_phishing",
    "impersonation",
    "manipulation_coercion",
    "passive_aggressive_abuse",
    "help_seeking_discouragement",
    "religious_coercion",
}

CLINICIAN_ONLY = VALID - VENDOR_DECIDABLE   # self-harm, grooming, sexual, medical


class BatchRejected(RuntimeError):
    pass


def score_gold(annotated: dict[str, list[str]], key: list[dict]) -> tuple[float, int, list[str]]:
    """Exact-set agreement on the gold items."""
    gold = [k for k in key if k["gold"]]
    if not gold:
        raise BatchRejected("key contains no gold items; this batch cannot be scored")

    hits = 0
    misses: list[str] = []
    for item in gold:
        got = set(annotated.get(item["item_id"], []))
        want = set(item["expected_labels"])
        if got == want:
            hits += 1
        elif len(misses) < 8:
            misses.append(
                f"{item['item_id']}: wanted {sorted(want) or ['(none)']}, got {sorted(got) or ['(none)']}"
            )
    return hits / len(gold), len(gold), misses


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--annotated", type=Path, required=True)
    p.add_argument("--key", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--min-gold-accuracy", type=float, default=0.80)
    p.add_argument("--max-benign-rate", type=float, default=0.90,
                   help="above this, the batch looks waved through rather than read")
    args = p.parse_args()

    key = [json.loads(l) for l in args.key.read_text(encoding="utf-8").splitlines() if l.strip()]
    by_id = {k["item_id"]: k for k in key}

    annotated: dict[str, list[str]] = {}
    unknown_labels: Counter[str] = Counter()

    for line in args.annotated.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        labels = row.get("labels") or []
        for label in labels:
            if label not in VALID:
                unknown_labels[label] += 1
        annotated[row["item_id"]] = [l for l in labels if l in VALID]

    missing = set(by_id) - set(annotated)
    if missing:
        raise BatchRejected(f"{len(missing)} items were not returned; batch is incomplete")

    accuracy, n_gold, misses = score_gold(annotated, key)
    real = [k for k in key if not k["gold"]]
    benign = sum(1 for k in real if not annotated[k["item_id"]])
    benign_rate = benign / len(real) if real else 0.0

    print(f"\n  gold accuracy   {accuracy:.0%}  ({n_gold} items, floor {args.min_gold_accuracy:.0%})")
    print(f"  benign rate     {benign_rate:.0%}  (ceiling {args.max_benign_rate:.0%})")
    if unknown_labels:
        print(f"  unknown labels  {dict(unknown_labels)}  — dropped")
    for m in misses:
        print(f"    gold miss: {m}")

    if accuracy < args.min_gold_accuracy:
        raise BatchRejected(
            f"gold accuracy {accuracy:.0%} is below the {args.min_gold_accuracy:.0%} floor. "
            f"Reject the batch whole — there is no way to tell which of the "
            f"un-gold items are the good ones."
        )
    if benign_rate > args.max_benign_rate:
        raise BatchRejected(
            f"benign rate {benign_rate:.0%} exceeds the ceiling. This is what a "
            f"batch looks like when it was clicked through rather than read."
        )

    written = held = 0
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8", newline="\n") as fh:
        for k in real:
            labels = annotated[k["item_id"]]
            needs_clinician = bool(set(labels) & CLINICIAN_ONLY)
            if needs_clinician:
                held += 1
            fh.write(json.dumps({
                "id": k["item_id"],
                "labels": labels,
                "source": "licensed",
                "dataset": "vendor-annotation",
                # Vendor agreement is not adjudication. Only the labels a
                # clinician has confirmed get `adjudicated: true`, and this
                # script never sets it.
                "adjudicated": False,
                "needs_clinician": needs_clinician,
                "platform_ref": k["platform_ref"],
            }, ensure_ascii=False) + "\n")
            written += 1

    print(f"\n  accepted {written} items -> {args.out}")
    print(f"  {held} carry a clinician-only label and are held for in-house review")
    print("\n  Text is not in this file. Re-join it from the platform by "
          "platform_ref, under the model-improvement purpose, at training time.\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
