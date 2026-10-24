"""Build a batch for a contracted annotation vendor.

Real platform content leaving our infrastructure is the highest-risk operation
in the whole AI programme, so this script is written to refuse rather than to
help. Four gates, and every one of them fails closed:

  1. CONSENT      Every record must carry `model_improvement_consent: true`.
                  A record without it is dropped, not warned about. Consent is
                  the `model-improvement` purpose: explicit, withdrawable,
                  default off, and no service degradation for declining.

  2. DE-IDENTIFY  Every record passes the A3 detector and is redacted. Phone
                  numbers, emails, Aadhaar, UPI ids and URLs become `[phone]`,
                  `[email]` and so on. Handles and pseudo ids never leave.

  3. UNLINK       Vendor item ids are random. The mapping back to the platform
                  record stays here, in the key file, which is never shipped.
                  A vendor that loses a batch has lost redacted text with no
                  route back to a person.

  4. GOLD         Every batch is salted with pre-adjudicated items. The vendor
                  is not told which. Their answers on those are the only
                  objective measure of whether the batch is worth paying for.

Usage:

    python -m alaap_ai.community_moderation.training.export_for_annotation \
        --content data/consented-content.jsonl \
        --gold data/synthetic-seed.v1.jsonl \
        --out-batch out/batch-001.jsonl \
        --out-key out/batch-001.key.jsonl

`out-batch` goes to the vendor. `out-key` never does.
"""

from __future__ import annotations

import argparse
import json
import random
import secrets
from pathlib import Path

from alaap_ai.shared.redaction import pii

from . import dataset as ds

# Fields that must never appear in an exported record, whatever the caller sent.
_FORBIDDEN = {
    "handle",
    "public_handle",
    "pseudo_id",
    "account_id",
    "author",
    "author_pseudo_id",
    "email",
    "phone",
    "user",
    "user_id",
    "ip",
}


class ExportRefused(RuntimeError):
    """Raised when the batch cannot be built safely. Never downgraded to a warning."""


def redact(text: str) -> tuple[str, list[str]]:
    findings = pii.detect(text)
    return pii.redact(text, findings), sorted({f.kind.value for f in findings})


def load_consented(path: Path) -> list[dict]:
    """Read platform content, keeping only what may lawfully leave.

    In deployment this is a call to community-service under the
    `model-improvement` purpose, and the consent check happens there. Reading a
    file is the prototype stand-in — the gate below is the same either way.
    """
    kept: list[dict] = []
    dropped_no_consent = 0
    total = 0

    with path.open(encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            total += 1
            row = json.loads(line)

            if row.get("model_improvement_consent") is not True:
                dropped_no_consent += 1
                continue

            leaked = _FORBIDDEN & row.keys()
            if leaked:
                raise ExportRefused(
                    f"record {row.get('ref', '?')} carries identifying fields "
                    f"{sorted(leaked)}. Fix the query that produced this file; do not "
                    f"strip them here, because the next caller will forget."
                )

            kept.append(row)

    print(f"  {total} records read")
    print(f"  {dropped_no_consent} dropped: no model-improvement consent")
    print(f"  {len(kept)} eligible")

    if total and not kept:
        raise ExportRefused(
            "nothing in this file carries consent. An empty batch is the correct "
            "outcome, not an error to work around."
        )
    return kept


def build(
    content: list[dict],
    gold: list[ds.Record],
    gold_ratio: float,
    rng: random.Random,
) -> tuple[list[dict], list[dict]]:
    """Return (batch for the vendor, key kept in-house)."""
    n_gold = max(1, round(len(content) * gold_ratio))
    salt = rng.sample(gold, min(n_gold, len(gold)))

    batch: list[dict] = []
    key: list[dict] = []

    for row in content:
        text, kinds = redact(row["text"])
        item_id = f"itm-{secrets.token_hex(8)}"
        batch.append({
            "item_id": item_id,
            "text": text,
            "surface": row.get("surface", "post"),
            "language": row.get("language", "en"),
        })
        key.append({
            "item_id": item_id,
            "platform_ref": row["ref"],
            "gold": False,
            "redacted_kinds": kinds,
        })

    for record in salt:
        text, _ = redact(record.text)
        item_id = f"itm-{secrets.token_hex(8)}"
        batch.append({
            "item_id": item_id,
            "text": text,
            "surface": "post",
            "language": record.language,
        })
        key.append({
            "item_id": item_id,
            "platform_ref": None,
            "gold": True,
            # The adjudicated answer. This is what the vendor is scored against
            # and the reason the key never ships.
            "expected_labels": sorted(record.labels),
        })

    rng.shuffle(batch)
    return batch, key


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--content", type=Path, required=True)
    p.add_argument("--gold", type=Path, required=True,
                   help="adjudicated corpus to salt the batch from")
    p.add_argument("--out-batch", type=Path, required=True)
    p.add_argument("--out-key", type=Path, required=True)
    p.add_argument("--gold-ratio", type=float, default=0.08,
                   help="share of the batch that is pre-adjudicated")
    p.add_argument("--seed", type=int, default=20260902)
    args = p.parse_args()

    rng = random.Random(args.seed)

    content = load_consented(args.content)
    gold = [r for r in ds.load(args.gold) if r.adjudicated] or ds.load(args.gold)

    batch, key = build(content, gold, args.gold_ratio, rng)

    for path, rows in ((args.out_batch, batch), (args.out_key, key)):
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8", newline="\n") as fh:
            for row in rows:
                fh.write(json.dumps(row, ensure_ascii=False) + "\n")

    n_gold = sum(1 for k in key if k["gold"])
    redacted = sum(1 for k in key if k.get("redacted_kinds"))

    print(f"\n  batch : {len(batch)} items -> {args.out_batch}")
    print(f"          {n_gold} gold ({n_gold / len(batch):.0%}), unmarked and shuffled in")
    print(f"          {redacted} items had identifiers redacted")
    print(f"  key   : {args.out_key}")
    print("\n  The key does not go to the vendor. It is the only route from an item")
    print("  id back to a person, and the only record of the gold answers.\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
