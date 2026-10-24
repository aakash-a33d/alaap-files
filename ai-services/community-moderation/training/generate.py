"""Synthetic training data generation.

    python -m alaap_ai.community_moderation.training.generate \
        --category manipulation_coercion --n 200 \
        --seed-corpus data/synthetic-seed.v1.jsonl \
        --out data/generated-manipulation.jsonl

Generates with a **locally hosted** model, by default an OpenAI-compatible endpoint
(vLLM serving Qwen3 8B). Two reasons that matters, and neither is convenience:

  * Qwen3 is Apache-2.0 and self-hosted, so nothing restricts using its outputs to
    train our classifier. Hosted assistant APIs generally restrict using outputs to
    train models — see docs/ai/dataset-sourcing.md §4.
  * No message we generate leaves our infrastructure.

Everything produced here is written with `adjudicated: false` and there is no flag to
change that. Generated text is a *candidate* for clinician review, never training
data. The reviewer queue is the product of this script; the corpus is the product of
the reviewers.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import re
from collections import defaultdict
from pathlib import Path

from alaap_ai.shared.schemas.moderation import Category

from . import dataset as ds

# --------------------------------------------------------------------------
# Per-category briefs.
#
# Each states the behaviour, the boundary against the nearest benign case, and an
# explicit prohibition on operational detail. The boundary line is the important
# one: without it the model produces cartoonish examples that teach the classifier
# a caricature, and the caricature is what fails on real users.
# --------------------------------------------------------------------------

_BRIEFS: dict[str, str] = {
    "self_harm_encouragement": (
        "Messages addressed to another person in distress that push them further "
        "from safety. Written as a REPLY — there is always a second person, and "
        "that is what separates this category from somebody's own despair. "
        "Vary the mechanism hard and do not settle into one template: agreeing "
        "that their situation is hopeless, telling them the people around them "
        "would be better off or relieved, framing the decision as reasonable or "
        "brave, daring or challenging someone who has disclosed, withdrawing an "
        "objection they were relying on ('i'm not going to talk you out of it'), "
        "dismissing every source of help at once so nothing is left. "
        "NEVER include any method, means, timing, dose, location or instructional "
        "detail of ANY kind, in any register — a message that carries one is "
        "useless here and must not be written. The harm being labelled is the "
        "pressure, not the information. "
        "BOUNDARY: the author's own despair is NEVER this category, however bleak. "
        "Neither is a person quoting what somebody said to them, nor a reply that "
        "argues against the act."
    ),
    "self_harm_encouragement_indirect": (
        "The deniable register of self_harm_encouragement, which the corpus is "
        "missing entirely. Nothing here is an instruction and nothing could be "
        "quoted back as one — the message does its work by agreeing, by "
        "sympathising, or by taking away a reason to stay. "
        "Use only these shapes: agreement with the reader's own hopeless "
        "conclusion ('honestly, i think you've already worked out that it doesn't "
        "get better'), sympathy that closes the door ('i don't blame you at all, "
        "anyone would be tired by now'), removing the person's stated reason for "
        "holding on ('your mum would grieve for a week and then be relieved, "
        "you know that'), or exhausted withdrawal ('do what you want, i'm done "
        "trying to convince you'). "
        "Every message must be addressed to somebody else and must leave them "
        "worse off than before they read it. NEVER any method, means or "
        "operational detail. "
        "BOUNDARY: gentle agreement that someone is exhausted, offered alongside "
        "any reason to stay or any offer of help, is support and must NOT appear "
        "here. The marker is that nothing is left standing."
    ),
    "grooming_exploitation": (
        "Messages showing the grooming pattern toward an apparently young or "
        "vulnerable user: secrecy requests, age probing, flattery about maturity, "
        "isolation from adults, moving off-platform. Pattern-level only. "
        "NEVER include sexual content or an operational script. "
        "BOUNDARY: a person reporting that this happened to them is NOT this category."
    ),
    "sexual_exploitation": (
        "Messages that sexualise a person who has disclosed distress, or trade "
        "support, attention or money for sexual contact or images. Convey the "
        "coercive structure only — the leverage, the escalation, the framing of "
        "compliance as gratitude. "
        "NEVER include sexual content, description of any sexual act, or any "
        "participant who is or may be a minor; minor-directed grooming belongs to "
        "grooming_exploitation and must not be generated here. "
        "BOUNDARY: an adult disclosing sexual abuse they experienced, and frank "
        "discussion of sexuality or intimacy in a health context, are NOT this "
        "category."
    ),
    "stalking_doxxing": (
        "Messages that expose or threaten to expose another person's identifying "
        "details, or that signal unwanted monitoring: claiming to know where someone "
        "lives, works or studies, referencing their accounts on other platforms, "
        "pressing for a location, threatening to tell an employer or family. "
        "Refer to identifiers in the abstract or as placeholders — NEVER invent a "
        "real-looking phone number, address, handle, Aadhaar or UPI id. "
        "BOUNDARY: someone describing being followed or monitored, or asking how to "
        "protect their own privacy, is NOT this category."
    ),
    "malware_phishing": (
        "Messages steering someone toward a malicious link, credential entry or "
        "download, in the register this platform actually sees: a 'free counselling "
        "portal' that needs a login, a support app that asks for an OTP, an "
        "account-verification scare aimed at someone already anxious. "
        "Use obvious placeholders such as [link] — NEVER a real or plausible live "
        "domain, and NEVER any working operational detail. "
        "BOUNDARY: sharing a genuine helpline number or a real support resource is "
        "NOT this category."
    ),
    "unsafe_medical_advice": (
        "Messages advising another person to stop, change, or avoid psychiatric "
        "medication or treatment, or asserting a diagnosis without qualification. "
        "The harm is the instruction about treatment, so every message must name "
        "a medication, a diagnosis, a dose, or a clinician's instruction — if you "
        "can delete the medical content and the message still makes sense, it "
        "belongs to a different category. "
        "Vary the mechanism hard and do not settle into one template: tapering "
        "advice, swapping in a supplement, reinterpreting a side effect as proof "
        "the drug is harmful, invoking a relative who recovered without it, "
        "framing a prescription as the industry's profit rather than care. "
        "BOUNDARY: sharing one's own medication experience while deferring to a "
        "clinician is NOT this category. Discouraging therapy or support in "
        "general without naming a treatment is help_seeking_discouragement, and "
        "calling someone lazy, weak or dramatic is bullying_harassment — those "
        "are separate labels and must not be generated here."
    ),
    "religious_coercion": (
        "Messages pressuring another person toward religious practice, framing "
        "distress as divine punishment, or presenting faith as a replacement for "
        "care. Draw on Indian religious contexts. "
        "BOUNDARY: describing one's own faith as a personal comfort is NEVER this "
        "category and must not be generated as a positive example."
    ),
    "emotional_dependency_pressure": (
        "Messages cultivating exclusive reliance: positioning oneself as the only "
        "person who understands, discouraging other support, guilt on withdrawal. "
        "The marker is EXCLUSIVITY. "
        "BOUNDARY: 'I am here for you' alongside encouragement to keep a therapist "
        "involved is healthy support and is NOT this category."
    ),
    "manipulation_coercion": (
        "Messages using guilt, obligation, or emotional leverage: debt-framing, "
        "blame-shifting, reality-denial, conditional affection. "
        "BOUNDARY: expressing hurt directly and without leverage is NOT this category."
    ),
    "passive_aggressive_abuse": (
        "Indirect hostility with deniability: sarcasm as attack, comparative digs, "
        "false congratulation, martyrdom. Often first-person, which does NOT exempt "
        "it. BOUNDARY: sincere congratulation and honest disagreement are NOT this "
        "category."
    ),
    "impersonation": (
        "Messages claiming an identity or authority the writer does not have, in "
        "order to make advice binding: posing as a therapist, psychiatrist, "
        "counsellor, moderator or platform staff, or inventing credentials to close "
        "off disagreement. "
        "BOUNDARY: honestly describing one's own profession, and peer support offered "
        "plainly as peer support, are NOT this category."
    ),
    "help_seeking_discouragement": (
        "Messages telling someone in a support community to stop seeking support: "
        "that posting is attention-seeking, that therapy is a waste of money, that "
        "they should keep it in the family, that talking about it makes it worse. "
        "Most are written as reasonable advice and should read that way — the "
        "cartoonish version of this category is the useless version. "
        "BOUNDARY: describing one's own bad experience with a particular therapist "
        "while still supporting the idea of care is NOT this category, and neither "
        "is suggesting a better-suited channel or resource."
    ),
    "benign": (
        "Ordinary posts and replies in a mental wellness community. Include the hard "
        "cases: intense self-directed distress with no harm to anyone; anger at "
        "employers and institutions; recovery narratives mentioning past suicidal "
        "periods; people reporting abuse they received; blunt but respectful "
        "disagreement; supportive replies that widen rather than narrow support."
    ),
    "benign_medication": (
        "Ordinary, harmless messages in a mental wellness community that happen to "
        "mention psychiatric medication, a dose, a diagnosis or a clinician. "
        "Cover: describing one's own medication as helping or not helping, asking "
        "whether anyone else had a particular side effect, mentioning that a "
        "prescriber changed a dose, nervousness about starting something new, "
        "relief at a diagnosis that finally explains things, and replies that "
        "encourage the reader to raise a concern with their own prescriber. "
        "Every message MUST name a medication, dose, diagnosis or clinician — one "
        "without any of those is useless here. "
        "NEVER advise anyone to stop, reduce, avoid or change a treatment, and "
        "NEVER assert a diagnosis about another person. Those are "
        "unsafe_medical_advice and must not appear."
    ),
    "unsafe_medical_advice_indirect": (
        "Advice to stop, reduce or avoid psychiatric medication or treatment, "
        "written in the GRAMMATICAL FORM of a harmless message. Never an order. "
        "Use only these shapes: a question ('have you thought about coming off "
        "it for a bit?'), a first-person story that carries the recommendation "
        "('mine did nothing for six months, i binned it and felt human again'), "
        "a hedge ('not telling you what to do, but i'd taper'), or a report of "
        "someone else's decision offered as a model ('my cousin stopped hers and "
        "she's fine now'). "
        "The message must still recommend stopping, reducing or avoiding "
        "treatment — softness of form, not of content. Name a medication, dose, "
        "diagnosis or clinician in every message. "
        "BOUNDARY: describing your own experience WITHOUT recommending the reader "
        "change anything is benign and must not appear here."
    ),
    "unsafe_medical_advice_question": (
        "Advice to stop, reduce or avoid psychiatric medication or treatment, "
        "phrased ENTIRELY AS QUESTIONS. Every single message must end with a "
        "question mark. A message that is not a question is useless here. "
        "Use the shapes a real person uses to plant a suggestion without owning "
        "it: 'have you thought about coming off the 20mg for a bit?', 'why are "
        "you still on that if it isn't working?', 'has anyone told you what "
        "that's doing to your liver?', 'do you actually need the lithium or is "
        "that just what they told you?', 'what if you skipped a couple of days "
        "and saw how you felt?'. "
        "The question must carry the recommendation to stop, reduce or distrust "
        "the treatment. Name a medication, dose, diagnosis or clinician. "
        "BOUNDARY: a genuine question seeking information or others' experience "
        "('has anyone had dizziness on fluoxetine?') is benign and must NOT "
        "appear here — the difference is whether the question is really advice."
    ),
    "benign_medication_peer": (
        "Harmless messages about psychiatric treatment in the two forms this "
        "corpus is missing, and every message must use one of them. "
        "(a) a GENUINE QUESTION seeking others' experience or information — "
        "'has anyone had weight gain on sertraline?', 'is the dizziness on "
        "20mg fluoxetine normal or should i call someone?', 'did the nausea "
        "settle down for anyone after a few weeks?'. "
        "(b) a NAMED RELATIVE OR FRIEND whose treatment is described neutrally "
        "or positively — 'my sister is on risperidone 2mg and it is helping "
        "her manage', 'my cousin started lamotrigine last month and seems "
        "steadier', 'my friend sees the same psychiatrist and rates her'. "
        "Use hedges freely ('honestly', 'maybe', 'tbh', 'i guess') — the corpus "
        "currently has those almost only in harmful messages. "
        "Every message must name a medication, dose, diagnosis or clinician. "
        "NEVER recommend stopping, reducing, avoiding or changing a treatment, "
        "and never imply the reader should. A question that is really advice "
        "('why are you still on that?') is unsafe_medical_advice and must not "
        "appear here."
    ),
    "benign_medication_refusal": (
        "Harmless messages in which the writer uses the vocabulary of stopping "
        "medication in order to REJECT it. The whole point is that the sentence "
        "contains the words 'quit', 'stop', 'come off', 'skip' — and then negates "
        "them. "
        "Shapes: 'i hate the side effects but i'm not going to stop without "
        "talking to her first', 'part of me wants to quit the 20mg but i know "
        "that's the illness talking', 'people keep telling me to come off it and "
        "i've decided not to listen', 'i thought about skipping a dose and then "
        "didn't'. "
        "Every message must (a) contain a stopping word and (b) make clear the "
        "writer is not doing it, or is not recommending it to anyone. "
        "Never advise the reader to change anything. Speak only about yourself."
    ),
    "self_harm_encouragement_softened": (
        "Harmful messages that push another person further from safety, written "
        "in the three forms the first generation round produced almost none of. "
        "`check_confounds` measured the gap: 0% of positives named a relative "
        "against 8% of the negatives, and 4% were first-person against 50%. A "
        "classifier trained on that learns 'mentions family = safe' and 'first "
        "person = safe', and then misses the harmful message that does either. "
        "EVERY message must use at least one, and preferably two: "
        "(a) NAME A RELATIVE OR FRIEND of the reader and use them to remove a "
        "reason to stay — 'your mum would grieve for a fortnight and then sleep "
        "properly again', 'your sister has said the same thing to me about you'. "
        "(b) FIRST PERSON framing that carries the push — 'i think you're right "
        "that it doesn't get better', 'honestly i'd feel the same in your "
        "position', 'i've stopped trying to talk people out of this'. "
        "(c) HEDGES — 'honestly', 'maybe', 'tbh', 'i guess', 'not saying you "
        "should, but'. "
        "The message must still be addressed to somebody and must still leave "
        "them worse off. NEVER any method, means or operational detail. "
        "BOUNDARY: first-person despair with no second person in it at all is "
        "benign_own_despair and must NOT appear here."
    ),
    "self_harm_encouragement_normalising": (
        "Harmful messages that normalise the act by reference to somebody the "
        "WRITER knows — 'my brother did it and honestly he's at peace now', 'a "
        "friend of mine went the same way and nobody blamed her'. The corpus has "
        "0 positives naming the writer's own relative against 59 benign, which "
        "teaches a classifier that 'my sister' is a safety signal. "
        "Every message must name the writer's own relative, friend or colleague "
        "(my brother, my cousin, my flatmate, a friend of mine) and must use them "
        "to make the reader's situation look resolved or acceptable. "
        "NEVER any method, means, timing or operational detail — the harm is the "
        "normalising, and a message carrying detail is useless here. "
        "BOUNDARY: grief for somebody lost to suicide, described as grief, is NOT "
        "this category and must not appear. The marker is that the story is being "
        "offered to the reader as a model."
    ),
    # ---- hard negatives for self_harm_encouragement ----
    #
    # This category's false positive is the worst outcome the platform has: a
    # person discloses that they want to die and the system moderates them for
    # it. The three briefs below are the negatives that make that separable, and
    # they matter more than the positives — 12 positives against a benign pool
    # that never uses this vocabulary would teach "mentions dying = harmful",
    # which is the a1-v4 medication shortcut with far worse consequences.
    "benign_own_despair": (
        "FIRST-PERSON crisis disclosure in a support community. The writer is "
        "describing their own state and asking nobody to do anything. This is the "
        "single most important negative in the corpus: these messages must never "
        "be moderated, and the classifier can only learn that if it sees them. "
        "Use the full vocabulary the harmful category uses, turned on the writer: "
        "'i don't want to be here anymore', 'there's no point in any of it', "
        "'everyone would be better off without me', 'i'm so tired of trying', "
        "'i keep wondering what the point is'. "
        "Vary the surrounding detail heavily — work, family, illness, money, "
        "sleeplessness, a specific bad day — so the model cannot learn a template. "
        "Every message must be about the writer. NEVER address a second person, "
        "never advise anybody, never include method or means. "
        "Some should be flat and undramatic, because most real ones are."
    ),
    "benign_crisis_support": (
        "Replies TO someone who has disclosed suicidal feelings, written by a peer "
        "who is trying to keep them safe. These deliberately share vocabulary with "
        "self_harm_encouragement and mean the opposite, which is the whole point. "
        "Shapes: naming the thing plainly ('are you saying you want to kill "
        "yourself? i'm asking because i want to know'), refusing to agree ('i "
        "don't think you're right that nobody would miss you, and i'm not going to "
        "pretend i do'), staying ('i'm not going anywhere, talk to me'), pointing "
        "at help without dismissing the person ('will you ring someone tonight, "
        "even if it's rubbish, just so you're not on your own with it'). "
        "Direct and unpolished is better than gentle and vague — real people are "
        "blunt when they are frightened for somebody. "
        "NEVER agree that the person should act, never remove a reason to stay, "
        "never include method or means."
    ),
    "benign_reported_abuse": (
        "Messages in which the writer QUOTES OR REPORTS cruelty that was directed "
        "at them, usually while asking for help with it. The harmful sentence is "
        "inside the message and the writer is its target, not its author. "
        "Shapes: 'my brother told me nobody would miss me and i can't stop hearing "
        "it', 'someone in a group chat said i should just end it, i left but it's "
        "still sitting with me', 'she said the family would be better off without "
        "me and then acted like it was a joke', 'i reported a reply that told me to "
        "kill myself, does anyone know how long that takes'. "
        "Vary who said it: family, partner, colleague, stranger online, a reply on "
        "this platform. Some should be recent and raw, some flat and long after. "
        "The writer must always be the one it was said TO. Never include method or "
        "means."
    ),
    "benign_crisis_question": (
        "Harmless messages around crisis and distress, written as QUESTIONS and "
        "with hedges. Every single message must end in a question mark. "
        "The first generation round left questions 27x more common in the harmful "
        "class and hedges 15x, which teaches a classifier that asking something "
        "is dangerous — in a support community, where asking is most of what "
        "happens. "
        "Cover all three shapes: "
        "(a) the writer's own despair as a question — 'what is even the point of "
        "any of this anymore?', 'honestly does it get better or do you just get "
        "used to it?', 'is it normal to feel nothing at all for weeks?'. "
        "(b) a supportive question to somebody struggling — 'have you eaten "
        "today?', 'do you want to talk or do you want company, tbh either is "
        "fine?', 'is there anyone you can ring tonight?'. "
        "(c) practical questions about help — 'has anyone here used the "
        "helpline, is it any good?', 'maybe this is a silly question but how do "
        "you get a referral?'. "
        "Use hedges freely: honestly, maybe, tbh, i guess, silly question. "
        "NEVER encourage anyone toward harm, never remove a reason to stay, "
        "never include method or means."
    ),
    "benign_reader_relative": (
        "Supportive messages to someone struggling that name THE READER'S family "
        "or friends — 'your mum', 'your sister', 'your partner'. "
        "The corrective round left this phrase 141x more common in the harmful "
        "class (26.4% against 0.2%), because the harmful move is using the "
        "reader's family to remove a reason to stay. A classifier trained on that "
        "learns 'your mum = harmful', and then flags every person asking whether "
        "someone has told their family. "
        "Shapes: encouraging contact — 'have you told your sister how bad it's "
        "got?', 'your mum would want to know, even if it feels like a burden'; "
        "practical — 'is your partner around tonight, or are you on your own?'; "
        "gently disagreeing with the reader's own conclusion about them — 'i "
        "don't think your dad would be relieved, i think he'd be devastated'. "
        "Every message must name a relative or friend OF THE READER and must "
        "leave them better off. NEVER agree that anyone would be better off "
        "without them, never include method or means."
    ),
    "benign_medication_directive": (
        "Harmless, protective messages about psychiatric treatment written as "
        "SECOND-PERSON INSTRUCTIONS — the grammatical form of advice, used to "
        "point someone toward care rather than away from it. "
        "Use imperatives and direct address: 'talk to your psychiatrist about "
        "the dose', 'ask your prescriber before you change anything', 'bring the "
        "side effects up at your next appointment', 'don't stop it on your own, "
        "call the clinic first', 'write the symptoms down so you remember to "
        "mention them'. "
        "Every message must name a medication, dose, diagnosis or clinician. "
        "NEVER recommend stopping, reducing, avoiding or altering a treatment "
        "except by telling the reader to consult the person who prescribed it."
    ),
}

# The label a generated record carries, when it differs from the brief's name.
# `unsafe_medical_advice_indirect` is a generation slice, not a category: it
# exists to supply first-person and interrogative examples of a category whose
# other examples are nearly all imperatives, and it trains the same label.
_LABEL_FOR = {
    "unsafe_medical_advice_indirect": "unsafe_medical_advice",
    "unsafe_medical_advice_question": "unsafe_medical_advice",
    "self_harm_encouragement_indirect": "self_harm_encouragement",
    "self_harm_encouragement_softened": "self_harm_encouragement",
    "self_harm_encouragement_normalising": "self_harm_encouragement",
}

# Categories that are generated as negatives: the brief describes what to write,
# and the records come out with no labels at all.
#
# `benign_medication` exists because a1-v4 learned "mentions psychiatric
# medication" instead of "unsafe advice about medication". With 199 positives
# naming a drug and no benign support-context message naming one, that shortcut
# separated the classes perfectly in training and scored 1.00 precision on a
# validation set drawn from the same generator — while flagging "ive been on
# sertraline for two years and it has helped a lot" at 0.955.
#
# This is the same correction `ingest.py` makes for mental-illness mentions,
# where the Civil Comments hard negatives are described as the most valuable
# slice of the whole download. Medication needed its own.
#
# The three `self_harm` negatives are the same correction again, for the
# category where getting it wrong is worst. A model trained on 12 positives
# using this vocabulary and a benign pool that never uses it learns "mentions
# dying = harmful" — and then moderates the person disclosing, which is the one
# failure this product cannot have.
_BENIGN_CATEGORIES = frozenset({
    "benign", "benign_medication", "benign_medication_directive",
    "benign_medication_peer", "benign_medication_refusal",
    "benign_own_despair", "benign_crisis_support", "benign_reported_abuse",
    "benign_crisis_question", "benign_reader_relative",
})

# Briefs that draw their few-shot examples from a different category's seeds,
# because they describe a slice no seed corpus labels separately.
_SEED_POOL_FOR = {
    "benign_medication": "benign",
    "benign_medication_directive": "benign",
    "benign_medication_peer": "benign",
    "benign_medication_refusal": "benign",
    "unsafe_medical_advice_indirect": "unsafe_medical_advice",
    "unsafe_medical_advice_question": "unsafe_medical_advice",
    "self_harm_encouragement_indirect": "self_harm_encouragement",
    "self_harm_encouragement_softened": "self_harm_encouragement",
    "self_harm_encouragement_normalising": "self_harm_encouragement",
    # The despair and reported-abuse negatives take their shots from the
    # positive category, not from `benign`. The whole job of these two is to
    # occupy the same vocabulary as the harmful class, and seeding them from
    # ordinary benign posts would produce ordinary benign posts — which the
    # corpus already has 60,000 of and which separate nothing.
    "benign_own_despair": "self_harm_encouragement",
    "benign_reported_abuse": "self_harm_encouragement",
    "benign_crisis_support": "self_harm_encouragement",
    "benign_crisis_question": "benign",
    "benign_reader_relative": "self_harm_encouragement",
}

_SYSTEM = (
    "You write realistic short messages for a mental wellness community, used to "
    "train a safety classifier. Messages are 1-3 sentences, in the register real "
    "users write in: lowercase starts, typos, incomplete sentences are all fine. "
    "Vary length, tone and vocabulary heavily. Do not number or label the output. "
    "Return one message per line and nothing else."
)


def build_prompt(category: str, shots: list[str], n: int, language: str) -> str:
    lang = {
        "en": "English",
        "hi-Latn": "Hinglish (romanised Hindi mixed with English, as typed on a phone)",
    }[language]

    examples = "\n".join(f"- {s}" for s in shots)

    # The examples are drawn from whatever the seed corpus has, which for every
    # category except a couple is English. A model imitates the register of its
    # examples more readily than it follows a one-line language instruction, so
    # a hi-Latn run needs the instruction repeated after the examples, where it
    # is the last thing read, and made concrete with actual function words.
    reinforce = ""
    if language == "hi-Latn":
        reinforce = (
            "\nThe examples above are mostly English. Do NOT copy their language. "
            "Every message must be romanised Hinglish as typed on a phone — Hindi "
            "function words (aap, hai, nahi, mat, karo, kya, bhi, thoda, dawai) "
            "carrying English content words. Use Latin script only, never "
            "Devanagari.\n"
        )

    return (
        f"Write {n} distinct messages in {lang}.\n\n"
        f"CATEGORY: {category}\n{_BRIEFS[category]}\n\n"
        f"Existing examples — match the realism, do NOT reuse the phrasing:\n"
        f"{examples}\n"
        f"{reinforce}\n"
        f"{n} new messages, one per line:"
    )


# --------------------------------------------------------------------------
# Deduplication
# --------------------------------------------------------------------------

def _slug(category: str) -> str:
    """Short unique id prefix: initials of each underscore-separated part.

    `category[:3]` collided as soon as two briefs shared a prefix —
    unsafe_medical_advice and unsafe_medical_advice_indirect both gave
    "uns", which would have produced duplicate ids across the two files
    and had ds.load() reject the merged corpus.
    """
    return "".join(part[0] for part in category.split("_"))


def _tokens(text: str) -> set[str]:
    return set(re.findall(r"[a-z']+", text.lower()))


# Romanised Hindi function words. This is detection, not identification — the
# only question is whether the model actually switched register. Function words
# are the right marker because they survive code-mixing even when every content
# word stays English, which is exactly how our users write.
_HI_LATN_MARKERS = frozenset("""
    hai hain hoga hogi nahi nahin mat karo karna kiya karke karlo
    mein kyun kyunki kyu aap tum tera teri tumhara tumhe mera meri mujhe
    apna apne bhi kya bahut thoda zyada theek thik achha acha bura
    chhod chod chhodo chodo jao raha rahi rahe woh yeh dawa dawai goli
    gharelu ilaj bimari sahab abhi phir matlab samajh nuksan faayda fayda
    khud sirf ghar zarurat baat suno sunna lekin aur haan jyada
    rakho lena dena wale wali bina saath liye
""".split())
#
# Tokens that collide with ordinary English are deliberately excluded above,
# even though they are perfectly good Hindi: romanised `the` (past tense),
# `is`, `us`, `me`, `do`, `par`, `na`, `ho`, `hi`, `bas`, `band`, `kam` and
# `log` all occur in plain English. Including them let "stop the zoloft, it is
# making you feel numb" pass as Hinglish on the strength of `the` + `is`.


def is_expected_language(text: str, language: str) -> bool:
    """Reject output that ignored the language instruction.

    When the seed pool is almost entirely English the generator copies the
    shots' register and returns English, while the record is still stamped
    `language: "hi-Latn"`. That is worse than generating nothing: the language
    field becomes false, and any language-stratified evaluation then measures
    English performance while reporting it as Hinglish.

    Two markers rather than one, because a single loanword ("bas", "theek")
    appears in English sentences often enough to pass by accident.
    """
    if language != "hi-Latn":
        return True
    words = set(re.findall(r"[a-z]+", text.lower()))
    return len(words & _HI_LATN_MARKERS) >= 2


# Generation failures that must never reach a reviewer, let alone a corpus.
#
# Every self-harm brief forbids method and means in capitals, and a brief can
# still be ignored — this cannot. It is applied to the self-harm briefs and
# their negatives, where a slip would put operational detail into a CSV that
# gets passed around a clinical review team.
#
# The pattern is the crisis generator's, which has been through this already.
# Importing it rather than copying keeps one list: two copies would drift, and
# the copy that drifted would be the one nobody was watching.
_UNSAFE_CATEGORIES = frozenset({
    "self_harm_encouragement",
    "self_harm_encouragement_indirect",
    "self_harm_encouragement_softened",
    "self_harm_encouragement_normalising",
    "benign_own_despair",
    "benign_crisis_support",
    "benign_reported_abuse",
    "benign_crisis_question", "benign_reader_relative",
})


def rejects_method_detail(text: str, category: str) -> bool:
    """True when a self-harm candidate names a method or means."""
    if category not in _UNSAFE_CATEGORIES:
        return False
    from alaap_ai.crisis_triage.training.generate_crisis import reject_unsafe

    return reject_unsafe(text)


# Typographic characters the generator emits and our users mostly do not.
#
# Measured on this run: 60.9% of generated positives carried U+2019 against
# 19.8% of generated negatives — a 3.1x separation on an apostrophe. That is the
# a1-v4 medication shortcut in a different costume, and a classifier will take it
# because it is perfectly clean and costs nothing to learn.
#
# It is already in the corpus. Lift of U+2019 against a 3.2% base rate:
#
#     unsafe_medical_advice        47.1%   14.6x
#     passive_aggressive_abuse     31.1%    9.6x
#     bullying_harassment           1.8%     0.6x
#     hate_speech                   1.9%     0.6x
#     threats_intimidation          0.8%     0.2x
#
# The two high ones are exactly the two categories built from generated text.
# The benchmark-derived categories are all below the base rate. `check_confounds`
# could not see it: its feature set is words, and this is punctuation.
_TYPOGRAPHY = str.maketrans({
    "‘": "'", "’": "'",
    "“": '"', "”": '"',
    "–": "-", "—": "-",
    "…": "...",
    " ": " ",
})


def normalise_typography(text: str) -> str:
    """Flatten generator punctuation to what a person types on a phone.

    Applied at write time so the artifact never reaches a file. It removes no
    meaning — an apostrophe is an apostrophe — and removes a feature that
    separates the classes for free.
    """
    return text.translate(_TYPOGRAPHY)


def is_near_duplicate(text: str, existing: list[set[str]], threshold: float = 0.6) -> bool:
    """Jaccard overlap against the corpus.

    Generators collapse toward a few phrasings, and a corpus of near-identical
    examples teaches the classifier a template rather than a concept. Anything
    above the threshold is discarded rather than reviewed.
    """
    candidate = _tokens(text)
    if not candidate:
        return True
    for other in existing:
        union = candidate | other
        if union and len(candidate & other) / len(union) >= threshold:
            return True
    return False


# --------------------------------------------------------------------------
# Backends
# --------------------------------------------------------------------------

def generate_openai_compatible(prompt: str, base_url: str, model: str) -> list[str]:
    """Call a local vLLM / llama.cpp server. Lazily imported."""
    try:
        import httpx
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("pip install httpx to use the local endpoint") from exc

    response = httpx.post(
        f"{base_url.rstrip('/')}/chat/completions",
        json={
            "model": model,
            "messages": [
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": prompt},
            ],
            "temperature": 1.0,
            "top_p": 0.95,
            "max_tokens": 2048,
        },
        timeout=300,
    )
    response.raise_for_status()
    content = response.json()["choices"][0]["message"]["content"]

    # Strip hybrid-reasoning output before parsing.
    #
    # Qwen3 — the model this script is built around — emits a <think> block by
    # default, and several OpenAI-compatible backends return it inline in
    # `content` rather than in a separate field. Every line of that reasoning
    # clears the 15-400 character filter below and is varied enough to clear the
    # near-duplicate check, so it would be written out as labelled training
    # candidates: "Okay, the user wants me to write 20 messages about..." tagged
    # unsafe_medical_advice, several hundred times.
    #
    # An unclosed <think> means the model ran out of tokens mid-reasoning and
    # never produced an answer, so there is nothing after it worth keeping.
    content = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL)
    if "<think>" in content:
        content = content.split("<think>", 1)[0]

    return [
        re.sub(r"^\s*(?:[-*•]|\d+[.)])\s*", "", line).strip()
        for line in content.splitlines()
        if line.strip()
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--category", required=True,
                        choices=sorted(_BRIEFS.keys()))
    parser.add_argument("--n", type=int, default=100)
    parser.add_argument("--language", default="en", choices=["en", "hi-Latn"])
    parser.add_argument("--seed-corpus", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--batch", type=int, default=20,
                        help="messages per request; smaller batches vary more")
    parser.add_argument("--shots", type=int, default=6)
    parser.add_argument("--max-attempts", type=int, default=None,
                        help="request budget; defaults to 3x the batches needed "
                             "for --n. The run also stops early once three "
                             "consecutive requests add nothing new.")
    parser.add_argument("--base-url", default="http://localhost:8000/v1")
    parser.add_argument("--model", default="Qwen/Qwen3-8B")
    parser.add_argument("--print-prompt", action="store_true",
                        help="print the prompt and exit; no model needed")
    args = parser.parse_args()

    seed_records = ds.load(args.seed_corpus)

    by_category: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for record in seed_records:
        entry = (record.text, getattr(record, "language", "en"))
        if record.is_benign:
            by_category["benign"].append(entry)
        for label in record.labels:
            by_category[label].append(entry)

    candidates = by_category.get(_SEED_POOL_FOR.get(args.category, args.category), [])
    if not candidates:
        print(f"  no seed examples for {args.category}; write a few by hand first")
        return 1

    # Shots in the target language go first. The generator imitates the register
    # of its examples far more strongly than it obeys the language instruction,
    # so a pool that is 20/21 English produces English output for a hi-Latn run.
    pool = [t for t, lang in candidates if lang == args.language]
    off_language_pool = [t for t, lang in candidates if lang != args.language]
    if len(pool) < args.shots:
        pool = pool + off_language_pool
        if args.language != "en":
            same = sum(1 for _, lang in candidates if lang == args.language)
            print(f"  note: only {same} of {len(candidates)} seed examples are "
                  f"{args.language}; shots will be mostly other-language and "
                  f"off-language output will be discarded.")

    seen = [_tokens(r.text) for r in seed_records]
    rng = random.Random(20260831)

    if args.print_prompt:
        print(build_prompt(args.category,
                           rng.sample(pool, min(args.shots, len(pool))),
                           args.batch, args.language))
        return 0

    labels = ([] if args.category in _BENIGN_CATEGORIES
              else [_LABEL_FOR.get(args.category, args.category)])
    kept: list[dict] = []
    attempts = 0

    # Attempts were capped at a flat 20, which silently truncated any run asking
    # for more than roughly 20x the batch size: `--n 600 --batch 50` stopped at
    # 360 and exited 0, reporting success. The cap has to scale with the target.
    #
    # Three requests' worth of headroom per batch, because the near-duplicate
    # filter bites harder as `seen` grows — late requests contribute a fraction
    # of what early ones do.
    max_attempts = args.max_attempts or max(20, math.ceil(args.n / args.batch) * 3)

    # Diversity is bounded by the seed pool, not by the attempt budget. With a
    # thin pool the generator rediscovers the same phrasings and every new
    # request is discarded wholesale, so stop when that plateau is reached
    # rather than spending the rest of the budget proving it.
    stalled = 0
    language_stalled = 0
    off_language = 0
    unsafe_dropped = 0

    while len(kept) < args.n and attempts < max_attempts:
        attempts += 1
        before = len(kept)
        before_off = off_language
        prompt = build_prompt(
            args.category,
            rng.sample(pool, min(args.shots, len(pool))),
            args.batch,
            args.language,
        )
        for line in generate_openai_compatible(prompt, args.base_url, args.model):
            # Before the length check and before dedupe, so that a curly and a
            # straight version of the same sentence collide as the duplicates
            # they are rather than both being kept.
            line = normalise_typography(line)
            if len(line) < 15 or len(line) > 400:
                continue
            if not is_expected_language(line, args.language):
                off_language += 1
                continue
            # Dropped silently and not counted as a stall, because a run that
            # produced only method detail should look like a run that produced
            # nothing — and the text must not be echoed to the console either.
            if rejects_method_detail(line, args.category):
                unsafe_dropped += 1
                continue
            if is_near_duplicate(line, seen):
                continue
            seen.append(_tokens(line))
            kept.append({
                # Language is part of the id because a category is generated once
                # per language. Without it the en and hi-Latn runs emit the same
                # ids, and ds.load() rejects the merged corpus on duplicate id.
                "id": f"gen-{_slug(args.category)}-{args.language}-{len(kept) + 1:04d}",
                "text": line,
                "labels": labels,
                "source": "synthetic",
                "language": args.language,
                # Not configurable. Generated text is a candidate for review,
                # never training data.
                "adjudicated": False,
            })
            if len(kept) >= args.n:
                break

        # Two different failures both show up as "no new candidates", and
        # conflating them reports the wrong cause. A run that returned usable
        # text which was all near-duplicates has exhausted its seed diversity.
        # A run whose output was rejected wholesale for being the wrong
        # language has not — it never produced a candidate to duplicate.
        if len(kept) == before:
            if off_language > before_off:
                language_stalled += 1
                if language_stalled >= 5:
                    print(f"  stopped after {attempts} requests: five consecutive "
                          f"requests produced nothing in {args.language}.\n"
                          f"  {off_language} candidates discarded as off-language. "
                          f"The model is answering in another language despite the "
                          f"instruction — try a smaller --batch, which holds the "
                          f"language instruction better, or add {args.language} "
                          f"seed examples.")
                    break
            else:
                stalled += 1
                if stalled >= 3:
                    print(f"  stopped after {attempts} requests: three consecutive "
                          f"requests produced no new candidates.\n"
                          f"  The seed pool ({len(pool)} examples) is the limit, not "
                          f"the request budget — add seed variety to go higher.")
                    break
        else:
            stalled = 0
            language_stalled = 0

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8", newline="\n") as fh:
        for row in kept:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")

    print(f"\n  {len(kept)} candidates -> {args.out}")
    print(f"  {attempts} request(s); duplicates discarded silently")
    if off_language:
        print(f"  {off_language} discarded as not {args.language}")
    if unsafe_dropped:
        print(f"  {unsafe_dropped} discarded for naming a method or means — the "
              f"brief forbids it and the filter is what enforces it")
    print("\n  These are NOT training data. Every record needs clinician review\n"
          "  and two-annotator adjudication before it enters a corpus.\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
