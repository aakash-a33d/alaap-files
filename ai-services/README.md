# ai-services

Python + FastAPI inference and orchestration. Deployed on GPU nodes separate from the
application tier.

| Path | Holds |
| --- | --- |
| `orchestrator/` | Routes AI tasks, versions models, logs AI access, blocks training use by default |
| `community-moderation/` | Server moderation layer — rules, compact classifier, larger context model for ambiguous cases |
| `therapist-insight/` | Summaries, trends, theme extraction, session prep, structured note drafting |
| `crisis-triage/` | Risk classification feeding the Safety and Crisis Service |
| `security-abuse/` | Abuse pattern, scam and malicious-link analysis |
| `subsidy-fraud/` | Subsidy eligibility fraud signals |
| `confidential-processing/` | Isolated zone: temporary decrypt, infer, re-encrypt, destroy plaintext |
| `on-device/` | Pre-send warnings in the browser. Rules only at MVP — no model ships to the client |
| `model-store/` | Quantised builds and resolved artifacts. `weights/` is git-ignored |
| `evaluation/` | Clinical safety, language bias, red-team and false-positive suites |

Which models exist, on what base, under what licence and against which evaluation gates
is declared in [`metadata/ai/model-registry/`](../metadata/ai/model-registry/) — not here
and not in code. The reasoning behind the MVP set is in
[`docs/ai/ai-requirements.md`](../docs/ai/ai-requirements.md).

## Running it

```bash
# serve — defaults to the lexicon baseline, no model download needed
uvicorn alaap_ai.orchestrator.api.main:app --port 8000

# serve the trained checkpoint instead; no code change
ALAAP_SAFETY_BACKEND=transformer \
ALAAP_SAFETY_CHECKPOINT=model-store/quantised/a1-v1 \
  uvicorn alaap_ai.orchestrator.api.main:app --port 8000
```

`GET /health` reports which categories the loaded model can actually score. A model
trained on a partial corpus leaves the rest unenforced, and that must be visible
rather than inferred from an absence of verdicts.

## Training A1

```bash
# 1. validate the corpus — refuses if block-tier categories are too thin
python -m alaap_ai.community_moderation.training.train --data <corpus> --dry-run

# 2. train. --only-ready narrows the head to what the corpus supports and
#    records the rest as uncovered in model_card.json
python -m alaap_ai.community_moderation.training.train \
    --data community-moderation/training/data/combined.v1.jsonl \
    --out model-store/quantised/a1-v1 --only-ready

# 3. derive per-category thresholds against the precision floors in config.yaml
python -m alaap_ai.community_moderation.training.calibrate \
    --predictions model-store/quantised/a1-v1/val_predictions.json \
    --labels     model-store/quantised/a1-v1/val_labels.json \
    --out ../metadata/moderation/thresholds.v1.yaml

# 4. measure. Overall accuracy is the least interesting number it prints
python evaluation/run_eval.py --verbose
```

Requires `torch` built for the local GPU. On Blackwell (sm_120) that is the cu128
index and **not** the PyPI default, which resolves to a CPU wheel:

```bash
pip install "torch==2.11.0+cu128" --index-url https://download.pytorch.org/whl/cu128
```

Install `transformers` *before* torch, or its dependency resolution will pull the
CPU build over the CUDA one.

## Rules

- The AI tier never receives real names, phone numbers, payment data, emergency
  contacts, government IDs, or unrelated community/clinical history.
- Every insight carries source range, confidence, consent scope and a
  "not a diagnosis" label.
- No model enters clinical production before passing `evaluation/clinical-safety`.
  English at MVP; Hindi and Hinglish sets are required before any non-English launch.
- Classifiers are trained on English labels but built on a multilingual base, so
  code-mixed input degrades gracefully rather than failing silently. No runtime
  translation sits in the request path.
- Third-party inference APIs are not called from any path.
- Facial emotion analysis, voice-emotion scoring, silence interpretation, dependency
  scoring and hidden psychological profiling are off by default.
