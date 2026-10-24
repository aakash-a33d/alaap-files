"""Ingest public benchmark corpora into the A1 label schema.

    python -m alaap_ai.community_moderation.training.ingest \
        --downloads "C:/Users/AAKASH/Downloads" --out data/public-benchmarks.v1.jsonl

Four sources, four different label vocabularies, one target schema. Every mapping
below is a judgement that a reviewer should be able to disagree with, so each is
stated explicitly rather than buried in a dict comprehension.

**These corpora are not from a mental health context.** They are Wikipedia talk
pages, news comments, Twitter and social media. Aggression in an edit war does not
look like coercion in a support thread. Treat this as auxiliary data that teaches
general harm, then fine-tune on the domain corpus — do not ship a model trained on
this alone.

**The known failure mode of Jigsaw-trained models is our worst case.** Models trained
on this data are documented to over-flag text that merely *mentions* an identity —
including mental illness. "I have depression" scoring as toxic is precisely the
failure this platform cannot have. Civil Comments carries a
`psychiatric_or_mental_illness` annotation, and non-toxic comments with that flag are
extracted here as explicit hard negatives to push back against it.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import random
import sys
import zipfile
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

csv.field_size_limit(10**7)


@dataclass
class Row:
    text: str
    labels: list[str]
    dataset: str
    language: str = "en"
    note: str = ""


# --------------------------------------------------------------------------
# Mapping decisions, and the deliberate non-mappings
#
#   obscene / severe_toxic  NOT mapped. Profanity is not one of our categories;
#                           people in distress swear, and that is not moderated.
#   sexual_explicit         NOT mapped to sexual_exploitation. Explicit content is
#                           not exploitation, and conflating them would teach the
#                           model to flag people disclosing sexual trauma.
#   toxic (umbrella)        NOT mapped on its own. It is a parent label; using it
#                           as a positive imports its ambiguity wholesale.
# --------------------------------------------------------------------------

# Civil Comments reliability floor.
#
# This was 10, which is a sensible-sounding default and was badly wrong here. The
# identity-annotated subset of Civil Comments was rated by far fewer toxicity
# annotators than the bulk corpus, so a floor of 10 cut the non-toxic
# mental-illness rows from 5,003 to 21 — silently deleting the single most valuable
# slice in the whole download. At 4 the trade is 2-of-4 agreement: noisy, but these
# are auxiliary training data, never the evaluation set.
MIN_ANNOTATORS = 4
TOXIC_THRESHOLD = 0.5     # fraction of annotators agreeing
BENIGN_CEILING = 0.10     # below this, treat as clean


def read_jigsaw(path: Path, rng: random.Random, cap: int) -> list[Row]:
    """Jigsaw Toxic Comment. Binary 0/1 sub-labels, raw text present."""
    out: list[Row] = []
    with path.open(encoding="utf-8", errors="replace", newline="") as fh:
        for r in csv.DictReader(fh):
            labels = []
            if r.get("threat") == "1":
                labels.append("threats_intimidation")
            if r.get("identity_hate") == "1":
                labels.append("hate_speech")
            if r.get("insult") == "1" or r.get("severe_toxic") == "1":
                labels.append("bullying_harassment")

            text = (r.get("comment_text") or "").strip()
            if not (15 <= len(text) <= 1000):
                continue
            # Skip the ambiguous middle: toxic but none of our sub-labels fired.
            if not labels and r.get("toxic") == "1":
                continue
            out.append(Row(text, labels, "jigsaw-toxic"))
            if len(out) >= cap:
                break
    return out


def read_civil_comments(
    path: Path, rng: random.Random, cap: int, mental_health_cap: int
) -> list[Row]:
    """Civil Comments / Jigsaw Unintended Bias. Fractional labels, ~2M rows.

    Three separate budgets, filled independently. A single shared cap meant the
    scan stopped on general benign rows long before reaching the identity-annotated
    section, so the hard negatives never got collected — the second way this reader
    lost the data it existed to find.
    """
    harmful: list[Row] = []
    mental_health: list[Row] = []
    general: list[Row] = []
    harmful_cap = cap // 2
    general_cap = cap // 2
    seen = 0

    with path.open(encoding="utf-8", errors="replace", newline="") as fh:
        for r in csv.DictReader(fh):
            seen += 1
            if seen % 400_000 == 0:
                print(f"    ... {seen:,} rows scanned", file=sys.stderr)

            text = (r.get("comment_text") or "").strip()
            if not (15 <= len(text) <= 1000):
                continue

            def f(key: str) -> float:
                try:
                    return float(r.get(key) or 0.0)
                except ValueError:
                    return 0.0

            if f("toxicity_annotator_count") < MIN_ANNOTATORS:
                continue

            labels = []
            if f("threat") >= TOXIC_THRESHOLD:
                labels.append("threats_intimidation")
            if f("identity_attack") >= TOXIC_THRESHOLD:
                labels.append("hate_speech")
            if f("insult") >= TOXIC_THRESHOLD:
                labels.append("bullying_harassment")

            toxicity = f("toxicity")

            if labels:
                if len(harmful) < harmful_cap:
                    harmful.append(Row(text, labels, "civil-comments"))
            elif toxicity < BENIGN_CEILING:
                # The prize in this corpus: clean comments that mention mental
                # illness. Exactly the text a Jigsaw-trained model wrongly flags.
                if f("psychiatric_or_mental_illness") > 0:
                    if len(mental_health) < mental_health_cap:
                        mental_health.append(Row(
                            text, [], "civil-comments",
                            note="HARD NEGATIVE: mentions mental illness, non-toxic",
                        ))
                elif len(general) < general_cap:
                    general.append(Row(text, [], "civil-comments"))

            if (len(harmful) >= harmful_cap
                    and len(general) >= general_cap
                    and len(mental_health) >= mental_health_cap):
                break

    print(f"    mental-illness hard negatives: {len(mental_health):,}", file=sys.stderr)
    return harmful + mental_health + general


def read_hatexplain(path: Path) -> list[Row]:
    """HateXplain. Three annotators per post; majority vote."""
    data = json.loads(path.read_text(encoding="utf-8"))
    out: list[Row] = []
    for post_id, rec in data.items():
        votes = Counter(a["label"] for a in rec.get("annotators", []))
        if not votes:
            continue
        label, count = votes.most_common(1)[0]
        if count < 2:          # no majority; ambiguous by construction
            continue

        text = " ".join(rec.get("post_tokens", [])).strip()
        if not (15 <= len(text) <= 1000):
            continue

        mapped = {
            "hatespeech": ["hate_speech"],
            "offensive": ["bullying_harassment"],
            "normal": [],
        }.get(label)
        if mapped is None:
            continue
        out.append(Row(text, mapped, "hatexplain"))
    return out


def read_trac(path: Path) -> list[Row]:
    """TRAC-2 aggression. English, Hindi and Bengali; train + dev.

    Sub-task A: NAG none / CAG covert / OAG overt.
    Sub-task B: NGEN / GEN gendered.

    CAG is the find. Covert aggression is precisely `passive_aggressive_abuse`, a
    category listed as having no public data in the earlier sourcing note. That was
    wrong, and the Hindi split is romanised code-mixed text.
    """
    out: list[Row] = []
    with zipfile.ZipFile(path) as z:
        for name in z.namelist():
            base = name.rsplit("/", 1)[-1]
            if not (base.startswith("trac2_") and base.endswith(".csv")):
                continue
            if "_test" in base or "_gold" in base:
                continue        # held out; do not train on the evaluation split

            language = {"eng": "en", "hin": "hi-Latn", "iben": "bn-Latn"}.get(
                base.split("_")[1], "en"
            )
            raw = z.read(name).decode("utf-8", "replace")
            for r in csv.DictReader(io.StringIO(raw)):
                text = (r.get("Text") or "").strip()
                if not (15 <= len(text) <= 1000):
                    continue

                labels = []
                a = (r.get("Sub-task A") or "").strip()
                b = (r.get("Sub-task B") or "").strip()
                if a == "OAG":
                    labels.append("bullying_harassment")
                elif a == "CAG":
                    labels.append("passive_aggressive_abuse")
                if b == "GEN":
                    labels.append("hate_speech")

                out.append(Row(text, sorted(set(labels)), f"trac2-{base.split('_')[1]}",
                               language=language))
    return out


def read_pan12(corpus_dir: Path, benign_cap: int = 4000) -> list[Row]:
    """PAN-12 sexual predator identification, **problem 2 only**.

    Problem 1 labels whole authors as predators. Using that at message level is
    catastrophic: 69% of predator-authored messages are under 25 characters, and
    only 3% contain anything grooming-related, so a classifier trained on it learns
    that "hey!!" and "sounds like fun lol" are grooming. Measured, not assumed.

    Problem 2 is the usable half — 6,478 individual lines annotated as suspicious
    within a conversation. That is genuine message-level ground truth.

    Register caveat: these are 2000s chat logs, short and abbreviated. Our surface is
    posts and replies. Auxiliary data, not domain data.

    LICENCE: PAN/CLEF corpora are released for research. Commercial use is not
    granted by default and needs checking before this reaches a shipped model.
    """
    import xml.etree.ElementTree as ET

    gt_path = corpus_dir / "pan12-sexual-predator-identification-groundtruth-problem2.txt"
    xml_path = corpus_dir / "pan12-sexual-predator-identification-test-corpus-2012-05-17.xml"
    if not (gt_path.exists() and xml_path.exists()):
        return []

    flagged: dict[str, set[str]] = {}
    for line in gt_path.read_text(encoding="utf-8", errors="replace").splitlines():
        parts = line.split()
        if len(parts) == 2:
            flagged.setdefault(parts[0], set()).add(parts[1])

    out: list[Row] = []
    benign = 0

    # iterparse and clear: the test corpus XML is ~394 MB.
    for event, conv in ET.iterparse(str(xml_path), events=("end",)):
        if conv.tag != "conversation":
            continue
        cid = conv.get("id")
        lines = flagged.get(cid)

        for m in conv.findall("message"):
            text = (m.findtext("text") or "").strip()
            # Chat messages are short; 12 chars keeps "how old r u" while dropping
            # the "lol" noise floor.
            if not (12 <= len(text) <= 1000):
                continue

            if lines and m.get("line") in lines:
                out.append(Row(text, ["grooming_exploitation"], "pan12"))
            elif not lines and benign < benign_cap:
                # Only from conversations with no flagged line anywhere. An
                # unflagged message inside a grooming conversation is not safely
                # benign, so those are dropped rather than mislabelled.
                benign += 1
                out.append(Row(text, [], "pan12"))

        conv.clear()

    print(f"    pan12 flagged lines: {sum(1 for r in out if r.labels):,}", file=sys.stderr)
    return out


def read_sms_spam(path: Path) -> list[Row]:
    """UCI SMS Spam. Latin-1 encoded, two useful columns.

    Spam only. The `ham` half is personal texting language and would import a
    register that has nothing to do with community posts.
    """
    out: list[Row] = []
    with path.open(encoding="latin-1", newline="") as fh:
        for r in csv.reader(fh):
            if len(r) < 2 or r[0] not in ("spam", "ham"):
                continue
            if r[0] != "spam":
                continue
            text = r[1].strip()
            if 15 <= len(text) <= 1000:
                out.append(Row(text, ["scams_financial_exploitation"], "uci-sms-spam"))
    return out


# --------------------------------------------------------------------------

def balance(rows: list[Row], rng: random.Random, per_category: int,
            benign_ratio: float) -> list[Row]:
    """Cap each category, then take benign up to the required ratio.

    Without a cap, Civil Comments alone supplies enough `bullying_harassment` to
    drown every other category and every domain example we later add.
    """
    harmful = [r for r in rows if r.labels]
    benign = [r for r in rows if not r.labels]
    rng.shuffle(harmful)
    rng.shuffle(benign)

    kept: list[Row] = []
    counts: Counter[str] = Counter()
    for row in harmful:
        if any(counts[l] >= per_category for l in row.labels):
            continue
        counts.update(row.labels)
        kept.append(row)

    # Priority order for the benign budget, because this list gets truncated and
    # what falls off the end is what the model never learns is harmless.
    #
    #   0  hard negatives      — mental-illness mentions, non-toxic
    #   1  non-English benign  — see below
    #   2  everything else
    #
    # Non-English benign was priority 2 and that was a measured mistake. TRAC
    # supplies `passive_aggressive_abuse` almost entirely in romanised Hindi and
    # Bengali, while the benign pool is dominated by English Jigsaw and Civil
    # Comments. Proportional sampling therefore kept 533 of 4,495 available
    # non-English NAG rows, leaving the corpus at 78% non-English for that
    # category against 1.2% for benign.
    #
    # a1-v8 learned the obvious proxy: **79.7% of held-out benign Hindi and
    # Bengali posts were flagged passive_aggressive_abuse, against 2.0% of
    # English** — a 40x false-positive disparity, on the platform that chose
    # MuRIL specifically to serve those users. Same failure as the Jigsaw
    # identity-mention bias that `mental_health_cap` exists to prevent, one axis
    # over.
    def priority(row: Row) -> int:
        if row.note:
            return 0
        return 1 if row.language != "en" else 2

    benign.sort(key=priority)
    need = int(len(kept) * benign_ratio / (1 - benign_ratio))
    kept.extend(benign[:need])

    rng.shuffle(kept)
    return kept


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--downloads", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--per-category", type=int, default=6000)
    p.add_argument("--benign-ratio", type=float, default=0.62)
    p.add_argument("--civil-cap", type=int, default=250_000)
    p.add_argument("--jigsaw-cap", type=int, default=200_000)
    p.add_argument("--mental-health-cap", type=int, default=4000)
    # Languages to keep. Bengali is dropped by default: the product ships
    # English and Hinglish (ai-requirements.md, "Language handling"), and
    # bn-Latn brought a category the platform has no evaluation set for.
    p.add_argument("--languages", nargs="+", default=["en"],
                   help="language tags to keep for TRAINING; others are dropped")
    p.add_argument("--eval-languages", nargs="+", default=["hi-Latn"],
                   help="languages written to a separate held-out file instead of "
                        "being discarded. Never trained on; used by "
                        "evaluation/run_language_bias.py to verify that the "
                        "English-only zero-shot bet actually holds.")
    args = p.parse_args()

    rng = random.Random(20260901)
    d = args.downloads
    rows: list[Row] = []

    sources = [
        ("jigsaw-toxic", d / "jigsaw-toxic-comment-train-processed-seqlen128.csv"
                           / "jigsaw-toxic-comment-train-processed-seqlen128.csv",
         lambda pth: read_jigsaw(pth, rng, args.jigsaw_cap)),
        ("civil-comments", d / "all_data.csv" / "all_data.csv",
         lambda pth: read_civil_comments(pth, rng, args.civil_cap, args.mental_health_cap)),
        ("hatexplain", d / "HateXplain_dataset.json" / "HateXplain_dataset.json",
         read_hatexplain),
        ("trac2", d / "trac2-shared-task-dataset" / "release-files" / "trac aggression.zip",
         read_trac),
        ("uci-sms-spam", d / "spam.csv", read_sms_spam),
        ("pan12", d / "3713280" / "pan12-sexual-predator-identification-test-and-training"
                    / "sexual predator identification test corpus"
                    / "pan12-sexual-predator-identification-test-corpus-2012-05-21",
         read_pan12),
    ]

    # NOT ingested: the CSSRS-annotated Reddit corpus (500 users, Supportive /
    # Indicator / Ideation / Behavior / Attempt). Its labels are per USER, not per
    # post, and 85% of posts by users labelled Attempt or Behavior contain no risk
    # language at all — many are that user supporting somebody else. Exploding it to
    # per-message labels would train A2 that recovery narratives are high risk,
    # which is the exact failure the design guards against. See
    # docs/ai/dataset-sourcing.md and training/cssrs_review_queue.py.

    for name, path, reader in sources:
        if not path.exists():
            print(f"  SKIP {name}: {path} not found", file=sys.stderr)
            continue
        print(f"  reading {name} ...", file=sys.stderr)
        got = reader(path)
        print(f"    {len(got):,} usable rows", file=sys.stderr)
        rows.extend(got)

    # Training is English-only, per ai-requirements.md "Language handling":
    # labels in English, MuRIL underneath, and cross-lingual transfer relied on
    # for Hinglish rather than Hinglish training data. The corpus had drifted off
    # that — TRAC supplied 2,691 non-English rows — and the drift is what broke
    # the transfer, because `passive_aggressive_abuse` arrived 78% romanised
    # Indic against a 99% English benign half and the model learned the language
    # as the label.
    #
    # Non-English rows are HELD OUT rather than dropped. The zero-shot bet is a
    # claim about behaviour, and a claim needs something to test it against;
    # discarding this text would leave `run_language_bias.py` with nothing to
    # measure and the bet unfalsifiable.
    train_langs = set(args.languages)
    eval_langs = set(args.eval_languages) - train_langs
    held_out = [r for r in rows if r.language in eval_langs]
    before = len(rows)
    rows = [r for r in rows if r.language in train_langs]
    if len(rows) != before:
        print(f"  training languages {sorted(train_langs)}: kept {len(rows):,} "
              f"of {before:,} rows", file=sys.stderr)
        print(f"  held out for evaluation only: {len(held_out):,} rows "
              f"({sorted(eval_langs)})", file=sys.stderr)

    kept = balance(rows, rng, args.per_category, args.benign_ratio)

    # Exact-duplicate removal across corpora.
    seen: set[str] = set()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    with args.out.open("w", encoding="utf-8", newline="\n") as fh:
        for i, row in enumerate(kept):
            key = " ".join(row.text.lower().split())
            if key in seen:
                continue
            seen.add(key)
            fh.write(json.dumps({
                "id": f"pb-{i:07d}",
                "text": row.text,
                "labels": row.labels,
                "source": "public_benchmark",
                "dataset": row.dataset,
                "language": row.language,
                # Benchmark labels come from crowd annotators against a different
                # rubric. They are usable for training and are NOT adjudicated
                # against our guidelines.
                "adjudicated": False,
                **({"note": row.note} if row.note else {}),
            }, ensure_ascii=False) + "\n")
            written += 1

    print(f"\n  wrote {written:,} records -> {args.out}")

    # The held-out languages, written beside the corpus with a name that says
    # what they are for. `dataset.py` never loads this and `train.py` never sees
    # it; `evaluation/run_language_bias.py` does.
    if held_out:
        eval_path = args.out.with_name(args.out.stem + ".eval-languages.jsonl")
        with eval_path.open("w", encoding="utf-8", newline="\n") as fh:
            for i, row in enumerate(held_out):
                fh.write(json.dumps({
                    "id": f"ev-{i:07d}",
                    "text": row.text,
                    "labels": row.labels,
                    "source": "public_benchmark",
                    "dataset": row.dataset,
                    "language": row.language,
                    "adjudicated": False,
                    "note": "EVALUATION ONLY - held out of training so the "
                            "English-only zero-shot claim can be measured",
                }, ensure_ascii=False) + "\n")
        print(f"  wrote {len(held_out):,} held-out records -> {eval_path}")
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
