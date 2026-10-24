# Dataset sourcing for A1 and A2

Where training data comes from, what may not be used, and why the gap is where it is.

---

## 1. Scraped mental health content is not available to us

Reddit's `r/SuicideWatch` and `r/depression`, Discord support servers, and similar
forums are the obvious source and must not be used. Four independent reasons, any one
of which is sufficient:

**Licensing.** Platform terms of service prohibit bulk collection and redistribution.
Reddit specifically restricted API access in 2023 to prevent AI training use. "It was
publicly visible" is not a licence.

**Lawful basis.** Mental health content is special-category data under GDPR Article 9
and receives equivalent treatment under the DPDP framework. Public availability is not
a lawful basis for processing it. There is no consent from the people who wrote it.

**Consistency.** Our own §12J.2 forbids using our users' therapy data for model
training without separate lawful consent. Applying a weaker standard to other
platforms' users than to our own is not defensible, internally or externally.

**Exposure.** "Mental wellness startup trained its AI on scraped suicide forum posts"
is a survivable engineering decision and an unsurvivable news story. The people in
those threads were in crisis. They were not volunteering.

This applies equally to data a vendor offers us: **ask for provenance and licence in
writing before any purchase**, and treat "publicly available" as a red flag rather than
an answer.

---

## 2. What is actually usable

Licences change; **verify each before use** rather than relying on this table.

| Dataset | Covers | Licence position |
| --- | --- | --- |
| Jigsaw Toxic Comment Classification | insult, threat, obscene, identity hate | Annotations CC0; text CC BY-SA (Wikipedia) |
| Jigsaw Unintended Bias | as above, larger, identity-annotated | Same family |
| Civil Comments | general toxicity | CC0 |
| HateXplain | hate speech with rationales | Permissive — verify |
| HASOC (FIRE) | **Hindi, English, code-mixed** hate/offensive | Registration + terms |
| TRAC aggression | **Hindi-English code-mixed** aggression | Shared-task terms |
| UCI SMS Spam Collection | scam and spam patterns | Public |
| PhishTank / OpenPhish | malicious URLs | Feed terms |

Research-only, and **not** commercially usable — do not plan around these:

- CLPsych shared task data (Reddit suicidality) — data use agreement, research only
- UMD Reddit Suicidality Dataset — restricted, ethics review required
- PAN12 sexual predator identification — research release
- DAIC-WOZ depression interviews — research licence

---

## 3. The gap, measured

The estimate in the first version of this document was wrong in two places. These are
the counts actually produced by `training/ingest.py` from the downloaded corpora,
combined with the synthetic seed set — 48,795 records, 62% benign.

| Category | Examples | Source |
| --- | --- | --- |
| `bullying_harassment` | 6,002 | Jigsaw insult, HateXplain offensive, TRAC OAG |
| `hate_speech` | 5,992 | Jigsaw identity_hate, Civil Comments identity_attack, HateXplain, TRAC GEN |
| `grooming_exploitation` | 5,865 | **PAN-12 problem 2** (line-level) |
| `threats_intimidation` | 3,910 | Jigsaw + Civil Comments threat |
| `passive_aggressive_abuse` | 2,446 | **TRAC covert aggression** |
| `scams_financial_exploitation` | 641 | UCI SMS spam |
| `unsafe_medical_advice` | 20 | synthetic only |
| `manipulation_coercion` | 17 | synthetic only |
| `emotional_dependency_pressure` | 16 | synthetic only |
| `religious_coercion` | 13 | synthetic only |
| `self_harm_encouragement` | 12 | synthetic only |
| `impersonation` | 1 | synthetic only |
| `help_seeking_discouragement` | 18 | synthetic only |
| `malware_phishing` | 0 | — |
| `sexual_exploitation` | 0 | — |
| `stalking_doxxing` | 0 | — |

Total 64,521 records, 62% benign. **Six of sixteen categories are trainable.**

`help_seeking_discouragement` is the sixteenth category, added after adversarial
testing of the live API surfaced a harm with no home in architecture §6.1 — telling
someone in a mental wellness community to stop sharing. No public corpus covers it,
and none is likely to: it is only a harm inside a support context. Synthetic
generation plus clinician authoring is the only route.

### Two corrections

**`passive_aggressive_abuse` is covered.** TRAC-2's *Covertly Aggressive* class is a
close match, and it supplies 2,444 examples. It was listed as having no usable public
data; that was wrong. Note the language split — 952 Hindi-Latin, 948 Bengali-Latin,
544 English — so the model will learn this category predominantly from code-mixed
Indic text. Good for our users, but English coverage of the category is thin and the
evaluation set should compensate.

**`malware_phishing` is not covered.** It was listed under good public coverage. UCI
SMS spam maps to financial scams rather than phishing text, and PhishTank and OpenPhish
are URL reputation feeds, not message corpora. This category needs synthetic data plus
the URL checks that run alongside the model.

**Six of sixteen categories are now genuinely trainable.** The remaining ten are the
ones specific to a mental health support context, and the preflight gate refuses to
train while four block-tier categories sit below the twenty-example floor.

---

## 3b. Two corpora where the label level is wrong

Both of these annotate **authors or users**, not messages. A1 and A2 classify single
messages. Exploding a user-level label onto every message that user wrote is not a
shortcut — it is a way to train a model on labels that are mostly false.

### PAN-12 — usable, but only half of it

| Sub-task | Label level | Verdict |
| --- | --- | --- |
| Problem 1 | author is a predator | **Unusable.** 40,978 predator-authored messages: 69% under 25 characters, only 3% containing anything grooming-related. Training on it teaches the model that `hey!!` and `sounds like fun lol` are grooming. |
| Problem 2 | specific suspicious lines | **Usable.** 6,478 message-level annotations; 5,865 survive filtering. |

`ingest.py` reads problem 2 only. Benign messages are taken solely from conversations
with no flagged line anywhere — an unflagged message inside a grooming conversation is
not safely benign, so those are dropped rather than mislabelled.

Register caveat: 2000s chat logs, short and abbreviated. Our surface is posts and
replies. Auxiliary data.

### CSSRS Reddit corpus — not used for training

500 users labelled Supportive / Indicator / Ideation / Behavior / Attempt on the
Columbia Suicide Severity Rating Scale. The label describes the **user**, and A2
classifies a **message**.

Measured on the file: of 1,815 posts by users labelled Attempt or Behavior,
**85% contain no risk language at all.** One user labelled *Attempt* writes
*"Keep your head up! Suicide is never a problem solver."* Per-post explosion would
train A2 that recovery narratives and peer support are high-risk crisis signals —
precisely the failure the A1/A2 split exists to prevent, and the same failure mode as
the open clinical question already logged in the evaluation seed set.

`training/cssrs_review_queue.py` puts it to its only defensible use: it emits **522
posts that actually contain risk language, carrying no labels**, for a clinician to
band individually. The user-level label travels as context and nothing more.

---

## 3a. Domain mismatch is the standing risk

Every ingested corpus is Wikipedia talk pages, news comments, Twitter or social media.
None is a mental health support context, and aggression in an edit war does not look
like coercion in a support thread. Two consequences:

- Use these as **auxiliary data that teaches general harm**, then fine-tune on the
  domain corpus. Do not ship a model trained on this alone.
- **The documented failure mode of Jigsaw-trained models is our worst case.** They
  over-flag text that merely *mentions* an identity, including mental illness — the
  "unintended bias" the Civil Comments release exists to study. A model that scores
  "I have depression" as toxic would be actively harmful here.

Against that last risk, `ingest.py` extracts **3,984 non-toxic comments annotated as
mentioning psychiatric or mental illness** and marks them as hard negatives. That slice
is the most valuable thing in the entire download.

> It very nearly did not survive ingestion. A reliability floor of "at least 10
> toxicity annotators" — an unremarkable default — cut those rows from 5,003 to 21,
> because Civil Comments rated its identity-annotated subset with far fewer annotators
> than the bulk corpus. A second bug then capped the scan before it reached them. Both
> are fixed and documented in the reader. The lesson generalises: **sanity-check the
> count of every slice you care about, because a plausible filter can silently delete
> exactly the data you went looking for.**

---

## 4. The realistic path: synthetic generation with clinical review

For the seven uncovered categories, and for the benign majority:

1. **Generate candidates with our own Qwen3 8B.** Apache-2.0, self-hosted, no terms
   restricting how the outputs are used.
2. **Clinicians review, edit, approve or reject.** Nothing enters the corpus unreviewed.
3. **Two annotators plus adjudication**, per the annotation guidelines.

> **Do not generate training data with Claude, GPT, or Gemini.** Their terms restrict
> using model outputs to train competing models. An Apache-2.0 model we host ourselves
> removes the question entirely — which is a second, unplanned dividend of the base
> model licence decision.

Advantages: legally clean, controllable class balance, coverage of rare categories, and
no real person's crisis post in our training set.

**The limitation, stated honestly:** synthetic text does not read like real users write.
Distribution gap is the standing risk of this approach. Two mitigations:

- **The evaluation set must be as realistic as possible**, even where training data is
  synthetic. Clinician-authored examples drawn from professional experience, and — after
  launch — consented real examples. A synthetic evaluation set measures whether the
  model learned the synthesiser, not whether it works.
- **Adversarial review.** Ask clinicians to write examples designed to defeat the
  current model, not just to illustrate categories.

---

## 5. Long-term: our own data, with explicit opt-in

The only source that will ever match how our users actually write is our users' own
messages, and there is exactly one acceptable way to obtain them.

The consent architecture already supports it. A new purpose in
`metadata/consent/purpose-registry/` — `model-improvement`, `consent: explicit`,
`withdrawable: true`, **default off** — with a plain-language explanation and no
degradation of service for declining.

Constraints that come with it:

- Community posts only at first. Clinical vault records are out of scope, and Maximum
  Privacy Mode records are structurally unavailable.
- Withdrawal removes the record from future training sets. It cannot un-train a
  released model, and the consent text must say so.
- Contributions are de-identified through the PII detector before entering any corpus.

This is a post-launch source. It cannot be planned into the first model.

---

## 6. Using an LLM to assist annotation

**As the annotator of record: no.** If a language model labels the clinical categories
and the classifier learns those labels, the clinician sign-off gate becomes ceremony —
the model inherits the labeller's biases with no clinical review, and we would have
built exactly the unaccountable system the governance requirements exist to prevent.

**As a pre-labelling assistant: yes**, and it is worth real money. The model proposes
labels with confidence; annotators review, correct and adjudicate. Typical throughput
gain is three to five times, which materially shortens the critical path.

**One caveat that must be designed around:** pre-labels bias annotators toward agreeing
with them. Automation bias is well documented and it silently inflates measured
agreement while degrading real quality. Mitigation: hold out **at least 10% of every
batch for blind annotation** with no pre-labels, and compare agreement between the two
streams. If blind and assisted labels diverge, the assistance is steering rather than
helping.

---

## 7. Recommended sequence

1. Assemble the public toxicity datasets for the five well-covered categories. Verify
   every licence in writing.
2. Write the clinical evaluation set **first**, by clinicians, for all sixteen
   categories. A few hundred adjudicated items is enough to measure with, and it is the
   gate everything else is judged against.
3. Generate synthetic training candidates for the seven uncovered categories, plus the
   benign majority. Clinician review throughout.
4. Train, calibrate, and measure against the evaluation set from step 2.
5. Post-launch, open `model-improvement` consent and begin replacing synthetic training
   data with consented real data.

Step 2 is the critical path and it is not parallelisable with the others: without it,
there is no way to tell whether steps 3 and 4 produced anything useful.
