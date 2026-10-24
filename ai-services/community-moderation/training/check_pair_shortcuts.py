"""Refuse a context+response dataset that a model can solve without reading the context.

    python -m alaap_ai.community_moderation.training.check_pair_shortcuts \
        --csv data/self_harm.csv --context context_sentence --response response_sentence \
        --label label --harmful self_harm_encouragement

Exit 0 means the dataset can teach context-dependence. Exit 1 means it cannot, and
says which check failed.

WHY THIS EXISTS

`check_confounds.py` is the same lesson for single-text datasets: a classifier learns
the easiest thing that separates its classes, and if some property of the *form* lines
up with the label, form is easier to learn than meaning. This script is that lesson
applied to PAIRS, where there is one more way to go wrong and it is invisible to every
metric you would normally look at.

A relational category - self_harm_encouragement is the clearest - is defined by what a
reply does to the person who wrote the post. "Don't let people talk you out of it if
you've already decided" is career advice after one post and lethal after another. A
model can only learn that if the data contains the same reply under both labels.

Two shapes of mistake, and a dataset can make both at once. The first five drafts
made the reply-only one; the three that replaced them made the context-only one.

Measured on the five context datasets as first drafted, across 24,000 rows:

    responses appearing under more than one label     0
    self_harm unique responses (in 3,000 rows)       32
    self_harm length gap, harmful vs safe      13.8 vs 24.1 words
    "please" in safe replies / in harmful replies    38% / <2%

Every one of those is a way to score 1.00 without reading the post, and a held-out
split does not catch any of them - the shortcut generalises perfectly, because it is a
real property of the data. Only these checks catch it.

THE CHECKS

  hard pairs       the same reply under two different labels. The one that matters:
                   without it the label is a function of the reply alone and the
                   context is decoration.
  reply variety    unique replies per row. 32 replies repeated 94 times is 32
                   examples, however many rows the file has.
  length parity    harmful and safe replies must be about the same length.
  giveaway tokens  no single word may almost decide the label.
  ablation         a reply-only classifier must NOT already solve it. This is the
                   summary check: if reply-only scores well on held-out replies,
                   every other number here is beside the point.
  context ablation a CONTEXT-only classifier must not solve it either. Added after
                   three datasets passed every check above and were still solvable
                   from the post alone, at 0.93. It is the worse failure of the two:
                   a reply-only shortcut flags the wrong replies, a context-only one
                   flags EVERY reply to a distressed person, including the kind
                   ones. On this platform that silences exactly the support somebody
                   came for, and it does it on their worst night.

Deliberately no scikit-learn - blocked by Application Control on the build machine,
and unnecessary. A bag-of-words naive Bayes is the right probe for "is this separable
from surface lexical cues", which is precisely the question.
"""

from __future__ import annotations

import argparse
import collections
import csv
import io
import json
import math
import random
import re
import sys
from pathlib import Path

_WORD = re.compile(r"[a-z0-9']+")

# Defaults chosen to fail the datasets that prompted this script, and to pass a
# corpus that genuinely teaches the pair. They are arguments, not constants, because
# a category with few real positives may justify a lower bar with a note saying so.
MIN_HARD_PAIR_RATIO = 0.25
MIN_REPLY_VARIETY = 0.30
MAX_LENGTH_GAP = 0.25
MAX_TOKEN_PRECISION = 0.95
MIN_TOKEN_SUPPORT = 25
MAX_REPLY_ONLY_F1 = 0.90
# Deliberately the same bar as reply-only. Neither half of a pair may decide the
# label on its own; that is what "the pair is the unit" means.
MAX_CONTEXT_ONLY_F1 = 0.90


def tokens(text: str) -> list[str]:
    return _WORD.findall((text or "").lower())


def features(text: str) -> set[str]:
    toks = tokens(text)
    grams = set(toks)
    grams.update(f"{a}_{b}" for a, b in zip(toks, toks[1:]))
    return grams


def _nb_predict(train, test):
    """Bernoulli naive Bayes. Small, dependency-free, adequate for an ablation."""
    by_label: dict[str, list[set[str]]] = collections.defaultdict(list)
    for feats, label in train:
        by_label[label].append(feats)

    counts = collections.Counter()
    for feats, _ in train:
        counts.update(feats)
    vocab = {g for g, n in counts.items() if n >= 2}

    priors, likelihood = {}, {}
    for label, docs in by_label.items():
        priors[label] = math.log(len(docs) / len(train))
        present = collections.Counter()
        for feats in docs:
            present.update(feats & vocab)
        n = len(docs)
        likelihood[label] = {
            g: math.log((present[g] + 1) / (n + 2)) - math.log((n - present[g] + 1) / (n + 2))
            for g in vocab
        }

    out = []
    for feats, _ in test:
        seen = feats & vocab
        best, best_score = None, -1e18
        for label in priors:
            score = priors[label] + sum(likelihood[label][g] for g in seen)
            if score > best_score:
                best, best_score = label, score
        out.append(best)
    return out


def _macro_f1(truth, pred) -> float:
    total = 0.0
    labels = sorted(set(truth))
    for lab in labels:
        tp = sum(1 for t, p in zip(truth, pred) if t == lab and p == lab)
        fp = sum(1 for t, p in zip(truth, pred) if t != lab and p == lab)
        fn = sum(1 for t, p in zip(truth, pred) if t == lab and p != lab)
        prec = tp / (tp + fp) if tp + fp else 0.0
        rec = tp / (tp + fn) if tp + fn else 0.0
        total += 2 * prec * rec / (prec + rec) if prec + rec else 0.0
    return total / max(1, len(labels))


def held_out_reply_f1(texts, labels, replies, seed=0) -> float:
    """Train and test with no REPLY string on both sides.

    A random split would put identical rows in train and test wherever a dataset
    recycles sentences, and score the model on remembering them.
    """
    uniq = sorted(set(replies))
    random.Random(seed).shuffle(uniq)
    held = set(uniq[: max(1, len(uniq) // 4)])
    train = [(features(t), l) for t, l, r in zip(texts, labels, replies) if r not in held]
    test = [(features(t), l) for t, l, r in zip(texts, labels, replies) if r in held]
    if not train or not test:
        return float("nan")
    if len({l for _, l in train}) < 2 or len({l for _, l in test}) < 2:
        return float("nan")
    return _macro_f1([l for _, l in test], _nb_predict(train, test))


def held_out_context_f1(texts, labels, contexts, seed=0) -> float:
    """The mirror of held_out_reply_f1, split on the CONTEXT string.

    Held out by post rather than by reply, for the same reason: a random split scores
    the model on recognising posts it has already read.
    """
    uniq = sorted(set(contexts))
    random.Random(seed).shuffle(uniq)
    held = set(uniq[: max(1, len(uniq) // 4)])
    train = [(features(t), l) for t, l, cx in zip(texts, labels, contexts) if cx not in held]
    test = [(features(t), l) for t, l, cx in zip(texts, labels, contexts) if cx in held]
    if not train or not test:
        return float("nan")
    if len({l for _, l in train}) < 2 or len({l for _, l in test}) < 2:
        return float("nan")
    return _macro_f1([l for _, l in test], _nb_predict(train, test))


class Report:
    def __init__(self) -> None:
        self.failures: list[str] = []
        self.lines: list[str] = []

    def check(self, ok: bool, label: str, detail: str, remedy: str = "") -> None:
        mark = "pass" if ok else "FAIL"
        self.lines.append(f"  {mark}  {label:<34}{detail}")
        if not ok:
            self.failures.append(f"{label}: {detail}" + (f"\n         {remedy}" if remedy else ""))


def analyse(rows: list[dict], harmful: set[str]) -> Report:
    r = Report()
    replies = [row["response"] for row in rows]
    contexts = [row["context"] for row in rows]
    labels = [row["label"] for row in rows]
    pairs = [f"{c} SEPTOKEN {p}" for c, p in zip(contexts, replies)]

    # --- hard pairs ---------------------------------------------------------
    by_reply: dict[str, set[str]] = collections.defaultdict(set)
    for reply, label in zip(replies, labels):
        by_reply[reply].add(label)
    ambiguous = {reply for reply, labs in by_reply.items() if len(labs) > 1}
    hard_ratio = sum(1 for reply in replies if reply in ambiguous) / len(rows)
    r.check(
        hard_ratio >= MIN_HARD_PAIR_RATIO,
        "hard pairs",
        f"{hard_ratio:.1%} of rows use a reply that appears under >1 label "
        f"(need >= {MIN_HARD_PAIR_RATIO:.0%})",
        "Without these the label is a function of the reply alone. Generate the SAME "
        "reply against a post that makes it harmful and one that makes it safe.",
    )

    # --- reply variety ------------------------------------------------------
    variety = len(set(replies)) / len(rows)
    r.check(
        variety >= MIN_REPLY_VARIETY,
        "reply variety",
        f"{len(set(replies))} unique replies in {len(rows)} rows ({variety:.1%}, "
        f"need >= {MIN_REPLY_VARIETY:.0%})",
        "A recycled sentence is one example however many times it appears.",
    )

    # --- length parity ------------------------------------------------------
    lengths = collections.defaultdict(list)
    for reply, label in zip(replies, labels):
        lengths["harmful" if label in harmful else "safe"].append(len(tokens(reply)))
    if lengths["harmful"] and lengths["safe"]:
        mh = sum(lengths["harmful"]) / len(lengths["harmful"])
        ms = sum(lengths["safe"]) / len(lengths["safe"])
        gap = abs(mh - ms) / max(mh, ms)
        r.check(
            gap <= MAX_LENGTH_GAP,
            "length parity",
            f"harmful {mh:.1f} words vs safe {ms:.1f} ({gap:.0%} apart, "
            f"allowed {MAX_LENGTH_GAP:.0%})",
            "Length alone should not hint at the label. Match the registers.",
        )

    # --- giveaway tokens ----------------------------------------------------
    per_class = collections.defaultdict(collections.Counter)
    totals = collections.Counter()
    for reply, label in zip(replies, labels):
        side = "harmful" if label in harmful else "safe"
        totals[side] += 1
        per_class[side].update(set(tokens(reply)))
    tells = []
    for word in set(per_class["harmful"]) | set(per_class["safe"]):
        h, s = per_class["harmful"][word], per_class["safe"][word]
        if h + s < MIN_TOKEN_SUPPORT:
            continue
        precision = max(h, s) / (h + s)
        if precision > MAX_TOKEN_PRECISION:
            tells.append((precision, word, "harmful" if h > s else "safe", h + s))
    tells.sort(reverse=True)
    r.check(
        not tells,
        "giveaway tokens",
        (", ".join(f"{w!r}->{side} {p:.0%} (n={n})" for p, w, side, n in tells[:6]) or "none")
        + (f" +{len(tells) - 6} more" if len(tells) > 6 else ""),
        "Use these words in both classes, or remove them from both.",
    )

    # --- the summary check --------------------------------------------------
    f_reply = held_out_reply_f1(replies, labels, replies)
    f_pair = held_out_reply_f1(pairs, labels, replies)
    r.check(
        not (f_reply == f_reply) or f_reply <= MAX_REPLY_ONLY_F1,
        "reply-only ablation",
        f"a reply-only classifier scores {f_reply:.3f} on unseen replies "
        f"(allowed {MAX_REPLY_ONLY_F1:.2f}); with context {f_pair:.3f}",
        "If the reply alone already solves it, the context is decoration and a "
        "pair model will learn to ignore it.",
    )

    # --- and the mirror of it ----------------------------------------------
    #
    # The check that three otherwise-clean datasets failed. Where the harmful rows all
    # carry a distressed post and the safe rows all carry a mundane one, the post is a
    # near-perfect separator and the model will take it — then flag every reply to
    # anybody in distress, the supportive ones included.
    #
    # The fix is never to weaken the contexts. It is to add the missing cell: the same
    # distressed post, answered kindly, labelled safe. Until that row exists the data
    # contains no evidence that supporting somebody at risk is allowed.
    f_context = held_out_context_f1(contexts, labels, contexts)
    r.check(
        not (f_context == f_context) or f_context <= MAX_CONTEXT_ONLY_F1,
        "context-only ablation",
        f"a context-only classifier scores {f_context:.3f} on unseen posts "
        f"(allowed {MAX_CONTEXT_ONLY_F1:.2f})",
        "Add rows where a distressed post gets a SUPPORTIVE reply labelled safe. "
        "Without them the model has never seen that answering kindly is permitted.",
    )
    return r


def load_csv(path: Path, context: str, response: str, label: str) -> list[dict]:
    with io.open(path, encoding="utf-8-sig", newline="") as fh:
        raw = list(csv.DictReader(fh))
    if not raw:
        raise SystemExit(f"{path}: no rows")
    for column in (context, response, label):
        if column not in raw[0]:
            raise SystemExit(
                f"{path}: no column {column!r}. Columns are: {sorted(raw[0])}"
            )
    return [
        {
            "context": (row[context] or "").strip(),
            "response": (row[response] or "").strip(),
            # Folded, so a file carrying both `Non-manipulative` and `non_manipulative`
            # is measured as one class rather than counted as three.
            "label": (row[label] or "").strip().lower().replace("-", "_").replace(" ", "_"),
        }
        for row in raw
    ]


def load_jsonl(path: Path) -> list[dict]:
    rows = []
    with io.open(path, encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            rec = json.loads(line)
            rows.append(
                {
                    "context": (rec.get("context") or "").strip(),
                    "response": (rec.get("text") or "").strip(),
                    "label": ",".join(sorted(rec.get("labels") or [])) or "benign",
                }
            )
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument("--csv", type=Path)
    src.add_argument("--data", type=Path, help="platform JSONL with a `context` field")
    parser.add_argument("--context", default="context")
    parser.add_argument("--response", default="response")
    parser.add_argument("--label", default="label")
    parser.add_argument(
        "--harmful",
        action="append",
        default=[],
        help="label value(s) counted as harmful. Repeatable. Anything else is safe.",
    )
    parser.add_argument("--min-hard-pairs", type=float, default=MIN_HARD_PAIR_RATIO)
    parser.add_argument(
        "--warn-only",
        action="store_true",
        help="report and exit 0. For looking at a draft, never for a corpus about to train.",
    )
    args = parser.parse_args()

    rows = (
        load_csv(args.csv, args.context, args.response, args.label)
        if args.csv
        else load_jsonl(args.data)
    )

    globals()["MIN_HARD_PAIR_RATIO"] = args.min_hard_pairs

    fold = lambda s: s.strip().lower().replace("-", "_").replace(" ", "_")
    harmful = {fold(h) for h in args.harmful}
    if not harmful:
        # Guess, and say so. Every one of these files names its harmful class after
        # the category, and the safe class with a negation.
        harmful = {
            lab
            for lab in {row["label"] for row in rows}
            if not lab.startswith(("non", "not", "benign", "safe")) and lab != "0"
        }
        print(f"  note   --harmful not given; treating {sorted(harmful)} as harmful\n")

    missing = sum(1 for row in rows if not row["context"])
    if missing:
        print(f"  note   {missing} of {len(rows)} rows have no context\n")

    report = analyse(rows, harmful)
    print(f"{args.csv or args.data}  —  {len(rows)} rows")
    print("\n".join(report.lines))

    if report.failures and not args.warn_only:
        print("\nThis dataset can be solved from one half of the pair alone:\n")
        for failure in report.failures:
            print(f"  •  {failure}")
        print(
            "\nTraining on it would produce a model that scores well and fails on the "
            "one case\nit exists for. See docs/ai/context-pair-datasets.md.\n"
        )
        return 1

    if report.failures:
        # --warn-only was passed. Say what failed anyway: a run that prints "ok" over a
        # failing check is how a flag meant for triage becomes a way of not knowing.
        print("\nwarnings suppressed by --warn-only, but these checks did fail:\n")
        for failure in report.failures:
            print(f"  •  {failure}")
        print()
        return 0

    print("\nok — the context has to be read to get these right.\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
