"""CSSRS Reddit corpus -> clinician review queue. Deliberately NOT training data.

The corpus (Gaur et al.) labels 500 Reddit users on the Columbia Suicide Severity
Rating Scale: Supportive / Indicator / Ideation / Behavior / Attempt. It is a
user-level assessment dataset and A2 is a message-level classifier, so the two do
not line up.

Measured on the file itself: of 1,815 posts written by users labelled Attempt or
Behavior, **85% contain no risk language at all**. Many are that user comforting
somebody else — one user labelled Attempt writes "Keep your head up! Suicide is
never a problem solver." Exploding user labels onto posts would teach A2 that
recovery narratives and peer support are high-risk crisis signals. That is the exact
failure the whole A1/A2 split exists to prevent.

So this script does not emit labels. It emits a queue: posts that a clinician should
read and band individually, with the original user-level label shown as context and
nothing more. The clinician's judgement is the label.

    python -m alaap_ai.community_moderation.training.cssrs_review_queue \
        --csv "<path>/500_anonymized_Reddit_users_posts_labels.csv" \
        --out data/cssrs-review-queue.jsonl

LICENCE AND PROVENANCE: scraped Reddit mental health content, released for research.
It carries no consent from the people who wrote it, and health data is special
category under both GDPR and the DPDP framework. Even routed through review, using
it in a commercial product needs a decision from counsel. See
docs/ai/dataset-sourcing.md §1.
"""

from __future__ import annotations

import argparse
import ast
import csv
import json
import re
from pathlib import Path

csv.field_size_limit(10**7)

# Context only. Never written as a label.
USER_LEVEL = ("Supportive", "Indicator", "Ideation", "Behavior", "Attempt")

_RISK = re.compile(
    r"kill (myself|my self)|end (my life|it all)|want(s)? to die|suicid\w*"
    r"|hopeless|worthless|can'?t go on|no reason to live|better off (dead|without me)"
    r"|don'?t want to (live|be here)|take my own life",
    re.IGNORECASE,
)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--csv", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--min-severity", default="Ideation",
                   choices=USER_LEVEL,
                   help="only queue posts from users at or above this band")
    p.add_argument("--require-risk-language", action="store_true", default=True,
                   help="queue only posts that actually contain risk language")
    args = p.parse_args()

    floor = USER_LEVEL.index(args.min_severity)
    rows = list(csv.DictReader(
        args.csv.open(encoding="utf-8", errors="replace", newline="")))

    queued = skipped_no_risk = unparsed = 0
    args.out.parent.mkdir(parents=True, exist_ok=True)

    with args.out.open("w", encoding="utf-8", newline="\n") as fh:
        for row in rows:
            label = (row.get("Label") or "").strip()
            if label not in USER_LEVEL or USER_LEVEL.index(label) < floor:
                continue
            try:
                posts = ast.literal_eval(row["Post"])
            except (ValueError, SyntaxError):
                unparsed += 1
                continue
            if not isinstance(posts, list):
                unparsed += 1
                continue

            for i, text in enumerate(posts):
                if not isinstance(text, str):
                    continue
                text = text.strip()
                if not (40 <= len(text) <= 2000):
                    continue
                if args.require_risk_language and not _RISK.search(text):
                    skipped_no_risk += 1
                    continue

                fh.write(json.dumps({
                    "id": f"cssrs-{row.get('User', '?')}-{i:03d}",
                    "text": text,
                    # No labels. A clinician assigns the risk band.
                    "labels": [],
                    "risk_band": None,
                    "user_level_label_for_context_only": label,
                    "source": "review_queue",
                    "adjudicated": False,
                    "note": (
                        "USER-level CSSRS label shown as context only. Band this "
                        "post on its own content. A supportive or recovery post "
                        "from a high-severity user is NOT high risk."
                    ),
                }, ensure_ascii=False) + "\n")
                queued += 1

    print(f"\n  queued for clinician review: {queued:,}")
    print(f"  skipped, no risk language:   {skipped_no_risk:,}")
    if unparsed:
        print(f"  unparsable Post fields:      {unparsed}")
    print(f"  -> {args.out}")
    print("\n  This file carries no labels and is not a training set. Nothing in it")
    print("  may enter a corpus until a clinician has banded each post.\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
