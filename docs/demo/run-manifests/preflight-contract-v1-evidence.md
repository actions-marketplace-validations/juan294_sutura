# preflight-contract-v1 result

Authorized by Juan on 2026-09-06 with a USD 1.00 spend cap. Both preflight checks passed against real services, so the stage 2 development smoke is not blocked by the provider, the image or the probe protocol.

| Check | Result | Evidence |
| --- | --- | --- |
| Provider contract | passed | `docs/demo/provider-contract-canary-3bc2008e357318f2a2419e7989f10a214da3f042.json` |
| Runtime image | passed | `docs/demo/runtime-image-canary-3bc2008e357318f2a2419e7989f10a214da3f042.json` |

Both artifacts are bound to candidate `3bc2008e357318f2a2419e7989f10a214da3f042` and were captured with a clean tree.

## Provider contract

Contract `sutura-super-repair-v5` against `https://api.tokenfactory.nebius.com/v1/chat/completions`. The returned model was `nvidia/nemotron-3-super-120b-a12b`, which is the requested Super model, so the returned identity matches the request. Finish reason `stop`, 393 input and 28 output tokens, 0 reasoning tokens, 1002 ms, request id `5dc295dec61b60b0b59b651bc9507f2f`. The reply produced the expected replacement, hash `a968c8f2bbfa307017a7a4af8f5fe13762891e3fa754fc495b9c1d80a460f073`.

Priced at the manifest's own rates (USD 0.30 input and USD 0.90 output per million), that call cost **USD 0.000143**.

## Runtime image

Image `astral/uv:0.9.30-python3.13-bookworm` imported into a real ConTree sandbox as `16f9b64e-3bdc-302c-b4c8-a194ed5483cd`. Both pinned digests matched: index `sha256:47965cdc9d53a515f68f78241161c901e70051ce428f12e791bd7fe19f6a631a` and linux/amd64 `sha256:35b0aa516fbcf6f18624919cfc38fa02ab3458e0ffcd3c03e932051b37f315db`. The required tools were present at the versions the runtime expects: Python 3.13.11, uv 0.9.30, git 2.39.5, tar 1.34.

## Spend

Measured inference: USD 0.000143. One sandbox image import. Against a priced ceiling of USD 0.118 and an authorized cap of USD 1.00, so the run used 0.12 percent of its ceiling.

Nebius bills sandbox time separately from inference and the raw unit is not confirmed in this artifact, so the sandbox side is recorded as one operation rather than a converted amount. That is the same rule `validateRunEvidence` applies: an unconfirmed unit is reported, never folded into a total.

## What this does not establish

The preflight proves the provider answers under contract and the image is the pinned one. It says nothing about repair quality. Stage 2 (`development-smoke-v1`) is the first stage that decides whether the six known controls behave, and it needs its own authorization.
