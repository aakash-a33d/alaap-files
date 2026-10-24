"""Map a mixed label column onto one scheme.

    python -m alaap_ai.community_moderation.training.normalise_labels \
        --csv data/context_dependent_passive_aggression_pairs.csv \
        --label label --harmful passive_aggressive --safe non_passive_aggressive

WHY THIS EXISTS

`context_dependent_passive_aggression_pairs.csv` shipped with two labelling schemes in
one column: the words `passive_aggressive` / `non_passive_aggressive` on its 2,100
English rows, and literal `1` / `0` on its 1,732 Hinglish ones. Trained as delivered
that is four classes, not two.

The subtler cost is what it does to the gate. `check_pair_shortcuts --harmful
passive_aggressive` reads every `1` as not-harmful, so all 1,732 Hinglish rows count as
safe — and then every Hindi word in the file looks like a 100%-safe token. The gate
reported 131 giveaway tokens and an apparent language bias. There was none. Normalise
the column and the same file passes every check.

That is worth stating because the false reading pointed at the one bias this project has
already fought: a1-v10 took three attempts to stop flagging benign Hinglish. A tooling
artifact that imitates a known real bug will be believed.

Idempotent. Values already in the target scheme are left alone.
"""

from __future__ import annotations

import argparse
import csv
import io
import shutil
from pathlib import Path

# Everything that has turned up standing in for the two classes. Extend rather than
# guess: a value not listed here stops the run instead of being mapped on a hunch.
TRUTHY = {"1", "1.0", "true", "yes", "y", "harmful", "positive", "pos"}
FALSY = {"0", "0.0", "false", "no", "n", "safe", "negative", "neg"}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--csv", type=Path, required=True)
    ap.add_argument("--label", default="label")
    ap.add_argument("--harmful", required=True, help="the target name for the positive class")
    ap.add_argument("--safe", required=True, help="the target name for the negative class")
    ap.add_argument(
        "--in-place",
        action="store_true",
        help="rewrite the file, keeping a .bak alongside it",
    )
    ap.add_argument("--out", type=Path, help="write here instead (default: <name>.normalised.csv)")
    args = ap.parse_args()

    with io.open(args.csv, encoding="utf-8-sig", newline="") as fh:
        rows = list(csv.DictReader(fh))
    if not rows:
        raise SystemExit(f"{args.csv}: no rows")
    if args.label not in rows[0]:
        raise SystemExit(f"{args.csv}: no column {args.label!r}; has {list(rows[0])}")

    before: dict[str, int] = {}
    for row in rows:
        v = (row[args.label] or "").strip()
        before[v] = before.get(v, 0) + 1

    unknown = set()
    changed = 0
    for row in rows:
        raw = (row[args.label] or "").strip()
        if raw in (args.harmful, args.safe):
            continue
        low = raw.lower()
        if low in TRUTHY:
            row[args.label] = args.harmful
        elif low in FALSY:
            row[args.label] = args.safe
        else:
            unknown.add(raw)
            continue
        changed += 1

    if unknown:
        # Refused rather than guessed. A label this script cannot name is one somebody
        # has to look at, and silently dropping it would change the class balance.
        raise SystemExit(
            f"{args.csv}: {len(unknown)} label value(s) not recognised: "
            + ", ".join(sorted(repr(u) for u in unknown))
            + f"\nAdd them to TRUTHY/FALSY in {Path(__file__).name} once you know which class they are."
        )

    destination = args.csv if args.in_place else (args.out or args.csv.with_suffix(".normalised.csv"))
    if args.in_place:
        shutil.copyfile(args.csv, args.csv.with_suffix(args.csv.suffix + ".bak"))

    with io.open(destination, "w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    after: dict[str, int] = {}
    for row in rows:
        v = row[args.label]
        after[v] = after.get(v, 0) + 1

    print(f"{args.csv}  —  {len(rows)} rows, {changed} relabelled")
    print("\n  before:")
    for v, n in sorted(before.items(), key=lambda kv: -kv[1]):
        print(f"    {v!r:<30} {n:>6}")
    print("\n  after:")
    for v, n in sorted(after.items(), key=lambda kv: -kv[1]):
        print(f"    {v!r:<30} {n:>6}")
    print(f"\nwrote {destination}")
    print("Now re-run check_pair_shortcuts against it — the numbers before this ran were")
    print("measuring a four-class file and cannot be compared to anything.\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
