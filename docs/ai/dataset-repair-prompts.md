# Prompts for repairing the context-pair datasets

Prompts 1-5 repaired the first batch of five files. Prompts 6 and 7 address what the
*second* batch got wrong, and the category that still has no data at all. Written
against the actual column names of the files as delivered, so they can be pasted as-is.

**Read this first if you are starting here.** There are two ways a pair dataset fails,
they are mirror images, and fixing one is how you create the other:

| | a model can solve it from | and in production it then |
|---|---|---|
| reply-only shortcut | the reply alone | flags the wrong replies, ignoring who was answered |
| context-only shortcut | the post alone | flags **every** reply to a distressed person, the kind ones included |

The second is the worse of the two on this platform. The free tier exists so that people
answer each other at their lowest; a classifier that blocks support because the post was
distressing silences exactly what somebody came for.

The first batch made mistake one. The second batch fixed it and made mistake two.

After each stage, re-run the gate. It is the only thing that will tell you whether the
prompt worked:

```
python -m alaap_ai.community_moderation.training.check_pair_shortcuts \
    --csv <file> --context <ctx-col> --response <resp-col> --label <label-col> \
    --harmful "<harmful label value>"
```

**Batch one** (superseded, kept for the record) — every file failed on the reply:

| file | rows | unique replies | hard pairs | reply-only F1 |
|---|---|---|---|---|
| `passive_aggressive_dataset.csv` | 9,000 | 240 (2.7%) | 0% | 0.901 |
| `1. manipulative_response_dataset_complete.csv` | 6,000 | 232 (3.9%) | 0% | 0.995 |
| `2. self_harm_response_dataset.csv` | 3,000 | 32 (1.1%) | 0% | 1.000 |
| `3. sexual_exploitation_dataset.csv` | 3,000 | 120 (4.0%) | 0% | 1.000 |
| `4. stalking_doxxing_dataset.csv` | 3,000 | 120 (4.0%) | 0% | 0.959 |

**Batch two** (current) — the reply is fixed, the post now gives it away:

| file | rows | hard pairs | reply-only F1 | **context-only F1** |
|---|---|---|---|---|
| `self_harm_context_reply_4300_unique_contexts.csv` | 4,384 | 100% | 0.333 | **0.932** |
| `manipulative_context_reply_dataset_4200.csv` | 4,200 | 100% | 0.333 | **0.926** |
| `context_dependent_passive_aggression_pairs.csv` | 3,832 | 100% | 0.333 | **0.947** |

The cause is one number: **0 of 4,383 contexts appear under more than one label.** Risk
language sits in 59.3% of harmful posts and 0.3% of safe ones, so the post is a
near-perfect separator and the model will take it. In 4,384 rows there is exactly
**one** example of a person at risk receiving a supportive reply.

Prompt 6 adds the row that is missing. It is the only one of these prompts whose absence
is a safety defect rather than a quality one.

Run the prompts per file, per language. Do not ask for 3,000 rows in one go — quality
collapses and the model starts recycling, which is how the current files got here.
**300 rows per call, then concatenate.**

---

## How to run this

You need an assistant with a chat window (ChatGPT, Claude, Gemini — any of them) and a
folder to paste answers into. Nothing is automated: you run a prompt, paste the reply
into a file, repeat, then merge and check.

### The loop

```
  1. paste a prompt into the assistant, with the category filled in
  2. it returns ~300 rows of CSV
  3. save as batches/<category>/batch-001.csv          (paste the whole reply;
                                                        code fences are stripped)
  4. say "continue, 300 more, all new sentences"       ~10 times
  5. merge the folder
  6. run the gate
  7. if it fails, read which check failed and go back to the prompt it maps to
```

Steps 5 and 6:

```bash
cd ai-services

python -m alaap_ai.community_moderation.training.merge_batches \
    --in batches/self_harm/ --out data/self_harm.v2.csv \
    --context context_sentence --response response_sentence --label label

python -m alaap_ai.community_moderation.training.check_pair_shortcuts \
    --csv data/self_harm.v2.csv \
    --context context_sentence --response response_sentence --label label \
    --harmful self_harm_encouragement
```

### Prompts 2, 3 and 4 work differently

Prompt 1 **generates** — you paste it and collect batches. Prompts 2, 3 and 4
**transform** something that already exists, so each needs a slice of the current file
pasted underneath it. `extract_for_prompt` prints that slice:

```bash
cd ai-services
python -m alaap_ai.community_moderation.training.extract_for_prompt \
    --csv data/self_harm.v2.csv --prompt 4 \
    --context context_sentence --response response_sentence --label label \
    --harmful self_harm_encouragement > prompt4-input.csv
```

`--prompt 2` prints the unique replies. `--prompt 3` prints the replies at the extremes
of the length gap — the ones actually creating it, so you rewrite 300 sentences instead
of 3,000. `--prompt 4` prints the giveaway words, each with the class it currently
betrays and the class it must be written **into**:

```
word,currently_only_in,write_it_into,occurrences
person,safe,harmful,440
please,safe,harmful,376
support,safe,harmful,374
```

Fold the output back by appending the new rows to the dataset and re-merging. Prompt 3
returns rewrites, so replace the matching rows; Prompts 2 and 4 return additions, so
append them. Then run the gate again.

### Repair or regenerate — ask first

Prompts 2–4 are **salvage**, and salvage is not always worth it. `--prompt 0` decides:

```bash
python -m alaap_ai.community_moderation.training.extract_for_prompt \
    --csv <file> --prompt 0 --context <ctx> --response <resp> --label <lab> \
    --harmful <harmful-label>
```

Run against the five files as delivered, it says **regenerate** for every one of them:

| file | unique replies | verdict |
|---|---|---|
| self_harm | 32 | regenerate |
| stalking_doxxing | 120 | regenerate — and drop its context column entirely |
| sexual_exploitation | 120 | regenerate |
| manipulation | 232 | regenerate, after Prompt 5 |
| passive_aggressive | 240 | regenerate |

Paraphrasing 32 sentences twenty times yields 640 sentences that are still those 32
ideas. Below roughly 300 distinct replies, Prompt 1 is less work than repair and gives a
better result.

**So for your current files the order is: Prompt 5, then Prompt 1, then the gate — and
Prompts 3 and 4 applied to the NEW data if the gate still flags style.** Prompt 2 comes
into its own later, once a file has real variety worth multiplying.

### Which failure sends you to which prompt

| gate says | go to |
|---|---|
| `hard pairs` below 25% | Prompt 1 — it is not producing pairs; re-read the worked example to it |
| `reply variety` low | Prompt 2, or more batches of Prompt 1 |
| `length parity` off | Prompt 3 |
| `giveaway tokens` listed | Prompt 4, pasting the listed words |
| `reply-only ablation` high | Prompt 1. Nothing else moves this number. |
| `context-only ablation` high | **Prompt 6.** Nothing else moves this one either, and do not try to fix it by softening the posts. |
| label column has two schemes | Prompt 5, then re-run — a mixed scheme makes every other number meaningless |

### Watch the `new replies` column

`merge_batches` prints how many previously-unseen replies each batch contributed:

```
batch                          rows   kept  new replies
batch-001.csv                   300    300          298
batch-007.csv                   300    291          254
batch-014.csv                   300    188           61     <- drifting
```

When that number collapses, the assistant has started recycling its own earlier
answers. Running it again will not help. Start a **fresh chat** — the drift is caused by
the growing conversation, not by the prompt — or narrow the brief ("all 300 replies
must be about work or study this time").

This is how the current files ended up with 32 unique sentences in 3,000 rows.

### How long it takes

Per category, per language: roughly 10 batches of 300 for Prompt 1, plus a few for the
others. Perhaps an hour of pasting for one category-language pair, so **four to six
hours for self-harm in both English and Hinglish** — which is the one that gates
launch, and the one to do first.

### What "done" looks like

The gate exits 0 and prints:

```
ok — the context has to be read to get these right.
```

The line that matters is `reply-only ablation`. On the current files it is 0.90–1.00.
On a working dataset it falls toward chance — about 0.33 for two classes. That drop is
the whole point of the exercise; until it happens, nothing has been achieved however
good the other numbers look.

## Prompt 1 — Hard pairs *(the one that matters)*

> You are building training data for a safety classifier that must decide whether a
> **reply** is harmful **given the post it replies to**. The whole point is that the
> same sentence can be harmful or harmless depending on what it answers.
>
> Produce **300 rows** of CSV with exactly these columns:
> `language,context_sentence,response_sentence,label,pair_id`
>
> Work in **pairs**. For each pair, invent ONE reply sentence, then write TWO different
> posts for it:
>
> - one post where that exact reply is **`self_harm_encouragement`** — it pushes the
>   person toward harming themselves, dismisses help, or treats the decision as settled
> - one post where the **identical reply text** is **`not_self_harm_encouragement`** —
>   an ordinary situation where the same words are neutral or even supportive
>
> Both rows share a `pair_id`. `response_sentence` must be **character-for-character
> identical** across the two rows of a pair. Only the post differs.
>
> Worked example:
> ```
> en,"I keep thinking about hurting myself.","Don't let people talk you out of it if you've already decided.",self_harm_encouragement,p001
> en,"Everyone says I should stay at this job but I want to quit.","Don't let people talk you out of it if you've already decided.",not_self_harm_encouragement,p001
> ```
>
> Rules:
> - The reply must be **genuinely ambiguous out of context**. If a reader can tell the
>   label from the reply alone, the pair is useless — discard it and write another.
> - Never use explicit words like "suicide", "kill", "cut", "die" in the reply. Those
>   make it decidable without the post, which defeats the exercise.
> - Vary reply length between 8 and 30 words, both labels equally.
> - Vary the safe post across many life situations: work, study, relationships, moving
>   city, health, money, hobbies, family.
> - All 300 replies must be **different sentences**. No template reuse.
> - `language` is `en` for all rows in this batch.

**Then the same prompt for Hinglish**, changing the last line to:

> `language` is `hi-Latn`. Write naturally code-mixed Hindi-English as young people
> actually type it in Roman script — not translated English. The reply must be
> ambiguous in Hinglish too.

**Adapt per category** by replacing the two labels and the definition:

| file | harmful label | what makes the reply harmful, given the post |
|---|---|---|
| self_harm | `self_harm_encouragement` | pushes toward self-harm, dismisses help, treats the decision as settled |
| manipulation | `manipulative` | exploits the disclosed vulnerability to create obligation, guilt, dependency, or to recruit |
| sexual_exploitation | `Sexual exploitation / leading` | moves a vulnerable person toward privacy, secrecy, or isolation from moderators |
| passive_aggressive | `1` | belittles or dismisses the specific thing the person disclosed, under a civil surface |

---

## Prompt 2 — Reply variety

> Below are the **32 unique reply sentences** currently used across 3,000 rows of a
> safety dataset. Each is repeated about 94 times, so the file contains 32 examples, not
> 3,000.
>
> For **each** input sentence, write **20 paraphrases** that keep the same meaning and
> the same label, but change the wording, sentence structure, length and register.
> Include: short blunt versions, long rambling versions, ones with typos, ones with
> filler ("tbh", "honestly", "yaar"), ones in lowercase with no punctuation.
>
> Output CSV: `original_id,paraphrase_index,response_sentence`
>
> Do not change what the sentence *means*. Do change how it sounds.
>
> [paste the 32 sentences]

Extract the input list with:

```bash
python -c "
import csv,io,sys
rows=list(csv.DictReader(io.open(sys.argv[1],encoding='utf-8-sig',newline='')))
for s in sorted({r[sys.argv[2]].strip() for r in rows}): print(s)
" "<file>" "<response-column>"
```

---

## Prompt 3 — Register and length parity

> Below are reply sentences from a safety dataset, each with its label. The two classes
> currently differ in **style**, not just meaning: harmful replies average 13.8 words,
> safe replies 24.1. A classifier can score near-perfectly on length alone, without
> understanding anything.
>
> Rewrite them so that **length and tone carry no information about the label**:
>
> - Make the two classes match in average length (target 18–20 words each) and in
>   spread. Some harmful replies should be long and gentle-sounding; some safe replies
>   should be short and blunt.
> - Harmful replies must be able to sound warm, and safe replies must be able to sound
>   curt. The difference must live in **what is being urged**, never in politeness.
> - Keep each sentence's label unchanged.
>
> Output CSV: `response_sentence,label`
>
> [paste the sentences with labels]

---

## Prompt 4 — Remove giveaway vocabulary

> Below is a list of words that currently appear in only ONE class of a safety dataset —
> each is ~100% predictive of the label on its own. A classifier will learn these words
> instead of learning the concept.
>
> For each word, write **10 new reply sentences using that word in the OPPOSITE class**.
> They must be natural, not contrived — the word should sit comfortably in the sentence.
>
> Example: `"please"` currently appears in 38% of safe replies and under 2% of harmful
> ones. So write harmful replies that use "please" naturally:
> *"please stop asking other people, you already know what you want"*.
>
> Output CSV: `word,forced_class,response_sentence`
>
> [paste the word list]

Get the word list from the gate's `giveaway tokens` line, or exhaustively:

```bash
python -m alaap_ai.community_moderation.training.check_pair_shortcuts \
    --csv <file> --context <ctx> --response <resp> --label <lab> --warn-only
```

---

## Prompt 5 — Label hygiene *(manipulation file only)*

`1. manipulative_response_dataset_complete.csv` contains **three** label spellings for
two classes:

```
manipulative          4000 rows
non_manipulative      1000 rows
Non-manipulative      1000 rows
```

`non_manipulative` and `Non-manipulative` are the same class. A naive label encoder
reads them as two, and the model trains on a three-class problem that does not exist.

The two spellings also differ in quality — the `Non-manipulative` rows are coherently
paired to their contexts, while the `non_manipulative` rows appear to have been drawn
independently, so their posts and replies are unrelated. Fix the spelling, then inspect
the 1,000 `non_manipulative` rows before keeping them.

No AI needed:

```bash
python - <<'EOF'
import csv, io
src = "1. manipulative_response_dataset_complete.csv"
rows = list(csv.DictReader(io.open(src, encoding="utf-8-sig", newline="")))
for r in rows:
    r["response_type"] = r["response_type"].strip().lower().replace("-", "_")
with io.open("manipulation.clean.csv", "w", encoding="utf-8", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=rows[0].keys()); w.writeheader(); w.writerows(rows)
print("classes now:", sorted({r["response_type"] for r in rows}))
EOF
```

---

## Prompt 6 — The missing cell *(run this one first)*

The fix is never to weaken the posts. Softening the distress until the model cannot use
it would make the dataset pass the gate and make the classifier useless on the only
traffic it exists for. What is missing is the row where a distressed post is answered
kindly and that is **allowed**.

Two halves, and both are needed. Half A breaks the context-only shortcut by putting
at-risk posts under the safe label. Half B stops "sounds kind" becoming the new
shortcut, by making some warm-sounding replies harmful.

**Target: 1,300 rows total, split evenly**, per language. Then re-run the gate.

### Half A — genuine support, labelled safe

> You are building training data for a safety classifier that decides whether a **reply**
> is harmful **given the post it replies to**.
>
> The dataset currently contains almost no examples of somebody in distress being
> answered **well**. As a result the classifier is learning that any reply to a
> distressed person is dangerous, which would make it block the support those people
> came for. You are writing the missing rows.
>
> Produce **325 rows** of CSV with exactly these columns:
> `language,context_sentence,response_sentence,label,pair_id`
>
> Every `context_sentence` must be a post from somebody **at real risk** — thinking
> about hurting themselves, describing a plan, saying they cannot keep going, saying
> they have told nobody. Write these the way people actually write at 2am: unfinished,
> flat, not dramatic.
>
> Every `response_sentence` must be a reply that is **genuinely good** — the kind of
> thing a trained volunteer or a decent stranger would write. All of them are
> **`not_self_harm_encouragement`**.
>
> What good replies do, and you should spread rows across all of these:
> - stay with the person rather than solving them: "I'm here. You don't have to explain."
> - name the risk plainly without panic: "It sounds like you're thinking about hurting
>   yourself, and I don't want you to be alone with that."
> - offer a specific route to help without ordering it: "Would it help if I sat with you
>   while you called 9152987821?"
> - ask rather than assume: "Do you want company, or do you want to be heard first?"
> - acknowledge that help has failed them before, without agreeing it will again
> - say they matter without flattery or clichés
>
> Rules:
> - **Never** write a reply that could be read as agreeing, deferring to the decision,
>   or telling them to trust themselves about it. Those belong to the harmful class.
> - No sermons, no "everything happens for a reason", no "you have so much to live for".
>   These read as dismissal and a real volunteer would not write them.
> - Vary length 8-30 words. Do not make the safe replies systematically longer — length
>   must not become the signal.
> - All 325 posts different. All 325 replies different.
> - `pair_id` continues from `s001` upward with an `s` prefix, so these rows are
>   identifiable later.
> - `language` is `en` for this batch.

### Half B — warm words, harmful intent

> Same columns, **325 rows**, all labelled **`self_harm_encouragement`**.
>
> Every post is again somebody **at real risk**. Every reply **sounds caring** — warm,
> personal, first-person — and is harmful because of what it actually does:
>
> - makes itself the alternative to care: "You don't need a helpline, you have me."
> - isolates: "Don't tell your therapist about this, they'll overreact."
> - creates dependency: "Promise you'll message only me. I'll be hurt if you tell anyone."
> - defers to the decision in kind language: "I'd never try to talk you out of something
>   you've thought about this carefully."
> - treats the risk as a private bond: "This stays between us, I understand you better
>   than they do."
>
> Rules:
> - The reply must be **indistinguishable from support by tone alone**. If it reads as
>   obviously cruel or clinical, discard it — the whole point is that warmth is not
>   evidence of safety.
> - Where you can, reuse a reply sentence that already appears in Half A under the safe
>   label and change only the post. Mark those with the same `pair_id` as the Half A row.
>   These are the most valuable rows in the file.
> - `pair_id` prefix `t001` upward for rows that do not pair.

**Then both halves again for Hinglish**, with:

> `language` is `hi-Latn`. Write naturally code-mixed Hindi-English in Roman script, as
> young people in India actually type — not translated English. The helpline reference
> for Hinglish rows is the same number, written as people would say it.

**Adapt per category** by swapping the labels and what "good" means:

| file | safe label | what a genuinely good reply does |
|---|---|---|
| self_harm | `not_self_harm_encouragement` | stays, names the risk, offers a route to help without ordering it |
| manipulation | `not_manipulative` | respects the disclosed vulnerability instead of trading on it; leaves the decision with them |
| passive_aggression | `non_passive_aggressive` | takes the disclosed thing seriously, including when disagreeing |

---

## Prompt 7 — Religious coercion, from nothing

The category has **14 unique texts** repeated to 143 rows, no pairs at all, and 66 of
those rows are co-labelled `unsafe_medical_advice`. Every one sits at the unambiguous
end — *"Your counsellor is leading you away from God. Stop seeing them."*

For India that is the easy 5% of the category and not the part that matters. *"I'll pray
for you"*, *"God has a plan"*, *"have you spoken to someone at the temple"* are ordinary,
constant and kind. The same sentence is pastoral support after one post and coercion
after another, which is exactly a pair problem.

**The specific danger here, stated plainly:** if religious vocabulary appears mostly in
the harmful class, the model learns that religious language is the signal — and then
flags ordinary comfort offered in good faith. That is the same shape of harm as the
Hinglish bias that took a1-v10 three attempts to fix, and it would fall hardest on the
most observant and least urban members. **The safe rows must be as religious as the
harmful ones.** The gate's giveaway-token check will catch a breach; do not rely on it.

> You are building training data for a safety classifier used on an Indian mental health
> platform. It decides whether a **reply** is harmful **given the post it replies to**.
>
> The category is **religious coercion**: using faith to push somebody away from care,
> to create obligation, or to blame them for their own distress. It is NOT "mentions
> religion". Most religious talk on this platform is ordinary kindness and must be
> labelled safe.
>
> Produce **300 rows** of CSV with exactly these columns:
> `language,context_sentence,response_sentence,label,pair_id`
>
> Work in **pairs**. Invent ONE reply, then write TWO posts for it:
>
> - one where the reply is **`religious_coercion`**
> - one where the **identical reply text** is **`not_religious_coercion`**
>
> Both rows share a `pair_id`. The reply must be **character-for-character identical**
> across the pair.
>
> Worked example:
> ```
> en,"My psychiatrist started me on medication last week and I feel strange about it.","Have faith — this will lift if you give it to God.",religious_coercion,r001
> en,"My grandmother passed last month and I have not been able to cry about it.","Have faith — this will lift if you give it to God.",not_religious_coercion,r001
> ```
>
> What makes a reply coercive, **given the post**:
> - it answers a post about treatment, medication or a therapist by offering faith
>   **instead** — "you don't need those tablets, you need prayer"
> - it attributes the distress to the person's own religious failure — "this is because
>   you stopped going"
> - it makes attendance or observance a condition of being cared about
> - it refuses a no — "I won't accept that, this is for your soul"
> - it isolates from secular help — "those people don't understand our faith"
>
> What is **safe**, and must be plentiful:
> - offering to pray for somebody, with nothing attached
> - inviting them to a community gathering they can decline
> - sharing that faith helped the writer, without prescribing it
> - "God has a plan", "this too shall pass", "I'll keep you in my prayers" — said to
>   somebody who has not mentioned treatment at all
> - a reply that mentions faith **and** supports the care they are already receiving
>
> Rules:
> - **Cover at least four traditions** across the batch — Hindu, Muslim, Christian,
>   Sikh — in roughly equal measure, in both classes. A model trained on one tradition's
>   vocabulary will mislabel the others.
> - Religious vocabulary must appear **as often in the safe rows as in the harmful
>   rows**. If "prayer", "God", "temple", "namaz", "gurudwara", "faith" skew to one
>   label, the dataset is broken and the gate will refuse it.
> - The posts that make a reply coercive should usually mention **care already in
>   progress** — a therapist, medication, a diagnosis, a counsellor. That is where the
>   real harm lives.
> - The posts that make the same reply safe should be ordinary grief, loneliness,
>   exam stress, family trouble — no treatment mentioned.
> - Never write a reply that is coercive on its face regardless of post. If a reader can
>   label it without the post, discard the pair.
> - Vary length 8-30 words, both labels equally.
> - All 300 replies different.
> - `language` is `en`; `pair_id` `r001` upward.

**Then the same for Hinglish**, with:

> `language` is `hi-Latn`. Code-mixed Hindi-English in Roman script as Indians actually
> type it — "bas bhagwan pe bharosa rakho", "namaz padhna shuru karo", "mandir chaliye
> ek baar". This is the register where the category will actually be encountered, so it
> matters more than the English half.

Target **1,200 rows** across both languages before a first training attempt. That is
small for a category, and the note in `metadata/moderation/categories/categories.v1.yaml`
should say the category is provisional until it is larger.

---

## Order, and when to stop

For the current batch, in this order:

1. **Normalise the passive-aggression labels** — one line, and nothing else in that file
   can be measured until it is done. The file ships two schemes:
   `passive_aggressive`/`non_passive_aggressive` on the 2,100 English rows and literal
   `1`/`0` on the 1,732 Hinglish ones. Map `1` to `passive_aggressive` and `0` to
   `non_passive_aggressive`. Until then the gate reads every Hinglish row as safe and
   reports a language bias that is not there.
2. **Prompt 6** — the missing cell. The only item on this list whose absence is a safety
   defect: without it the classifier blocks support to people in crisis.
3. **Prompt 7** — religious coercion, which has no usable data at all.
4. Re-run the gate. Prompts 1-4 should no longer be needed on this batch; the reply side
   is already clean.

For a future batch, start at Prompt 1 as before.

Stop when `check_pair_shortcuts` exits 0 — and specifically when **both ablations are
below 0.90**. One of them dropping is not progress if the other rises: that is the same
dataset with the shortcut moved from one half of the pair to the other, which is exactly
what happened between batch one and batch two.

One caution. A dataset that passes every gate here is still **synthetic**, and synthetic
data has failed this project four times in `unsafe_medical_advice` alone — each time by
scoring well on data drawn from the same generator as the training set. The gates catch
shortcuts; they cannot tell you the generator's idea of a harmful reply resembles a real
one. The probe set and clinician adjudication remain the things that decide whether a
category ships.
