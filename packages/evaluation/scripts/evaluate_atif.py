"""Run NVIDIA's EvaluationHarness over recorded Sutura trajectories.

The harness and the evaluator protocol come from `nvidia-nat-eval` at the
pinned NeMo Agent Toolkit revision. The evaluators here are deterministic and
need no provider: they read what a recorded trajectory actually contains.
Nemotron and Data Lab judgements are later compared against these outcomes
rather than defining truth themselves.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

from nat.atif import ATIFTrajectory
from nat.plugins.eval.data_models.evaluator_io import EvalOutput, EvalOutputItem
from nat.plugins.eval.evaluator.atif_evaluator import AtifEvalSample, AtifEvalSampleList
from nat.plugins.eval.runtime.eval_harness import EvaluationHarness

MAX_TRAJECTORY_BYTES = 4 * 1024 * 1024

# Sutura event types a complete recorded run reports, in controller order.
REQUIRED_EVENTS = ("run-start", "candidate-submitted", "audit-result", "run-finish")


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _steps(trajectory: ATIFTrajectory) -> list[Any]:
    return list(getattr(trajectory, "steps", None) or [])


def _sutura_extra(step: Any) -> dict[str, Any]:
    extra = getattr(step, "extra", None) or {}
    if not isinstance(extra, dict):
        return {}
    sutura = extra.get("sutura")
    return sutura if isinstance(sutura, dict) else {}


def _event_types(trajectory: ATIFTrajectory) -> set[str]:
    return {
        str(event)
        for step in _steps(trajectory)
        if (event := _sutura_extra(step).get("event_type")) is not None
    }


class GateCoverageEvaluator:
    """Scores how many of the required run events a trajectory actually recorded."""

    name = "gate_coverage"

    async def evaluate_atif_fn(self, atif_samples: AtifEvalSampleList) -> EvalOutput:
        items: list[EvalOutputItem] = []
        for sample in atif_samples:
            present = _event_types(sample.trajectory)
            covered = [event for event in REQUIRED_EVENTS if event in present]
            missing = [event for event in REQUIRED_EVENTS if event not in present]
            items.append(
                EvalOutputItem(
                    id=sample.item_id,
                    score=len(covered) / len(REQUIRED_EVENTS),
                    reasoning={"covered": covered, "missing": missing},
                )
            )
        return EvalOutput(average_score=_average(items), eval_output_items=items)


class OutcomeAgreementEvaluator:
    """Compares the recorded outcome with evaluator-only expected truth.

    A sample with no declared truth scores nothing and says so. An unknown
    expectation must not be counted as agreement.
    """

    name = "outcome_agreement"

    async def evaluate_atif_fn(self, atif_samples: AtifEvalSampleList) -> EvalOutput:
        items: list[EvalOutputItem] = []
        for sample in atif_samples:
            expected = sample.expected_output_obj
            observed = sample.output_obj
            if expected is None:
                items.append(
                    EvalOutputItem(
                        id=sample.item_id,
                        score=float("nan"),
                        reasoning={"status": "unknown-truth"},
                        error="no evaluator-only expected outcome was supplied",
                    )
                )
                continue
            agreed = expected == observed
            items.append(
                EvalOutputItem(
                    id=sample.item_id,
                    score=1.0 if agreed else 0.0,
                    reasoning={"expected": expected, "observed": observed, "agreed": agreed},
                )
            )
        return EvalOutput(average_score=_average(items), eval_output_items=items)


class ResourceAccountingEvaluator:
    """Checks that a trajectory accounts for the operations it claims to have run."""

    name = "resource_accounting"

    async def evaluate_atif_fn(self, atif_samples: AtifEvalSampleList) -> EvalOutput:
        items: list[EvalOutputItem] = []
        for sample in atif_samples:
            steps = _steps(sample.trajectory)
            timed = [step for step in steps if getattr(step, "timestamp", None) is not None]
            sequenced = [step for step in steps if _sutura_extra(step).get("sequence") is not None]
            items.append(
                EvalOutputItem(
                    id=sample.item_id,
                    score=(len(timed) / len(steps)) if steps else 0.0,
                    reasoning={"steps": len(steps), "timed": len(timed), "sequenced": len(sequenced)},
                )
            )
        return EvalOutput(average_score=_average(items), eval_output_items=items)


def _average(items: list[EvalOutputItem]) -> float:
    scores = [
        float(item.score)
        for item in items
        if isinstance(item.score, (int, float)) and float(item.score) == float(item.score)
    ]
    return sum(scores) / len(scores) if scores else float("nan")


def _load(path: Path) -> tuple[ATIFTrajectory, str]:
    raw = path.read_bytes()
    if len(raw) > MAX_TRAJECTORY_BYTES:
        raise SystemExit(f"{path} exceeds {MAX_TRAJECTORY_BYTES} bytes")
    text = raw.decode("utf-8")
    return ATIFTrajectory.model_validate_json(text), _digest(text)


def _samples(paths: list[Path], manifest: dict[str, Any]) -> tuple[list[AtifEvalSample], list[str]]:
    samples: list[AtifEvalSample] = []
    hashes: list[str] = []
    for path in paths:
        trajectory, trajectory_hash = _load(path)
        declared = manifest.get(path.name, {})
        samples.append(
            AtifEvalSample(
                item_id=path.name,
                trajectory=trajectory,
                expected_output_obj=declared.get("expectedOutcome"),
                output_obj=declared.get("observedOutcome"),
                metadata={"trajectoryHash": trajectory_hash},
            )
        )
        hashes.append(trajectory_hash)
    return samples, hashes


async def _run(paths: list[Path], manifest: dict[str, Any]) -> dict[str, Any]:
    samples, hashes = _samples(paths, manifest)
    evaluators = {
        GateCoverageEvaluator.name: GateCoverageEvaluator(),
        OutcomeAgreementEvaluator.name: OutcomeAgreementEvaluator(),
        ResourceAccountingEvaluator.name: ResourceAccountingEvaluator(),
    }
    outputs = await EvaluationHarness().evaluate(evaluators, samples)

    missing = sorted(set(evaluators) - set(outputs))
    if missing:
        raise SystemExit(f"evaluators produced no terminal result: {', '.join(missing)}")
    for name, output in outputs.items():
        if len(output.eval_output_items) != len(samples):
            raise SystemExit(f"evaluator {name} returned {len(output.eval_output_items)} of {len(samples)} items")

    report = {
        "schemaVersion": "sutura-atif-evaluation-v1",
        "trajectoryHashes": hashes,
        "samples": len(samples),
        "evaluators": {
            name: {
                "averageScore": output.average_score,
                "items": [
                    {"id": item.id, "score": item.score, "error": item.error}
                    for item in output.eval_output_items
                ],
            }
            for name, output in sorted(outputs.items())
        },
    }
    report["reportHash"] = _digest(json.dumps(report, sort_keys=True, default=str))
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate recorded ATIF trajectories.")
    parser.add_argument("trajectories", nargs="+", type=Path)
    parser.add_argument("--manifest", type=Path, default=None,
                        help="JSON mapping each file name to its evaluator-only expected outcome.")
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()

    manifest: dict[str, Any] = {}
    if args.manifest is not None:
        manifest = json.loads(args.manifest.read_text(encoding="utf-8"))

    report = asyncio.run(_run(args.trajectories, manifest))
    text = json.dumps(report, indent=2, sort_keys=True, default=str)
    if args.output is not None:
        args.output.write_text(f"{text}\n", encoding="utf-8")
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
