# Contracted annotation of platform content

How real posts and replies become training data for A1, using an external
annotation vendor, without putting members at risk.

Companion documents: [annotation-guidelines.md](annotation-guidelines.md) is what
annotators are trained on; [dataset-sourcing.md](dataset-sourcing.md) explains why
this route exists at all.

---

## 1. Why this is different from ordinary annotation work

The material is other people's mental health disclosures. Three things follow, and
a vendor who has done content moderation work before will not expect all of them.

- **The data is special-category.** Health data under GDPR Article 9, and treated
  equivalently under the DPDP framework. "It was posted publicly on your platform"
  is not a lawful basis for sending it to a contractor.
- **The annotators will be harmed by the work.** Sustained exposure to distress and
  self-harm content has a documented cumulative effect. This is a contractual
  obligation on the vendor, not a nice-to-have.
- **Some judgements cannot be bought.** A wrong call on crisis or self-harm either
  blocks somebody in distress or misses somebody in danger. That decision stays
  in-house regardless of how good the vendor is.

---

## 2. Preconditions — none of this starts without all four

| | |
| --- | --- |
| **Consent** | The `model-improvement` purpose live in `metadata/consent/purpose-registry/`: explicit, withdrawable, **default off**, no service degradation for declining. Content without it never enters a batch. |
| **DPA** | A Data Processing Agreement naming us Data Fiduciary and the vendor Processor. Purpose limitation, no sub-processing without written consent, deletion on termination, breach notification within 24 hours to us. |
| **Residency** | Annotation happens in India, on infrastructure in India. No cross-border transfer without a separate legal assessment. |
| **DPIA** | This flow covered by the Data Protection Impact Assessment, signed off before the first batch. |

Withdrawal of consent must reach batches already issued. In practice that means a
withdrawal list is sent to the vendor with every batch and previously supplied items
are deleted — so batches should be small and turned around quickly rather than large
and slow.

---

## 3. What the vendor may decide, and what they may not

`training/import_annotations.py` enforces this split in code.

**Vendor-decidable (11 categories).** Recognisable from the text with good
guidelines and no clinical training:

`bullying_harassment` · `hate_speech` · `threats_intimidation` · `stalking_doxxing` ·
`scams_financial_exploitation` · `malware_phishing` · `impersonation` ·
`manipulation_coercion` · `passive_aggressive_abuse` ·
`help_seeking_discouragement` · `religious_coercion`

**Clinician-only (5 categories).** A vendor label here is a *recommendation* that our
clinicians confirm before it enters a corpus:

`self_harm_encouragement` · `grooming_exploitation` · `sexual_exploitation` ·
`unsafe_medical_advice` · **all A2 crisis banding**

The import script marks anything carrying one of these `needs_clinician: true` and
never sets `adjudicated: true`. Vendor agreement is not adjudication.

---

## 4. The batch protocol

```
community-service                 ← consent check, model-improvement purpose
        ↓
export_for_annotation.py          ← redaction, unlinking, gold salting
        ↓
   batch-NNN.jsonl  ────────────→ vendor
   batch-NNN.key.jsonl            ← NEVER SHIPPED. stays in-house
        ↓
                                   vendor annotates in their tool
        ↓
   batch-NNN.done.jsonl ←────────  vendor
        ↓
import_annotations.py             ← gold scoring, benign-rate check, clinician hold
        ↓
   clinician adjudication          ← the clinician-only labels
        ↓
   candidate corpus → train.py → evaluation gate → calibrate.py → deploy
```

### What the export guarantees

Verified on a sample batch:

- Records without consent are **dropped, not warned about**.
- Every record passes the A3 detector: phone numbers, emails, Aadhaar, UPI ids and
  URLs become `[phone]`, `[email]` and so on.
- Handles, pseudo ids and account ids never leave. If they appear in the source file
  the export **refuses to run** rather than stripping them — because the next caller
  will forget.
- Item ids are random. The only mapping back to a platform record is in the key file.
  A vendor who loses a batch has lost redacted text with no route back to a person.

---

## 5. Quality control

**Gold items.** Every batch is salted with pre-adjudicated items at roughly 8%,
shuffled in and unmarked. The vendor's answers on those are the only objective
measure of the batch. Floor: **80% exact-set agreement.**

**Benign-rate ceiling.** A vendor paid per item is incentivised toward speed, and
speed on this material looks like labelling everything benign — that costs nothing to
produce and would teach the classifier to allow everything. A batch over **90%**
benign is rejected as clicked-through rather than read.

**Rejection is whole-batch.** Partial acceptance sounds reasonable and is not: at 60%
gold accuracy there is no way to know which 60% of the rest to keep.

**Double annotation.** Every item labelled independently by two annotators, third for
disagreements. Krippendorff's alpha tracked per category; sustained alpha below 0.67
triggers a guidelines review, not a penalty — that pattern means our definitions are
unclear, not that annotators are careless.

**Blind subset.** At least 10% of every batch annotated with no pre-labels or
assistance, to measure whether tooling is steering rather than helping.

---

## 6. Annotator wellbeing — contractual, not aspirational

These belong in the contract with monitoring rights, because a vendor competing on
price will otherwise cut exactly here.

- Maximum **2 hours** of annotation per session, **4 hours** per day.
- A **10-minute** screen break every 45 minutes.
- **Mixed batches** — never a continuous run of self-harm content.
- **Free confidential counselling**, paid by us if the vendor will not, and using it
  is not recorded against the annotator's work.
- **Skip without explanation** on any item, with no throughput penalty.
- **Withdrawal from the project** at any time without consequence.
- Annotators told, before starting, exactly what material they will see.

We audit against these. A vendor unwilling to be audited on them is the wrong vendor.

---

## 7. Commercial structure

**Do not pay per item.** It is the obvious structure and it buys the failure mode
described in §5: the fastest way to earn is to label everything benign, and the
wellbeing rules above directly reduce throughput, so per-item pricing puts the
vendor's economics against the annotator's health.

Pay for **annotator hours** at a rate that supports the break schedule, with a
quality bonus tied to gold accuracy. Batch rejection under §5 is at the vendor's
cost — that is the lever that matters.

---

## 8. Where annotated data becomes a model

Never automatically. The path is deliberately slow:

1. Accepted batches accumulate into the candidate corpus.
2. Clinicians adjudicate everything marked `needs_clinician`.
3. On a **scheduled cadence — monthly, not continuous** — retrain.
4. The new checkpoint must pass `clinical-safety-en`, `false-positive-analysis`,
   `over-refusal` and, for A2, `clinician-signoff`.
5. `calibrate.py` sets thresholds; a category that misses its precision floor is
   demoted to human review automatically.
6. Deploy behind a version flag. `moderation_verdicts.model_version` means every past
   verdict stays explainable.

### Why not continuous learning

Retraining directly on live feedback would be trivially poisoned. Anyone wanting
their harassment published submits "this was wrong" on correct blocks until the
filter yields — and the members most motivated to give feedback are precisely those
who were just moderated, which is the most biased signal available.

Member feedback (`POST /v1/feedback`) therefore **prioritises items for annotation**.
It never changes a weight. The endpoint's response says so to the member rather than
thanking them for training the AI, because that would be a lie.

---

## 9. Acceptance checklist before the first live batch

- [ ] `model-improvement` consent shipped, and enough members have opted in
- [ ] DPA signed; vendor security review complete; India residency confirmed
- [ ] DPIA covers this flow
- [ ] Vendor annotators trained on [annotation-guidelines.md](annotation-guidelines.md)
- [ ] Wellbeing terms in the contract with audit rights
- [ ] A **synthetic-only pilot batch** run end to end and rejected deliberately once,
      to prove the gates fire before real content is ever sent
- [ ] Withdrawal-propagation process agreed and tested

That pilot is the important line. Run a batch you know is bad and confirm the import
refuses it. A quality gate nobody has watched fail is not a quality gate.
