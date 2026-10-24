"""Turn the CSSRS review queue into clinician-workable banding batches.

    python -m alaap_ai.community_moderation.training.cssrs_banding_batches \
        --queue data/cssrs-review-queue.jsonl \
        --filler data/combined.v9.jsonl \
        --out-dir data/banding

**This script does not band anything, and neither should any model.** Annotation
guidelines §8: "Risk banding for the A2 model is annotated separately, by
clinically qualified annotators only... If you are not clinically qualified, do
not annotate this task." dataset-sourcing.md §6 adds the reason — a model that
labels the clinical categories turns the clinician sign-off gate into ceremony,
and the classifier inherits the labeller's biases with no clinical review.

What this does instead is remove every obstacle between a clinician and the
judgement only they can make.

**Batching follows the wellbeing requirements, which are requirements.** §9 caps
sessions at two hours with a ten-minute break every 45 minutes, and states that
"batches are mixed, never a continuous run of self-harm content". Every post in
the review queue contains risk language by construction — that is what the queue
filter selects for — so shipping them as-is would be exactly the continuous run
§9 forbids. Each batch is therefore diluted with benign posts drawn from the
training corpus, shuffled through.

The benign filler does a second job: a clinician who bands one of them above
`low` has told us something about fatigue or about the guidelines, and the key
file records which rows were filler so that signal is recoverable. They are not
adversarial traps and should not be described as such to the annotator — the
mixing requirement is the reason they are there.

**No pre-labels.** §6 permits an LLM to propose labels for a human to correct,
and that is worth real throughput, but it carries automation bias: pre-labels
pull annotators toward agreeing with them and silently inflate measured
agreement. Proposals from a weak model on clinical risk would be worse than
none. If pre-labels are added later, §6 requires at least 10% of every batch be
held out blind, and `--holdout` here reserves that split so the comparison stays
possible.

Two files come out per batch. The CSV goes to the annotator. The key stays here.
"""

from __future__ import annotations

import argparse
import csv
import json
import random
import re
from pathlib import Path

from . import dataset as ds

# Objective, mechanical features. These are extraction, not judgement — they say
# what is in the text, never what it means. A clinician reads the post; these
# only make the reading faster.
_RISK_PHRASE = re.compile(
    r"kill (?:myself|my self)|end(?:ing)? (?:my life|it all)|want(?:s)? to die"
    r"|suicid\w*|hopeless|worthless|can'?t go on|no reason to live"
    r"|better off (?:dead|without me)|don'?t want to (?:live|be here)"
    r"|take my own life|self.?harm",
    re.IGNORECASE,
)
_PAST = re.compile(
    r"\b(used to|years? ago|back then|when i was|since then|these days|now i|"
    r"recovered|better now|no longer)\b", re.I)
_THIRD_PARTY = re.compile(
    r"\b(my (?:friend|sister|brother|mum|mom|dad|partner|son|daughter)|"
    r"someone i know|a friend of mine|he |she |they )\b", re.I)
_SECOND_PERSON = re.compile(r"\byou(?:r|'?re)?\b", re.I)
_FIRST_PERSON = re.compile(r"\b(i|i'?m|i'?ve|my|myself)\b", re.I)

BAND_GUIDE = [
    "# A2 risk banding — clinically qualified annotators only (guidelines §8)",
    "#",
    "#   none      No distress indicators",
    "#   low       Distress present; no ideation",
    "#   moderate  Hopelessness, worthlessness, feeling trapped; passive ideation",
    "#   high      Active ideation, intent, plan, or timeframe",
    "#   skip      Use this freely and without explanation (§9). Not 'uncertain'.",
    "#",
    "# Past-tense ideation in a recovery narrative attenuates. Concern about",
    "# another person's risk is not the author's own band.",
    "#",
    "# cssrs_user_label is the ORIGINAL corpus label for the USER, not this post,",
    "# and 85% of posts by users labelled Attempt contain no risk language at all.",
    "# It is context. Band the post on its own content.",
    "#",
    "# §9: two hours maximum per session, ten-minute break every 45 minutes.",
    "# One batch is roughly one 45-minute block.",
]


def features(text: str) -> dict[str, str]:
    matched = sorted({m.group(0).lower() for m in _RISK_PHRASE.finditer(text)})
    return {
        "risk_phrases": "; ".join(matched[:6]),
        "person": ("1st" if _FIRST_PERSON.search(text) else "")
                  + ("/2nd" if _SECOND_PERSON.search(text) else "")
                  + ("/3rd" if _THIRD_PARTY.search(text) else ""),
        "past_tense_markers": "yes" if _PAST.search(text) else "",
        "chars": str(len(text)),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--queue", type=Path, required=True)
    parser.add_argument("--filler", type=Path, required=True,
                        help="corpus to draw benign posts from, per §9 batch mixing")
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--batch-size", type=int, default=50,
                        help="items per batch; ~45 minutes of work")
    parser.add_argument("--filler-ratio", type=float, default=0.3,
                        help="share of each batch that is benign, to satisfy §9")
    parser.add_argument("--holdout", type=float, default=0.1,
                        help="share reserved for blind annotation if pre-labels "
                             "are ever added (§6)")
    args = parser.parse_args()

    rng = random.Random(20260905)

    with args.queue.open(encoding="utf-8") as fh:
        queue = [json.loads(line) for line in fh if line.strip()]

    benign = [r for r in ds.load(args.filler)
              if not r.labels and r.source != "review_queue"]
    rng.shuffle(benign)
    need = int(len(queue) * args.filler_ratio / (1 - args.filler_ratio))
    filler = benign[:need]

    items = (
        [{"id": r["id"], "text": r["text"], "kind": "review",
          "cssrs_user_label": r.get("user_level_label_for_context_only") or ""}
         for r in queue]
        + [{"id": r.id, "text": r.text, "kind": "filler", "cssrs_user_label": ""}
           for r in filler]
    )
    rng.shuffle(items)

    args.out_dir.mkdir(parents=True, exist_ok=True)
    key_path = args.out_dir / "banding.key.jsonl"
    columns = ["id", "cssrs_user_label", "risk_phrases", "person",
               "past_tense_markers", "chars", "text",
               "risk_band", "annotator", "notes"]

    n_batches = 0
    with key_path.open("w", encoding="utf-8", newline="\n") as key:
        for start in range(0, len(items), args.batch_size):
            chunk = items[start:start + args.batch_size]
            n_batches += 1
            path = args.out_dir / f"batch-{n_batches:03d}.csv"
            with path.open("w", encoding="utf-8-sig", newline="") as fh:
                for line in BAND_GUIDE:
                    fh.write(line + "\n")
                writer = csv.DictWriter(fh, fieldnames=columns)
                writer.writeheader()
                for i, item in enumerate(chunk):
                    blind = i < int(len(chunk) * args.holdout)
                    row = {"id": item["id"],
                           "cssrs_user_label": item["cssrs_user_label"],
                           "text": item["text"],
                           "risk_band": "", "annotator": "", "notes": ""}
                    row.update(features(item["text"]))
                    writer.writerow(row)
                    key.write(json.dumps({
                        "id": item["id"], "batch": n_batches,
                        "kind": item["kind"], "blind_holdout": blind,
                    }) + "\n")

    n_review = sum(1 for i in items if i["kind"] == "review")
    print(f"\n  {n_batches} batches of up to {args.batch_size} -> {args.out_dir}")
    print(f"  {n_review} posts for banding, {len(items) - n_review} benign "
          f"({args.filler_ratio:.0%}) mixed in per guidelines §9")
    print(f"  key (never ships to the annotator): {key_path}")
    print(f"\n  At §9's two hours per session, this is roughly "
          f"{n_batches * 45 / 60 / 2:.0f} sessions of work.")
    print("\n  Nothing here is banded. A model must not band it — guidelines §8\n"
          "  restricts this task to clinically qualified annotators, and\n"
          "  dataset-sourcing.md §6 explains what is lost if that is bypassed.\n")
    print("  BEFORE spending clinician hours: this corpus is scraped Reddit.\n"
          "  Guidelines §10 says scraped forum content never enters the dataset,\n"
          "  and cssrs_review_queue.py notes commercial use needs counsel. Resolve\n"
          "  that first or the labels may be unusable.\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
