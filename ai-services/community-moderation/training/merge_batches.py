"""Merge the CSV batches an AI returns, clean them, and report what you have.

    python -m alaap_ai.community_moderation.training.merge_batches \
        --in batches/self_harm/ --out data/self_harm.v2.csv \
        --context context_sentence --response response_sentence --label label

Generating a dataset means running the same prompt twenty or thirty times and pasting
the results into files. This does the boring half: concatenate, strip the wrappers an
assistant adds, drop exact repeats, and say whether the batch is drifting.

WHAT IT CLEANS, AND WHY EACH ONE BITES

  code fences        assistants wrap CSV in ```csv ... ``` about half the time
  repeated headers   every batch has one; only the first is a header
  smart quotes       "..." breaks CSV parsing three batches later, silently
  blank rows         trailing newlines from copy-paste
  exact duplicates   two batches independently inventing the same sentence

WHAT IT WILL NOT DO

Fix a batch that came back lazy. If run 17 quietly reused run 3's sentences, this
reports the overlap and keeps one copy - it cannot invent the variety that was asked
for and not delivered. That is what the `new` column below is for: watch it fall, and
when it stalls, stop and change the prompt rather than running it again.
"""

from __future__ import annotations

import argparse
import csv
import io
import re
import sys
from pathlib import Path

_FENCE = re.compile(r"^\s*```(?:csv)?\s*$", re.IGNORECASE)
_SMART = str.maketrans({"“": '"', "”": '"', "‘": "'", "’": "'", "—": "-"})


def clean_text(raw: str) -> str:
    """Strip fences and normalise punctuation an assistant introduces."""
    lines = [ln for ln in raw.splitlines() if not _FENCE.match(ln)]
    return "\n".join(lines).translate(_SMART)


def read_batch(path: Path) -> list[dict[str, str]]:
    text = clean_text(path.read_text(encoding="utf-8-sig"))
    rows = list(csv.DictReader(io.StringIO(text)))
    return [
        {k: (v or "").strip() for k, v in row.items() if k}
        for row in rows
        if any((v or "").strip() for v in row.values())
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--in", dest="indir", type=Path, required=True,
                        help="directory of batch CSVs, read in sorted filename order")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--context", default="context_sentence")
    parser.add_argument("--response", default="response_sentence")
    parser.add_argument("--label", default="label")
    args = parser.parse_args()

    batches = sorted(args.indir.glob("*.csv"))
    if not batches:
        print(f"no .csv files in {args.indir}", file=sys.stderr)
        return 1

    merged: list[dict[str, str]] = []
    seen_pairs: set[tuple[str, str]] = set()
    seen_replies: set[str] = set()

    print(f"{'batch':<28}{'rows':>7}{'kept':>7}{'new replies':>13}")
    print("-" * 56)
    for path in batches:
        try:
            rows = read_batch(path)
        except csv.Error as exc:
            print(f"{path.name:<28}  unreadable: {exc}", file=sys.stderr)
            return 1

        missing = {args.context, args.response, args.label} - set(rows[0] if rows else {})
        if missing:
            print(
                f"{path.name:<28}  missing columns {sorted(missing)}; "
                f"found {sorted(rows[0]) if rows else []}",
                file=sys.stderr,
            )
            return 1

        kept = 0
        fresh = 0
        for row in rows:
            reply = row[args.response]
            key = (row[args.context], reply)
            if not reply or key in seen_pairs:
                continue
            seen_pairs.add(key)
            if reply not in seen_replies:
                seen_replies.add(reply)
                fresh += 1
            merged.append(row)
            kept += 1
        print(f"{path.name:<28}{len(rows):>7}{kept:>7}{fresh:>13}")

    if not merged:
        print("nothing survived the merge", file=sys.stderr)
        return 1

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with io.open(args.out, "w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(merged[0].keys()))
        writer.writeheader()
        writer.writerows(merged)

    # The one number that says whether the generation is working. Hard pairs are the
    # point of the exercise; everything else is hygiene.
    by_reply: dict[str, set[str]] = {}
    for row in merged:
        by_reply.setdefault(row[args.response], set()).add(row[args.label].strip().lower())
    ambiguous = {r for r, labs in by_reply.items() if len(labs) > 1}
    hard = sum(1 for row in merged if row[args.response] in ambiguous)

    print(f"\n  wrote       {args.out}  ({len(merged)} rows)")
    print(f"  replies     {len(seen_replies)} unique ({len(seen_replies) / len(merged):.1%})")
    print(f"  hard pairs  {hard / len(merged):.1%} of rows")
    print(
        "\nNow run check_pair_shortcuts on it. A clean merge is not a usable dataset —\n"
        "only the gate decides that.\n"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
