# Phase 4: `release:case-lab` script and its tests

Plan: [2026-09-15-case-lab-tracks-latest-release.md](../2026-09-15-case-lab-tracks-latest-release.md)

Status: not started

`[batch-eligible]` with Phase 1 (disjoint files). This phase adds the script,
its test and the `package.json` entries only. It does **not** touch
`.husky/pre-push` or `ci.yml` (Phase 5), because until Phase 3 lands the check
fails on `develop`.

## Goal

`scripts/release-case-lab.mjs` in house style (`scripts/push-freeze.mjs`
shape: named exports, injected dependencies, `run(argv, options)` returning an
exit code, CLI guard at the bottom), with four subcommands, and
`scripts/release-case-lab.test.mjs` registered in `test:release-contracts`.

## Script contract

```js
// scripts/release-case-lab.mjs
// Subcommands:
//   check                              read-only: newest v* tag on origin/main == release.json == demo pins == recorded evidence
//   bump --tag <vX.Y.Z> --result <docs/demo/...json> --ledger <docs/demo/...json>
//                                      local edit; then runs case-lab verify-pin --tag
//   publish-demo --authorize           PUT the demo workflow to juan294/sutura-demo main, then re-verify byte identity
//   deploy --authorize                 vercel deploy --prod, then assert /api/health.release == release.json
// Exit 0 on success, 1 on any refusal. Every refusal names the file, the observed value and the expected value.

export const FILES = Object.freeze({
  release: 'packages/case-lab/release.json',
  workflow: 'packages/case-lab/demo/case-lab.yml',
  evidence: 'packages/case-lab/src/evidence.ts',
  replay: 'packages/case-lab/src/replay.ts',
});

export function defaultDependencies() {
  return {
    git: (args) => command('git', args),
    gh: (args) => command('gh', args),
    vercel: (args, options) => command('vercel', args, options),
    fetch: globalThis.fetch,
    readFile, writeFile,
    stdout: process.stdout, stderr: process.stderr,
  };
}

/** Newest semver v* tag whose peeled commit is reachable from origin/main. */
export async function newestReleaseTag(dependencies) {
  const lines = (await dependencies.git(['ls-remote', '--tags', 'origin', 'refs/tags/v*'])).split('\n').filter(Boolean);
  // "<sha>\trefs/tags/v0.3.0" (annotated tag object) and "<sha>\trefs/tags/v0.3.0^{}" (peeled commit)
  const tags = new Map();
  for (const line of lines) {
    const [sha, ref] = line.split('\t');
    const match = /^refs\/tags\/(v\d+\.\d+\.\d+)(\^\{\})?$/u.exec(ref ?? '');
    if (!match) continue;
    const entry = tags.get(match[1]) ?? {};
    if (match[2]) entry.commit = sha; else entry.ref = sha;
    tags.set(match[1], entry);
  }
  if (tags.size === 0) throw new ReleaseCaseLabError('origin has no v* tags');
  const ordered = [...tags.keys()].sort(compareSemverDesc);
  await dependencies.git(['fetch', '--quiet', 'origin', 'main']);
  for (const tag of ordered) {
    const commit = tags.get(tag).commit ?? tags.get(tag).ref;   // lightweight tags have no ^{}
    try { await dependencies.git(['merge-base', '--is-ancestor', commit, 'origin/main']); return { tag, version: tag.slice(1), commit }; }
    catch { /* a tag not on main is not a production release; keep looking */ }
  }
  throw new ReleaseCaseLabError('no v* tag is reachable from origin/main');
}

export function readPins(text)            // reuse the three regexes from packages/case-lab/src/pin.ts (copy them; the .mjs cannot import TS)
export function readEvidenceBinding(text) // RECORDED_RESULT_FILE / RECORDED_LEDGER_FILE literals from evidence.ts
export function readEvidenceUrl(text)     // EVIDENCE_URL literal from replay.ts

export async function check(dependencies = defaultDependencies()) {
  const release = await newestReleaseTag(dependencies);
  const json = JSON.parse(await dependencies.readFile(FILES.release, 'utf8'));
  const refusals = [];
  const expect = (file, what, observed, expected) => {
    if (observed !== expected) refusals.push(`${file}: ${what} is ${observed} but the newest release tag ${release.tag} names ${expected}`);
  };
  expect(FILES.release, 'version', json.version, release.version);
  expect(FILES.release, 'actionSha', json.actionSha, release.commit);
  const pins = readPins(await dependencies.readFile(FILES.workflow, 'utf8'));
  expect(FILES.workflow, 'uses: juan294/sutura/packages/action@', pins.usesSha, release.commit);
  expect(FILES.workflow, 'SUTURA_ACTION_SHA', pins.envActionSha, release.commit);
  expect(FILES.workflow, 'SUTURA_CONTROLLER_SHA', pins.controllerSha, release.commit);
  const binding = readEvidenceBinding(await dependencies.readFile(FILES.evidence, 'utf8'));
  const result = JSON.parse(await dependencies.readFile(binding.result, 'utf8'));
  expect(binding.result, 'subjectSha', result.subjectSha, release.commit);
  expect(binding.result, 'subjectVersion', result.subjectVersion, release.version);
  const ledger = JSON.parse(await dependencies.readFile(binding.ledger, 'utf8'));
  expect(binding.ledger, 'resultHash', ledger.resultHash, result.ledgerHash);
  expect(FILES.replay, 'EVIDENCE_URL', readEvidenceUrl(await dependencies.readFile(FILES.replay, 'utf8')),
    `https://github.com/juan294/sutura/blob/develop/${binding.result}`);
  if (refusals.length > 0) {
    throw new ReleaseCaseLabError([
      `BLOCKED: the Case Lab lags release ${release.tag} (${release.commit})`,
      ...refusals,
      'Fix: run the release benchmark (Phase 2 procedure), then `pnpm run release:case-lab bump --tag <tag> --result <file> --ledger <file>`.',
    ].join('\n'));
  }
  return release;
}

export async function bump({ tag, result, ledger }, dependencies)
  // 1. resolve the tag exactly as newestReleaseTag does and require it to BE the newest (never bump to an older tag)
  // 2. require the result file's subjectSha/subjectVersion and ledger.resultHash to match before writing anything
  // 3. rewrite release.json (canonical 2-space JSON + newline), the three workflow SHAs, evidence.ts constants, replay.ts EVIDENCE_URL
  // 4. run `node packages/case-lab/bin/case-lab.js verify-pin --tag <tag>` through dependencies.command and surface its output
  // Writes only after every read check passes; never touches docs/demo files.

export async function publishDemo({ authorize }, dependencies)
  // literal --authorize required ("publish-demo requires literal --authorize")
  // GET repos/juan294/sutura-demo/contents/.github/workflows/case-lab.yml?ref=main → sha
  // PUT same path with { message: `chore(case-lab): pin the Action and controller to sutura ${tag}`, content: base64(local), sha, branch: 'main' }
  // then run check() semantics for byte identity: GET again and compare to the local file
  // refuses when check() itself fails (the local tree must already be consistent)
  // Historically (Sep 4–5) the file was pushed from the local clone /Users/juan/code/sutura-demo,
  // which is now out of sync (ahead 1, behind 11 of origin/main). The contents API avoids that
  // clone entirely; the committer shows as GitHub for these commits, which is acceptable.

export async function deploy({ authorize }, dependencies)
  // literal --authorize required
  // Production deploys are PREBUILT ONLY (docs/plans/2026-09-04-sutura-case-lab-notes.md:84-85,
  // docs/release/discoverability-playbook.md:20-30); a personal scope is refused by Vercel:
  //   cwd packages/case-lab
  //   vercel pull --yes --environment=production --scope thecreativetoken
  //   vercel build --prod --scope thecreativetoken
  //   vercel deploy --prebuilt --prod --scope thecreativetoken
  // then fetch https://sutura-case-lab.vercel.app/api/health and require .release.version and .release.actionSha equal release.json; retry the fetch up to 5 times at 10 s spacing (edge propagation), then refuse with both values in the message
```

Semver ordering: numeric per component; pre-release suffixes are excluded by
the regex (the project tags plain `vX.Y.Z`).

## `package.json`

- `"release:case-lab": "node scripts/release-case-lab.mjs"`.
- Append `scripts/release-case-lab.test.mjs` to the `test:release-contracts`
  file list (`package.json:29`).

## Tests (`scripts/release-case-lab.test.mjs`, node:test, offline)

Fixtures live in a temp directory built with the `withTempDirectory` idiom
(`scripts/push-freeze.test.mjs:16-23`); `git`/`gh`/`fetch` are stubs.

1. "newest release tag picks the highest semver whose commit is on main":
   `ls-remote` stub returns `v0.2.0`, `v0.2.1`, `v0.3.0` (annotated, with `^{}`
   lines) plus `v0.9.0` on a branch; `merge-base` stub rejects only `v0.9.0`'s
   commit → returns `v0.3.0` / `c94eee20…`. Also: lightweight tag without
   `^{}` resolves to its ref sha.
2. "check passes when every binding names the newest tag": temp tree with
   consistent `release.json`, workflow, `evidence.ts`, `replay.ts`, result +
   ledger JSON → resolves.
3. "check names the file, observed and expected value for each drift": one
   assertion per binding (six cases), each rejecting with a message matching
   `/^BLOCKED: the Case Lab lags release v0\.3\.0/mu`, the file path, the
   observed value, the expected value, and `/Fix: run the release benchmark/u`
   (rule: errors name the file and the cause, `.claude/rules/ci-parity.md`).
4. "bump rewrites all six bindings and refuses to write on a stale result":
   after `bump`, `check` passes on the same temp tree; with a result whose
   `subjectSha` differs, no file changes (compare bytes before/after).
5. "bump refuses a tag older than the newest".
6. "publish-demo requires literal --authorize and re-verifies byte identity":
   without the flag → rejects before any `gh` call; with the flag, the `gh`
   stub records GET → PUT → GET and the PUT body carries the local bytes.
7. "deploy requires literal --authorize and refuses a health mismatch": `vercel`
   stub records the three invocations in order (`pull`, `build --prod`,
   `deploy --prebuilt --prod`, all with `--scope thecreativetoken`, cwd
   `packages/case-lab`); `fetch` stub returns `0.2.0` → rejects with both
   versions in the message; returns `0.3.0`/matching sha → resolves.
8. "cli guard: run returns 1 and prints the refusal on stderr" (spawn with
   `process.execPath`, as `scripts/guards-verify.test.mjs:71-76`).

## Verification

```bash
pnpm run test:release-contracts
pnpm run lint
node scripts/release-case-lab.mjs check   # on develop before Phase 3 lands: exit 1, BLOCKED message naming release.json 0.2.0 vs v0.3.0
```

## Done when

Tests 1–8 pass offline; the live `check` on `develop` produces the expected
BLOCKED output (paste it in the phase report — it is the red-path proof from
the plan's success criteria); committed and pushed (gate not yet wired). STOP.
