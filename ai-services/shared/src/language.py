"""Which language was this written in?

Only the distinction the moderation policy actually acts on: English versus
romanised Hindi (Hinglish). Both are Latin script, so script detection is useless
and a full language-ID model is more machinery than one binary decision needs.

Function words are the marker because they survive code-mixing. Our users write
English content words inside Hindi grammar — "meri anxiety bahut bad hai" is
Hinglish by every measure that matters here, and every content word in it is
English.

**Tokens that collide with ordinary English are deliberately excluded**, even
though they are perfectly good Hindi: romanised `the` (past tense), `is`, `us`,
`me`, `do`, `par`, `na`, `ho`, `hi`, `bas`, `band`, `kam` and `log` all occur in
plain English sentences. With them in, "stop the zoloft, it is making you feel
numb" reads as Hinglish on the strength of `the` + `is`.

Two markers are required rather than one, because a single loanword ("bas",
"theek") turns up in English sentences often enough to pass by accident.

This is a policy input, not a linguistic claim. It decides whether a category
that is only trustworthy in one language is allowed to fire, so its errors should
land on the side of routing to a human — see `_LANGUAGE_SCOPE` in
community-moderation/app/config/policy.py.
"""

from __future__ import annotations

import re

HI_LATN_MARKERS = frozenset("""
    hai hain hoga hogi nahi nahin mat karo karna kiya karke karlo
    mein kyun kyunki kyu aap tum tera teri tumhara tumhe mera meri mujhe
    apna apne bhi kya bahut thoda zyada theek thik achha acha bura
    chhod chod chhodo chodo jao raha rahi rahe woh yeh dawa dawai goli
    gharelu ilaj bimari sahab abhi phir matlab samajh nuksan faayda fayda
    khud sirf ghar zarurat baat suno sunna lekin aur haan jyada
    rakho lena dena wale wali bina saath liye kuch koi sab
""".split())

_MIN_MARKERS = 2
_WORD = re.compile(r"[a-z]+")

# Devanagari. The corpus is entirely romanised and the classifier has never seen
# this script, so it is reported separately rather than folded into hi-Latn.
_DEVANAGARI = re.compile(r"[ऀ-ॿ]")


def detect(text: str) -> str:
    """Return `"hi"`, `"hi-Latn"` or `"en"`.

    `"hi"` means Devanagari, which the classifier was never trained on — callers
    should treat it as out of scope for every category rather than as Hinglish.
    """
    if _DEVANAGARI.search(text):
        return "hi"
    words = set(_WORD.findall(text.lower()))
    if len(words & HI_LATN_MARKERS) >= _MIN_MARKERS:
        return "hi-Latn"
    return "en"
