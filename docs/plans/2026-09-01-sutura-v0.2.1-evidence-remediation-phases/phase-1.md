# Phase 1: Restore Python runtime and fail-early image proof

Status: Implemented locally; live ConTree proof pending

## Goal

Restore the Python runtime through ConTree while binding its versioned import tag to verified registry digests before every release canary.

## Work

1. Resolve the one permitted versioned tag and require its exact OCI index and Linux amd64 manifest digests.
2. Import the candidate image through the same ConTree boundary used by repair execution.
3. On a network-disabled child, prove Python, `uv`, Git, and tar versions and execute the Python fixture preparation contract.
4. Store the exact tag, index digest, and Linux amd64 manifest digest in runtime constants and update the Action bundle.
5. Add the image proof to provider/ConTree canary evidence and to the release gate.
6. Add captured failure tests for a deleted digest, wrong tools, mutable tag, and runtime mismatch.

## Automated success criteria

- The exact old digest reproduces the captured unavailable-image failure offline.
- Any tag other than the one permitted versioned tag fails before import, and registry digest drift fails before repair inference.
- The selected exact digest passes tool, lockfile, preparation, and network-isolation tests.
- Python repair and refusal fixtures pass locally through the real runtime adapter.
- `pnpm run test:release-contracts`, typecheck, lint, build, and bundle verification pass.

## Manual success criteria

- Review the registry source, image provenance, and exact digest.
- Confirm the canary artifact contains no credential or registry authorization value.

Stop after the phase is integrated into local `develop` and its task worktree is removed.
