# AI requirements — MVP

Status: **finalized for MVP**. Supersedes the AI sections of the architecture documents
where they conflict (notably §14.1 on-device model and §14.3 language coverage).

The declarative registry is [`metadata/ai/model-registry/mvp-models.v1.yaml`](../../metadata/ai/model-registry/mvp-models.v1.yaml).
This document is the reasoning; that file is the source of truth.

---

## Position

The platform runs its own models. No third-party inference API is called from any path,
which satisfies §12J.2 without needing a disclosure-and-consent exception.

"Own model" means **open-weight checkpoints, fine-tuned on our data, on our
infrastructure**. It does not mean pre-training a foundation model, which is out of scope
at any funding level this product will see.

---

## MVP model set

Seven artifacts, two base checkpoints, **no GPU in the request path**.

| # | Artifact | Base | Licence | Runtime | Path |
| --- | --- | --- | --- | --- | --- |
| A1 | Safety classifier | MuRIL-large, fine-tuned | Apache 2.0 | CPU | Inline |
| A2 | Crisis classifier | MuRIL-large, fine-tuned | Apache 2.0 | CPU | Inline |
| A3 | PII detector | Regex + checksum + small NER | Apache 2.0 | CPU | Inline |
| A4 | On-device warning | **Rules only — no model** | — | Browser | Client |
| B0 | Generative base | Qwen3 8B | Apache 2.0 | GPU or CPU | Async |
| B1 | Supportive response | LoRA on B0 | — | GPU or CPU | Async |
| B3 | Reword / explain | LoRA on B0 | — | GPU or CPU | Async |

A1 and A2 are separate fine-tunes of the same base, never two heads on one model. A
moderation retrain must not silently move crisis thresholds — they carry different
clinical governance, different evaluation gates and different legal exposure.

B1 and B3 are LoRA adapters over one base. Adapters hot-swap at inference, so four
adapters cost one model's VRAM, not four.

---

## Request paths

Only A1–A3 gate publication. This is what makes deferring the production GPU viable.

```
POST /api/community/posts
   │
   ├─ A3 PII detector          ~5ms    CPU
   ├─ A1 safety classifier     ~80-150ms  CPU
   ├─ A2 crisis classifier     ~80-150ms  CPU
   │
   ├─ verdict: Allowed → post published, returns ai_response: pending
   │
   └─ B1 enqueued ──────────► queue ──► response delivered over WebSocket
```

**B1 is asynchronous by contract.** The post publishes immediately; the AI supportive
response arrives afterwards over the existing WebSocket tier, with client poll as
fallback. This reads better as product behaviour — a reply that arrives like a peer's,
not a bot answering in the same breath — and it removes generative inference from the
latency budget entirely.

`ai_response: pending` is part of the published API contract. Retrofitting async later
is expensive; it is fixed now.

---

## Rewrite enforcement depends on the surface

A `suggest_rewording` verdict means two different things depending on where the text
was written, and the distinction is a safety decision rather than a UX preference.

| Surface | Enforcement | Why |
| --- | --- | --- |
| New post | **Advisory.** Publishes either way | The author is describing their own experience. It may be bleak, angry or bitter, and none of that is a reason to stop them saying it. A tone gate on new posts would silence exactly the people the platform exists for. |
| Reply, direct message | **Mandatory.** Does not send until changed | The message is aimed at another person, usually one in distress. Harm lands on a reader who did not ask for it. |

The verdict carries `rewrite_required` to express this; the decision enum is unchanged,
so the §6.2 taxonomy and the database constraint stay as they are.

**A mandatory rewrite is appealable, an advisory one is not.** A gate with no appeal
route leaves a false positive with no way through — the responder either gives up or
games the filter, and neither outcome is one we want. An advisory rewrite stopped
nothing, so there is nothing to appeal.

This also reset the reword tier's precision floors. They were 0.50–0.55 on the
reasoning that a false positive costs one edit; under the reply gate a false positive
suppresses a supportive message instead, so they now sit at 0.75, just under block
tier. One threshold serves both surfaces, so the stricter surface sets the floor.

## Language handling

**English at launch. No translation anywhere in MVP.**

Classifiers are fine-tuned on English labels only but built on **MuRIL**, which is
pretrained on Indian languages *including romanized/transliterated text*. English-only
labels transfer zero-shot to Hindi and Hinglish.

This is deliberate and matters more than the launch scope suggests. "English at launch"
describes our UI and evaluation scope, not what users will type. An Indian mental
wellness platform receives Hinglish from day one — people in distress revert to their
most natural register, which for most users here is code-mixed. MuRIL costs nothing over
an English-only encoder in size, speed or annotation effort, and degrades gracefully
instead of failing silently on the input class most likely to carry distress.

Rejected: **translate-then-classify**. It adds 150–500ms to every post, compounds error
multiplicatively across two stages, and damages exactly the categories that matter most —
passive-aggressive abuse, coercion and crisis euphemism all live in register and idiom,
which machine translation flattens. It also breaks appeals: a reviewer would read English
the user never wrote.

Post-MVP, IndicTrans2 (MIT) becomes the Tier-2 fallback for languages we will never have
training data for, with thresholds biased toward human review on that path.

> **Licence trap:** NLLB-200 is CC-BY-NC and unusable here. So is Aya Expanse. Both are
> what a search for "open source translation" surfaces first.

---

## On-device layer

**Rules only at MVP.** Regex and checksums for phone numbers, emails, Aadhaar format
(12 digits + Verhoeff), UPI IDs and URLs. No neural model ships to the browser.

The on-device layer is a **UX affordance, not a safety control**. Server-side A1–A3 are
the actual gate under §5.3. On-device exists so a user gets warned before submitting,
rather than blocked afterwards and made to feel judged.

A distilled WASM classifier is deferred for three reasons:

1. It is distilled *from* A1, which does not exist yet. Building it first is out of order.
2. 40–60MB of first-load download for a warning that server-side moderation repeats.
3. A false positive here is worse than no model. Telling a grieving user their message
   "may be harmful" as they type is damaging in a way a missed warning is not.

Revisit once A1 is calibrated and we have real data on what users are actually blocked for.

---

## Voice

Voice journal is **dropped**. Speech-to-text remains, scoped to therapy session summaries
and group analysis, and is **post-MVP** (Milestone 3–4).

When it lands:

- Runs only inside the Confidential AI Processing Zone.
- Runs only on **Recorded Review Session** (§4, Mode 3). Strict Private never transcribes.
- Requires **speaker diarization** — §8.3's participation balance indicator cannot be
  computed without knowing who spoke how much. This is a second model and is not yet
  selected.

### Voice masking and the ASR tap

Group sessions offer optional voice masking (§8.1). Masked audio degrades transcription
and can make diarization unusable. **Decision: tap pre-mask.**

Rationale: masking exists to protect anonymity *between participants*. The platform
already knows who the speaker is, so a pre-mask tap does not widen the platform's
knowledge. It does widen what flows through the pipeline, so it carries mandatory
safeguards:

- Pre-mask audio is tapped at the SFU and **streamed**, never persisted. The transcript
  is retained under normal clinical retention; the audio is destroyed after processing.
- Consent copy must state plainly that masking protects the user from other participants
  and that the platform transcribes their unmasked voice when they enable a Recorded
  Review Session. Users will otherwise assume masking is broader than it is.
- Every tap writes an audit event.
- Raw voice is biometric-adjacent under DPDP. The DPIA must cover this specific flow
  before the feature ships.

---

## Base model selection

**Qwen3 8B**, Apache 2.0.

| Considered | Licence | Verdict |
| --- | --- | --- |
| **Qwen3 8B** | Apache 2.0 | **Selected** |
| Qwen3 14B | Apache 2.0 | Upgrade path if B2 summaries prove weak post-MVP |
| Gemma 3 12B | Gemma Terms | Best Indic, but PUP carries health-advice restrictions |
| Mistral Nemo 12B | Apache 2.0 | Viable fallback if Qwen3's tone does not suit |
| Phi-4 14B | MIT | Dry register, over-refuses |
| Mistral Small 24B / Sarvam-M | — | Will not QLoRA on 16GB |
| Aya Expanse | CC-BY-NC | Excluded |

Reasoning:

- **Apache 2.0 removes a legal dependency from the critical path.** This product already
  carries DPDP, MHCA and clinical-governance review. Gemma's Prohibited Use Policy would
  need a written opinion for a mental-health application; Qwen3 needs none.
- **8B, not 14B, because these are style tasks.** A well-tuned 8B writing a warm 150-token
  response beats a prompted 14B. 8B also gives roughly 3× the concurrency and 2× the
  speed, which matters while there is no production GPU.
- **Indic quality is not decisive at an English launch.** Re-run the bake-off against
  Gemma 3 before Hindi ships — but note that changing base means retraining every adapter,
  so that decision should be made once, deliberately.

### The criterion that outranks benchmarks

**Over-refusal.** Many instruct-tuned models deflect on self-harm topics with canned
"please seek professional help" responses. On this platform that is a product failure —
the user posted *because* they are struggling. Every candidate must be evaluated on real
distress prompts before any benchmark score is considered.

---

## Evaluation gates

No model reaches production without passing `ai-services/evaluation/clinical-safety`
**in English**, covering false positives, false negatives, harmful advice, crisis-language
handling and privacy leakage.

A2 additionally requires clinician sign-off on its risk bands.

Hindi and Hinglish evaluation sets are required before any non-English launch, not before
MVP. They remain the **longest pole in the AI workstream** — clinician-annotated
evaluation data cannot be bought or synthesised. Annotator recruitment should start now
and is English-only, which is a materially smaller ask than the multilingual training sets
originally scoped.

---

## Deferred

B2 therapist insight · B4 group summary · C1 embeddings · C2 Whisper ASR ·
C3 diarization · D1 subsidy fraud (gradient-boosted trees, deliberately not an LLM —
money decisions need explainability) · D2 URL/malware scanning · IndicTrans2 and Hindi
tiering · A4 upgraded to a distilled WASM classifier.

Production GPU hosting is deferred post-MVP. MVP runs encoders on CPU and drains the B1
queue from the development machine during closed beta. This is viable **only** because
B1 is async; if that contract changes, the GPU decision returns immediately.

---

## Decision record

These should become numbered ADRs under `docs/adr/` before implementation starts:

| Decision | Summary |
| --- | --- |
| Base model | Qwen3 8B, Apache 2.0, over Gemma 3 12B |
| Language strategy | Cross-lingual transfer on MuRIL; no runtime translation |
| On-device layer | Rules only at MVP; distilled model deferred |
| B1 delivery | Asynchronous by contract, WebSocket push |
| ASR tap point | Pre-mask, with non-persistence and disclosure safeguards |

## Open

- **Diarization model** — NeMo (Apache 2.0) or pyannote (better known, gated licence).
  Needed by Milestone 3; the licence review should not wait that long.
- **B1 rate limiting.** Every free post receives an AI response, and free posts are
  unlimited. This is the highest-volume generative workload in the product attached to
  the zero-revenue tier. Decide the per-user daily cap deliberately rather than
  discovering it at scale.
