# ADR-0001 · AI layer topology

- **Status** Accepted
- **Date** 2026-09-10
- **Deciders** Founder
- **Supersedes** nothing
- **Relates to** architecture §14 (recommended AI architecture), §12D, §12J;
  [backend-requirements](../backend/backend-requirements.md) §9

---

## Context

The platform needs AI in two places, and they were being discussed as one question.

1. **Moderation and crisis detection.** Every post and reply is scored before
   publication (§12D makes publication conditional on the check). Sixteen categories,
   per-category operating points, and a verdict that must be auditable and
   recalibratable.
2. **The AI supportive response.** One generated reply per post, plus therapist
   insight later (§14.3).

Three topologies were considered for the first job:

- **A.** A small model per language — one for English, one for Hinglish, one for
  Kannada — each doing the same classification, with a language classifier routing
  between them. Downloaded to the user's device, or run server-side.
- **B.** One multilingual model, server-side.
- **C.** One multilingual model, on the user's device.

Facts that constrain the choice:

- A1 is already **MuRIL-large**, 506M parameters, pretrained on 17 Indian languages
  *and their transliterated forms*.
- Of 16 categories, 6 are calibrated and 5 enforced. The failures are **data**
  failures, not language or capacity failures: `self_harm_encouragement` has 134
  training examples.
- Where a failure *is* language-shaped — `passive_aggressive_abuse` at 0.78 recall in
  English and 0.39 in Hinglish — the cause is corpus **register** mismatch (TRAC-2
  social-media argument against support-community text), not model capacity.
- The surface is short posts and replies, heavily code-mixed.
- The target audience includes students on low-end Android devices.

---

## Decision

**Two tiers, not one, and the tiers use different models.**

### Tier 1 — enforcement: one multilingual encoder, server-side (option B)

MuRIL-large stays. It runs behind the AI orchestrator, on the GPU, and its verdict is
the one that gates publication.

### Tier 2 — advisory: deterministic checks on the device, and no neural model yet

§14.1's pre-send warnings ship as the **existing PII detector**
(`ai-services/shared/src/redaction/pii.py`) ported to the client: phone, email,
Aadhaar with its Verhoeff checksum, UPI VPA, URL. Regex, a few kilobytes, no model.

An on-device *neural* tier is deferred to the native app, where model caching is a
solved problem.

### Language differences are handled by thresholds, not by separate models

The mechanism already exists in `app/config/policy.py`: `_LANGUAGE_SCOPE` enforces a
category only in the languages where it measures acceptably, and demotes it to human
review elsewhere. `passive_aggressive_abuse` is already scoped to English on exactly
this basis.

### Generative work uses a different model family

The AI supportive response and therapist insight are autoregressive, and MuRIL cannot
do them. A Gemma-class or Qwen-class open-weight model, served by Ollama in
development and vLLM under load, quantised to fit alongside A1 on one GPU.

---

## Why option A was rejected

It is the most expensive way to be wrong, so the reasoning is recorded in full.

**Code-mixing has no target to route to.** Hinglish is not a language a classifier
selects; it is English and Hindi interleaved within a sentence and sometimes within a
word. *"mujhe bohot anxiety ho rahi hai yaar"* has no single label. Handling mixtures
per-model is combinatorial — Hinglish, Tanglish, Manglish, Benglish — and each mixture
needs its own corpus.

**The router becomes a safety single point of failure.** Language identification on a
fifteen-word post is unreliable, and that is precisely this platform's length
distribution. A misroute yields a confident verdict from the wrong model, which is
worse than no verdict because it looks like one.

**It makes the data problem worse.** 134 self-harm examples split eight ways is
seventeen each. Multilingual pretraining exists so that Hindi examples improve
Hinglish inference and English improves everything; per-language models discard that
transfer at exactly the moment the corpus cannot afford it.

**It multiplies work that has not been done once.** Sixteen categories across eight
languages is 128 operating points and 128 probe sets. There are currently zero probe
sets. Every retrain, evaluation and model card multiplies by the same factor.

The only condition under which A wins is abundant per-language data. That is the
opposite of the present situation.

---

## Why option C was rejected for enforcement

**A client-side verdict cannot be trusted.** The client is adversarial by
construction: anyone wishing to publish harmful content patches the model, the
threshold, or the response. §12D requires moderation *before* publication, and a check
the publisher controls is not a check.

Three further reasons, any one of which would be sufficient:

- **It cannot be fixed quickly.** A bad threshold or a newly discovered evasion is a
  server-side change taking minutes. On-device it requires every user to update.
- **It is not auditable.** A server verdict writes to the audit vault with a model
  version. A device verdict is an assertion.
- **It does not fit the devices.** MuRIL-large at 4-bit is roughly 250 MB. The student
  cohort this platform is built for runs low-end Android phones, and the first release
  is a website that reloads its JavaScript on every visit (§12T).

---

## Consequences

**Accepted:**

- Post content reaches the server before publication. This is not a new concession —
  §12D already states the community vault is not end-to-end encrypted *because*
  moderation must run, and says so to users rather than hiding it.
- A round trip before a post appears. Acceptable: this is a composer, not a chat.
- GPU cost scales with moderated volume. On present arithmetic one RTX 5070 Ti covers
  roughly a million users before a dedicated inference tier is needed.

**Gained:**

- Cross-lingual transfer, which is the only affordable route out of the current data
  position.
- One calibration set, one probe set per category, one model card, one retrain.
- Instant safety updates.
- A model that can be deployed into a State Data Centre, which is what makes a
  sovereign government deployment possible at all. An on-device design offers nothing
  there.

**Costs and risks:**

- Per-language operating points mean deliberately applying a different bar by
  language. That is defensible **only while it equalises outcomes**, and
  `policy.py` already says so: revisit every scoped category whenever the language
  bias evaluation passes for it, because at that point the scope protects nobody.
- Adding a language is a fine-tune, not a new model — cheap for Indic. A new region
  (Southeast Asia) needs a different multilingual base, so one model per *region
  family*. Still not one per language.
- The generative tier introduces a second model family, a second licence to review,
  and its own output guardrails: the AI response must not diagnose, prescribe, or
  claim certainty about suicide risk (§7.4), and A1 must moderate the AI's own output
  as well as the users'.

---

## Open items this decision does not settle

- **Generative model licence.** The AI tier operates a permissive-licence-only policy
  — the reason OpenBao was chosen over Vault. **Gemma is not Apache-2.0**: it carries a
  custom Google licence with a prohibited-use policy that must be passed downstream.
  It permits commercial use, but that is not the same as permissive, and whether its
  prohibited-use terms touch health advice needs counsel. Qwen 2.5 (Apache-2.0) should
  be evaluated as the licence-clean alternative before M6 commits.
- **Where the on-device PII detector lives.** Porting the Python regex to TypeScript
  duplicates a security-relevant rule in two languages. Either generate both from one
  source, or accept the duplication with a shared test corpus. Decide before shipping
  the client-side check.
- **Nothing here fixes the corpus.** This ADR chooses a topology. The 134-example
  self-harm category remains the highest-value item on the roadmap, and no arrangement
  of models substitutes for building that data.
