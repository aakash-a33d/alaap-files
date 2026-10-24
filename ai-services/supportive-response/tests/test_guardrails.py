"""The rules that decide what reaches somebody at their worst.

Tested against the real metadata file, not a fixture. The patterns in that file ARE the
enforcement, and a test against an inline copy would keep passing after somebody
loosened them.

These matter more than the generation does. A model that writes nothing leaves a post
to its peers, which is the normal case and a fine one. A model that writes a diagnosis
has done something the platform cannot take back.
"""

from __future__ import annotations

import pytest

from alaap_ai.supportive_response.generate import (
    Result,
    check_forbidden,
    check_shape,
    generate,
    load_policy,
)

policy = load_policy()


class TestTheFileItself:
    def test_it_loads_with_enforcement(self) -> None:
        assert policy.forbidden, "the prompt is a request; these rules are the enforcement"

    def test_reasoning_is_off(self) -> None:
        # A visible trace of a model deliberating about somebody's distress must never
        # reach them, and disabling it also halves the latency.
        assert policy.think is False

    def test_the_model_tag_is_pinned(self) -> None:
        # A floating tag would change the platform's voice silently.
        assert ":" in policy.model and not policy.model.endswith(":latest")

    def test_every_rule_adr_0001_names_is_present(self) -> None:
        # "must not diagnose, prescribe, or claim certainty about suicide risk"
        ids = {r.id for r in policy.forbidden}
        assert {"diagnosis", "prescription", "risk_certainty"} <= ids


class TestDiagnosis:
    @pytest.mark.parametrize(
        "text",
        [
            "It sounds like you have depression, and that is treatable.",
            "You might have anxiety — a lot of people do.",
            "That sounds like clinical depression to me.",
            "You're depressed, and there is no shame in it.",
        ],
    )
    def test_naming_a_condition_is_refused(self, text: str) -> None:
        assert check_forbidden(text, policy) is not None

    @pytest.mark.parametrize(
        "text",
        [
            "That sounds like an exhausting week, and the not-sleeping part especially.",
            "A lot of what you describe is hard to carry on your own.",
            "You said you have not told anyone. That part stood out.",
        ],
    )
    def test_ordinary_acknowledgement_is_allowed(self, text: str) -> None:
        assert check_forbidden(text, policy) is None


class TestPrescription:
    @pytest.mark.parametrize(
        "text",
        [
            "You should try increasing your medication and see if it helps.",
            "Consider a different antidepressant, they vary a lot.",
            "It might help to stop your meds for a week.",
        ],
    )
    def test_medication_advice_is_refused(self, text: str) -> None:
        assert check_forbidden(text, policy) is not None


class TestRiskCertainty:
    @pytest.mark.parametrize(
        "text",
        [
            "You're not in danger, this is just a rough patch.",
            "You are safe now, the worst is behind you.",
            "You aren't suicidal, you are just tired.",
        ],
    )
    def test_telling_somebody_how_much_danger_they_are_in_is_refused(self, text: str) -> None:
        # Both directions. "You are not suicidal" can be catastrophic and "you are at
        # risk" is a clinical judgement; neither is the model's to make.
        assert check_forbidden(text, policy) is not None


class TestPromisesAndEmpathy:
    @pytest.mark.parametrize(
        "text",
        [
            "It will get better, I promise.",
            "Everything is going to be okay.",
            "You will get through this.",
        ],
    )
    def test_a_promise_nobody_can_keep_is_refused(self, text: str) -> None:
        assert check_forbidden(text, policy) is not None

    @pytest.mark.parametrize(
        "text",
        [
            "I understand how you're feeling right now.",
            "I know what you're going through.",
            "I've been there myself.",
        ],
    )
    def test_claiming_to_feel_it_is_refused(self, text: str) -> None:
        assert check_forbidden(text, policy) is not None

    @pytest.mark.parametrize(
        "text",
        [
            "As someone who's also struggled with this, it does pass.",
            "When I was going through something similar I found it helped to write.",
        ],
    )
    def test_claiming_to_be_a_person_is_refused(self, text: str) -> None:
        # The interface labels this reply as AI. The reply must not contradict the label.
        assert check_forbidden(text, policy) is not None


class TestShape:
    def test_a_stub_is_refused(self) -> None:
        assert check_shape("Sorry.", policy) is not None

    def test_a_lecture_is_refused(self) -> None:
        assert check_shape("word " * 400, policy) is not None

    def test_an_interrogation_is_refused(self) -> None:
        # A reply that is all questions puts the work back on somebody who has none left.
        text = "How long has this been going on? Have you told anyone? What helps? Do you sleep?"
        assert check_shape(text, policy) is not None

    def test_a_normal_reply_passes_both(self) -> None:
        text = (
            "A week of not sleeping properly would wear anyone down, and running out of "
            "ways to describe it sounds like its own kind of tiring. You do not have to "
            "explain it well for it to count."
        )
        assert check_shape(text, policy) is None
        assert check_forbidden(text, policy) is None


class TestGenerationContract:
    def test_an_unreachable_model_is_not_an_error(self) -> None:
        # No reply is a normal outcome. The post is published, its peers can answer,
        # and nothing about the thread is broken.
        result = generate("anything", policy, host="http://127.0.0.1:9", timeout=0.4, attempts=1)
        assert result.ok is False
        assert result.refused_by == "unavailable"

    def test_a1_refusing_the_platforms_own_words_discards_them(self) -> None:
        """ADR-0001: A1 moderates B1's output as well as the members'."""
        calls: list[str] = []

        def always_block(text: str) -> tuple[str, list[str]]:
            calls.append(text)
            return "blocked", ["bullying_harassment"]

        def fake_ollama(*_args, **_kwargs) -> str:
            return "That sounds like a genuinely hard week, and you described it clearly."

        import alaap_ai.supportive_response.generate as module

        original = module._ollama
        module._ollama = fake_ollama  # type: ignore[assignment]
        try:
            result = generate("a post", policy, attempts=2, moderate=always_block)
        finally:
            module._ollama = original  # type: ignore[assignment]

        assert result.ok is False
        assert result.refused_by == "a1"
        assert result.categories == ["bullying_harassment"]
        # Retried once, then given up. A third would be the service arguing with
        # itself about somebody's distress.
        assert len(calls) == 2

    def test_a_clean_response_survives(self) -> None:
        def fake_ollama(*_args, **_kwargs) -> str:
            return '"That sounds exhausting, and the part about not telling anyone stood out."'

        import alaap_ai.supportive_response.generate as module

        original = module._ollama
        module._ollama = fake_ollama  # type: ignore[assignment]
        try:
            result = generate("a post", policy, moderate=lambda _t: ("allowed", []))
        finally:
            module._ollama = original  # type: ignore[assignment]

        assert result.ok is True
        # The surrounding quotes are stripped: a model wrapping its reply in quotes
        # reads as a machine performing a reply rather than writing one.
        assert not result.text.startswith('"')
        assert result.attempts == 1

    def test_a_reasoning_trace_never_survives(self) -> None:
        def fake_ollama(*_args, **_kwargs) -> str:
            return (
                "<think>The user seems distressed. I should be careful not to "
                "diagnose them.</think>"
                "That sounds like a lot to carry through a week on your own."
            )

        import alaap_ai.supportive_response.generate as module

        original = module._ollama
        module._ollama = fake_ollama  # type: ignore[assignment]
        try:
            result = generate("a post", policy, moderate=lambda _t: ("allowed", []))
        finally:
            module._ollama = original  # type: ignore[assignment]

        assert result.ok is True
        assert "<think>" not in result.text
        assert "diagnose" not in result.text
