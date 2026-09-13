# WS-3 Data Lab evidence

This directory contains the deterministic, public-safe 110-row dataset and the
exact Nebius Data Lab upload request prepared from the committed 55-evaluation
Placebo result. The request is reviewable without credentials or network access.

Preparation is non-mutating and does not contact Nebius:

```bash
pnpm --filter @sutura/evaluation build
node scripts/datalab-experiment.mjs prepare --source docs/demo/placebo-v0.2-live-2026-09.json --dataset-output docs/datalab/sutura-placebo-v0.2-live-data-lab-v1.jsonl --request-output docs/datalab/sutura-placebo-v0.2-live-dataset-request-v1.json
```

Upload, batch inference, participant contact, and Marketplace publication remain
separate authorization gates in the WS-3 implementation plan. Never add a
Nebius API key or an unredacted provider response to this directory.
