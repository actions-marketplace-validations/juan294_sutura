# Typed observation provider preflight

Status: local protocol controls pass for JavaScript, erasable TypeScript, Python synchronous/asynchronous callables and JSON properties; no provider run authorized or executed for the verified repair program. Phase 10 performs this preflight before any dependent live acceptance. Existing provider captures establish only their historical contracts.

The selected boundary is the existing executor's snapshot and run interface: fixed controller commands receive typed invocation inputs and emit an untrusted bounded JSON observation. The controller derives expectations from operator-trusted declarations and compares returned values outside the candidate sandbox. A provider does not supply a protected mount or authenticated assertion API. Passing these sampled observations does not establish universal correctness or exclude test-aware implementations.

The local TypeScript proof uses Node's type stripping; syntax requiring transformation, such as enums, is unsupported. Python loads a standalone file under isolated mode; package-relative and sibling-module imports are not currently supported. Unsupported imports or syntax yield insufficient observations. These local results do not establish compatibility with a provider image. The executor currently returns an image identifier rather than a verified digest; accepted v1 evidence still requires the exact digest to be established separately.

Before dispatch, generate a finite manifest from the implemented adapters and actual configuration containing:

- Exact controller/source commit, source snapshot SHA-256, complete control diff hashes, trusted policy commit and policy SHA-256.
- Exact available Node and Python image digests, requested and returned model IDs where inference is used, adapter/schema revisions, commands and fixture hashes.
- Selected subjects, repetitions, maximum operations, per-command timeout, total wall-time cap, concurrency, output-byte caps and stop procedure.
- Priced inference maximum with source/date and a separately approved provider spend cap or finite raw sandbox-unit cap; unconfirmed sandbox units cannot be converted to USD.
- Explicit authorization for this manifest. The plan's current authorized remote budget is zero.

Execute these controls in order, with two fresh branches per repeated subject:

| Surface | Positive observation | Negative/control observation |
| --- | --- | --- |
| Node JavaScript | Named exported callable returns a bounded JSON scalar/array/object | Missing export, import failure, thrown error, unsupported/nonfinite value |
| Node TypeScript | Exact supported typed exported callable on the recorded image | Unsupported syntax or missing TypeScript support yields insufficient evidence |
| Python synchronous | Named callable returns a JSON-compatible value | Import error, invalid return type, nonzero process exit |
| Python asynchronous | Awaited coroutine produces its resolved typed value | Unawaited/failed coroutine cannot count as a passing assertion |
| JSON property | Trusted baseline file/property returns the exact declared Boolean/value | Invalid JSON, absent property, symlink target, oversized data |
| Protocol | One bounded envelope, zero exit and nontruncated output | Forged approval fields, duplicate/malformed/oversized output, missing envelope |
| Isolation | Same source and input yield independently observed outputs from fresh branches | First repetition mutates local state; second must start from the original parent |
| Packaging | Public contract declarations remain available as specifications | Raw Git objects, hidden evaluator values and controller tables absent; aliases rejected |

Stop on a failing positive control, an accepted malformed/forged observation, unexpected returned identity, insufficient capacity, or any cap. Cancel only operations started by this manifest, collect terminal cancellation evidence, and account for errors and cleanup. Do not retry or expand the manifest automatically. Preserve sanitized raw responses and request hashes as captured fixtures, then review locally before starting the development smoke.

Record actual operation IDs, source/image identities, stdout/stderr truncation flags, exit codes, resource units, elapsed time and item-level controller outcomes. Integrity hashes cover stored timing; normalization hashes are separately labeled comparison identities. A prepared recipe, mocked upload or local process test is not provider acceptance.
