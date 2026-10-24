"""Does the model moderate one language more than another, on text that is benign?

    python evaluation/run_language_bias.py \
        --checkpoint model-store/quantised/a1-v9 \
        --corpus community-moderation/training/data/combined.v8.jsonl \
        --thresholds ../metadata/moderation/thresholds.v9-real.yaml

Accuracy metrics are averages, and an average hides a disparity that falls entirely
on one group. a1-v8 reported `passive_aggressive_abuse` precision 0.76 — comfortably
over its floor, apparently shippable — while flagging **79.7% of held-out benign
Hindi and Bengali posts against 2.0% of English**. A 40x gap, invisible in every
number the training pipeline produced.

The cause was in the corpus, not the model. `passive_aggressive_abuse` comes from
TRAC-2, which is 78% romanised Indic, while the benign half was 99% English. The
model learned "romanised Indic text" as a proxy for the category. That is the Jigsaw
identity-mention failure — the one `ingest.py` mines Civil Comments hard negatives to
prevent — displaced onto language instead of identity.

**This runs on benign text only.** A higher flag rate on genuinely harmful text in
some language is the model working. A higher flag rate on harmless text is the model
penalising people for how they write, and on a platform whose users code-mix by
default that lands on the people it was built for.

Exit code is non-zero when any category's flag rate on benign text in one language
exceeds the English rate by more than `--max-ratio`, so this can gate a release.
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter, defaultdict
from pathlib import Path

import yaml

from alaap_ai.community_moderation.training import dataset as ds
from alaap_ai.shared.schemas.moderation import Category

_REPO_ROOT = Path(__file__).resolve().parents[1]

# Below this many benign examples in a language, the rate is noise and reporting a
# ratio on it would be worse than saying nothing.
MIN_SAMPLES = 30



def _benign_by_language(args) -> dict:
    """Benign held-out text, keyed by language.

    The training corpus contributes its own test split; the eval-languages file
    contributes everything held out of training. Both are benign-only, because a
    higher flag rate on genuinely harmful text is the model working — it is the
    rate on harmless text that measures whether people are penalised for how
    they write.
    """
    buckets: dict[str, list] = defaultdict(list)
    for record in ds.split(ds.load(args.corpus))["test"]:
        if not record.labels:
            buckets[record.language].append(record)
    if args.eval_languages and args.eval_languages.exists():
        for record in ds.load(args.eval_languages):
            if not record.labels:
                buckets[record.language].append(record)
    return buckets


def _crisis_bias(args) -> int:
    """A2 has no categories and no thresholds — one ordered risk band.

    So the disparity question changes shape: not "which category over-fires in
    which language" but "is benign text in one language escalated into the
    crisis workflow more often than another". An escalation is a support offer
    rather than a sanction, so the harm from a false positive is smaller than
    A1's — but it is not zero. A user whose ordinary posts keep triggering an
    intervention learns to stop posting.
    """
    from alaap_ai.crisis_triage.models import crisis as crisis_models
    from alaap_ai.shared.schemas.moderation import RiskLevel

    model = (crisis_models.build("transformer", checkpoint=args.checkpoint)
             if args.checkpoint else crisis_models.build())
    by_language = _benign_by_language(args)

    print(f"\n  model   {model.model_id}")
    print("  benign text from the held-out test split — escalation rate\n")
    rates = {}
    for lang, records in sorted(by_language.items()):
        rows = records[:args.limit]
        if len(rows) < MIN_SAMPLES:
            print(f"  {lang:<10} only {len(rows)} benign examples — skipped")
            continue
        counts = Counter(model.score(r.text)[0] for r in rows)
        escalated = len(rows) - counts[RiskLevel.NONE]
        rates[lang] = escalated / len(rows)
        detail = "  ".join(f"{lvl.value} {counts[lvl]}" for lvl in RiskLevel
                           if counts[lvl])
        print(f"  {lang:<10} {len(rows):>4} benign   escalated "
              f"{escalated / len(rows):>6.1%}   ({detail})")

    if args.baseline not in rates or len(rates) < 2:
        print("\n  not enough languages to compare\n")
        return 1
    base = max(rates[args.baseline], 1 / args.limit)
    worst_lang, worst = max(((l, r) for l, r in rates.items() if l != args.baseline),
                            key=lambda kv: kv[1])
    print(f"\n  {worst_lang} {worst:.1%} vs {args.baseline} "
          f"{rates[args.baseline]:.1%}  ({worst / base:.1f}x)")
    if worst / base > args.max_ratio:
        print(f"\n  Benign {worst_lang} text is escalated more than "
              f"{args.max_ratio:.0f}x as often as {args.baseline}.\n")
        return 1
    print(f"\n  No language exceeds {args.max_ratio:.0f}x the {args.baseline} "
          "escalation rate on benign text.\n")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", default=None,
                        help="A1 checkpoint; omit with --model crisis to probe "
                             "the A2 lexicon baseline")
    parser.add_argument("--model", choices=["safety", "crisis"], default="safety",
                        help="safety = A1 per-category flag rates. crisis = A2, "
                             "which emits one risk band, so the measured quantity "
                             "is how often benign text is escalated at all.")
    parser.add_argument("--corpus", type=Path, required=True)
    parser.add_argument("--eval-languages", type=Path, default=None,
                        help="the *.eval-languages.jsonl written by ingest.py. "
                             "Training is English-only, so the corpus has no "
                             "other language left to compare against and this "
                             "file is where the comparison text lives. Without "
                             "it the harness silently reports 'only English' "
                             "and passes, which is the zero-shot claim going "
                             "untested rather than confirmed.")
    parser.add_argument("--thresholds", type=Path, default=None)
    parser.add_argument("--baseline", default="en",
                        help="language the others are compared against")
    parser.add_argument("--max-ratio", type=float, default=2.0,
                        help="how many times the baseline flag rate is tolerable")
    parser.add_argument("--limit", type=int, default=400,
                        help="benign examples per language (speed)")
    args = parser.parse_args()

    if args.model == "crisis":
        return _crisis_bias(args)

    from alaap_ai.community_moderation.models import safety

    thresholds: dict[str, float] = {}
    if args.thresholds and args.thresholds.exists():
        payload = yaml.safe_load(args.thresholds.read_text(encoding="utf-8"))
        for name, row in (payload.get("categories") or {}).items():
            # An uncalibrated category is not enforced, so including it would
            # report a disparity nobody is exposed to.
            if row.get("calibrated"):
                thresholds[name] = float(row["threshold"])
    if not thresholds:
        thresholds = {c.value: 0.5 for c in Category}

    # Never seen in training and never used for calibration.
    by_language = _benign_by_language(args)

    model = safety.build("transformer", checkpoint=args.checkpoint)

    print(f"\n  checkpoint  {args.checkpoint}")
    print(f"  benign text from the held-out test split, "
          f"{len(thresholds)} enforced categories\n")

    rates: dict[str, dict[str, float]] = {}
    totals: dict[str, float] = {}
    for language, records in sorted(by_language.items()):
        rows = records[:args.limit]
        if len(rows) < MIN_SAMPLES:
            print(f"  {language:<10} only {len(rows)} benign examples — skipped")
            continue
        fired: Counter[str] = Counter()
        any_fired = 0
        for record in rows:
            scores = model.score(record.text)
            hit = False
            for name, threshold in thresholds.items():
                if scores[Category(name)] >= threshold:
                    fired[name] += 1
                    hit = True
            any_fired += hit
        rates[language] = {n: fired[n] / len(rows) for n in thresholds}
        totals[language] = any_fired / len(rows)
        print(f"  {language:<10} {len(rows):>4} benign   "
              f"any category fires on {any_fired / len(rows):>6.1%}")

    if args.baseline not in rates:
        print(f"\n  no baseline data for {args.baseline!r}\n")
        return 1

    print(f"\n  per category, flag rate on benign text "
          f"(baseline {args.baseline}):\n")
    header = f"  {'category':<32}" + "".join(f"{lg:>12}" for lg in sorted(rates))
    print(header)
    failures = []
    for name in sorted(thresholds):
        cells = "".join(f"{rates[lg][name]:>11.1%} " for lg in sorted(rates))
        base = rates[args.baseline][name]
        worst = max((rates[lg][name], lg) for lg in rates if lg != args.baseline) \
            if len(rates) > 1 else (0.0, None)
        # A ratio against a zero baseline is meaningless, so compare against the
        # smallest rate the sample could have resolved instead.
        floor = max(base, 1 / args.limit)
        over = worst[0] / floor > args.max_ratio and worst[0] > 0
        if over:
            failures.append((name, base, worst[0], worst[1]))
        print(f"  {name:<32}{cells}{'  <- disparity' if over else ''}")

    if failures:
        print(f"\n  {len(failures)} category(ies) moderate benign text unequally:\n")
        for name, base, worst_rate, worst_lang in failures:
            print(f"    {name}: {worst_rate:.1%} of benign {worst_lang} vs "
                  f"{base:.1%} of benign {args.baseline}")
        print("\n  These categories penalise users for the language they write in.\n"
              "  Do not enable them, whatever their precision floor says.\n")
        return 1

    print(f"\n  No enforced category exceeds {args.max_ratio:.0f}x the "
          f"{args.baseline} flag rate on benign text.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
