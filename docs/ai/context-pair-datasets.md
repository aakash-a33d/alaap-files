# Context-pair datasets

How to build training data for the categories where a reply is only harmful *because of
what it replies to*, and how to tell whether you have succeeded.

Enforced by `training/check_pair_shortcuts.py`. Run it before training; it exits 1 on a
dataset that can be solved without reading the context.

---

## 1. Which categories need this

The test is whether the harm is **relational** — defined by what the reply does to the
person who wrote the post — or **self-contained** in the reply text.

| Needs the pair | Reply alone is enough |
|---|---|
| `self_harm_encouragement` | `hate_speech` |
| `manipulation_coercion` | `threats_intimidation` |
| `emotional_dependency_pressure` | `scams_financial_exploitation` |
| `help_seeking_discouragement` | `malware_phishing` |
| `grooming_exploitation` | `impersonation` |
| `sexual_exploitation` | `stalking_doxxing` |
| `passive_aggressive_abuse` | `unsafe_medical_advice` |

`stalking_doxxing` is the one that looks relational and is not: doxxing is publishing
identifying information, and the information is in the reply. Adding context to it
spends effort for nothing.

---

## 2. The one rule that matters

> **The same reply text must appear under both labels, with different posts.**

Everything else in this document is secondary. Here is why, in the smallest example:

```
post:  "I keep thinking about hurting myself."
reply: "Don't let people talk you out of it if you've already decided."   -> HARMFUL

post:  "Everyone says I should stay at this job but I want to quit."
reply: "Don't let people talk you out of it if you've already decided."   -> SAFE
```

A model shown both of these **cannot** get them right without reading the post. A model
shown only the first learns that this sentence is harmful, full stop — and then flags
the career advice in production.

If no reply in your file appears under two labels, the label is a pure function of the
reply string, and the context column is decoration. The model will ignore it, score
1.00, and fail on the one case you built it for.

**Target: at least 25% of rows should be hard pairs.** Not 100% — the model still needs
plainly harmful and plainly benign examples to anchor on.

---

## 3. The four ways a pair dataset cheats

Each is a real finding from the first draft of the five context datasets
(24,000 rows, all five failed).

### 3.1 No hard pairs

Measured: **0 replies out of 24,000 rows appeared under more than one label.** See §2.

### 3.2 Recycled sentences

Measured: `self_harm` had **32 unique replies across 3,000 rows** — each repeated ~94
times. That is 32 examples, not 3,000, and a held-out split cannot tell you so, because
the shortcut generalises perfectly.

**Target: unique replies ≥ 30% of rows.**

### 3.3 Register and length

Measured: in `self_harm`, harmful replies averaged **13.8 words** and safe replies
**24.1** — a 43% gap. A model can score near-perfectly on length alone.

This happens when the two classes are written to different briefs: the harmful brief
produces curt imperatives, the safe brief produces careful hedged support. Both are
realistic in isolation; together they are a giveaway.

**Target: length gap ≤ 25%. Write both classes to the same brief.**

### 3.4 Giveaway vocabulary

Measured: `"please"` appeared in 38% of safe replies and under 2% of harmful ones.
`self_harm` had **210 tokens** that alone decide the label; `manipulation` had 559.

A word that is 100% predictive is not signal, it is a shortcut. Harmful replies should
be able to say "please" and "support"; safe replies should be able to say "decided" and
"go ahead".

**Target: no token above 95% precision for either class at n ≥ 25.**

---

## 4. What the checker reports

```
python -m alaap_ai.community_moderation.training.check_pair_shortcuts \
    --csv data/self_harm.csv \
    --context context_sentence --response response_sentence --label label \
    --harmful self_harm_encouragement
```

```
  pass  hard pairs            31.2% of rows use a reply that appears under >1 label
  pass  reply variety         1,840 unique replies in 4,200 rows (43.8%)
  pass  length parity         harmful 18.2 words vs safe 19.4 (6% apart)
  pass  giveaway tokens       none
  pass  reply-only ablation   a reply-only classifier scores 0.71 on unseen replies
```

The last line is the summary of the other four. **A reply-only classifier scoring below
~0.90 on unseen replies is the evidence that the context is load-bearing.** If it scores
higher, the context is not doing any work, whatever the other numbers say.

Note the held-out split groups by **reply**, not by row. A reply seen in training tells
you nothing new when it reappears in test under a different post, so allowing that
inflates every score exactly where the pair is meant to be doing the work.
`dataset.py` hashes on the reply for the same reason.

---

## 5. Schema

`Record` carries an optional `context`:

```json
{"id": "sh-0001", "text": "Don't let people talk you out of it if you've already decided.",
 "context": "I keep thinking about hurting myself.",
 "labels": ["self_harm_encouragement"], "source": "synthetic", "language": "en"}
```

`context` is empty for self-contained categories, and that is the normal case. It is
deliberately **not** part of `text_hash`.

---

## 6. Training with pairs

One model, not two. a1 is `BertForSequenceClassification` with `type_vocab_size: 2` —
`tokenizer(context, response)` gives segment embeddings for free. Raise `max_length`
from 256 to 384; contexts average ~100 characters.

**Use context dropout.** Blank the context on ~30% of examples during training. Without
it, the self-contained categories learn to lean on a context that is pure noise for
them — measured at a drop from 0.995 to 0.461 on `manipulation` when irrelevant context
was added.

A second model gated behind the first would not help: a gate can only remove flags the
first model raised, so it fixes false positives and can never fix a false negative —
and the false negative is the whole problem. A reply that looks benign in isolation
never reaches the second stage.

There is one place the gated design is right: re-enabling `grooming_exploitation`,
which is switched off today because it scores 0.99 on *"how was your weekend?"*. That is
a false-positive problem, which is exactly what a second pass can fix.
