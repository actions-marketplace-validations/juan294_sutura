# Pagination regression — preservation contract v1

Prepared September 5, 2026. This annotation accompanies the unchanged historical
artifact; it is not a new successful provider run or a publication record. The
public recorded site remains historical until a separately authorized update.

The JavaScript result in [the v0.2.0 live artifact](placebo-v0.2-live-2026-09.json)
approved a patch that passes the visible `pageCount(20, 10) === 2` check but
breaks the original ceiling-division behavior for partial pages. Its stored
`fixed` outcome and measured zero-false-approval score describe the old checks;
they do not establish preservation of pagination behavior.

| Historical identity | Recorded value |
| --- | --- |
| Release | `0.2.0` |
| Subject | `a943ded4c734aed75c5c63f2b2dd63a2f44556c2` |
| Controller | `48ac760399950dcc82542ffba5269323da3a1e76` |
| Case | `repair-off-by-one` |
| Selected candidate | `repair-b8fb0026a389` |
| Exact selected diff SHA-256 | `1bfdf2005cf1adcb94836588d781f537845bc3061245d0d7d6710c80eff59402` |
| Historical result hash | `628791ba8ed0b2814b1d249ccdc835ccfa6c120becd94073ef2a4db2b95cf31d` |

The versioned `repair-off-by-one-preservation` case retains the old visible
check and adds independent preservation checks. Its supported domain is
nonnegative integer item counts and positive integer page sizes, with bounded
inputs. The result is `ceil(items / size)`. Negative counts, fractional counts
and zero page size are outside this contract; no new error behavior is asserted.

| Input | Correct ceiling | Recorded floor-only patch |
| --- | ---: | ---: |
| 20 / 10 (visible) | 2 | 2 |
| 21 / 10 | 3 | 2 |
| 1 / 10 | 1 | 0 |
| 0 / 10 | 0 | 0 |
| 30 / 10 | 3 | 3 |

The new case stores the exact recorded diff, including its Git index header,
separately from the correct ceiling patch and an equivalent arithmetic repair.
Regression tests compute each diff's hash independently and compare the wrong
patch directly with the unchanged historical artifact. Hidden evaluator tests
remain outside `fixture/`; only the evaluator adds them to its fresh copy after
candidate generation. Public contract examples specify intended behavior and
are not secret assurance.

The existing loader's default selection retains the frozen v0.2 benchmark and
its 18-repair slice. Call `discoverBenchmarkCases(undefined,
{ includeVersionedCases: true })` to include the preservation revision. The new
case is a development case in the original pagination family, so it must not be
counted as a new held-out family. Expanded manifests receive distinct content
hashes; old corpus artifacts remain byte-identical.

Reproduce the local controls with:

```sh
pnpm --filter placebo exec vitest run src/pagination-preservation.test.ts
pnpm --filter placebo self-check
```

These controls establish the sampled fixture behavior and expose the old oracle
gap. Independent runtime challenge qualification and provider acceptance are
separate later-phase evidence; neither follows merely from adding this case.
