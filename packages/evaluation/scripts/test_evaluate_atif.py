"""Installed smoke test for the NeMo EvaluationHarness lane.

This exercises NVIDIA's harness rather than a local stand-in: the evaluators are
dispatched through `EvaluationHarness.evaluate`, and a failure inside one of
them would surface as a missing terminal result.
"""

from __future__ import annotations

import asyncio
import json
import math
import sys
from pathlib import Path

FIXTURES = Path(__file__).parent / "__fixtures__"
sys.path.insert(0, str(Path(__file__).parent))

from evaluate_atif import _run  # noqa: E402


def _report() -> dict:
    manifest = json.loads((FIXTURES / "manifest.json").read_text(encoding="utf-8"))
    paths = [
        FIXTURES / "correct.atif.json",
        FIXTURES / "deceptive.atif.json",
        FIXTURES / "infra-stop.atif.json",
    ]
    return asyncio.run(_run(paths, manifest))


REPORT = _report()


def _scores(evaluator: str) -> dict[str, float]:
    return {
        item["id"].split(".")[0]: item["score"]
        for item in REPORT["evaluators"][evaluator]["items"]
    }


def test_every_requested_evaluator_returned_terminal_items() -> None:
    assert set(REPORT["evaluators"]) == {
        "gate_coverage", "outcome_agreement", "resource_accounting",
    }
    for name, output in REPORT["evaluators"].items():
        assert len(output["items"]) == REPORT["samples"], name


def test_gate_coverage_separates_a_stopped_run_from_a_complete_one() -> None:
    scores = _scores("gate_coverage")
    assert scores["correct"] == 1.0
    assert scores["deceptive"] == 1.0
    # The stopped run never recorded an audit result or a finish.
    assert scores["infra-stop"] < scores["correct"]


def test_outcome_agreement_catches_the_deceptive_run() -> None:
    scores = _scores("outcome_agreement")
    assert scores["correct"] == 1.0
    assert scores["deceptive"] == 0.0
    assert scores["infra-stop"] == 1.0


def test_scores_are_not_identical_across_the_three_trajectories() -> None:
    per_trajectory = {
        name: tuple(_scores(evaluator)[name] for evaluator in sorted(REPORT["evaluators"]))
        for name in ("correct", "deceptive", "infra-stop")
    }
    assert len(set(per_trajectory.values())) == 3, per_trajectory


def test_unknown_truth_is_reported_rather_than_scored() -> None:
    report = asyncio.run(_run([FIXTURES / "correct.atif.json"], {}))
    item = report["evaluators"]["outcome_agreement"]["items"][0]
    assert math.isnan(item["score"])
    assert item["error"] is not None


def test_report_binds_trajectory_hashes_and_its_own_hash() -> None:
    assert len(REPORT["trajectoryHashes"]) == 3
    assert len(set(REPORT["trajectoryHashes"])) == 3
    for digest in REPORT["trajectoryHashes"]:
        assert len(digest) == 64
    assert len(REPORT["reportHash"]) == 64


def test_report_is_reproducible_for_the_same_inputs() -> None:
    assert _report()["reportHash"] == REPORT["reportHash"]


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"ok {name}")
            except AssertionError as error:
                failures += 1
                print(f"FAIL {name}: {error}")
    print(f"{failures} failure(s)")
    sys.exit(1 if failures else 0)
