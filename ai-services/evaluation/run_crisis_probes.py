"""Generalisation probes for A2, the crisis classifier.

    python evaluation/run_crisis_probes.py

Separate from `run_probes.py` because A2 answers a different question. A1 emits a
score per category and is judged against a calibrated threshold; A2 emits one
ordered risk band, so a probe asserts a floor ("this must reach at least high")
or a ceiling ("this must not exceed low") rather than a firing decision.

The two failure directions are not symmetric and the harness reports them apart:

    MISSED     real risk language read as none or low. A person in crisis is
               not offered support. The worst thing this system can fail to do.

    OVER-READ  a recovery narrative, a third-party worry, or an idiom read as
               high risk. This is not merely noise — it teaches users that
               describing their own history triggers an intervention, and the
               reliable way to stop that is to stop disclosing.

A2 is currently a regex lexicon (`baseline-crisis-v0`) and its own docstring says
"real crisis language is idiomatic, euphemistic and culture-specific, which is
exactly what a phrase list misses". These probes are written to measure that
claim rather than assume it, so half of them deliberately avoid every phrase in
the list, and half of those are Hinglish.

Exit code is non-zero on any failure.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from alaap_ai.shared.schemas.moderation import RiskLevel

_HERE = Path(__file__).parent

# Ordered, so a probe can assert a floor or a ceiling.
_ORDER = [RiskLevel.NONE, RiskLevel.LOW, RiskLevel.MODERATE, RiskLevel.HIGH]
_RANK = {level: i for i, level in enumerate(_ORDER)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", default=None,
                        help="a trained A2 checkpoint; omit to probe the lexicon baseline")
    parser.add_argument("--probes", type=Path, default=_HERE / "probes" / "crisis.jsonl")
    parser.add_argument("-v", "--verbose", action="store_true",
                        help="print every probe, not just the summary and failures")
    args = parser.parse_args()

    from alaap_ai.crisis_triage.models import crisis as crisis_models

    model = (crisis_models.build("transformer", checkpoint=args.checkpoint)
             if args.checkpoint else crisis_models.build())

    with args.probes.open(encoding="utf-8") as fh:
        probes = [json.loads(line) for line in fh if line.strip()]

    print(f"\n  model   {model.model_id}")
    print(f"  probes  {len(probes)}")

    missed, over_read = [], []
    by_form: dict[str, list[bool]] = {}
    by_language: dict[str, list[bool]] = {}

    for probe in probes:
        level, _score = model.score(probe["text"])
        floor = probe.get("expect_min")
        ceiling = probe.get("expect_max")

        ok = True
        if floor and _RANK[level] < _RANK[RiskLevel(floor)]:
            ok = False
            missed.append((probe, level))
        if ceiling and _RANK[level] > _RANK[RiskLevel(ceiling)]:
            ok = False
            over_read.append((probe, level))

        by_form.setdefault(probe.get("form", "?"), []).append(ok)
        by_language.setdefault(probe["language"], []).append(ok)
        if args.verbose:
            expected = f">= {floor}" if floor else f"<= {ceiling}"
            print(f"  {probe['id']:<14}{probe['language']:<10}{expected:<20}"
                  f"{level.value:<10}  {'ok  ' if ok else 'FAIL'}  {probe['text'][:42]}")

    passed = len(probes) - len(missed) - len(over_read)

    # Broken out by form and language, because an aggregate hides the thing that
    # matters. A2 can score respectably overall while failing every euphemism and
    # every Hinglish probe, and those are the two registers real users write in.
    print(f"\n  by form:")
    for form, results in sorted(by_form.items(), key=lambda kv: sum(kv[1]) / len(kv[1])):
        n_ok, n = sum(results), len(results)
        bar = "#" * n_ok + "." * (n - n_ok)
        print(f"    {form:<20}{n_ok:>3}/{n:<4} {bar}")
    print(f"\n  by language:")
    for lang, results in sorted(by_language.items()):
        n_ok, n = sum(results), len(results)
        print(f"    {lang:<20}{n_ok:>3}/{n:<4} {100 * n_ok / n:.0f}%")

    print(f"\n  {passed}/{len(probes)} passed")

    if missed:
        print(f"\n  MISSED — real risk language not detected ({len(missed)}):")
        for probe, level in missed:
            print(f"    {probe['id']} [{probe['language']}] read as {level.value}")
            print(f"      {probe['text']}")
            print(f"      {probe['why']}")
    if over_read:
        print(f"\n  OVER-READ — benign text escalated ({len(over_read)}):")
        for probe, level in over_read:
            print(f"    {probe['id']} [{probe['language']}] read as {level.value}")
            print(f"      {probe['text']}")
            print(f"      {probe['why']}")

    if missed or over_read:
        print("\n  A2 must not be relied on for crisis routing while these fail.\n")
        return 1
    print("\n  No known gap. This is a floor, not clinical validation:\n"
          "  A2's risk bands require clinician sign-off (ai-requirements.md).\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
