"""B1 — the AI supportive response.

One reply to every post, so nobody who writes here at 3am finds their words sitting
alone in the morning. Asynchronous by contract: the post publishes immediately and this
arrives afterwards, like a peer's reply rather than a bot answering in the same breath.

THREE GATES, AND THEY CATCH DIFFERENT THINGS

    1. the prompt        a request. Weak on its own - a prompt is a request and a
                         fine-tune is a habit, and B1 is not yet a fine-tune.
    2. `forbidden`       rules checked against what the model actually produced.
                         Diagnosis, prescription, claims about risk, false promises.
                         A1 was never trained to catch these: a confident clinical
                         claim is not abuse and no moderation category fires on it.
    3. A1               the safety classifier, run over the model's own output.
                         ADR-0001: "A1 must moderate the AI's own output as well as
                         the users'."

A response that fails any of them is DISCARDED, not repaired. A reply that had to be
edited is not one to put in front of somebody in distress, and the post is left to its
peers - which is the normal case anyway, and a better one.
"""

from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

import yaml

_DEFAULT_PROMPT = (
    Path(__file__).resolve().parents[3] / "metadata" / "ai" / "supportive-response" / "prompt.v1.yaml"
)


@dataclass(frozen=True)
class ForbiddenRule:
    id: str
    reason: str
    patterns: tuple[re.Pattern[str], ...]


@dataclass(frozen=True)
class Policy:
    model: str
    think: bool
    temperature: float
    max_tokens: int
    system_prompt: str
    forbidden: tuple[ForbiddenRule, ...]
    min_characters: int
    max_characters: int
    max_question_marks: int
    write_comment_on_failure: bool = False


def load_policy(path: Path | None = None) -> Policy:
    raw = yaml.safe_load((path or _DEFAULT_PROMPT).read_text(encoding="utf-8"))

    rules = tuple(
        ForbiddenRule(
            id=rule["id"],
            reason=rule["reason"],
            patterns=tuple(re.compile(p) for p in rule["patterns"]),
        )
        for rule in raw.get("forbidden", [])
    )
    if not rules:
        # An empty list means somebody deleted the enforcement and left the prompt.
        # The prompt alone is a request, and this is the part that is not.
        raise ValueError(
            "supportive-response policy has no `forbidden` rules. The system prompt is "
            "a request; these are the enforcement. Refusing to run without them."
        )

    limits = raw.get("limits", {})
    model = raw["model"]
    return Policy(
        model=model["name"],
        think=bool(model.get("think", False)),
        temperature=float(model.get("temperature", 0.7)),
        max_tokens=int(model.get("max_tokens", 220)),
        system_prompt=raw["system_prompt"],
        forbidden=rules,
        min_characters=int(limits.get("min_characters", 40)),
        max_characters=int(limits.get("max_characters", 900)),
        max_question_marks=int(limits.get("max_question_marks", 2)),
        write_comment_on_failure=bool(raw.get("on_failure", {}).get("write_comment", False)),
    )


@dataclass
class Result:
    """What came back, and why it did or did not survive."""

    ok: bool
    text: str = ""
    # Why it was discarded. Operational detail - never shown to the member, who sees
    # only that no AI reply arrived, which is indistinguishable from a quiet thread.
    refused_by: str = ""
    detail: str = ""
    latency_ms: int = 0
    model: str = ""
    attempts: int = 0
    categories: list[str] = field(default_factory=list)


def _strip_reasoning(text: str) -> str:
    """Remove any <think> block Qwen emits despite think=false.

    Belt and braces. A visible trace of a model deliberating about somebody's distress
    is not something to risk ever reaching them, so it is stripped here as well as
    disabled in the request.
    """
    return re.sub(r"(?is)<think>.*?</think>", "", text).strip()


# Typographic characters the model emits, mapped to the ASCII the rules are written in.
#
# THIS IS A SAFETY FIX, NOT TIDYING.
#
# Qwen writes a curly apostrophe (U+2019), and every `forbidden` pattern spells its
# apostrophes ASCII. Measured: three rules — the two stock openers and part of
# `false_empathy` — matched nothing at all until this existed, and replies that should
# have been discarded were delivered. Nothing failed; the rules just quietly did not
# apply, which is the worst way for a guardrail to be wrong.
_TYPOGRAPHIC = str.maketrans(
    {
        "’": "'",
        "‘": "'",
        "“": '"',
        "”": '"',
        "–": "-",
        "—": "-",
        "…": "...",
        " ": " ",
    }
)


def _clean(text: str) -> str:
    text = _strip_reasoning(text).translate(_TYPOGRAPHIC)
    # Models like to wrap a reply in quotes, or open with a label. Both read as a
    # machine performing a reply rather than writing one.
    text = re.sub(r'^\s*(?:reply|response)\s*:\s*', "", text, flags=re.IGNORECASE)
    text = text.strip().strip('"').strip("'").strip()
    return re.sub(r"\n{3,}", "\n\n", text)


def check_forbidden(text: str, policy: Policy) -> tuple[str, str] | None:
    """The rule the text broke, or None. First match wins; order is not significant."""
    for rule in policy.forbidden:
        for pattern in rule.patterns:
            if pattern.search(text):
                return rule.id, rule.reason
    return None


def check_echo(text: str, post: str, min_run: int = 40) -> str | None:
    """Refuse a reply that hands the post back before answering it.

    Observed in both Hinglish generations of a twelve-post sample: the model repeated
    the post verbatim as its opening sentence, then added one line. That reads as being
    parroted rather than answered, and it is worse than silence for somebody who has
    just written something hard.

    Compared on a normalised copy so punctuation and casing do not hide it. `min_run`
    is deliberately long - a reply SHOULD reuse the person's own words, and the prompt
    asks it to. Echoing forty unbroken characters is not reuse, it is repetition.
    """
    norm = lambda t: " ".join(t.lower().split())
    haystack, needle = norm(post), norm(text)
    if len(needle) < min_run:
        return None
    for size in range(min(len(needle), 200), min_run - 1, -10):
        if needle[:size] in haystack:
            return f"echoes the post back ({size} characters)"
    return None


def check_shape(text: str, policy: Policy) -> str | None:
    if len(text) < policy.min_characters:
        return f"too short ({len(text)} < {policy.min_characters})"
    if len(text) > policy.max_characters:
        return f"too long ({len(text)} > {policy.max_characters})"
    if text.count("?") > policy.max_question_marks:
        # A reply that is all questions puts the work back on somebody who has none left.
        return f"too many questions ({text.count('?')} > {policy.max_question_marks})"
    return None


def _ollama(prompt: str, policy: Policy, host: str, timeout: float) -> str:
    body = json.dumps(
        {
            "model": policy.model,
            "system": policy.system_prompt,
            "prompt": prompt,
            "stream": False,
            "think": policy.think,
            "options": {
                "temperature": policy.temperature,
                "num_predict": policy.max_tokens,
            },
        }
    ).encode("utf-8")

    request = urllib.request.Request(
        f"{host.rstrip('/')}/api/generate",
        data=body,
        headers={"content-type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
        return json.loads(response.read()).get("response", "")


def generate(
    post_body: str,
    policy: Policy,
    *,
    host: str | None = None,
    timeout: float = 90.0,
    attempts: int = 3,
    moderate=None,
) -> Result:
    """Write one reply to `post_body`, or explain why there is none.

    `moderate` is a callable taking the generated text and returning a
    (decision, categories) pair - A1 over the model's own output. It is a parameter
    rather than an import so this module can be tested without loading a checkpoint,
    and so the caller decides which classifier is authoritative.

    Retried on a rule breach, three attempts by default.

    Measured over twelve posts: two attempts delivered 6, three delivered 7, five
    delivered 6. Retrying barely helps, and that is the finding rather than a tuning
    detail - the model's stock phrases are a HABIT, not a sampling accident, and no
    number of samples escapes a habit. It is the measured argument for B1 becoming the
    LoRA the spec calls for instead of a base model with a prompt in front of it.

    Three is where the curve flattens. Past that the service is only arguing with
    itself about somebody's distress.
    """
    host = host or os.getenv("ALAAP_OLLAMA_HOST", "http://127.0.0.1:11434")
    started = time.monotonic()
    last = Result(ok=False, model=policy.model)

    for attempt in range(1, attempts + 1):
        try:
            raw = _ollama(post_body, policy, host, timeout)
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            # No reply is a normal outcome. The post is published, its peers can
            # answer, and nothing about the thread is broken.
            return Result(
                ok=False,
                refused_by="unavailable",
                detail=str(exc),
                latency_ms=int((time.monotonic() - started) * 1000),
                model=policy.model,
                attempts=attempt,
            )

        text = _clean(raw)

        shape = check_shape(text, policy)
        if shape is not None:
            last = Result(ok=False, refused_by="shape", detail=shape, model=policy.model, attempts=attempt)
            continue

        echo = check_echo(text, post_body)
        if echo is not None:
            last = Result(ok=False, refused_by="echo", detail=echo, model=policy.model, attempts=attempt)
            continue

        broke = check_forbidden(text, policy)
        if broke is not None:
            rule_id, reason = broke
            last = Result(
                ok=False, refused_by=rule_id, detail=reason, model=policy.model, attempts=attempt
            )
            continue

        if moderate is not None:
            decision, categories = moderate(text)
            if decision != "allowed":
                # A1 refused the platform's own words. Rare, and worth the same
                # treatment as anyone else's - the point of running it over B1's
                # output is that the rule applies to everybody.
                last = Result(
                    ok=False,
                    refused_by="a1",
                    detail=decision,
                    model=policy.model,
                    attempts=attempt,
                    categories=list(categories),
                )
                continue

        return Result(
            ok=True,
            text=text,
            latency_ms=int((time.monotonic() - started) * 1000),
            model=policy.model,
            attempts=attempt,
        )

    last.latency_ms = int((time.monotonic() - started) * 1000)
    return last
