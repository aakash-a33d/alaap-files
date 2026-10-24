"""A1 — the safety classifier.

Two backends behind one interface:

  HeuristicSafetyClassifier   lexicon baseline. Zero dependencies, deterministic,
                              always available. Runs in CI without a model download.

  TransformerSafetyClassifier the real shape: a fine-tuned MuRIL-large multi-label
                              head. Loaded lazily so importing this module is cheap.

The heuristic is scaffolding, not a product. It exists so the pipeline, the API
contract and the evaluation harness can be built and measured now, and so there is a
baseline number to beat once the fine-tuned model arrives. It must never reach
production: gate on `metadata/ai/model-registry` status, not on this file.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from alaap_ai.shared.inference.base import ModelUnavailable
from alaap_ai.shared.schemas.moderation import Category

# --------------------------------------------------------------------------
# Baseline lexicons.
#
# Indicative only. Real categories are learned, not enumerated — coercion and
# passive aggression in particular live in register and structure, which no word
# list reaches. That gap is the argument for the fine-tuned model, and the
# evaluation harness is what will show its size.
# --------------------------------------------------------------------------

_LEXICON: dict[Category, tuple[str, ...]] = {
    Category.BULLYING_HARASSMENT: (
        "pathetic", "loser", "nobody likes you", "shut up", "worthless",
        "you're useless", "stupid idiot",
    ),
    Category.HATE_SPEECH: (
        "your kind", "you people", "go back to your",
    ),
    Category.THREATS_INTIMIDATION: (
        "i will find you", "you'll regret", "watch your back", "i know where you live",
        "you better", "or else",
    ),
    Category.STALKING_DOXXING: (
        "i found your", "your address is", "i know where you work", "posting your",
    ),
    Category.MANIPULATION_COERCION: (
        "if you really cared", "after everything i've done", "you owe me",
        "you made me", "no one else will", "prove it to me",
    ),
    Category.GROOMING_EXPLOITATION: (
        "don't tell anyone", "our secret", "how old are you", "send me a picture",
        "meet me alone",
    ),
    Category.PASSIVE_AGGRESSIVE_ABUSE: (
        "must be nice", "whatever you say", "i guess some people",
        "not that you'd care", "typical of you",
    ),
    Category.SELF_HARM_ENCOURAGEMENT: (
        "just do it", "no one would miss", "you should end", "nothing left for you",
        "better off without you",
    ),
    Category.UNSAFE_MEDICAL_ADVICE: (
        "stop taking your", "double your dose", "you don't need medication",
        "you don't need those pills", "throw away your pills", "skip your meds",
        "don't listen to your doctor", "instead of taking medicine",
        "instead of medication", "stop your treatment",
    ),
    Category.RELIGIOUS_COERCION: (
        "only god can", "you must pray", "your suffering is punishment",
        "convert and you", "this is god's will for you",
    ),
    Category.SCAMS_FINANCIAL_EXPLOITATION: (
        "send money", "investment opportunity", "guaranteed returns",
        "transfer to my account", "lottery", "processing fee",
    ),
    Category.MALWARE_PHISHING: (
        "click this link", "verify your account", "download this file",
        "claim your prize",
    ),
    Category.SEXUAL_EXPLOITATION: (
        "send nudes", "pictures of yourself",
    ),
    Category.IMPERSONATION: (
        "i am a doctor", "i'm a licensed", "as your therapist", "official support team",
    ),
    Category.EMOTIONAL_DEPENDENCY_PRESSURE: (
        "only i understand you", "you need me", "don't talk to anyone else",
        "i'm the only one",
    ),
    Category.HELP_SEEKING_DISCOURAGEMENT: (
        "keep your issues", "keep your problems", "keep it to yourself",
        "keep them to yourself", "stop airing", "deal with it privately",
        "deal with it yourself", "why are you telling strangers",
        "nobody wants to read", "nobody here cares about your problems",
        "attention seeking", "stop posting about", "don't call any helpline",
        "not share it", "embarrassing to share",
    ),
}

# Distress in the author's own voice must not be scored as harm toward others.
# "I feel worthless" is the product working; "you are worthless" is not.
_FIRST_PERSON = re.compile(
    r"\b(i|i'm|im|i am|me|my|myself|we|us)\b", re.IGNORECASE
)


# The most this baseline will ever emit. Declared once and used both by `score`
# and by `score_ceiling`, because the two drifting apart is precisely how three
# block-tier categories were silently disabled: a threshold of 0.97 against a
# scorer that saturates at 0.95 can never fire, and nothing reported it.
_SATURATION = 0.95


class HeuristicSafetyClassifier:
    model_id = "baseline-lexicon-v0"
    # Which calibrated threshold set applies to these scores: none. This baseline
    # saturates at 0.95 and its scores share no scale with a trained checkpoint's,
    # so policy.load falls back to defaults rather than applying a1-vN thresholds.
    calibrated_for = "baseline-lexicon-v0"
    # Highest score this backend can produce, for threshold-reachability checks.
    score_ceiling = _SATURATION

    @property
    def covered(self) -> set[Category]:
        """Categories this backend can score at all.

        A word list is thin coverage — coercion and passive aggression live in
        register, which no lexicon reaches — but it is honest about which
        categories have any detection behind them and which have none.
        """
        return set(_LEXICON)

    def score(self, text: str) -> dict[Category, float]:
        lowered = text.lower()
        scores: dict[Category, float] = {c: 0.0 for c in Category}

        for category, phrases in _LEXICON.items():
            hits = sum(1 for p in phrases if p in lowered)
            if not hits:
                continue
            # Saturating: three hits is as confident as this baseline gets.
            scores[category] = min(0.45 + 0.25 * hits, _SATURATION)

        self._damp_self_directed(lowered, scores)
        return scores

    @staticmethod
    def _damp_self_directed(lowered: str, scores: dict[Category, float]) -> None:
        """Halve harm-toward-others scores on clearly first-person text.

        Crude, and the fine-tuned model should learn this properly. It is here
        because the failure it prevents — moderating someone for describing their own
        pain — is the single worst false positive this product can produce.
        """
        if not _FIRST_PERSON.search(lowered):
            return
        if re.search(r"\byou\b|\byour\b", lowered):
            return
        # Passive aggression is deliberately excluded. It is very often phrased in
        # the first person precisely to stay deniable — "I guess some people just
        # get everything easy" — so damping it on first-person voice removes the
        # signal instead of the false positive.
        for category in (
            Category.BULLYING_HARASSMENT,
            Category.SELF_HARM_ENCOURAGEMENT,
            Category.THREATS_INTIMIDATION,
        ):
            scores[category] *= 0.5


class TransformerSafetyClassifier:
    """A fine-tuned MuRIL head, loaded from a local checkpoint directory.

    Coverage is read from the model card written by `training/train.py`. A model
    trained with `--only-ready` has a head over some categories and not others,
    and the ones it never saw score 0.0 — but `covered` says which those are, so
    an interface can tell "this model found nothing" apart from "this model
    cannot see that". Conflating the two is how a category silently stops being
    enforced.
    """

    # Sigmoid output, so any threshold below 1.0 is in principle reachable.
    score_ceiling = 1.0

    def __init__(self, checkpoint: str = "google/muril-large-cased") -> None:
        self.model_id = checkpoint
        self._pipe = None
        self._path = Path(checkpoint)
        # The checkpoint directory name is the model version calibrate.py stamps
        # into the threshold file, so `model-store/quantised/a1-v1` answers to
        # `thresholds.v1.yaml` with `model_version: a1-v1` and to nothing else.
        self.calibrated_for = self._path.name
        self.covered: set[Category] = set()
        self.uncovered: set[Category] = set()
        self._read_card(Path(checkpoint))

    def _read_card(self, path: Path) -> None:
        card_path = path / "model_card.json"
        if not card_path.exists():
            # A hub checkpoint or an untrained base: assume it answers for all
            # categories, and let evaluation catch it if it does not.
            self.covered = set(Category)
            return
        card = json.loads(card_path.read_text(encoding="utf-8"))
        self.covered = {Category(c) for c in card.get("covered_categories", [])}
        self.uncovered = set(Category) - self.covered
        self.model_id = f"{card.get('base', self.model_id)} @ {path.name}"

    def _load(self):
        if self._pipe is None:
            try:
                from transformers import pipeline
            except ImportError as exc:  # pragma: no cover
                raise ModelUnavailable(
                    "transformers is not installed; install the 'models' extra"
                ) from exc
            self._pipe = pipeline(
                "text-classification",
                model=str(self._path),
                top_k=None,
                truncation=True,
                max_length=256,
                function_to_apply="sigmoid",   # multi-label: not softmax
            )
        return self._pipe

    def score(self, text: str) -> dict[Category, float]:
        pipe = self._load()
        raw = pipe(text)[0]
        by_label = {r["label"]: float(r["score"]) for r in raw}
        return {c: by_label.get(c.value, 0.0) for c in Category}


def build(backend: str = "heuristic", **kwargs):
    if backend == "heuristic":
        return HeuristicSafetyClassifier()
    if backend == "transformer":
        return TransformerSafetyClassifier(**kwargs)
    raise ModelUnavailable(f"unknown safety backend: {backend!r}")
