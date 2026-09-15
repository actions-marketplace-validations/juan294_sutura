# Phase 1: Release-mode benchmark gate and the v0.3.0 run manifest

Plan: [2026-09-15-case-lab-tracks-latest-release.md](../2026-09-15-case-lab-tracks-latest-release.md)

Status: not started

`[batch-eligible]` with Phase 4 (disjoint files).

## Goal

`pnpm run placebo:live gate|run|streak --release-tag v0.3.0` accepts the tag
commit `c94eee2086b31450d975137a0102dda18522d0b8` as controller and subject,
gates it against `main` instead of `develop`, and dispatches the workflow at
the tag. Develop mode is byte-for-byte unchanged in behaviour. A committed run
manifest binds the v0.3.0 benchmark.

Paid dispatch is **not** part of this phase; nothing here calls `gh workflow
run` outside injected tests.

## Why the gate must change (read before editing)

`gateDogfood` (`scripts/dogfood.mjs:409-486`) was written for dogfooding the
integration branch. Three of its checks encode "candidate is develop HEAD":

- `clean-tree` (`:421-426`): tree clean **and** `HEAD == candidate`.
- `origin-develop` (`:427-431`): `origin/develop == candidate`.
- `develop-ci` (`:432-439`): a `ci.yml` run with `head_branch === 'develop'`.

For a release tag the operator CLI (this repository at `develop`, which
carries this phase) is not the candidate; the candidate is the tag commit on
`main`, and the local checkout cannot be both. In release mode the identity that
matters is proven elsewhere: the workflow checks out the controller at the tag
(`.github/workflows/placebo-live-case.yml:49-54`) and asserts
`GITHUB_SHA == CONTROLLER_SHA` (`:82`), and the manifest binds
`identity.candidateCommit` to the tag commit (`scripts/manifest-spend.mjs:78-81`).

`finalizePlaceboEvidence` stamps `subjectVersion` from the operator's
`RELEASE_VERSION` (`scripts/placebo-live.mjs:554`, `scripts/install-test-lib.mjs:10`),
so release mode must prove that constant equals the tag's version.

## Changes

### 1. `scripts/dogfood.mjs`

```js
// gateDogfood(sha, inputDependencies = {}, options = {})
const branch = options.branch ?? 'develop';
if (branch !== 'develop' && branch !== 'main') throw new Error(`Dogfood gate branch must be develop or main, got ${branch}`);
const releaseVersion = options.releaseVersion;   // 'X.Y.Z' in release mode, undefined otherwise

await check('clean-tree', async () => {
  const status = cleanStatus(await dependencies.git(['status', '--porcelain']));
  if (status) throw new Error(`dirty paths: ${status}`);
  if (branch === 'develop') {
    const head = await dependencies.git(['rev-parse', 'HEAD']);
    if (head !== candidate) throw new Error(`HEAD is ${head}`);
  } else {
    // Release mode: the operator checkout is not the candidate. Prove the one
    // value it stamps into the evidence instead.
    const { RELEASE_VERSION } = await import('./install-test-lib.mjs');
    if (RELEASE_VERSION !== releaseVersion) {
      throw new Error(`scripts/install-test-lib.mjs RELEASE_VERSION is ${RELEASE_VERSION} but the release tag names ${releaseVersion}`);
    }
  }
});
await check(`origin-${branch}`, async () => {
  await dependencies.git(['fetch', 'origin', branch]);
  if (branch === 'develop') {
    const remote = await dependencies.git(['rev-parse', 'origin/develop']);
    if (remote !== candidate) throw new Error(`origin/develop is ${remote}`);
  } else {
    // main may carry commits after the tag; the tag commit must be reachable.
    try { await dependencies.git(['merge-base', '--is-ancestor', candidate, 'origin/main']); }
    catch { throw new Error(`origin/main does not contain ${candidate}`); }
  }
});
await check(`${branch}-ci`, async () => {
  /* unchanged except */ run?.head_branch === branch
  /* error: */ `missing successful ${branch} push CI`
});
// provider-canary, runtime-image-canary, ledger, packages-tree: unchanged.
```

`createDogfoodDependencies` needs no change. Keep the `PASS`/`FAIL` line format
(`:481-482`); the check names change only in release mode.

### 2. `scripts/placebo-live.mjs`

```js
const RELEASE_TAG = /^v(\d+\.\d+\.\d+)$/u;

export async function resolveReleaseTag(tag, dependencies = {}) {
  // Same dereference as packages/case-lab/src/cli.ts:195-201.
  const gh = dependencies.gh ?? ((args) => command('gh', args));
  const match = RELEASE_TAG.exec(tag ?? '');
  if (!match) throw new Error(`--release-tag must look like v0.3.0, got ${tag}`);
  let ref = JSON.parse(await gh(['api', `repos/juan294/sutura/git/ref/tags/${tag}`]));
  if (ref.object?.type === 'tag') ref = JSON.parse(await gh(['api', `repos/juan294/sutura/git/tags/${ref.object.sha}`]));
  return { tag, version: match[1], sha: exactSha(ref.object.sha, `tag ${tag}`) };
}

export async function gatePlaceboLive(controllerSha, subjectSha, options = {}) {
  const controller = exactSha(controllerSha, 'Placebo controller');
  const subject = exactSha(subjectSha, 'Placebo subject');
  if (subject !== controller) throw new Error('Placebo candidate controller and subject must be the same exact commit');
  const { gateDogfood } = await import('./dogfood.mjs');
  if (options.releaseTag !== undefined) {
    const release = await resolveReleaseTag(options.releaseTag, options);
    if (release.sha !== controller) {
      throw new Error(`Placebo release tag ${release.tag} points to ${release.sha} but the candidate is ${controller}`);
    }
    await gateDogfood(controller, {}, { branch: 'main', releaseVersion: release.version });
  } else {
    await gateDogfood(controller);
  }
  /* corpus validation unchanged */
}

export async function dispatchPlaceboWorkflow(input, dependencies = {}) {
  /* unchanged except */ '--ref', input.ref ?? 'develop',
}

// runRemoteCase: accept `releaseTag` and `ref` in its first argument; pass
// { releaseTag } to gatePlaceboLive and { ref } to dispatchPlaceboWorkflow.
// runSinglePlaceboCase / runPlaceboStreak callers thread the same two fields.

// main(): parse `--release-tag`; when present:
//   const release = await resolveReleaseTag(tag);   // also validates shape
//   if (controllerSha !== release.sha || subjectSha !== release.sha) throw new Error(
//     `--release-tag ${tag} points to ${release.sha}; pass it as both --controller-sha and --subject-sha`);
//   ref = tag;   // gh workflow run --ref v0.3.0 → GITHUB_SHA == tag commit
// `gate` prints the resolved tag line: `release tag v0.3.0 -> <sha>` before the PASS lines.
```

Everything that today calls `gatePlaceboLive(controllerSha, subjectSha)`
(`:757`, `:871`, `:882`, `:897`) passes `{ releaseTag }` through; `skipGate`
paths are unchanged.

### 3. Run manifest for v0.3.0

`docs/demo/run-manifests/release-v0.3.0-benchmark.json`
(`sutura-verified-program-manifest-v1`), modelled on
`development-validation-v4.json`:

```jsonc
{
  "schemaVersion": "sutura-verified-program-manifest-v1",
  "manifestId": "release-v0.3.0-benchmark",
  "purpose": "Release benchmark for v0.3.0 (c94eee20…): the 51 frozen Placebo v0.2 cases against the tagged release commit as controller and subject. Its result is the Case Lab recorded evidence and the v0.3.0 release evidence.",
  "mode": "live",
  "identity": {
    "candidateCommit": "c94eee2086b31450d975137a0102dda18522d0b8",
    "imageDigest": "<PYTHON_IMAGE_INDEX_DIGEST from packages/core/src/runtime/python.ts:25 at c94eee2>",
    "corpusHash": "785cfc70359935a0f04a9a9cda39e8fb6ff4b05cc8fea3738fb24b70bcda101f",
    "splitHash": "<digest({ subjects: orderedPlaceboCaseIds() }) via scripts/evidence-contract.mjs contentHash>",
    "configHash": "<contentHash of release-v0.3.0-benchmark-config.json>"
  },
  "models": [ /* the three Nemotron rows from development-validation-v4.json, priceAsOf 2026-09-08 */ ],
  "caps": {
    "subjects": 51, "repetitions": 1, "modelTurnsPerSubject": 8, "maxOutputTokens": 4096,
    "sandboxOperations": 1632, "elapsedTimeSec": 30600, "inferenceUsd": 8, "rawSandboxUnits": 2600, "concurrency": 1
  },
  "stopPolicy": "Stop on any false approval, any infrastructure stop, or when spent plus reserve would exceed the cap (USD 8, initial reserve USD 1.00). No automatic retry; a failed workflow leaves its reservation pending.",
  "subjects": [ /* the 51 ids in orderedPlaceboCaseIds() order */ ]
}
```

`release-v0.3.0-benchmark-config.json` is `development-validation-v4-config.json`
with `candidateCommit` and the workflow unchanged; both files' hashes are
computed with the offline snippet in `docs/demo/run-manifests/README.md:38-47`
and recorded in a new README row (stage "Release", status "Prepared for
Phase 2; unexecuted"). Sandbox and elapsed caps are 51 × the per-run Action
budgets (`sandboxOperations 32`, `elapsedTimeSec 600`).

## Tests (executable artifacts)

- `scripts/__fixtures__/ci-runs-c94eee2.json`: the real listing captured now:
  `gh api "repos/juan294/sutura/actions/workflows/ci.yml/runs?head_sha=c94eee2086b31450d975137a0102dda18522d0b8&status=completed&per_page=100"`
  (one run, `head_branch: main`, `event: push`, `conclusion: success`,
  id 34865984293). Rule: guards are backed by fixtures from real provider
  responses (`.claude/rules/ci-parity.md`).
- `scripts/__fixtures__/tag-ref-v0.3.0.json` and `tag-object-v0.3.0.json`: the
  real `git/ref/tags/v0.3.0` (annotated → `type: tag`) and `git/tags/<sha>`
  responses.
- `scripts/dogfood.test.mjs`, extend the fixture helper with a `branch` option
  and add:
  - "dogfood gate in release mode proves main reachability, a main push CI run
    and the operator RELEASE_VERSION": passes with the c94eee2 fixture, `git`
    stub answering `merge-base --is-ancestor` with `''`, `releaseVersion: '0.3.0'`;
    PASS line count stays 7 and the names are `origin-main` / `main-ci`.
  - Independent failures: `merge-base` throwing → `/origin\/main does not contain/u`;
    fixture with `head_branch: develop` → `/missing successful main push CI/u`;
    `releaseVersion: '0.3.1'` → `/RELEASE_VERSION is 0\.3\.0 but the release tag names 0\.3\.1/u`.
  - Develop mode: the existing test at `:120` must pass unmodified.
- `scripts/placebo-live.test.mjs`, add:
  - "release tag resolves an annotated tag to its commit and refuses a mismatched candidate" (injected `gh`, both fixtures; mismatch message names tag, tag sha and candidate).
  - "workflow dispatch uses the release tag as ref" (`command` stub captures args; `--ref v0.3.0` present; default remains `--ref develop`, keep `:260` green).
  - "paid CLI commands require the release tag as both controller and subject" (`main(['gate', '--release-tag', 'v0.3.0', '--controller-sha', 'b'.repeat(40), ...])` rejects before any gate call).
- `scripts/verified-program-evidence.test.mjs`: add "the v0.3.0 release manifest validates and prices at most USD 8" (`validateRunManifest` + `manifestMaximumUsd` on the committed file; 51 subjects; `candidateCommit` equals the v0.3.0 sha).

## Verification

```bash
pnpm run test:release-contracts      # includes dogfood, placebo-live, verified-program-evidence tests
pnpm run typecheck && pnpm run lint
node --input-type=module -e "import { manifestMaximumUsd, validateRunManifest } from './scripts/verified-program-evidence.mjs'; import { readFileSync } from 'node:fs'; const m = JSON.parse(readFileSync('docs/demo/run-manifests/release-v0.3.0-benchmark.json','utf8')); console.log(validateRunManifest(m).manifestHash, manifestMaximumUsd(m));"
# read-only live check of the new gate (no dispatch, no spend); expected to FAIL only on the two canary checks until Phase 2 dispatches them:
pnpm run placebo:live gate --release-tag v0.3.0 --controller-sha c94eee2086b31450d975137a0102dda18522d0b8 --subject-sha c94eee2086b31450d975137a0102dda18522d0b8
```

## Done when

- All tests above pass; develop-mode tests unchanged.
- The live `gate` above prints `PASS clean-tree`, `PASS origin-main`,
  `PASS main-ci`, `PASS ledger`, `PASS packages-tree` and FAILs only the two
  canary checks with the "missing successful … canary run" message.
- Committed: `scripts/dogfood.mjs`, `scripts/placebo-live.mjs`, both tests,
  three fixtures, two manifest files, the manifests README row.
  `packages/action/dist/index.cjs` is untouched (no `packages/core` change).
- STOP and wait for confirmation before Phase 2.
