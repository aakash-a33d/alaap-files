"""A1 training data: schema, validation, splitting and class statistics.

Two rules are enforced here rather than documented elsewhere, because a rule that
lives only in a policy document eventually gets broken by someone in a hurry:

  1. No production data. §12P — "no real user data in development or staging".
     A record sourced from the live platform is rejected outright.

  2. No split leakage. The same text appearing in train and test inflates every
     metric and would let an unusable model pass its clinical gate.

Format is JSONL, one record per line:

    {"id": "syn-0001",
     "text": "...",
     "labels": ["bullying_harassment"],
     "source": "synthetic",
     "language": "en",
     "adjudicated": true}

`labels` is a list because the task is multi-label — one message can be both a scam
and an impersonation attempt. An empty list is a valid and important record: the
model needs to learn what benign distress looks like, and benign examples must be
the majority of the set.
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from alaap_ai.shared.schemas.moderation import Category

VALID_LABELS = {c.value for c in Category}

# Sources permitted in a training set. "production" is deliberately absent.
ALLOWED_SOURCES = {"synthetic", "licensed", "public_benchmark", "clinician_authored"}

SPLITS = ("train", "validation", "test")


class DatasetError(ValueError):
    """Raised on any record that must not enter training."""


@dataclass
class Record:
    id: str
    text: str
    labels: list[str]
    source: str
    language: str = "en"
    adjudicated: bool = False
    note: str = ""
    # Which benchmark a record came from. Kept because label semantics differ
    # between corpora, and a per-dataset error breakdown is the only way to see
    # that one source is dragging a category down.
    dataset: str = ""
    # What this text was a reply to, when it was one.
    #
    # Empty for a standalone record, and empty is the normal case: most categories
    # are decided by the text alone. It is populated for the RELATIONAL categories -
    # self_harm_encouragement, manipulation_coercion, grooming_exploitation,
    # sexual_exploitation, emotional_dependency_pressure,
    # help_seeking_discouragement, passive_aggressive_abuse - where the same sentence
    # is harmless after one post and harmful after another, and no amount of reading
    # the reply alone can tell you which.
    #
    # Deliberately NOT part of text_hash. The hash groups the splits, and grouping
    # must be by the reply: a reply seen in training tells you nothing new when it
    # reappears in test under a different post, so allowing that would inflate every
    # score exactly where the pair is supposed to be doing the work.
    context: str = ""

    @property
    def is_benign(self) -> bool:
        return not self.labels

    @property
    def has_context(self) -> bool:
        return bool(self.context.strip())

    @property
    def text_hash(self) -> str:
        """Normalised hash of the REPLY, used for leakage detection across splits.

        The reply and not the pair, on purpose. See the note on `context`.
        """
        normalised = " ".join(self.text.lower().split())
        return hashlib.sha256(normalised.encode("utf-8")).hexdigest()


def parse(raw: dict, line_no: int) -> Record:
    missing = {"id", "text", "labels", "source"} - raw.keys()
    if missing:
        raise DatasetError(f"line {line_no}: missing {sorted(missing)}")

    if raw["source"] not in ALLOWED_SOURCES:
        raise DatasetError(
            f"line {line_no}: source {raw['source']!r} is not permitted in training. "
            f"Allowed: {sorted(ALLOWED_SOURCES)}. Production data may never be used "
            f"for model training (§12P)."
        )

    if not isinstance(raw["labels"], list):
        raise DatasetError(f"line {line_no}: labels must be a list, got {type(raw['labels'])}")

    unknown = set(raw["labels"]) - VALID_LABELS
    if unknown:
        raise DatasetError(f"line {line_no}: unknown labels {sorted(unknown)}")

    if not raw["text"].strip():
        raise DatasetError(f"line {line_no}: empty text")

    return Record(
        id=raw["id"],
        text=raw["text"],
        labels=list(dict.fromkeys(raw["labels"])),  # dedupe, keep order
        source=raw["source"],
        language=raw.get("language", "en"),
        adjudicated=bool(raw.get("adjudicated", False)),
        note=raw.get("note", ""),
        dataset=raw.get("dataset", ""),
        context=raw.get("context", ""),
    )


def load(path: Path) -> list[Record]:
    records: list[Record] = []
    seen_ids: set[str] = set()

    with path.open(encoding="utf-8") as fh:
        for line_no, line in enumerate(fh, start=1):
            if not line.strip():
                continue
            record = parse(json.loads(line), line_no)
            if record.id in seen_ids:
                raise DatasetError(f"line {line_no}: duplicate id {record.id!r}")
            seen_ids.add(record.id)
            records.append(record)

    if not records:
        raise DatasetError(f"{path} contains no records")
    return records


def split(records: list[Record], seed: str = "alaap-a1") -> dict[str, list[Record]]:
    """Deterministic 80/10/10 split, assigned by hash of the text.

    Hashing the *text* rather than the id means an identical message cannot land in
    two splits even if it was annotated twice under different ids. Determinism means
    the split survives a re-run, so metrics stay comparable across training runs.
    """
    buckets: dict[str, list[Record]] = {s: [] for s in SPLITS}

    for record in records:
        digest = hashlib.sha256(f"{seed}:{record.text_hash}".encode()).hexdigest()
        position = int(digest[:8], 16) % 100
        if position < 80:
            buckets["train"].append(record)
        elif position < 90:
            buckets["validation"].append(record)
        else:
            buckets["test"].append(record)

    return buckets


def assert_no_leakage(buckets: dict[str, list[Record]]) -> None:
    hashes = {s: {r.text_hash for r in rs} for s, rs in buckets.items()}
    for a, b in (("train", "validation"), ("train", "test"), ("validation", "test")):
        overlap = hashes[a] & hashes[b]
        if overlap:
            raise DatasetError(
                f"{len(overlap)} texts appear in both {a} and {b}. Every metric "
                f"computed on this split would be inflated."
            )


@dataclass
class Stats:
    total: int
    benign: int
    per_label: Counter = field(default_factory=Counter)
    per_language: Counter = field(default_factory=Counter)
    unadjudicated: int = 0

    @property
    def benign_ratio(self) -> float:
        return self.benign / self.total if self.total else 0.0


def describe(records: list[Record]) -> Stats:
    stats = Stats(total=len(records), benign=sum(r.is_benign for r in records))
    for record in records:
        stats.per_label.update(record.labels)
        stats.per_language[record.language] += 1
        stats.unadjudicated += not record.adjudicated
    return stats


def positive_weights(records: list[Record], cap: float = 20.0) -> dict[str, float]:
    """Per-category `pos_weight` for BCEWithLogitsLoss.

    Grooming and sexual exploitation will always be a fraction of a percent of any
    honest corpus. Unweighted, the model learns to predict "not that" for every
    example and reports excellent loss while being useless.

    Weights are capped: an uncapped weight on a category with four examples
    produces a model that fires on everything remotely similar, which on this
    platform means blocking people who needed to speak.
    """
    total = len(records)
    weights: dict[str, float] = {}
    counts = describe(records).per_label

    for label in sorted(VALID_LABELS):
        positives = counts.get(label, 0)
        if positives == 0:
            weights[label] = 1.0
            continue
        weights[label] = min((total - positives) / positives, cap)
    return weights


def report(path: Path) -> int:
    """`python training/dataset.py data.jsonl` — validate and describe."""
    records = load(path)
    buckets = split(records)
    assert_no_leakage(buckets)
    stats = describe(records)

    print(f"\n  {path.name}: {stats.total} records")
    print(f"  benign {stats.benign} ({stats.benign_ratio:.0%})   "
          f"unadjudicated {stats.unadjudicated}")
    print(f"  splits  " + "   ".join(f"{s} {len(b)}" for s, b in buckets.items()))
    print(f"  languages  " + "  ".join(f"{k}:{v}" for k, v in stats.per_language.items()))

    print("\n  label                            n   pos_weight")
    weights = positive_weights(records)
    for label in sorted(VALID_LABELS):
        n = stats.per_label.get(label, 0)
        flag = "  <- no examples" if n == 0 else ("  <- sparse" if n < 20 else "")
        print(f"    {label:<30} {n:>4}   {weights[label]:>6.1f}{flag}")

    if stats.benign_ratio < 0.5:
        print("\n  WARNING: benign examples are a minority. A safety classifier "
              "trained on mostly-harmful data over-fires on ordinary distress.")
    print()
    return 0


if __name__ == "__main__":
    import sys

    raise SystemExit(report(Path(sys.argv[1])))
