# Supplied-patch verification in GitHub Actions

The local Action now dispatches `mode: verify` through the execution-backed
shared verifier. This source example does not establish that a released Action
tag contains the feature. Publication remains gated on the quality measurements.

The example assumes the reviewed, bundled Sutura Action is already checked out
in `./sutura-action`. Configure the workflow in a trusted repository branch.
The failed run and source must belong to that repository. Fork sources and
successful runs are refused before fetching source or starting inference.

```yaml
permissions:
  contents: read
  actions: read

steps:
  - name: Verify the supplied patch
    id: verify
    uses: ./sutura-action
    with:
      mode: verify
      github-token: ${{ github.token }}
      run-id: ${{ inputs.failed_run_id }}
      source-sha: ${{ inputs.source_sha }}
      policy-base-sha: ${{ vars.SUTURA_POLICY_BASE_SHA }}
      candidate-diff: ${{ inputs.candidate_diff }}
      failing-command: diagnosed
      nebius-api-key: ${{ secrets.NEBIUS_API_KEY }}
      contree-token: ${{ secrets.CONTREE_TOKEN }}
      contree-project: ${{ secrets.CONTREE_PROJECT }}
```

`candidate-diff` contains the complete unified diff, including its final newline.
Unlike the CLI argument, this Action input contains patch bytes rather than a
filename. The workflow must define the three referenced inputs; only the
operator-controlled repository variable chooses the trusted policy commit.
Both SHA inputs require exactly 40 lowercase hexadecimal characters.

At that policy commit, `.sutura.json` must declare the failing command in
`requiredCommands` and supported verification contracts. `diagnosed` resolves to
the first required command. `required-1` resolves to the second. Missing contracts
cannot produce a verified result: Action verify mode requires qualified,
independent challenges even if legacy heal uses optional challenges.

The Action reads authenticated workflow-run metadata, fetches isolated source
and policy checkouts, freezes the source snapshot and challenge set, and runs the
supplied patch through the full verifier. It writes no repository branch, pull
request, comment or check run. The GitHub Actions artifact service receives
`sutura-verification-<run-id>/verification.json`; the job summary shows the
terminal status and blocking gate. `verification-status` is also a step output.
Any result other than `verified-supplied-patch` fails the step.

Inference and sandbox execution consume the configured shared run budget.
Existing limits apply; selecting verification does not raise them. Configure
credentials only in a trusted workflow and obtain the run's spending approval
before dispatch. This document does not authorize a paid run or workflow publish.
