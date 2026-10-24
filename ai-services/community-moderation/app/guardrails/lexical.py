"""Lexical stand-ins for categories the model has no head for.

**This is scaffolding, and every rule in it is a bug report against the corpus.**
A rule here exists because a1-v10 emits 0.000 for its category on every input,
and it retires itself the moment calibration produces a real threshold for that
category — `Policy.unmeasured` is what decides whether a rule runs at all, so a
trained checkpoint silences these without anybody remembering to.

Why it is needed. `help_seeking_discouragement` is the sixteenth category and the
one most specific to this product: telling somebody in a mental wellness
community to stop sharing attacks the exact behaviour the platform exists to make
safe. The v10 corpus holds fifteen examples of it. Fifteen, split 80/10/10,
leaves one or two in validation, which is why `thresholds.v10.yaml` records
`support: 0` and `calibrated: false` — the sweep had nothing to sweep. The head
learned nothing and outputs zero.

What was covering it, by accident, was `passive_aggressive_abuse` firing
alongside on a handful of phrasings — at threshold 0.94, on text that is almost
verbatim from its own training set. Change one capital letter and the score falls
from 0.985 to 0.385. That is memorisation, not detection, and it is why "You
should keep it to yourself" published unremarked.

Two limits worth stating plainly, because a regex in a moderation path invites
being trusted more than it deserves:

  * A rule catches phrasings somebody has thought of. It generalises to nothing,
    it is trivially reworded around by anyone who wants to, and it will miss the
    quiet version of the same act.
  * It is scored at `_SCORE`, deliberately below every block-tier threshold. A
    rule may ask for a rewrite. **A rule may not block a person**, because the
    evidence behind it is that somebody wrote a regex.

It is here rather than nowhere because the alternative was a category that does
not exist.
"""

from __future__ import annotations

import re
from collections.abc import Iterable

from alaap_ai.shared.schemas.moderation import Category

# High enough to clear a reword threshold, low enough that no block-tier cut
# point is reachable from here. A rule is evidence for "ask them to rephrase",
# never for "refuse this person".
_SCORE = 0.90

# Written for withdrawal of support, not redirection of it.
#
# "You should talk to your doctor about this rather than us", "this might get
# better answers in the medication thread" and "whatever you choose to share is
# up to you" are all protective, and a rule that caught them would be worse than
# no rule — it would moderate people for signposting help. The invariant suite
# holds those three as negatives.
_RULES: dict[Category, tuple[re.Pattern[str], ...]] = {
    Category.HELP_SEEKING_DISCOURAGEMENT: tuple(
        re.compile(p, re.IGNORECASE)
        for p in (
            r"\bkeep (it|that|this|your (problems?|issues?|feelings?|stuff)) (to|with) your ?self\b",
            r"\bnobody wants to (read|hear|see) (this|that|about)\b",
            r"\bstop (airing|posting about|sharing|bringing up)\b",
            r"\bdeal with (it|this) (privately|on your own)\b",
            r"\b(does ?n'?t|do not) belong (on|in) a public\b",
            r"\battention[- ]seeking\b",
            r"\bsort (it|this) out yourself\b",
            r"\bhandle (these things|this|it) on (your|their) own\b",
            r"\bwhy (are|do) you (telling|keep telling) strangers\b",
            r"\bstrong people\b.*\bon their own\b",
        )
    ),
    # Block tier by configuration, `review` in practice because it was never
    # calibrated — and dead in the model, which is the worst of the nine gaps.
    # Twelve training examples for the category that exists to stop one member
    # pushing another toward harm.
    #
    # **Every pattern requires the second person**, and that is the whole safety
    # argument for the rule. "No point in going on" is somebody describing their
    # own despair and must never match; "you should just end it" is aimed at
    # another person. Moderating the first would be the worst failure this
    # product has available to it, which is why none of these can reach a first-
    # person sentence at all.
    Category.SELF_HARM_ENCOURAGEMENT: tuple(
        re.compile(p, re.IGNORECASE)
        for p in (
            r"\byou should (just )?(end it|kill yourself|give up)\b",
            r"\bnobody would miss you\b",
            r"\byou'?(re| are) better off dead\b",
            r"\b(kill|hang) yourself\b",
            r"\bthe world would be better (off )?without you\b",
            r"\bwhy do ?n'?t you (just )?(end it|disappear|die)\b",
        )
    ),
}

#: Categories this module can say anything about at all. Exposed so /health can
#: report which unmeasured categories have a stand-in and which have nothing.
COVERED = frozenset(_RULES)


def score(text: str, categories: Iterable[Category]) -> dict[Category, float]:
    """Score only the categories the caller says are unmeasured.

    Passing the set in, rather than reading policy here, is what makes these
    rules self-retiring: once a category has a calibrated threshold it stops
    appearing in the argument and these patterns stop being consulted, with no
    edit to this file.
    """
    wanted = set(categories) & COVERED
    return {
        c: _SCORE
        for c in wanted
        if any(pattern.search(text) for pattern in _RULES[c])
    }
