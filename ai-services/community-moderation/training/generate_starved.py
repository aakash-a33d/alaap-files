"""Run generation for every starved category in one pass.

    python -m alaap_ai.community_moderation.training.generate_starved --plan
    python -m alaap_ai.community_moderation.training.generate_starved --per-category 600

`generate.py` produces one file per (category, language). There are seven starved
categories and two languages, so driving it by hand is fourteen near-identical
commands and an easy place to lose a run. This wraps it, checks the endpoint before
firing anything, and refuses the categories that cannot work yet.

HOW MANY. The binding number is not the training floor, it is the calibration floor.
`train.py` needs 20 examples to put a category in the head, but `calibrate.py` needs
20 *positive validation* examples to pick a threshold, and validation is 10% of the
corpus (dataset.py splits 80/10/10). So a category needs roughly 200 records before
it can be calibrated at all, and the a1-v1 run is the proof: `unsafe_medical_advice`
had 21 records, cleared the training floor, landed 1 positive in validation and came
out uncalibrated at the default 0.5.

The default here is 600. That is ~60 in validation after the split, with enough margin
to survive near-duplicate rejection and whatever the clinical review discards — and
review will discard a lot, which is the point of the review.

WHAT THIS DOES NOT DO. Everything it writes is `adjudicated: false`, inherited from
generate.py, which has no flag to change it. These files are a review queue, not a
corpus. Nothing here may be merged into a training set before two-annotator
adjudication (docs/ai/dataset-sourcing.md §4).
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections import Counter
from pathlib import Path

from . import dataset as ds
from .generate import _BRIEFS

# The categories with no usable public corpus. Ordered by how badly the a1-v1 run
# needed them: block tier first, then review, then reword.
STARVED = [
    "self_harm_encouragement",
    "unsafe_medical_advice",
    "religious_coercion",
    "emotional_dependency_pressure",
    "impersonation",
    "manipulation_coercion",
    "help_seeking_discouragement",
]

# Briefed, but no seed examples exist to few-shot from, so generate.py exits 1.
# Listed separately rather than silently skipped: a category that is missing
# because nobody wrote its seeds should be visible every time this runs.
NEEDS_SEEDS = ["stalking_doxxing", "sexual_exploitation", "malware_phishing"]

LANGUAGES = ["en", "hi-Latn"]

# Calibration needs 20 positives in a 10% validation split. See module docstring.
CALIBRATION_FLOOR = 20
VALIDATION_FRACTION = 0.1


def seed_pools(seed_corpus: Path) -> Counter:
    counts: Counter = Counter()
    for record in ds.load(seed_corpus):
        for label in record.labels:
            counts[label] += 1
    return counts


def endpoint_alive(base_url: str) -> tuple[bool, str]:
    try:
        import httpx
    except ImportError:
        return False, "httpx is not installed (pip install -e '.[dev]')"
    try:
        response = httpx.get(f"{base_url.rstrip('/')}/models", timeout=5)
    except Exception as exc:
        return False, f"{type(exc).__name__}: {exc}"
    if response.status_code != 200:
        return False, f"HTTP {response.status_code}"
    served = [m.get("id", "?") for m in response.json().get("data", [])]
    return True, ", ".join(served) or "no models listed"


def plan(seed_corpus: Path, per_category: int, languages: list[str]) -> int:
    pools = seed_pools(seed_corpus)
    projected = per_category * len(languages) * VALIDATION_FRACTION

    print(f"\n  target {per_category} per category per language "
          f"({len(languages)} languages)")
    print(f"  projected validation support ~{projected:.0f} "
          f"(calibration needs {CALIBRATION_FLOOR})\n")

    print(f"  {'category':<32}{'seeds':>7}{'brief':>8}   status")
    runnable = 0
    for name in STARVED + NEEDS_SEEDS:
        seeds = pools.get(name, 0)
        has_brief = "yes" if name in _BRIEFS else "NO"
        if not seeds:
            status = "BLOCKED - no seed examples to few-shot from"
        elif name not in _BRIEFS:
            status = "BLOCKED - no brief"
        else:
            status = "ready"
            runnable += 1
            if seeds < 6:
                status = f"ready (thin: {seeds} shots available)"
        print(f"  {name:<32}{seeds:>7}{has_brief:>8}   {status}")

    print(f"\n  {runnable} of {len(STARVED) + len(NEEDS_SEEDS)} categories runnable\n")
    if any(not pools.get(n) for n in NEEDS_SEEDS):
        print("  The blocked categories need a handful of clinician-authored seed\n"
              "  examples each before they can be generated. Per dataset-sourcing.md\n"
              "  §4 those must not be written by a hosted assistant.\n")
    return 0


def run_one(category: str, language: str, n: int, seed_corpus: Path,
            out_dir: Path, base_url: str, model: str) -> tuple[int, int]:
    out = out_dir / f"{category}.{language}.jsonl"
    cmd = [
        sys.executable, "-m", "alaap_ai.community_moderation.training.generate",
        "--category", category,
        "--language", language,
        "--n", str(n),
        "--seed-corpus", str(seed_corpus),
        "--out", str(out),
        "--base-url", base_url,
        "--model", model,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"    {category:<32}{language:<9} FAILED")
        print("      " + (result.stderr.strip().splitlines() or ["no stderr"])[-1])
        return 0, 1

    kept = sum(1 for line in out.read_text(encoding="utf-8").splitlines() if line.strip())
    print(f"    {category:<32}{language:<9} {kept:>5} candidates")
    return kept, 0


def main() -> int:
    here = Path(__file__).parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--per-category", type=int, default=600)
    parser.add_argument("--languages", nargs="+", default=LANGUAGES, choices=LANGUAGES)
    parser.add_argument("--seed-corpus", type=Path,
                        default=here / "data" / "synthetic-seed.v1.jsonl")
    parser.add_argument("--out-dir", type=Path, default=here / "data" / "generated")
    parser.add_argument("--base-url", default="http://localhost:8000/v1")
    parser.add_argument("--model", default="Qwen/Qwen3-8B")
    parser.add_argument("--plan", action="store_true",
                        help="show what would run and why; contacts nothing")
    args = parser.parse_args()

    if args.plan:
        return plan(args.seed_corpus, args.per_category, args.languages)

    alive, detail = endpoint_alive(args.base_url)
    if not alive:
        print(f"\n  no generator at {args.base_url} — {detail}\n")
        print("  generate.py talks to a self-hosted OpenAI-compatible endpoint.\n"
              "  Start one before running this, e.g.\n\n"
              "    vllm serve Qwen/Qwen3-8B --port 8000\n\n"
              "  The model is deliberately self-hosted: dataset-sourcing.md §4\n"
              "  rules out generating training data with a hosted assistant.\n")
        return 1
    print(f"\n  endpoint {args.base_url} serving: {detail}")

    pools = seed_pools(args.seed_corpus)
    ready = [c for c in STARVED if pools.get(c) and c in _BRIEFS]
    skipped = [c for c in STARVED + NEEDS_SEEDS if c not in ready]

    args.out_dir.mkdir(parents=True, exist_ok=True)
    print(f"  writing to {args.out_dir}\n")

    total, failures = 0, 0
    for category in ready:
        for language in args.languages:
            kept, failed = run_one(category, language, args.per_category,
                                   args.seed_corpus, args.out_dir,
                                   args.base_url, args.model)
            total += kept
            failures += failed

    print(f"\n  {total} candidates across {len(ready)} categories, {failures} failed run(s)")
    if skipped:
        print(f"  skipped (no seeds): {', '.join(skipped)}")
    print("\n  These are NOT training data. Every record is adjudicated:false and\n"
          "  needs clinician review plus two-annotator adjudication before it\n"
          "  enters a corpus. Next: export_for_annotation.py\n")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
