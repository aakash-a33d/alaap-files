"""Classifier interfaces.

Everything downstream depends on these protocols rather than on a concrete model, so
the pipeline can be built, tested and evaluated before a single fine-tuned weight
exists. Swapping the baseline for the real MuRIL checkpoint is then a config change,
not a rewrite.

This is the ordering that matters: the evaluation harness has to exist *before*
fine-tuning starts, or there is no way to tell whether fine-tuning helped.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from ..schemas.moderation import Category, RiskLevel


@runtime_checkable
class SafetyClassifier(Protocol):
    """A1 — multi-label scoring over the sixteen moderation categories."""

    model_id: str

    def score(self, text: str) -> dict[Category, float]:
        """Return a score in [0, 1] for every category. Never a decision."""
        ...


@runtime_checkable
class CrisisClassifier(Protocol):
    """A2 — single-label risk banding, governed separately from A1."""

    model_id: str

    def score(self, text: str) -> tuple[RiskLevel, float]:
        ...


class ModelUnavailable(RuntimeError):
    """Raised when a configured backend cannot be loaded.

    Never swallowed into a default-allow. An inline gate that cannot run must fail
    the request, because publishing unmoderated content is the worse outcome.
    """
