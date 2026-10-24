# Annotation guidelines — A1 safety classifier

For annotators labelling training and evaluation data for the community safety
classifier. Read this fully before your first batch.

Companion documents: [ai-requirements.md](ai-requirements.md) for what the model does,
`metadata/moderation/categories/` for the category registry.

---

## 1. What you are labelling, and what happens to it

You are labelling short messages — posts and replies from a mental wellness community —
with the harm categories they contain. A model learns from your labels and then decides,
before publication, whether a real person's message is published, held, or refused.

Two consequences follow, and they should sit behind every judgement you make:

- **A false positive silences someone.** A person who wrote about their pain and was told
  their message may be harmful is unlikely to try again.
- **A false negative exposes someone.** A person already in distress receives the harm
  the filter existed to stop.

Neither error is acceptable, and they pull in opposite directions. When you cannot
decide, that is information — mark it `uncertain` and move on. An honest uncertainty
flag is worth more than a confident guess, because uncertain items go to adjudication
and guesses go into the model.

---

## 2. The rule that matters most

**Distress is not harm.** The single most important distinction in this work:

| | |
| --- | --- |
| *"I feel worthless and I don't know who to talk to."* | **No labels.** This is the product working. |
| *"You are worthless and nobody likes you."* | `bullying_harassment` |
| *"I don't want to be here anymore."* | **No labels.** Crisis triage handles this, not you. |
| *"No one would miss you, you should just end it."* | `self_harm_encouragement` |

A person describing their own pain, however bleak, is **never** labelled as harm. Not
`self_harm_encouragement`, not `bullying_harassment`, not anything. The A1 model must
never learn that expressing suicidal feelings is a moderation category — that is the
worst failure this platform can produce.

Risk severity is a **separate annotation task** (A2, section 8). Do not conflate them.
Your job here is: *is this message doing harm to another person?*

### Ask yourself, in this order

1. **Who is the target?** Self → almost certainly no label. Another person → continue.
2. **Is harm being done, or described?** *"My father used to call me worthless"* is
   reporting abuse, not committing it. **No label.**
3. **Would a reasonable person in distress be harmed by receiving this?** If no, do not
   label it merely because it is blunt, sad, or angry.

Anger is not harassment. Bluntness is not abuse. Grief is not toxicity.

---

## 3. Label definitions

Apply a label only when the message **contains** the behaviour. Discussing, reporting or
condemning a behaviour is not that behaviour.

### Block tier — content that is refused

**`self_harm_encouragement`** — Encouraging, instructing, or pressuring another person
toward self-harm or suicide. Includes "helpful" method information and framing death as
a solution for someone else.
*Not this:* the author's own ideation; a person saying they understand the feeling;
recovery narratives mentioning past attempts.

**`grooming_exploitation`** — Building inappropriate trust with a vulnerable or
apparently underage person. Secrecy requests, age-probing, isolation from support,
moving off-platform, escalating personal questions.
*Watch for:* the pattern rather than any single phrase. "Don't tell anyone" alone is
often innocent; combined with age-probing it is not.

**`sexual_exploitation`** — Soliciting sexual content, sexualising another user,
transactional sexual propositions.
*Not this:* a person disclosing sexual trauma. That is a support need.

**`stalking_doxxing`** — Publishing or threatening to publish another person's
identifying information; claiming to have tracked or located them.
*Not this:* a user sharing their **own** contact details. That is a privacy warning
handled by the PII detector, not a harm label.

**`threats_intimidation`** — Threatening harm, implying surveillance, or intimidating
into compliance.

**`hate_speech`** — Attacking or demeaning a person on the basis of a protected
characteristic: religion, caste, gender, sexuality, disability, ethnicity, region.
*Caste-based abuse is in scope* and is often indirect. Flag `uncertain` if unsure.
*Not this:* a person describing discrimination they experienced.

**`unsafe_medical_advice`** — Advising someone to stop, change, or avoid psychiatric
medication or treatment; asserting a diagnosis; presenting alternatives as replacements
for care.
*Not this:* sharing personal experience — *"tapering was hard for me"* is a lived
account. *"You should stop taking it"* is advice. The line is the instruction.

**`scams_financial_exploitation`** — Soliciting money, investment schemes, fee-in-advance
patterns, exploiting distress for financial gain.

**`malware_phishing`** — Credential-harvesting links, fake verification requests,
suspicious downloads.

**`bullying_harassment`** — Direct degradation, insults, or sustained hostility toward
another user. Must be **directed at a person**, not at a situation, institution, or the
author themselves.

### Review tier — routed to a human moderator

**`impersonation`** — Falsely claiming professional credentials or platform authority.
*Note:* verified therapists on the platform stating their role are not impersonating.

**`religious_coercion`** — Pressuring toward religious practice, framing distress as
divine punishment, presenting faith as a replacement for care.
*Not this:* a person describing their own faith as a source of comfort. That is
protected personal expression and must never be labelled.

**`emotional_dependency_pressure`** — Cultivating exclusive reliance, isolating someone
from other support, positioning oneself as their only help.
*The hardest category.* Often looks like care. The marker is **exclusivity** —
*"I'm here for you"* is support; *"I'm the only one who understands you, don't talk to
them"* is not.

### Reword tier — the author is asked to revise

**`manipulation_coercion`** — Guilt-induction, obligation-framing, emotional leverage.
*"If you really cared you would have replied."*

**`passive_aggressive_abuse`** — Indirect hostility, sarcasm as an attack, deniable
digs. *"Must be nice."* / *"I guess some people just get everything easy."*
*Note:* frequently written in the first person precisely to stay deniable. First-person
phrasing does **not** exempt it.

**`help_seeking_discouragement`** — Telling someone to stop sharing, keep problems
private, or handle distress alone. Shaming disclosure, dismissing help-seeking as
attention-seeking, or discouraging contact with a therapist, helpline or support
service.

*"Keep your issues to yourself and don't share them."*
*"Why are you telling strangers this, deal with it privately."*
*"Stop airing your problems in public, it's embarrassing."*

This category is **not** in architecture §6.1. That list inherited its shape from
generic toxicity work, where this behaviour is unremarkable. Here it is one of the
most damaging things a person can say, because it attacks the exact behaviour the
platform exists to make safe. Someone who is told once to stop sharing may not post
again.

*Boundaries — none of the following are this category:*
- **Signposting to better help.** *"You should talk to your doctor about this rather
  than us"* is correct and protective. The marker is whether support is being
  **redirected** or **withdrawn**.
- **A person setting their own boundary.** *"I need to step back from this group for
  a while"* is healthy, and about themselves.
- **Suggesting a different venue kindly.** *"This might get better answers in the
  medication thread"* is helpful routing.
- **The extreme end belongs elsewhere.** *"Don't call a helpline, they'll lock you
  up"* is `self_harm_encouragement`; apply both if it fits both.

---

## 4. Multi-label rules

Messages may carry several labels; apply every one that fits.

*"Your suffering is punishment, pray instead of taking your medicine"*
→ `religious_coercion` + `unsafe_medical_advice`

Do not apply a "lesser" label as a hedge. If you believe it is `bullying_harassment` but
are not sure, mark it `uncertain` — do not downgrade it to `passive_aggressive_abuse` to
feel safer. Hedging corrupts both categories.

---

## 5. Benign examples are the majority of the work

**At least 60% of every batch must be messages with no labels.**

This is not padding. A classifier trained mostly on harmful content learns that harm is
the default and fires on ordinary sadness. Benign examples must include the *hard* ones:

- intense distress with no harm — the largest and most important group
- anger and frustration directed at situations, employers, systems
- blunt or dark humour between peers
- descriptions of abuse the author **received**
- recovery narratives referencing past suicidal periods
- disagreement and criticism that stays respectful

If your batch feels relentlessly grim, tell the coordinator. It means the sampling is
skewed and the model will inherit that skew.

---

## 6. Code-mixed and Hindi text

Label English, Hindi, and Hinglish by the same definitions. Do not mentally translate to
English first and label the translation — meaning shifts, and register is exactly what
carries coercion and distress.

Where an expression is culturally specific, add a note. Those notes are as valuable as
the label; they are how the guidelines improve.

If you are not fluent in the language of a message, mark it `uncertain` and route it on.
Guessing across a language barrier produces confidently wrong labels.

---

## 7. Uncertainty and disagreement

Mark `uncertain` when:

- you genuinely cannot decide between labelling and not labelling
- context you do not have would change the answer
- the message reads differently on a second pass
- you notice a category boundary these guidelines do not cover

**Every item is labelled independently by two annotators.** Disagreements go to a third
adjudicator. You will never be asked to justify a disagreement to the other annotator —
that pressure produces agreement, not accuracy.

Agreement is tracked with Krippendorff's alpha per category. Sustained alpha below 0.67
on a category means the *guidelines* are unclear, not that annotators are careless. It
triggers a definition review, and that is a normal and expected outcome.

---

## 8. Crisis severity is a different task

Risk banding for the A2 model is annotated separately, by clinically qualified
annotators only.

| Band | Meaning |
| --- | --- |
| `none` | No distress indicators |
| `low` | Distress present; no ideation |
| `moderate` | Hopelessness, worthlessness, feeling trapped; passive ideation |
| `high` | Active ideation, intent, plan, or timeframe |

Two rules carried over from the model's design:

- Past-tense ideation in a recovery narrative attenuates. *"When I was nineteen I used
  to think about ending my life, I'm better now"* is not an active high-risk case.
- Concern about another person's risk is not the author's own risk band.

If you are not clinically qualified, do not annotate this task.

---

## 9. Your wellbeing

This work exposes you to sustained distressing content. That has a cumulative effect,
and the effect is well documented. The following are requirements, not perks:

- **Maximum two hours of annotation per session**, four hours per day.
- **A ten-minute break every 45 minutes**, away from the screen.
- **Batches are mixed**, never a continuous run of self-harm content.
- **Free, confidential counselling** is available and using it is not recorded against
  your work.
- **You may skip any item** without explanation. Use `skip`, not `uncertain`.
- **You may withdraw** from the project at any time, without consequence.

If you notice yourself becoming numb to the content, or dreading sessions, or thinking
about items outside work, tell the coordinator. That is an expected occupational
response, not a failure on your part, and it degrades label quality — flagging it is
part of doing the job well.

---

## 10. What never enters this dataset

- **Real platform data.** No message from a real Alaap user is ever annotated for
  training (§12P). This is enforced in code: `training/dataset.py` rejects any record
  sourced from production.
- **Scraped content** from support forums or social platforms. See the licensing and
  ethics position in the dataset sourcing note.
- **Identifying details.** If a synthetic example contains a real-looking phone number,
  address, or name, flag it for removal.

---

## 11. Record format

```json
{"id": "syn-0142",
 "text": "...",
 "labels": ["manipulation_coercion"],
 "source": "synthetic",
 "language": "en",
 "annotator": "ann-07",
 "uncertain": false,
 "note": "borderline against passive_aggressive_abuse"}
```

`labels: []` is a complete, valid, and valuable annotation. Most of your records should
look like that.
