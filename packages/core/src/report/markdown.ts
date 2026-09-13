import type { CaseFile } from '../domain.js';
import {
  aggregateStageEvidence,
  counterfactualLede,
  diffSummary,
  escapeHtml,
  escapeMarkdown,
  formatConfidence,
  formatUsd,
  mergeGuidance,
  outcomeLabel,
  raceNote,
  recoverySummary,
  safeWebUrl,
  stageForRole,
  triageSentence,
} from './format.js';

function renderDiagnosis(caseFile: CaseFile): string[] {
  const { diagnosis } = caseFile;
  const lines = [
    '### Diagnosis',
    '',
    `**${escapeMarkdown(diagnosis.class)}** · ${formatConfidence(diagnosis.confidence)} confidence`,
    '',
    `Failing command: <code>${escapeHtml(diagnosis.failingCmd)}</code>`,
    '',
    ...diagnosis.signals.map((signal) => `- ${escapeMarkdown(signal)}`),
    '',
    '> ' + escapeMarkdown(diagnosis.errorExcerpt),
  ];

  const grounding = diagnosis.grounding;
  if (grounding && !grounding.skipped && grounding.citations.length > 0) {
    lines.push('', '**Grounding**');
    for (const citation of grounding.citations) {
      const title = escapeMarkdown(citation.title);
      const snippet = escapeMarkdown(citation.snippet);
      const url = safeWebUrl(citation.url);
      lines.push(url ? `- [${title}](<${url}>) — ${snippet}` : `- ${title} — ${snippet}`);
    }
  }

  return lines;
}

function renderProcedure(caseFile: CaseFile): string[] {
  const lines = [
    '### Procedure',
    '',
    '| Candidate | Strategy | Held? | Note |',
    '| --- | --- | :---: | --- |',
  ];
  for (const result of caseFile.race) {
    lines.push(
      `| ${escapeMarkdown(result.candidate.id)} | ${escapeMarkdown(result.candidate.rationale)} | ${result.held ? 'YES' : 'NO'} | ${escapeMarkdown(raceNote(result))} |`,
    );
  }
  if (caseFile.race.length === 0) {
    lines.push('| — | No candidates were produced | NO | Repair cycle stopped |');
  }
  if (caseFile.search && caseFile.search.length > 0) {
    lines.push(
      '',
      '**Adaptive checkpoint lineage**',
      '',
      '| Node | Parent | Depth | Test | Policy | Terminal |',
      '| --- | --- | ---: | ---: | :---: | --- |',
      ...caseFile.search.map((node) =>
        `| ${escapeMarkdown(node.nodeId)} | ${escapeMarkdown(node.parentNodeId ?? 'baseline')} | ${node.depth} | ${node.testExitCode} | ${node.policyValid ? 'PASS' : 'FAIL'} | ${escapeMarkdown(node.terminalReason ?? 'frontier')} |`,
      ),
    );
  }
  return lines;
}

function renderPathology(caseFile: CaseFile): string[] {
  const lines = ['### Pathology', ''];
  if (!caseFile.audit) {
    lines.push('**NOT RUN** — no candidate survived for adversarial audit.');
    return lines;
  }

  lines.push(
    `**${caseFile.audit.approved ? 'PASS' : 'FAIL'}** — adversarial verdict`,
    '',
    '| Check | Result | Evidence |',
    '| --- | :---: | --- |',
  );
  for (const check of caseFile.audit.checks) {
    lines.push(
      `| ${escapeMarkdown(check.name)} | **${check.passed ? 'PASS' : 'FAIL'}** | ${escapeMarkdown(check.evidence ?? 'No evidence recorded')} |`,
    );
  }
  lines.push('', `> ${escapeMarkdown(caseFile.audit.reasoning)}`);
  return lines;
}

function renderCounterfactual(caseFile: CaseFile): string[] {
  const evidence = caseFile.counterfactual;
  if (!evidence || evidence.alternatives.length === 0) return [];
  const lines = [
    '### Counterfactual',
    '',
    escapeMarkdown(counterfactualLede(caseFile)),
    '',
    '| Alternative | Intent | Verdict | Gate | Rule |',
    '| --- | --- | :---: | --- | --- |',
  ];
  for (const item of evidence.alternatives) {
    lines.push(
      `| <code>${escapeHtml(item.id)}</code> | ${escapeMarkdown(item.intent)} | **${item.approved ? 'ACCEPTED' : 'REJECTED'}** | ${escapeMarkdown(item.rejectedBy?.gate ?? '—')} | ${escapeMarkdown(item.rejectedBy?.rule ?? '—')} |`,
    );
  }
  lines.push(
    '',
    `**Added cost:** ${evidence.cost.sandboxOperations} sandbox operations · ${evidence.cost.elapsedTimeSec.toFixed(3)} s elapsed · ${formatUsd(evidence.cost.inferenceUsd)} inference`,
  );
  return lines;
}

function renderDischarge(caseFile: CaseFile): string[] {
  const totals = aggregateStageEvidence(caseFile);
  return [
    '### Discharge',
    '',
    `**Diff summary:** ${escapeMarkdown(diffSummary(caseFile))}`,
    '',
    `**Human merge check:** ${escapeMarkdown(mergeGuidance(caseFile))}`,
    '',
    `**Inference cost: ${formatUsd(caseFile.cost.totalUsd())}**`,
    '',
    `**Sandbox cost: ${formatUsd(totals.sandboxCostUsd)}** · operations ${totals.operationCount} · elapsed ${totals.elapsedTimeSec.toFixed(3)} s · CPU ${totals.cpuTimeSec.toFixed(3)} s · peak RSS ${totals.maxRssKb.toLocaleString('en-US')} KB`,
    '',
    `**Policy:** base <code>${escapeHtml(caseFile.policy.baseRef)}</code> at <code>${escapeHtml(caseFile.policy.baseSha)}</code> · policy <code>${escapeHtml(caseFile.policy.policySha)}</code>`,
    '',
    `**Runtime:** <code>${escapeHtml(caseFile.runtime)}</code>`,
  ];
}

function renderFooter(caseFile: CaseFile, artifactUrl?: string): string[] {
  const models = caseFile.cost.entries.map(
    (entry) => `${stageForRole(entry.role)} (${entry.role}): <code>${escapeHtml(entry.model)}</code>`,
  );
  const artifactLink = artifactUrl ? safeWebUrl(artifactUrl) : undefined;
  return [
    '---',
    '',
    `Models — ${models.length > 0 ? models.join(' · ') : 'no inference recorded'}`,
    '',
    artifactLink
      ? `[Open case-file artifact](<${artifactLink}>)`
      : 'Case-file artifact link pending workflow upload.',
  ];
}

export function renderComment(caseFile: CaseFile, artifactUrl?: string): string {
  const sections = [
    `## Sutura — Surgical Report`,
    '',
    `**${outcomeLabel(caseFile.outcome)}** · <code>${escapeHtml(caseFile.repo)}</code> · case <code>${escapeHtml(caseFile.runId)}</code>`,
    '',
    ...renderDiagnosis(caseFile),
    '',
    '### Triage',
    '',
    `**${triageSentence(caseFile)}**`,
  ];

  if (
    caseFile.outcome !== 'flaky-no-patch' &&
    caseFile.outcome !== 'infra-stop'
  ) {
    sections.push(
      '',
      ...renderProcedure(caseFile),
      '',
      ...renderPathology(caseFile),
    );
  }

  const recovery = recoverySummary(caseFile);
  if (recovery.length > 0) sections.push('', '### Diagnosis recovery', '', ...recovery.map((line) => `- ${escapeMarkdown(escapeHtml(line))}`));

  const counterfactual = renderCounterfactual(caseFile);
  if (counterfactual.length > 0) sections.push('', ...counterfactual);

  sections.push('', ...renderDischarge(caseFile));

  sections.push('', ...renderFooter(caseFile, artifactUrl));
  return sections.join('\n') + '\n';
}
