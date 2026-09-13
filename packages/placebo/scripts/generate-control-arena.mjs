import { writeFile } from 'node:fs/promises';
import { DEFAULT_MODELS, DEFAULT_REPAIR_BUDGET_LIMITS, DEFAULT_ROUTING_PROFILE_ID } from '@sutura/core';
import { canonicalJson } from '@sutura/evaluation';
import {
  ARM_SEARCH_LIMITS, arenaReport, budgetProfileHash, createComparison, createCorpusManifest,
  discoverBenchmarkCases, DummyAdapter, executedObservation, projectFirstGreenWins,
  RefuseAllAdapter, renderArena, runBenchmark, SCORE_CONTRACT_VERSION, score,
} from '../dist/index.js';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
if (!/^[a-f0-9]{40}$/u.test(process.argv[2] ?? '')) {
  console.error('usage: node scripts/generate-control-arena.mjs <sutura commit sha>');
  process.exit(2);
}
const counterfactual = JSON.parse(await readFile(`${root}/docs/demo/sutura-counterfactual-v0.2.json`, 'utf8'));
const selection = JSON.parse(await readFile(`${root}/packages/placebo/arena/selection-placebo-v0.2.json`, 'utf8'));

const caseIds = (await discoverBenchmarkCases()).map(({ id }) => id).sort();
const invariants = {
  caseIds,
  corpusName: 'placebo',
  corpusVersion: '0.2',
  corpusHash: (await createCorpusManifest()).corpusHash,
  models: { ...DEFAULT_MODELS },
  routingProfile: DEFAULT_ROUTING_PROFILE_ID,
  budgetProfileHash: budgetProfileHash(DEFAULT_REPAIR_BUDGET_LIMITS),
  scoreContractVersion: SCORE_CONTRACT_VERSION,
  tavilyEnabled: true,
  suturaCommit: process.argv[2],
};

// Known-answer controls: `dummy` approves every candidate, `refuse-all` approves none.
const approving = await runBenchmark(new DummyAdapter(), {});
const refusing = await runBenchmark(new RefuseAllAdapter(), { noTavily: true });

function armFrom(name, report) {
  const observations = report.results
    .filter((result, index, all) => all.findIndex((item) => item.caseId === result.caseId) === index)
    .map(executedObservation);
  return {
    arm: name,
    searchLimits: { ...ARM_SEARCH_LIMITS[name] },
    auditEnabled: true,
    derived: false,
    observations,
    score: report.score,
  };
}

const suturaArm = armFrom('sutura', approving);

// The naive baseline is a projection over the same recorded evidence, rescored
// from what it would have concluded rather than from what Sutura concluded.
const naiveResults = approving.results
  .filter((result, index, all) => all.findIndex((item) => item.caseId === result.caseId) === index);
const naiveObservations = naiveResults.map((result) => projectFirstGreenWins({ result }));
const firstGreen = {
  arm: 'first-green-wins',
  searchLimits: null,
  auditEnabled: false,
  derived: true,
  observations: naiveObservations,
  score: score(naiveResults.map((result, index) => ({
    ...result,
    caseFile: {
      ...result.caseFile,
      outcome: naiveObservations[index].outcome === 'not-run'
        ? 'gave-up'
        : naiveObservations[index].outcome,
      audit: {
        approved: naiveObservations[index].approved,
        checks: [],
        reasoning: naiveObservations[index].approved
          ? 'ACCEPTED: the diagnosed verification command exited 0.'
          : 'REFUSED: no candidate made the diagnosed verification command exit 0.',
      },
    },
  }))),
};

const manifest = createComparison({
  comparisonId: 'arena-controls-v0.2',
  invariants,
  arms: [
    suturaArm,
    armFrom('single-branch', refusing),
    armFrom('fixed-parallel', refusing),
    firstGreen,
  ],
});

await writeFile(`${root}/docs/demo/sutura-arena-controls-v0.2.json`, `${canonicalJson(manifest)}\n`);
const report = arenaReport(manifest, {
  counterfactual,
  selection,
  allowIncomplete: true,
  note: 'CONTROL ARTIFACT — NOT A SUTURA RESULT. The arms below were produced by the scripted '
    + 'dummy and refuse-all control adapters, not by Sutura. It exists only to prove the '
    + 'comparison harness, the scorer wiring, and this page end to end with no provider and no '
    + 'spend. The measured Arena replaces it once the authorized benchmark run completes.',
});
await writeFile(`${root}/docs/demo/sutura-arena-v0.2.json`, `${canonicalJson(report)}\n`);
await writeFile(`${root}/docs/demo/sutura-arena-v0.2.html`, renderArena(report));
console.log('complete:', manifest.complete, 'resultHash:', manifest.resultHash);
console.log('report hash:', report.resultHash);
console.log('arms:', report.measures.arms.map((a) => `${a.arm}: fix ${a.repairRate.numerator}/${a.repairRate.denominator} fa=${a.falseApprovals} notRun=${a.notRun}`).join(' | '));
