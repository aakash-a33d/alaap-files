"""A1 safety classifier — fine-tuning.

    python training/train.py --data data/a1.jsonl --out ../model-store/quantised/a1-v1
    python training/train.py --data data/a1.jsonl --dry-run     # no torch needed

Full fine-tune of MuRIL-large as a 15-way multi-label head. Torch and transformers
are imported lazily so `--dry-run` validates the config, the data and the split on a
machine with neither installed — which is what CI runs.

Two choices worth stating, because both are easy to get wrong:

  Weighted BCE.  Grooming and sexual exploitation are a fraction of a percent of any
                 honest corpus. Unweighted, the model predicts "not that" every time,
                 reports excellent loss, and is useless.

  Selection on block-tier recall, not macro-F1. A checkpoint that lifts average F1
                 while dropping recall on the categories that block content is not a
                 better model for this product.

Nothing here decides thresholds. Training produces scores; `calibrate.py` turns them
into operating points against the precision floors in config.yaml.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import yaml

from alaap_ai.shared.schemas.moderation import Category

from . import dataset as ds

ALL_LABELS = [c.value for c in Category]

# Below this a category cannot reach a usable operating point, so a head trained
# on it produces confident noise. A category we cannot calibrate is a category we
# cannot ship.
#
# This was 20, on the stated reasoning that it matched calibration's floor. It did
# not. Calibration's floor is 20 positives in the **validation** split, and the
# split is 80/10/10, so the equivalent floor on corpus totals is ten times that.
# The two numbers were only ever equal by looking alike.
#
# a1-v2 is what the gap cost. `unsafe_medical_advice` cleared the old floor with
# 21 examples, took a place in the head, landed 1 positive in validation, and
# scored precision 0.000 / recall 0.000 / F1 0.000 — predicted zero times. It also
# carried the maximum pos_weight of 20 at a frequency of one sample in 2,843,
# which is the rare-large-gradient pattern that preceded the run's divergence.
#
# A category admitted here but unusable at calibration is worse than an absent
# one: the model card claims coverage the model does not have.
_VALIDATION_FRACTION = 0.10          # dataset.split() is 80/10/10
_CALIBRATION_FLOOR = 20              # config.yaml calibration.min_positive_examples
MIN_EXAMPLES = int(_CALIBRATION_FLOOR / _VALIDATION_FRACTION)   # 200


def to_matrix(records: list[ds.Record], labels: list[str]) -> list[list[float]]:
    index = {name: i for i, name in enumerate(labels)}
    matrix = []
    for record in records:
        row = [0.0] * len(labels)
        for label in record.labels:
            if label in index:            # labels outside the head are dropped
                row[index[label]] = 1.0
        matrix.append(row)
    return matrix


def ready_categories(records: list[ds.Record], min_examples: int = MIN_EXAMPLES) -> list[str]:
    """Categories with enough examples to be worth a head.

    A model that covers ten of sixteen categories is not a broken model, but it
    IS a model that must say so. The six it cannot see are not silently absent —
    they are recorded in the model card, and `policy.py` routes them to human
    review rather than letting them quietly never fire.
    """
    counts = ds.describe(records).per_label
    return [name for name in ALL_LABELS if counts.get(name, 0) >= min_examples]


def block_tier(config: dict) -> list[str]:
    return [n for n, c in config["categories"].items() if c["action"] == "block"]


def preflight(data_path: Path, config: dict, only_ready: bool = False) -> dict:
    """Validate everything that does not need a GPU. Also the whole of --dry-run.

    `only_ready` narrows the head to the categories the corpus can actually
    support, instead of refusing the run. It does not make a thin corpus
    acceptable — it makes the resulting model honest about its own blind spots.
    """
    records = ds.load(data_path)
    buckets = ds.split(records)
    ds.assert_no_leakage(buckets)

    stats = ds.describe(records)
    weights = ds.positive_weights(records, cap=config["training"]["pos_weight_cap"])

    covered = ready_categories(records)
    uncovered = [n for n in ALL_LABELS if n not in covered]

    print(f"\n  data        {data_path}")
    print(f"  records     {stats.total}  (benign {stats.benign_ratio:.0%})")
    print("  splits      " + "  ".join(f"{s}={len(b)}" for s, b in buckets.items()))
    print(f"  base        {config['model']['base']}")
    print(f"  strategy    {config['model']['strategy']}  "
          f"bf16={config['training']['bf16']}  "
          f"max_len={config['model']['max_length']}")
    print(f"  select on   {config['training']['select_on']}")

    blockers: list[str] = []
    thin = [n for n in ALL_LABELS if stats.per_label.get(n, 0) < MIN_EXAMPLES]
    if thin:
        print(f"\n  {len(thin)} categories under 20 examples:")
        for name in thin:
            n = stats.per_label.get(name, 0)
            tier = config["categories"].get(name, {}).get("action", "?")
            print(f"    {name:<32} {n:>3}  ({tier})")
            if tier == "block" and n < 20:
                blockers.append(name)

    if stats.benign_ratio < 0.5:
        blockers.append(
            f"benign examples are {stats.benign_ratio:.0%} of the set; a safety "
            f"classifier trained on mostly-harmful data over-fires on ordinary distress"
        )

    if stats.unadjudicated:
        print(f"\n  {stats.unadjudicated} records are not adjudicated. "
              f"Single-annotator labels carry that annotator's bias into the model.")

    if only_ready:
        print(f"\n  --only-ready: head covers {len(covered)} of {len(ALL_LABELS)} categories")
        print(f"    covered   {', '.join(covered)}")
        print(f"    NOT SEEN  {', '.join(uncovered) or 'none'}")
        print("\n  Uncovered categories are recorded in the model card. policy.py\n"
              "  routes them to human review — this model cannot score them, and\n"
              "  a category that silently never fires is worse than one that is\n"
              "  declared missing.\n")
        blockers = []
    elif blockers:
        print("\n  NOT READY TO TRAIN:")
        for b in blockers:
            print(f"    ! {b}")
        print("\n  A block-tier category with too few examples cannot reach its\n"
              "  precision floor, and shipping it would block innocent posts.\n"
              "  Pass --only-ready to train a head over what the corpus supports.\n")
    else:
        print("\n  preflight OK\n")

    return {"records": records, "buckets": buckets, "weights": weights,
            "blockers": blockers, "covered": covered, "uncovered": uncovered}


def train(data_path: Path, out_dir: Path, config: dict, only_ready: bool = False) -> int:
    checks = preflight(data_path, config, only_ready)
    if checks["blockers"]:
        return 1

    labels: list[str] = checks["covered"] if only_ready else ALL_LABELS
    label_to_idx = {name: i for i, name in enumerate(labels)}

    # Imported here so --dry-run works without a torch install.
    import numpy as np
    import torch
    from torch import nn
    from transformers import (
        AutoModelForSequenceClassification,
        AutoTokenizer,
        Trainer,
        TrainingArguments,
    )
    from datasets import Dataset

    mcfg, tcfg = config["model"], config["training"]
    buckets = checks["buckets"]

    tokenizer = AutoTokenizer.from_pretrained(mcfg["base"])

    def encode(records: list[ds.Record]) -> "Dataset":
        enc = tokenizer(
            [r.text for r in records],
            truncation=True,
            max_length=mcfg["max_length"],
            padding=False,
        )
        enc["labels"] = to_matrix(records, labels)
        return Dataset.from_dict(enc)

    train_ds = encode(buckets["train"])
    val_ds = encode(buckets["validation"])

    model = AutoModelForSequenceClassification.from_pretrained(
        mcfg["base"],
        num_labels=len(labels),
        problem_type=mcfg["problem_type"],
        id2label={i: n for i, n in enumerate(labels)},
        label2id=label_to_idx,
    )

    pos_weight = torch.tensor(
        [checks["weights"][n] for n in labels], dtype=torch.float
    )
    block_idx = [label_to_idx[n] for n in block_tier(config) if n in label_to_idx]

    class WeightedTrainer(Trainer):
        def compute_loss(
            self, model, inputs, return_outputs=False, num_items_in_batch=None
        ):
            labels = inputs.pop("labels")
            outputs = model(**inputs)
            loss = nn.BCEWithLogitsLoss(pos_weight=pos_weight.to(outputs.logits.device))(
                outputs.logits, labels.float()
            )
            return (loss, outputs) if return_outputs else loss

    def compute_metrics(pred):
        probs = 1 / (1 + np.exp(-pred.predictions))
        truth = pred.label_ids
        hits = (probs >= 0.5).astype(int)

        def recall_over(indices):
            tp = ((hits[:, indices] == 1) & (truth[:, indices] == 1)).sum()
            fn = ((hits[:, indices] == 0) & (truth[:, indices] == 1)).sum()
            return float(tp / (tp + fn)) if (tp + fn) else 0.0

        f1s = []
        for i in range(len(labels)):
            tp = ((hits[:, i] == 1) & (truth[:, i] == 1)).sum()
            fp = ((hits[:, i] == 1) & (truth[:, i] == 0)).sum()
            fn = ((hits[:, i] == 0) & (truth[:, i] == 1)).sum()
            p = tp / (tp + fp) if (tp + fp) else 0.0
            r = tp / (tp + fn) if (tp + fn) else 0.0
            f1s.append(2 * p * r / (p + r) if (p + r) else 0.0)

        return {
            "macro_f1": float(np.mean(f1s)),
            "block_tier_recall": recall_over(block_idx),
        }

    out_dir.mkdir(parents=True, exist_ok=True)

    # transformers 5.x dropped `warmup_ratio` in favour of absolute steps, so the
    # ratio from config is resolved against the real step count here. Keeping the
    # ratio in config is the right call — it survives a change of batch size or
    # corpus, which a hardcoded step count would not.
    steps_per_epoch = max(
        1,
        len(train_ds)
        // (tcfg["batch_size"] * tcfg["gradient_accumulation_steps"]),
    )
    total_steps = steps_per_epoch * tcfg["epochs"]
    warmup_steps = int(total_steps * tcfg["warmup_ratio"])

    trainer = WeightedTrainer(
        model=model,
        args=TrainingArguments(
            output_dir=str(out_dir),
            num_train_epochs=tcfg["epochs"],
            per_device_train_batch_size=tcfg["batch_size"],
            per_device_eval_batch_size=tcfg["batch_size"],
            gradient_accumulation_steps=tcfg["gradient_accumulation_steps"],
            learning_rate=tcfg["learning_rate"],
            warmup_steps=warmup_steps,
            weight_decay=tcfg["weight_decay"],
            # Stated, not inherited. A silent Trainer default is not a training
            # decision anyone reviewed, and this one matters — see config.yaml.
            max_grad_norm=tcfg.get("max_grad_norm", 1.0),
            save_total_limit=2,
            bf16=tcfg["bf16"],
            gradient_checkpointing=tcfg["gradient_checkpointing"],
            seed=tcfg["seed"],
            eval_strategy="epoch",
            save_strategy="epoch",
            load_best_model_at_end=True,
            metric_for_best_model=tcfg["select_on"],
            greater_is_better=True,
            logging_steps=25,
            report_to=[],
        ),
        train_dataset=train_ds,
        eval_dataset=val_ds,
        compute_metrics=compute_metrics,
        # transformers 5.x renamed `tokenizer` to `processing_class`.
        processing_class=tokenizer,
    )

    trainer.train()
    trainer.save_model(str(out_dir))
    tokenizer.save_pretrained(str(out_dir))

    # Emit validation scores in the shape calibrate.py expects, so the operating
    # points are always derived from the checkpoint that was actually selected.
    import numpy as np  # noqa: F811  (local re-bind for clarity)

    raw = trainer.predict(val_ds)
    probs = 1 / (1 + np.exp(-raw.predictions))
    (out_dir / "val_predictions.json").write_text(
        json.dumps({n: probs[:, i].tolist() for i, n in enumerate(labels)}),
        encoding="utf-8",
    )
    (out_dir / "val_labels.json").write_text(
        json.dumps({n: raw.label_ids[:, i].astype(int).tolist()
                    for i, n in enumerate(labels)}),
        encoding="utf-8",
    )

    # The model card travels with the weights. Without it a later loader has no
    # way to know that six categories were never in this head, and would read
    # their absence as "never fires" rather than "cannot see".
    stats = ds.describe(checks["records"])
    (out_dir / "model_card.json").write_text(
        json.dumps({
            "base": mcfg["base"],
            "strategy": mcfg["strategy"],
            "covered_categories": labels,
            "uncovered_categories": checks["uncovered"] if only_ready else [],
            "train_examples": len(buckets["train"]),
            "validation_examples": len(buckets["validation"]),
            "per_label_counts": {n: stats.per_label.get(n, 0) for n in labels},
            "adjudicated": False,
            "evaluation_gates_passed": [],
            "production_ready": False,
        }, indent=2),
        encoding="utf-8",
    )

    print(f"\n  saved to {out_dir}")
    print("  next: training/calibrate.py --predictions val_predictions.json "
          "--labels val_labels.json --out metadata/moderation/thresholds.v1.yaml\n")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--out", type=Path,
                        default=Path("../model-store/quantised/a1-latest"))
    parser.add_argument("--config", type=Path,
                        default=Path(__file__).parent / "config.yaml")
    parser.add_argument("--dry-run", action="store_true",
                        help="validate data and config; do not load the model")
    parser.add_argument("--only-ready", action="store_true",
                        help="train a head over the categories the corpus supports, "
                             "and record the rest as uncovered in the model card")
    args = parser.parse_args()

    config = yaml.safe_load(args.config.read_text(encoding="utf-8"))

    if args.dry_run:
        return 1 if preflight(args.data, config, args.only_ready)["blockers"] else 0
    return train(args.data, args.out, config, args.only_ready)


if __name__ == "__main__":
    raise SystemExit(main())
