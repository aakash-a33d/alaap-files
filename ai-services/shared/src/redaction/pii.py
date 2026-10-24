"""A3 — personal data leak detection. Rules only, no model.

Two jobs, same code:

  * server side, as the third inline gate before a post is published
  * client side, as the pre-send warning (§14.1), compiled to the browser

Deliberately deterministic. A regex on a phone number is either right or it is not;
it cannot misjudge someone's grief. That property is why the on-device layer ships
rules at MVP and defers a classifier — see docs/ai/ai-requirements.md.

Detects literal identifiers only. Personal data described in prose ("my dad works at
the SBI branch near the station and I live right behind it") is out of reach here and
is the job of the distilled classifier, post-MVP.
"""

from __future__ import annotations

import re

from ..schemas.moderation import PiiFinding, PiiKind

# --------------------------------------------------------------------------
# Verhoeff checksum — Aadhaar numbers carry one, so format alone is not enough.
# Checking it turns "any 12 digits" into "a plausible Aadhaar", which is the
# difference between warning on every order number and warning on real leaks.
# --------------------------------------------------------------------------

_D = (
    (0, 1, 2, 3, 4, 5, 6, 7, 8, 9),
    (1, 2, 3, 4, 0, 6, 7, 8, 9, 5),
    (2, 3, 4, 0, 1, 7, 8, 9, 5, 6),
    (3, 4, 0, 1, 2, 8, 9, 5, 6, 7),
    (4, 0, 1, 2, 3, 9, 5, 6, 7, 8),
    (5, 9, 8, 7, 6, 0, 4, 3, 2, 1),
    (6, 5, 9, 8, 7, 1, 0, 4, 3, 2),
    (7, 6, 5, 9, 8, 2, 1, 0, 4, 3),
    (8, 7, 6, 5, 9, 3, 2, 1, 0, 4),
    (9, 8, 7, 6, 5, 4, 3, 2, 1, 0),
)

_P = (
    (0, 1, 2, 3, 4, 5, 6, 7, 8, 9),
    (1, 5, 7, 6, 2, 8, 3, 0, 9, 4),
    (5, 8, 0, 3, 7, 9, 6, 1, 4, 2),
    (8, 9, 1, 6, 0, 4, 3, 5, 2, 7),
    (9, 4, 5, 3, 1, 2, 6, 8, 7, 0),
    (4, 2, 8, 6, 5, 7, 3, 9, 0, 1),
    (2, 7, 9, 3, 8, 0, 6, 4, 1, 5),
    (7, 0, 4, 6, 9, 1, 3, 2, 5, 8),
)


def verhoeff_valid(digits: str) -> bool:
    """True when `digits` satisfies the Verhoeff check."""
    c = 0
    for i, ch in enumerate(reversed(digits)):
        if not ch.isdigit():
            return False
        c = _D[c][_P[i % 8][int(ch)]]
    return c == 0


def is_aadhaar(candidate: str) -> bool:
    """A 12-digit UIDAI number: no leading 0 or 1, and a valid Verhoeff check."""
    digits = re.sub(r"\D", "", candidate)
    if len(digits) != 12 or digits[0] in "01":
        return False
    return verhoeff_valid(digits)


# --------------------------------------------------------------------------
# Patterns
# --------------------------------------------------------------------------

_PATTERNS: list[tuple[PiiKind, re.Pattern[str]]] = [
    # Indian mobile: optional +91/0 prefix, then 6-9 followed by nine digits.
    # Separators allowed because people type "98765 43210".
    (
        PiiKind.PHONE,
        re.compile(r"(?<!\d)(?:\+?91[-.\s]?|0)?[6-9]\d{4}[-.\s]?\d{5}(?!\d)"),
    ),
    (
        PiiKind.EMAIL,
        re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"),
    ),
    # UPI VPA. The lookahead must be bounded to the handle run: an unbounded
    # `(?!.*\.)` also fails on the full stop ending the sentence, so every UPI id
    # in ordinary prose went undetected.
    (
        PiiKind.UPI_VPA,
        re.compile(r"\b[A-Za-z0-9._-]{2,}@(?![A-Za-z0-9-]*\.)[A-Za-z]{2,}\b"),
    ),
    (
        PiiKind.URL,
        re.compile(r"\b(?:https?://|www\.)[^\s<>\"']+", re.IGNORECASE),
    ),
    # PAN: five letters, four digits, one letter.
    (PiiKind.PAN, re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b")),
    # Aadhaar candidates; the checksum filters them below.
    (PiiKind.AADHAAR, re.compile(r"(?<!\d)\d{4}[-\s]?\d{4}[-\s]?\d{4}(?!\d)")),
]


def detect(text: str) -> list[PiiFinding]:
    """Find literal personal identifiers in `text`.

    Overlaps are resolved by preferring the earlier match, then the longer one, so a
    string matching both email and UPI patterns is reported once.
    """
    found: list[PiiFinding] = []

    for kind, pattern in _PATTERNS:
        for m in pattern.finditer(text):
            matched = m.group(0)
            if kind is PiiKind.AADHAAR and not is_aadhaar(matched):
                continue
            found.append(
                PiiFinding(kind=kind, start=m.start(), end=m.end(), text=matched)
            )

    found.sort(key=lambda f: (f.start, -(f.end - f.start)))

    deduped: list[PiiFinding] = []
    claimed_until = -1
    for f in found:
        if f.start >= claimed_until:
            deduped.append(f)
            claimed_until = f.end
    return deduped


def redact(text: str, findings: list[PiiFinding] | None = None) -> str:
    """Replace findings with their kind, for safe display in logs and reviews.

    A moderator reviewing a report sees `[phone]`, not the number. Nothing that
    reaches a log or a review queue should carry the identifier itself.
    """
    findings = detect(text) if findings is None else findings
    out, cursor = [], 0
    for f in sorted(findings, key=lambda x: x.start):
        out.append(text[cursor : f.start])
        out.append(f"[{f.kind.value}]")
        cursor = f.end
    out.append(text[cursor:])
    return "".join(out)
