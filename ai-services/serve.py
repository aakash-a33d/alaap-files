"""Run the AI tier locally against a trained checkpoint.

    python ai-services/serve.py

The orchestrator defaults to the lexicon baseline so a fresh clone starts with no
model download (`_safety_from_env`). That default is right for the repository and
wrong for a prototype you want to actually type into, so this script sets the
three variables that swap in a trained model and starts uvicorn on the port the
frontend's `VITE_AI_URL` already points at.

    ALAAP_SAFETY_BACKEND     transformer, not the word list
    ALAAP_SAFETY_CHECKPOINT  which model
    ALAAP_THRESHOLDS         the threshold set calibrated FOR that model

The third is not optional and not cosmetic. `policy.load` refuses a threshold set
whose `model_version` does not match the loaded checkpoint and falls back to
uncalibrated defaults, so pointing at the wrong one silently gives you a
differently-behaved service. `/health` reports which happened.

**What this is not.** In deployment the browser never reaches this tier — it calls
the Privacy Gateway, which calls the AI services over the internal network
(architecture §8.1). `backend/gateway/` is still a scaffold, so for now the
frontend talks here directly, with CORS restricted to dev origins. Anything
learned from this run is about the model, not about the deployed request path.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_REPO = _HERE.parent

# a1-v10 rather than the newest checkpoint. a1-v11 is English-only and passes the
# language-bias gate, but its `passive_aggressive_abuse` recall collapsed to 0.11
# and it scores 12/15 on the probe set. a1-v10 scores 15/15 and keeps that
# category usable at 0.49 recall; its Hinglish disparity is contained by the
# language scope in policy.py rather than by removing the data.
DEFAULT_CHECKPOINT = _HERE / "model-store" / "quantised" / "a1-v10"
DEFAULT_THRESHOLDS = _REPO / "metadata" / "moderation" / "thresholds.v10.yaml"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path, default=DEFAULT_CHECKPOINT)
    parser.add_argument("--thresholds", type=Path, default=DEFAULT_THRESHOLDS)
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--host", default="127.0.0.1",
                        help="loopback by default; this tier is not for a network")
    parser.add_argument("--baseline", action="store_true",
                        help="run the lexicon baseline instead of a checkpoint")
    args = parser.parse_args()

    if not args.baseline:
        if not args.checkpoint.exists():
            print(f"  no checkpoint at {args.checkpoint}\n"
                  f"  train one, or pass --baseline to run the word list.",
                  file=sys.stderr)
            return 1
        if not args.thresholds.exists():
            print(f"  no threshold file at {args.thresholds}", file=sys.stderr)
            return 1
        os.environ["ALAAP_SAFETY_BACKEND"] = "transformer"
        os.environ["ALAAP_SAFETY_CHECKPOINT"] = str(args.checkpoint)
        os.environ["ALAAP_THRESHOLDS"] = str(args.thresholds)
        print(f"\n  model       {args.checkpoint.name}")
        print(f"  thresholds  {args.thresholds.name}")
    else:
        print("\n  lexicon baseline — no checkpoint")

    print(f"  listening   http://{args.host}:{args.port}")
    print(f"  frontend    set VITE_AI_URL if it is not "
          f"http://localhost:{args.port}\n")
    print("  Check /health before trusting a verdict: `thresholds_calibrated`\n"
          "  false means the threshold set did not match the model and every\n"
          "  category is running on a default.\n")

    import uvicorn

    # Imported after the environment is set: the pipeline is constructed at
    # module import, so setting these afterwards would have no effect.
    uvicorn.run("alaap_ai.orchestrator.api.main:app",
                host=args.host, port=args.port, log_level="info")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
