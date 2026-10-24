# Training the A1 safety classifier

How to build the corpus and run a training cycle on a local workstation. Written
against the machine this was first run on — RTX 5070 Ti (16 GB, Blackwell / sm_120),
Ryzen 9950X3D, 32 GB DDR5 — and the numbers below are measured on it, not estimated.

The pipeline is four steps and only one of them needs the GPU:

```
ingest.py  ->  dataset.py  ->  train.py  ->  calibrate.py
(corpus)       (validate)      (GPU)        (thresholds)
```

---

## 0. Environment

**This machine is already set up. Do not "fix" it.** The versions matter more than
usual here:

| Package | Installed | Why it matters |
| --- | --- | --- |
| torch | 2.11.0+**cu128** | Blackwell is compute capability **sm_120**. A cu121 or cu124 wheel gives `no kernel image is available for execution on the device` on this GPU. |
| transformers | 5.16.1 | 5.x renamed `tokenizer` → `processing_class` and dropped `warmup_ratio`; `train.py` is written against 5.x. |
| datasets | 5.0.1 | |
| Python | 3.12.10 | |

Verify before a long run:

```bash
python -c "import torch; print(torch.__version__, torch.cuda.get_device_name(0), torch.cuda.get_arch_list()[-1])"
```

Expect `2.11.0+cu128 NVIDIA GeForce RTX 5070 Ti sm_120`. If `sm_120` is absent from
the arch list, the wheel is wrong — reinstall from the cu128 index rather than PyPI
default:

```bash
pip install --force-reinstall torch --index-url https://download.pytorch.org/whl/cu128
```

The package is installed editable, so code edits take effect without reinstalling:

```bash
cd ai-services && pip install -e ".[models,dev]"
```

---

## 1. VSCode

Open **`D:\Projects\wellness\alaap-platform`** as the folder — not `wellness`, and not
`ai-services`. `.vscode/launch.json` resolves `${workspaceFolder}/ai-services`, and the
wrong root silently breaks every config.

1. Install the **Python** and **Pylance** extensions.
2. `Ctrl+Shift+P` → *Python: Select Interpreter* →
   `C:\Users\AAKASH\AppData\Local\Programs\Python\Python312\python.exe`.
3. Open the Run and Debug panel (`Ctrl+Shift+D`). The five `A1 …` configurations run
   the pipeline in order.

Run them from the panel, or use the terminal commands below — they are equivalent.
Breakpoints work in either case because `justMyCode` is off, which you want when the
break is inside `WeightedTrainer.compute_loss`.

> Training prints a live progress bar. Use **`console: integratedTerminal`** (already
> set) — the Debug Console does not render it and a 40-minute run looks hung.

---

## 2. Build the corpus

Already done — `data/combined.v2.jsonl`, 74,919 records. Rebuild only if the downloads
change:

```bash
cd ai-services
python -m alaap_ai.community_moderation.training.ingest \
    --downloads "C:/Users/AAKASH/Downloads" \
    --out community-moderation/training/data/public-benchmarks.v2.jsonl \
    --per-category 8000 --mental-health-cap 6000 --benign-ratio 0.62
```

Takes about 6 minutes; most of it is the 874 MB Civil Comments scan and the 394 MB
PAN-12 XML. PAN-12 must be **extracted** first — `read_pan12` wants a directory, not
the zip. TRAC-2 is read from its zip directly.

Then merge the synthetic seed in to get `combined.v2.jsonl`. The two id prefixes
(`pb-` and `syn-`) do not collide, so it is a concatenation.

**Sanity-check every slice you care about.** The mental-illness hard negatives came in
at 4,996 of the ~5,003 that exist. If that number collapses to double digits, the
annotator floor in `ingest.py` has drifted again — see the note in `dataset-sourcing.md`.

---

## 3. Validate, then preflight

Both run in seconds on CPU. Never skip them; they are what stops a bad corpus from
costing you 40 minutes.

```bash
python -m alaap_ai.community_moderation.training.dataset \
    community-moderation/training/data/combined.v2.jsonl

python -m alaap_ai.community_moderation.training.train \
    --data community-moderation/training/data/combined.v2.jsonl --dry-run --only-ready
```

`dataset.py` fails on production-sourced records, duplicate ids and split leakage.
`train.py --dry-run` additionally reports which categories the corpus can support.
Exit 0 means go.

`--only-ready` is required. Without it preflight refuses the run, because four
block-tier categories sit under the 20-example floor — correctly, since a block-tier
category that cannot reach its precision floor would block innocent posts.

---

## 4. Train

```bash
python -m alaap_ai.community_moderation.training.train \
    --data community-moderation/training/data/combined.v2.jsonl \
    --out model-store/quantised/a1-v2 \
    --only-ready
```

Or **A1 3. train** in the Run and Debug panel.

What to expect on this machine:

| | |
| --- | --- |
| Steps | 1,865/epoch (59,698 train ÷ effective batch 32), 7,460 over 4 epochs |
| Time | ~8–10 min/epoch including eval → **~40 minutes** |
| Throughput | ~0.26 s/step, measured on the a1-v1 run |
| Disk | ~14 GB — each checkpoint is 2 GB of weights + 4 GB of optimiser state, `save_total_limit=2` |
| First run | add ~2 GB and a few minutes to download `google/muril-large-cased` |

The a1-v1 run completed at these exact settings on this GPU, so batch 16 fits. If you
change the base model or `max_length` and hit `torch.OutOfMemoryError`, the knobs in
`config.yaml`, in the order to reach for them:

1. `batch_size: 8` **and** `gradient_accumulation_steps: 4` — halves activation memory
   and keeps the effective batch at 32, so the learning rate still holds.
2. `gradient_checkpointing: true` — large saving, roughly 30% slower.
3. `max_length: 192` — only if the first two are not enough; it truncates real posts.

Leave `bf16: true`. Blackwell has native bf16 and fp32 would not fit.

### Watch the eval, not the loss

Training loss falls the whole way and means nothing on its own. The a1-v1 run:

| epoch | eval_loss | macro_f1 | block_tier_recall |
| --- | --- | --- | --- |
| 1 | 0.172 | 0.713 | **0.946** ← selected |
| 2 | 0.159 | 0.890 | 0.942 |
| 3 | 0.187 | 0.756 | 0.941 |
| 4 | 0.237 | 0.761 | 0.925 |

It was overfitting from epoch 3. `load_best_model_at_end=True` means this costs time
rather than quality, but **`epochs: 3` in `config.yaml` is the honest setting** for a
corpus this size and saves ~10 minutes a run.

Note also that selection on `block_tier_recall` picked epoch 1 over epoch 2 for a
0.45pp recall gain that cost 17.7pp of macro-F1 — a margin well inside noise at
n=7,629. If that repeats on v2, consider requiring a minimum improvement so ties fall
through to the better-calibrated checkpoint.

---

## 5. Calibrate

Training produces scores. It does **not** produce thresholds, and a model without
calibrated thresholds is running every category at an arbitrary 0.5.

```bash
python -m alaap_ai.community_moderation.training.calibrate \
    --predictions model-store/quantised/a1-v2/val_predictions.json \
    --labels model-store/quantised/a1-v2/val_labels.json \
    --out ../metadata/moderation/thresholds.v2.yaml \
    --model-version a1-v2
```

CPU, a few seconds. **Exit code 1 is normal** — it returns non-zero whenever any
category is uncalibrated, and nine will be.

The binding constraint is not the training floor. `train.py` admits a category at 20
examples, but calibration needs 20 *positive validation* examples, and validation is
10% of the corpus — so a category needs **~200 records before it can be calibrated at
all**. `unsafe_medical_advice` is the worked example: 21 records, cleared the training
gate, landed 1 positive in validation, shipped uncalibrated at 0.5.

Any category whose row shows `meets_precision_floor: false` must not be enabled for its
configured action. Route it to human review.

---

## 6. Point the service at what you just trained

Training and calibration write files; nothing reads them until you say so. Both
variables move together — a checkpoint and the threshold set calibrated for it:

```bash
ALAAP_SAFETY_BACKEND=transformer
ALAAP_SAFETY_CHECKPOINT=../model-store/quantised/a1-v2
ALAAP_THRESHOLDS=../metadata/moderation/thresholds.v2.yaml
```

Setting only one is no longer silently honoured. `policy.load` refuses a threshold set
whose `model_version` does not match the loaded model and falls back to uncalibrated
defaults, so a half-applied upgrade shows up as `thresholds_calibrated: false` rather
than as thresholds that quietly never fire.

Confirm on `/health` before believing anything:

```
thresholds_calibrated    true
thresholds_source        .../thresholds.v2.yaml
covered_categories       7
unscorable_categories    9
unreachable_categories   0
```

`unreachable_categories` must be empty. A category listed there is one the model scores
but whose threshold sits above anything it can emit — it will never fire, and silence
is indistinguishable from safety.

---

## 7. What this model is, and is not

Seven of sixteen categories, from 74,919 records that are **entirely unadjudicated**.
`model_card.json` records `production_ready: false` and lists the nine uncovered
categories so `policy.py` can route them to human review rather than letting them
silently never fire. Do not remove that flag on the basis of good validation numbers.

Two things stand between this and a shippable model, and neither is a training problem:

- **The nine starved categories need data.** `generate_starved.py --plan` shows where
  they stand. Three of them have no seed examples at all and cannot be generated until
  someone writes a handful by hand.
- **The clinical evaluation set does not exist.** `dataset-sourcing.md` §7 step 2 puts
  it on the critical path and says it is not parallelisable, for the reason visible
  above: every number in this runbook is measured against a validation split drawn
  from the same benchmark corpora as the training data. It tells you the model learned
  the corpus. It does not tell you the model works on a mental wellness community.

---

## 8. Adding data for a starved category

Three steps, from `dataset-sourcing.md` §4. Step 2 is the one that is easy to skip
and is the reason any of this is allowed at all.

**1. Generate candidates on the local Qwen.** Never Claude, GPT or Gemini — their
terms restrict training a model on their output, and that restriction is why the
base-model licence decision mattered. Start Ollama, then:

```bash
python -m alaap_ai.community_moderation.training.generate \
  --category self_harm_encouragement --n 350 --batch 25 \
  --seed-corpus ai-services/community-moderation/training/data/combined.v10.jsonl \
  --out ai-services/community-moderation/training/data/generated/self_harm_encouragement.en.jsonl \
  --base-url http://localhost:11434/v1 --model qwen3:8b
```

**`--base-url` is not optional.** Its default is port 8000, which is the moderation
API — omit it and the generator posts prompts at the classifier.

Generate the negatives in the same pass, not later. A category whose positives use
a vocabulary the benign pool never contains teaches the vocabulary, which is how
a1-v4 learned *mentions psychiatric medication = harmful*. For self-harm the
negatives are `benign_own_despair`, `benign_crisis_support` and
`benign_reported_abuse`, and they matter more than the positives: the failure they
prevent is moderating somebody for disclosing that they want to die.

**2. Build a review sheet and have a clinician work through it.**

```bash
python -m alaap_ai.community_moderation.training.build_review_sheet \
  --in ai-services/community-moderation/training/data/generated/self_harm_encouragement*.en.jsonl \
       ai-services/community-moderation/training/data/generated/benign_*.en.jsonl \
  --out ai-services/community-moderation/training/data/review/self_harm_encouragement-review.csv
```

The sheet carries `proposed_label`, never `label`. The generator's brief is a
proposal and the clinician is the annotator of record.

**3. Import the adjudicated sheet** with `import_annotations.py`, then re-run the
merge and the preflight. Nothing from `data/generated/` goes into a corpus
directly, and `adjudicated: false` on every generated record is what makes that
check possible.

---

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `no kernel image is available` | torch wheel without sm_120. Reinstall from the cu128 index. |
| `ModuleNotFoundError: alaap_ai` | Wrong cwd, or the editable install is missing. Run from `ai-services`. |
| `duplicate id` from `ds.load` | Two generation runs merged without distinct ids. Fixed for language collisions in `generate.py`; check any hand-merged file. |
| `N texts appear in both train and validation` | Real leakage. The split is by text hash, so this means the same text under two ids — deduplicate before training. |
| Preflight exits 1 | A block-tier category is under 20 examples. Intended. Pass `--only-ready`. |
| Progress bar invisible | Debug Console instead of integrated terminal. |
| Run looks hung at start | First run downloads MuRIL-large (~2 GB). |
