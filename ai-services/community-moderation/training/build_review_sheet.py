"""Turn generated candidates into a sheet a clinician can actually work through.

`dataset-sourcing.md` §4 is three steps and only the first was executable:

    1. Generate candidates with our own Qwen3 8B.       generate.py
    2. Clinicians review, edit, approve or reject.      <- this
    3. Two annotators plus adjudication.                import_annotations.py

Step 2 had no script. The one review sheet in `data/review/` was assembled by
hand, which is why there is exactly one.

The sheet is a CSV because that is what a reviewer can open, sort and filter
without being given a tool. Three design decisions in it:

  * **Discriminator columns, not a bare list of text.** A reviewer scanning 350
    lines cannot hold "is this addressed to somebody?" in their head for all of
    them. The column answers it mechanically and they correct it where it is
    wrong — which is faster and, more importantly, makes the disagreements
    visible instead of averaged away.

  * **Method detail never reaches the sheet.** Candidates naming a means are
    dropped here as well as in the generator, because this file is the one that
    gets emailed. The count is reported; the text is not printed.

  * **`proposed_label`, never `label`.** The generator's brief is a proposal. A
    clinician is the annotator of record (§6), so the column the reviewer fills
    in is the one that counts and the model's guess sits beside it, not in it.

Usage:

    python -m alaap_ai.community_moderation.training.build_review_sheet \\
        --in data/generated/self_harm_encouragement.en.jsonl \\
             data/generated/benign_own_despair.en.jsonl \\
        --out data/review/self_harm_encouragement-review.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path

from .generate import rejects_method_detail

# Second person, including the forms people actually type. This is the single
# discriminator that separates `self_harm_encouragement` from
# `benign_own_despair`: the harmful class is always addressed to somebody, and
# the protected class is always about the writer.
_SECOND_PERSON = re.compile(r"\b(you|your|you're|youre|yours|u|ur|urself|yourself)\b", re.I)
_FIRST_PERSON = re.compile(r"\b(i|i'm|im|my|me|myself|mine|i've|ive|i'd)\b", re.I)

# Someone reporting what was said to them. These read as the harmful class to
# any bag-of-words model and are its most damaging false positive after own
# despair, because the person being moderated is the person who was attacked.
_REPORTED = re.compile(
    r"\b(he|she|they|mum|mom|dad|brother|sister|someone|somebody|a reply|"
    r"my (partner|boss|friend|cousin|husband|wife))\b[^.!?]{0,40}\b"
    r"(said|told|says|texted|wrote|messaged|called me)\b",
    re.I,
)


def flags(text: str) -> dict[str, str]:
    second = bool(_SECOND_PERSON.search(text))
    first = bool(_FIRST_PERSON.search(text))
    return {
        # Capitalised when the answer is the one that usually means "reject",
        # so a reviewer sorting the column finds the problems at one end.
        "addresses_reader": "yes" if second else "NO",
        "about_self_only": "yes" if first and not second else "no",
        "quotes_someone_else": "yes" if _REPORTED.search(text) else "no",
        "words": str(len(text.split())),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--in", dest="inputs", nargs="+", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument(
        "--category",
        default="self_harm_encouragement",
        help="the category whose method/means filter to apply",
    )
    args = parser.parse_args()

    rows: list[dict[str, str]] = []
    dropped = 0
    seen_ids: set[str] = set()

    for path in args.inputs:
        if not path.exists():
            print(f"  missing, skipped: {path}")
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            record = json.loads(line)
            text = record["text"]

            if rejects_method_detail(text, args.category):
                dropped += 1
                continue

            # Ids collide across files only if a slug repeats; make it loud
            # rather than letting two candidates share a row identity.
            rid = record["id"]
            if rid in seen_ids:
                rid = f"{rid}-{path.stem[:6]}"
            seen_ids.add(rid)

            labels = record.get("labels") or []
            rows.append({
                "id": rid,
                "source_file": path.name,
                "proposed_label": ",".join(labels) if labels else "(benign)",
                **flags(text),
                "text": text,
                "verdict_keep_reject_relabel": "",
                "corrected_labels": "",
                "reviewer_notes": "",
            })

    if not rows:
        print("  nothing to review")
        return 1

    args.out.parent.mkdir(parents=True, exist_ok=True)
    # utf-8-sig so Excel opens it without mangling the text, which is how the
    # previous sheet ended up with a BOM in its first header cell.
    with args.out.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)

    positives = sum(1 for r in rows if r["proposed_label"] != "(benign)")
    print(f"\n  {len(rows)} rows -> {args.out}")
    print(f"  {positives} proposed positive, {len(rows) - positives} proposed benign")
    if dropped:
        print(f"  {dropped} dropped before the sheet for naming a method or means")
    print(
        "\n  Nothing here is labelled until a clinician fills in the verdict\n"
        "  column. Two annotators plus adjudication, per annotation-guidelines.md.\n"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
