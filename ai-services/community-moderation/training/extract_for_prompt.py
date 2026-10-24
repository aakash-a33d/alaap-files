"""Pull the input that Prompts 2, 3 and 4 need out of a dataset.

    python -m alaap_ai.community_moderation.training.extract_for_prompt \
        --csv data/self_harm.csv --prompt 4 \
        --context context_sentence --response response_sentence --label label \
        --harmful self_harm_encouragement

Prompt 1 GENERATES; you paste it and collect batches. Prompts 2, 3 and 4 TRANSFORM
something that already exists, so each needs a specific slice of the current file
pasted underneath it. This prints that slice, ready to paste.

    --prompt 2   the unique replies, to be paraphrased into many
    --prompt 3   the replies whose LENGTH gives the label away, with their labels
    --prompt 4   the words that alone decide the label, with the class they betray

Output goes to stdout. Redirect it, open it, paste it under the prompt.

A note on which files are worth this. Prompts 2-4 are salvage. Where a file has only a
few dozen distinct replies, regenerating with Prompt 1 is less work than repairing, and
the result is better - paraphrasing 32 sentences 20 times gives 640 sentences that are
all still those 32 ideas. Salvage is worth it where the sentence stock is genuinely
varied; regenerate where it is not. `--prompt 0` prints the numbers that decide which.
"""

from __future__ import annotations

import argparse
import collections
import csv
import io
import re
import sys
from pathlib import Path

_WORD = re.compile(r"[a-z0-9']+")

MIN_TOKEN_SUPPORT = 25
MAX_TOKEN_PRECISION = 0.95


def fold(value: str) -> str:
    return (value or "").strip().lower().replace("-", "_").replace(" ", "_")


def load(path: Path, ctx: str, resp: str, lab: str) -> list[dict[str, str]]:
    with io.open(path, encoding="utf-8-sig", newline="") as fh:
        raw = list(csv.DictReader(fh))
    if not raw:
        raise SystemExit(f"{path}: no rows")
    for column in (ctx, resp, lab):
        if column not in raw[0]:
            raise SystemExit(f"{path}: no column {column!r}. Columns: {sorted(raw[0])}")
    return [
        {
            "context": (r[ctx] or "").strip(),
            "response": (r[resp] or "").strip(),
            "label": fold(r[lab]),
        }
        for r in raw
    ]


def triage(rows: list[dict[str, str]], harmful: set[str]) -> None:
    """--prompt 0. Repair or regenerate?"""
    replies = [r["response"] for r in rows]
    unique = len(set(replies))
    variety = unique / len(rows)
    print(f"rows                {len(rows)}")
    print(f"unique replies      {unique}  ({variety:.1%})")
    lengths = collections.defaultdict(list)
    for r in rows:
        lengths["harmful" if r["label"] in harmful else "safe"].append(len(_WORD.findall(r["response"].lower())))
    if lengths["harmful"] and lengths["safe"]:
        mh = sum(lengths["harmful"]) / len(lengths["harmful"])
        ms = sum(lengths["safe"]) / len(lengths["safe"])
        print(f"length harmful/safe {mh:.1f} / {ms:.1f} words  ({abs(mh - ms) / max(mh, ms):.0%} apart)")
    print()
    if unique < 300:
        print(
            f"VERDICT  regenerate with Prompt 1. Only {unique} distinct replies exist, so\n"
            f"         paraphrasing them multiplies {unique} ideas rather than adding any.\n"
            f"         Prompts 3 and 4 still apply afterwards, to the NEW file."
        )
    else:
        print(
            "VERDICT  worth salvaging. Run Prompt 2 to multiply the existing stock, then\n"
            "         Prompts 3 and 4 to close the style shortcuts. Prompt 1 is still\n"
            "         needed for hard pairs, which no amount of paraphrasing creates."
        )


def prompt2(rows: list[dict[str, str]]) -> None:
    for reply in sorted({r["response"] for r in rows}):
        print(reply)


def prompt3(rows: list[dict[str, str]], harmful: set[str]) -> None:
    """The replies at the extremes of the length gap — the ones doing the leaking."""
    scored = [(len(_WORD.findall(r["response"].lower())), r) for r in rows]
    by_class = collections.defaultdict(list)
    for length, r in scored:
        by_class["harmful" if r["label"] in harmful else "safe"].append((length, r))

    out: list[tuple[int, dict[str, str]]] = []
    for side, items in by_class.items():
        items.sort(key=lambda t: t[0])
        # Shortest harmful and longest safe are the rows that create the gap: fixing
        # the middle of the distribution moves the mean far less per sentence rewritten.
        picked = items[:150] if side == "harmful" else items[-150:]
        seen: set[str] = set()
        for length, r in picked:
            if r["response"] in seen:
                continue
            seen.add(r["response"])
            out.append((length, r))

    writer = csv.writer(sys.stdout, lineterminator="\n")
    writer.writerow(["response_sentence", "label", "words"])
    for length, r in out:
        writer.writerow([r["response"], r["label"], length])


def prompt4(rows: list[dict[str, str]], harmful: set[str]) -> None:
    per_class = collections.defaultdict(collections.Counter)
    for r in rows:
        side = "harmful" if r["label"] in harmful else "safe"
        per_class[side].update(set(_WORD.findall(r["response"].lower())))

    tells = []
    for word in set(per_class["harmful"]) | set(per_class["safe"]):
        h, s = per_class["harmful"][word], per_class["safe"][word]
        if h + s < MIN_TOKEN_SUPPORT:
            continue
        precision = max(h, s) / (h + s)
        if precision > MAX_TOKEN_PRECISION:
            betrays = "harmful" if h > s else "safe"
            # The class it must be written INTO is the opposite of the one it betrays.
            tells.append((h + s, word, betrays, "safe" if betrays == "harmful" else "harmful"))
    tells.sort(reverse=True)

    writer = csv.writer(sys.stdout, lineterminator="\n")
    writer.writerow(["word", "currently_only_in", "write_it_into", "occurrences"])
    for n, word, betrays, target in tells:
        writer.writerow([word, betrays, target, n])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--csv", type=Path, required=True)
    parser.add_argument("--prompt", type=int, choices=[0, 2, 3, 4], required=True)
    parser.add_argument("--context", default="context_sentence")
    parser.add_argument("--response", default="response_sentence")
    parser.add_argument("--label", default="label")
    parser.add_argument("--harmful", action="append", default=[])
    args = parser.parse_args()

    rows = load(args.csv, args.context, args.response, args.label)
    harmful = {fold(h) for h in args.harmful}
    if not harmful:
        harmful = {
            lab
            for lab in {r["label"] for r in rows}
            if not lab.startswith(("non", "not", "benign", "safe")) and lab != "0"
        }
        print(f"# --harmful not given; treating {sorted(harmful)} as harmful", file=sys.stderr)

    {0: lambda: triage(rows, harmful),
     2: lambda: prompt2(rows),
     3: lambda: prompt3(rows, harmful),
     4: lambda: prompt4(rows, harmful)}[args.prompt]()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
