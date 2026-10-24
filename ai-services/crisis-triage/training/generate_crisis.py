"""A2 training candidates: crisis-language examples for clinician review.

    python -m alaap_ai.crisis_triage.training.generate_crisis \
        --band high_euphemism --n 200 --language en \
        --out data/crisis-candidates/high_euphemism.en.jsonl

**These are candidates, not labels, and not an evaluation set.**

Two separate prohibitions apply and they are easy to conflate:

  * The **clinical evaluation set** must be written by clinicians
    (dataset-sourcing.md §7 step 2). Nothing generated here may be used to grade
    A2. If the same source writes the training data and the test, the gate
    measures self-consistency.
  * **Risk banding** is for clinically qualified annotators only (annotation
    guidelines §8). Every record here carries the band its brief was written to
    express, as a *generation intent*, not an assessment. A clinician bands it.

What this is for: the a2 baseline probes fail in specific, measured places, and
those are the places worth generating.

    euphemism      0/9    "i just want to sleep and never wake up"      -> none
    plan           0/3    "im going to end it tonight"                  -> none
    preparation    0/3    "ive been giving away my things"              -> none
    hi-Latn        9/21   every Hinglish high-risk probe missed
    recovery       3/5    negated past ideation escalated to high

A lexicon cannot reach any of that, which is the argument for a trained A2. The
briefs below target those gaps rather than restating what a keyword list already
catches.

**Content limits, absolute and non-negotiable.** Every brief forbids method,
means, lethality, timing detail that could function as instruction, and anything
that presents self-harm as a solution or relief. What is being modelled is the
*register in which distress is disclosed* — the linguistic surface a classifier
must recognise so a person is offered support. That is the whole purpose. Text
that instructs rather than discloses is a generation failure, and
`reject_unsafe()` drops it before it is written.

Negatives matter as much as positives here. Half of A2's measured failures are
over-reads: recovery narratives and prevention discussion escalated to `high`.
Those are generated too, and a corpus without them will rebuild that failure.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

# The A1 generator already solved dedupe, hybrid-reasoning stripping, language
# verification and stall detection. Importing across services is deliberate
# coupling: forking those would mean two copies of the <think>-stripping fix and
# the Hinglish marker set, and they would drift.
from alaap_ai.community_moderation.training.generate import (
    generate_openai_compatible,
    is_expected_language,
    is_near_duplicate,
    _tokens,
)

# The band each brief is written to express. A clinician confirms or changes it;
# it is never treated as a label.
_BANDS: dict[str, str] = {
    "high_explicit": "high",
    "high_euphemism": "high",
    "high_plan": "high",
    "high_preparation": "high",
    "moderate_distress": "moderate",
    "low_distress": "low",
    "negative_recovery": "low",
    "negative_third_party": "low",
    "negative_idiom": "none",
    "negative_discussion": "none",
}

_SHARED_LIMITS = (
    "ABSOLUTE LIMITS, no exceptions: never name or imply a method, means, "
    "substance, quantity, location or lethality. Never present ending one's life "
    "as relief, escape, peace or a solution. Never give any instruction, plan "
    "detail or sequence anyone could follow. You are writing the LANGUAGE in "
    "which people disclose distress so a support system can recognise it, "
    "nothing else. "
)

_BRIEFS: dict[str, str] = {
    "high_explicit": (
        "First-person messages stating active suicidal ideation directly, in the "
        "plain words people actually use in a support community. Vary between "
        "flat statement, exhaustion, and disclosure framed as confession. "
        + _SHARED_LIMITS
    ),
    "high_euphemism": (
        "First-person messages carrying active suicidal ideation WITHOUT any "
        "explicit term. This is the register the current classifier misses "
        "entirely. Use: wanting to sleep and not wake, being tired of fighting, "
        "not seeing a point in waking up, others being better off, not being a "
        "problem much longer, wanting it to stop, feeling finished. "
        "Never use the words suicide, kill, or die — if one appears the example "
        "is useless, because the point is the absence of the keyword. "
        + _SHARED_LIMITS
    ),
    "high_plan": (
        "First-person messages indicating intent with a TIMEFRAME — tonight, "
        "tomorrow, after the weekend, once something is finished. The presence "
        "of a time is the signal. "
        "Never state a method or any step. A timeframe attached to a departure, "
        "not to an action. "
        + _SHARED_LIMITS
    ),
    "high_preparation": (
        "First-person messages showing pre-attempt behaviour that reads as "
        "ordinary or even positive on the surface: giving possessions away, "
        "settling arrangements, thanking people for the years, saying goodbye "
        "without saying goodbye, sudden calm after a long period of distress, "
        "apologising in advance. "
        "These read as gratitude or improvement, which is exactly why they are "
        "missed and why they must be in the corpus. "
        + _SHARED_LIMITS
    ),
    "moderate_distress": (
        "First-person messages showing hopelessness, worthlessness, entrapment or "
        "being a burden, WITHOUT any intent or ideation. The person is suffering "
        "and not planning anything. "
        + _SHARED_LIMITS
    ),
    "low_distress": (
        "First-person messages showing ordinary distress: exhaustion, anxiety, "
        "sleeplessness, loneliness, a hard week. Real difficulty, no risk markers, "
        "no hopelessness. " + _SHARED_LIMITS
    ),
    "negative_recovery": (
        "First-person RECOVERY narratives that reference a past period of "
        "suicidal feeling and make unmistakably clear it has passed. 'I used to "
        "feel that way, I don't now.' 'Years ago I didn't want to be here; today "
        "I'm glad I stayed.' "
        "The past-tense ideation must be present in the text — that is the whole "
        "point, because the classifier currently escalates these. The message "
        "must be clearly resolved and safe. "
        "These are the most protected posts on the platform and moderating or "
        "escalating one is the worst thing this system can do. " + _SHARED_LIMITS
    ),
    "negative_third_party": (
        "Messages from someone WORRIED ABOUT ANOTHER PERSON — a friend, sibling, "
        "partner — who has said something frightening, and asking how to help. "
        "The author is not at risk. Their concern is. " + _SHARED_LIMITS
    ),
    "negative_idiom": (
        "Ordinary messages using death or self-harm vocabulary IDIOMATICALLY, "
        "with no distress at all: dying of boredom, a deadline killing someone, "
        "dying of embarrassment, 'kill me now' about a meeting. Light in tone. "
        "The risk word must be present and must mean nothing. " + _SHARED_LIMITS
    ),
    "negative_discussion": (
        "Messages DISCUSSING suicide prevention, mental health research, a "
        "helpline, a campaign, or a class — as a topic, not a disclosure. Sharing "
        "a resource, describing coursework, recommending an article. "
        "Escalating these teaches people that circulating help triggers an "
        "intervention, which stops them circulating help. " + _SHARED_LIMITS
    ),
}

# Generation failures that must never reach a reviewer, let alone a corpus.
# A brief can be ignored; this cannot.
_UNSAFE = re.compile(
    r"\b(overdose|hang(ing|ed)?|noose|rope|jump(ing)? (off|from)|bridge|"
    r"slit|cut(ting)? my (wrist|arm)|bleed out|pills? (and|with)|"
    r"how (much|many) (do|would|will) it take|lethal|fatal dose|"
    r"carbon monoxide|firearm|gun|blade|razor)\b", re.I)


def reject_unsafe(text: str) -> bool:
    """True when a candidate names a method or means, whatever the brief said."""
    return bool(_UNSAFE.search(text))


def build_prompt(band: str, shots: list[str], n: int, lang_name: str) -> str:
    examples = "\n".join(f"- {s}" for s in shots) if shots else "(none yet)"
    reinforce = ""
    if lang_name != "English":
        reinforce = (
            "\nThe examples above may be English. Do NOT copy their language. "
            "Every message must be romanised Hinglish as typed on a phone — Hindi "
            "function words (main, mujhe, nahi, ab, bahut, kuch, hai) carrying "
            "English content words. Latin script only, never Devanagari.\n"
        )
    return (
        f"Write {n} distinct messages in {lang_name}, as posted to an anonymous "
        f"mental wellness support community.\n\n"
        f"KIND: {band}\n{_BRIEFS[band]}\n\n"
        f"Existing examples — match the realism, do NOT reuse the phrasing:\n"
        f"{examples}\n{reinforce}\n"
        f"{n} new messages, one per line:"
    )


def load_shots(path: Path | None, band: str, language: str) -> list[str]:
    """Few-shot examples: the probe set, which is the only A2 text we have."""
    if path is None or not path.exists():
        return []
    want = _BANDS[band]
    out = []
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            probe = json.loads(line)
            band_of = probe.get("expect_min") or probe.get("expect_max")
            if band_of == want and probe.get("language") == language:
                out.append(probe["text"])
    return out


def main() -> int:
    here = Path(__file__).resolve().parents[2] / "evaluation"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--band", required=True, choices=sorted(_BRIEFS))
    parser.add_argument("--n", type=int, default=150)
    parser.add_argument("--language", default="en", choices=["en", "hi-Latn"])
    parser.add_argument("--batch", type=int, default=20)
    parser.add_argument("--max-attempts", type=int, default=40)
    parser.add_argument("--shots-from", type=Path,
                        default=here / "probes" / "crisis.jsonl")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--base-url", default="http://localhost:11434/v1")
    parser.add_argument("--model", default="qwen3:8b")
    args = parser.parse_args()

    lang_name = {"en": "English",
                 "hi-Latn": "Hinglish (romanised Hindi mixed with English)"}[args.language]
    shots = load_shots(args.shots_from, args.band, args.language)

    seen: list[set[str]] = []
    kept: list[dict] = []
    attempts = unsafe = off_language = 0

    while len(kept) < args.n and attempts < args.max_attempts:
        attempts += 1
        prompt = build_prompt(args.band, shots[:6], args.batch, lang_name)
        for line in generate_openai_compatible(prompt, args.base_url, args.model):
            if len(line) < 15 or len(line) > 400:
                continue
            if reject_unsafe(line):
                unsafe += 1
                continue
            if not is_expected_language(line, args.language):
                off_language += 1
                continue
            if is_near_duplicate(line, seen):
                continue
            seen.append(_tokens(line))
            kept.append({
                "id": f"gen-crisis-{args.band}-{args.language}-{len(kept) + 1:04d}",
                "text": line,
                # Generation intent, NOT an assessment. A clinician bands this.
                "proposed_band": _BANDS[args.band],
                "band": None,
                "source": "synthetic",
                "language": args.language,
                "adjudicated": False,
            })
            if len(kept) >= args.n:
                break

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8", newline="\n") as fh:
        for row in kept:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")

    print(f"\n  {len(kept)} candidates -> {args.out}")
    print(f"  {attempts} request(s)")
    if unsafe:
        print(f"  {unsafe} discarded for naming a method or means")
    if off_language:
        print(f"  {off_language} discarded as not {args.language}")
    print("\n  `band` is null on every record. These are candidates for a\n"
          "  clinically qualified annotator to band (guidelines §8), and may\n"
          "  not be used to evaluate A2 (dataset-sourcing.md §7 step 2).\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
