import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const submissionUrl = new URL('docs/devpost/sutura-submission.md', root);
const videoUrl = new URL('docs/devpost/sutura-video-script.md', root);
const feedbackUrl = new URL('docs/feedback/2026-10-sutura-nebius-feedback.md', root);

async function text(url) {
  return readFile(url, 'utf8');
}

function count(value, pattern) {
  return [...value.matchAll(pattern)].length;
}

function seconds(value) {
  const match = /^(\d+):(\d{2})$/u.exec(value);
  assert.ok(match, `invalid video timestamp: ${value}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function assertVersionConsistency(document, currentVersion) {
  assert.match(document, new RegExp(`\\bsutura@${escapeRegex(currentVersion)}\\b`, 'u'));
  for (const line of document.split('\n')) {
    for (const match of line.matchAll(/(?<![\d.])(?:v)?(\d+\.\d+\.\d+)(?![\d.])/gu)) {
      if (match[1] === currentVersion) continue;
      assert.match(
        line,
        /\b(?:historical|history)\b/iu,
        `version ${match[0]} differs from ${currentVersion} without a history label`,
      );
    }
  }
}

test('submission source carries the qualitative judge story and one architecture diagram', async () => {
  const [submission, packageJson] = await Promise.all([
    text(submissionUrl),
    text(new URL('package.json', root)).then(JSON.parse),
  ]);

  assert.match(submission, /^# Sutura: Verified Self-Healing CI$/mu);
  assert.ok(submission.includes(packageJson.description));
  for (const heading of [
    'Problem',
    'Who it is for',
    'Why existing fix-CI tools are insufficient',
    'Product workflow',
    'Architecture',
    'Runtime roles',
    'Significant work since the submission period opened',
  ]) {
    assert.match(submission, new RegExp(`^## ${heading}$`, 'mu'));
  }
  for (const role of [
    'Nano',
    'Super',
    'Ultra',
    'Token Factory',
    'ConTree',
    'Data Lab',
    'ATIF',
    'NeMo Agent Toolkit',
  ]) {
    assert.match(submission, new RegExp(`\\b${role}\\b`, 'u'));
  }
  assert.equal(count(submission, /^```mermaid\n[\s\S]*?^```$/gmu), 1);
  assert.match(submission, /2026-08-26/u);

  assertVersionConsistency(submission, packageJson.version);
});

test('submission, video, and feedback links resolve to repository files', async () => {
  for (const documentUrl of [submissionUrl, videoUrl, feedbackUrl]) {
    const document = await text(documentUrl);
    const targets = [...document.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu)]
      .map((match) => match[1])
      .filter((target) => !/^(?:https?:|#)/u.test(target));
    assert.ok(targets.length > 0, `${fileURLToPath(documentUrl)} must contain a local link`);
    for (const target of targets) {
      const targetUrl = new URL(target, documentUrl);
      const info = await stat(targetUrl);
      assert.ok(info.isFile(), `${fileURLToPath(targetUrl)} must be a file`);
    }
  }
});

test('video script has six contiguous sections and ends before 180 seconds', async () => {
  const video = await text(videoUrl);
  const expected = [
    ['0:00', '0:20'],
    ['0:20', '1:20'],
    ['1:20', '1:55'],
    ['1:55', '2:25'],
    ['2:25', '2:45'],
    ['2:45', '2:55'],
  ];
  const ranges = [...video.matchAll(/^## (\d+:\d{2})-(\d+:\d{2}) — .+$/gmu)]
    .map((match) => [match[1], match[2]]);
  assert.deepEqual(ranges, expected);
  for (let index = 0; index < ranges.length; index += 1) {
    assert.ok(seconds(ranges[index][0]) < seconds(ranges[index][1]));
    if (index > 0) assert.equal(ranges[index - 1][1], ranges[index][0]);
  }
  assert.ok(seconds(ranges.at(-1)[1]) < 180);
  assert.doesNotMatch(video, /\b(?:fix rate|catch rate|accuracy|percentage-point|USD|\d+\/\d+)\b/iu);

  const counterfactual = video.slice(
    video.indexOf('## 1:20-1:55'),
    video.indexOf('## 1:55-2:25'),
  );
  const arena = video.slice(
    video.indexOf('## 2:25-2:45'),
    video.indexOf('## 2:45-2:55'),
  );
  assert.match(counterfactual, /only after[\s\S]*WS-2[\s\S]*evidence is committed/iu);
  assert.match(arena, /only after[\s\S]*WS-2[\s\S]*evidence is committed/iu);
});

test('version contract rejects drift in bare, npm, tag, Action, and release-link forms', () => {
  const current = '0.2.1';
  const canonical = `Canonical package identity: sutura@${current}.`;
  for (const reference of [
    'Release 9.9.9',
    'npm install sutura@9.9.9',
    'tag v9.9.9',
    'uses: juan294/sutura@v9.9.9',
    '[release](https://github.com/juan294/sutura/releases/tag/v9.9.9)',
  ]) {
    assert.throws(() => assertVersionConsistency(`${canonical}\n${reference}`, current), /differs/u);
  }
  assert.doesNotThrow(() => assertVersionConsistency(
    `${canonical}\nHistorical release history: sutura@0.2.0, tag v0.2.0.`,
    current,
  ));
});

test('feedback separates local contracts, observed incidents, and requests', async () => {
  const feedback = await text(feedbackUrl);
  const local = feedback.indexOf('## Verified local integration behavior');
  const observed = feedback.indexOf('## Observed live integration problems');
  const requested = feedback.indexOf('## Requested features');
  assert.ok(local >= 0 && observed > local && requested > observed);

  const observedText = feedback.slice(observed, requested);
  for (const incident of [
    /ConTree[\s\S]*HTTP\s+404/u,
    /Tavily[\s\S]*HTTP\s+403/u,
    /Nemotron[\s\S]*invalid JSON/u,
    /force_nonempty_content/u,
    /completion-limit/u,
  ]) {
    assert.match(observedText, incident);
  }
});

test('submission sources contain no unfinished markers', async () => {
  const documents = await Promise.all([text(submissionUrl), text(videoUrl), text(feedbackUrl)]);
  for (const document of documents) {
    assert.doesNotMatch(document, /\b(?:TODO|TBD|placeholder|coming soon|insert here|add later)\b/iu);
    assert.doesNotMatch(document, /https?:\/\/(?:example\.com|localhost)\b/iu);
  }
});

const evaluatorDocs = ['docs/evaluation/README.md', 'docs/evaluation/architecture.md'];
const cardIds = [
  'controller-authority',
  'contree-branches',
  'layered-audit',
  'flake-triage',
  'grounded-dependencies',
  'counterfactual-verification',
];
const cardFields = [
  'Claim', 'Product value', 'Criterion', 'Implementation', 'Verification', 'Mode and revision', 'Limit',
];

function markdownLinks(document) {
  return [...document.matchAll(/!?\[([^\]]*)\]\(([^)]+)\)/gu)]
    .map((match) => ({ label: match[1], target: match[2] }));
}

function explicitIds(document) {
  return [...document.matchAll(/<a id="([a-z][a-z0-9-]*)"><\/a>/gu)]
    .map((match) => ({ id: match[1], index: match.index }));
}

async function readRepositoryFile(path) {
  return readFile(resolve(fileURLToPath(root), path), 'utf8');
}

async function checkLocalTarget(document, target, read = readRepositoryFile) {
  if (/^https?:\/\//u.test(target)) return;
  const context = `${document}: broken target ${target}`;
  let decodedTarget;
  try {
    decodedTarget = decodeURIComponent(target);
  } catch (error) {
    assert.fail(`${context}: invalid URL encoding (${error.message})`);
  }
  assert.ok(!/^(?:\/|\\|[a-z][a-z0-9+.-]*:)/iu.test(decodedTarget), `${context}: absolute local path`);
  const targetUrl = new URL(target, new URL(document, root));
  assert.ok(targetUrl.href.startsWith(root.href), `${context}: outside repository`);
  const fragment = decodeURIComponent(targetUrl.hash.slice(1));
  targetUrl.search = '';
  targetUrl.hash = '';
  const path = relative(fileURLToPath(root), resolve(decodeURIComponent(targetUrl.pathname)));
  assert.ok(!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`), `${context}: outside repository`);
  let contents;
  try {
    contents = await read(path);
  } catch (error) {
    assert.fail(`${context}: missing file (${error.message})`);
  }
  if (!fragment) return;
  const lines = /^L(\d+)(?:-L(\d+))?$/u.exec(fragment);
  if (lines) {
    const start = Number(lines[1]);
    const end = Number(lines[2] ?? lines[1]);
    const lineCount = contents.replace(/\n$/u, '').split('\n').length;
    assert.ok(start > 0 && end >= start && end <= lineCount, `${context}: out-of-range lines`);
    return;
  }
  assert.match(fragment, /^[a-z][a-z0-9-]*$/u, `${context}: unsupported fragment`);
  assert.ok(explicitIds(contents).some(({ id }) => id === fragment), `${context}: missing explicit section`);
}

async function checkEvaluatorDocs(read = readRepositoryFile) {
  const documents = new Map();
  for (const path of evaluatorDocs) {
    let document;
    try {
      document = await read(path);
    } catch (error) {
      assert.fail(`${path}: missing evaluator document (${error.message})`);
    }
    documents.set(path, document);
    assert.match(document, /Reviewed source[^\n]*\n?[^\n]*\b[0-9a-f]{40}\b/iu, `${path}: reviewed source SHA required`);
    assert.match(document, /\b\d{4}-\d{2}-\d{2}\b/u, `${path}: inspection date required`);
    const ids = explicitIds(document).map(({ id }) => id);
    assert.equal(new Set(ids).size, ids.length, `${path}: duplicate explicit ID`);
    for (const { target } of markdownLinks(document)) await checkLocalTarget(path, target, read);
  }

  const [guidePath, architecturePath] = evaluatorDocs;
  const guide = documents.get(guidePath);
  const guideLinks = markdownLinks(guide).map(({ target }) => target);
  assert.ok(guideLinks.includes('architecture.md'), `${guidePath}: architecture link required`);
  for (const id of ['evidence-status', 'limitations']) {
    assert.ok(explicitIds(guide).some((anchor) => anchor.id === id), `${guidePath}: ${id} section required`);
    assert.ok(guideLinks.includes(`#${id}`), `${guidePath}: ${id} link required`);
  }
  assert.ok(guideLinks.some((target) => /^\.\.\/(?:demo|datalab)\//u.test(target)), `${guidePath}: canonical evidence link required`);
  const criterionSection = /^## [^\n]*criteri[^\n]*\n([\s\S]*?)(?=^## |$(?![\s\S]))/imu.exec(guide)?.[1];
  assert.ok(criterionSection, `${guidePath}: criterion section required`);
  for (const criterion of ['Technological Implementation', 'Design', 'Potential Impact', 'Quality of the Idea']) {
    assert.ok(criterionSection.includes(criterion), `${guidePath}: missing criterion ${criterion}`);
  }

  const architecture = documents.get(architecturePath);
  const anchors = explicitIds(architecture);
  for (const cardId of cardIds) {
    const anchorIndex = anchors.findIndex(({ id }) => id === cardId);
    assert.ok(anchorIndex >= 0, `${architecturePath}: missing card ${cardId}`);
    const card = architecture.slice(anchors[anchorIndex].index, anchors[anchorIndex + 1]?.index);
    const fields = new Map();
    for (const field of cardFields) {
      const rows = [...card.matchAll(new RegExp(`^\\| ${escapeRegex(field)} \\| (.+) \\|$`, 'gmu'))];
      assert.equal(rows.length, 1, `${architecturePath}#${cardId}: missing or duplicate ${field} field`);
      assert.ok(rows[0][1].trim(), `${architecturePath}#${cardId}: empty ${field} field`);
      fields.set(field, rows[0][1]);
    }
    assert.match(fields.get('Implementation'), /`[A-Za-z_$][\w.$]*`/u, `${cardId}: named implementation symbol required`);
    assert.ok(markdownLinks(fields.get('Implementation')).some(({ target }) => /^\.\.\/\.\.\/packages\/.+\/src\/.+#L\d/u.test(target)), `${cardId}: repository source link required`);
    assert.ok(markdownLinks(fields.get('Verification')).some(({ target }) => /\.test\.[cm]?[jt]s(?:#|$)|^\.\.\/(?:demo|plans|datalab)\/|^\.\.\/\.\.\/packages\/placebo\//u.test(target)), `${cardId}: test or canonical artifact link required`);
    assert.match(fields.get('Mode and revision'), /\b(?:inspect(?:ed|ion)|execut(?:ed|ion))\b/iu, `${cardId}: inspection/execution mode required`);
    assert.match(fields.get('Mode and revision'), /\b[0-9a-f]{40}\b/u, `${cardId}: revision required`);
  }
}

test('evaluator guide and architecture carry source-backed evidence cards and valid local links', async () => {
  await checkEvaluatorDocs();
});

test('evaluator local links reject missing files, invalid lines, missing sections, and repository escapes', async () => {
  const read = async (path) => {
    assert.equal(path, 'docs/evaluation/target.md', `missing fixture ${path}`);
    return '<a id="present"></a>\nsecond line\n';
  };
  for (const target of ['target.md?plain=1#L1-L2', 'target.md#present']) {
    await checkLocalTarget(evaluatorDocs[0], target, read);
  }
  for (const [target, reason] of [
    ['missing.md', 'missing file'],
    ['target.md#L3', 'out-of-range lines'],
    ['target.md#L2-L1', 'out-of-range lines'],
    ['target.md#missing', 'missing explicit section'],
    ['target.md#%ZZ', 'invalid URL encoding'],
    ['/tmp/outside.md', 'absolute local path'],
    ['%2Ftmp%2Foutside.md', 'absolute local path'],
    ['../../../outside.md', 'outside repository'],
    ['%2e%2e%2f%2e%2e%2f%2e%2e%2foutside.md', 'outside repository'],
  ]) {
    await assert.rejects(checkLocalTarget(evaluatorDocs[0], target, read), (error) => {
      assert.ok(error.message.includes(evaluatorDocs[0]) && error.message.includes(target));
      assert.ok(error.message.includes(reason));
      return true;
    });
  }
});

function evaluatorFixture() {
  const revision = 'a'.repeat(40);
  const identity = `Reviewed source: \`${revision}\`; inspected 2026-09-05.\n`;
  return new Map([
    [evaluatorDocs[0], `${identity}
[Architecture](architecture.md), [evidence](#evidence-status), [limits](#limitations).
## Hackathon criteria
Technological Implementation; Design; Potential Impact; Quality of the Idea.
<a id="evidence-status"></a>
## Evidence status
[Canonical measured report](../demo/evidence.md)
<a id="limitations"></a>
## Limitations
Source inspection only.
`],
    [evaluatorDocs[1], identity + cardIds.map((id) => `
<a id="${id}"></a>
### ${id}
| Field | Evidence |
| --- | --- |
| Claim | Bounded behavior. |
| Product value | Reviewable results. |
| Criterion | Technological Implementation |
| Implementation | \`audit\`, [audit source](../../packages/core/src/audit/audit.ts#L1) |
| Verification | [audit test](../../packages/core/src/audit/audit.test.ts#L1) |
| Mode and revision | Source inspected at \`${revision}\`. |
| Limit | Inspection does not demonstrate live behavior. |
`).join('')],
    ['docs/demo/evidence.md', 'Historical evidence.\n'],
    ['packages/core/src/audit/audit.ts', 'export function audit() {}\n'],
    ['packages/core/src/audit/audit.test.ts', 'test("audit", () => {});\n'],
  ]);
}

test('evaluator cards reject duplicate IDs and missing Limit fields with the card context', async () => {
  const fixture = evaluatorFixture();
  const read = async (path) => {
    assert.ok(fixture.has(path), `missing fixture ${path}`);
    return fixture.get(path);
  };
  await checkEvaluatorDocs(read);
  const architecture = fixture.get(evaluatorDocs[1]);
  fixture.set(evaluatorDocs[1], `${architecture}\n<a id="controller-authority"></a>\n`);
  await assert.rejects(checkEvaluatorDocs(read), /architecture\.md: duplicate explicit ID/u);
  fixture.set(evaluatorDocs[1], architecture.replace(/^\| Limit \|.*\n/mu, ''));
  await assert.rejects(checkEvaluatorDocs(read), /architecture\.md#controller-authority: missing or duplicate Limit field/u);
});

function navigationLinks(document) {
  const visible = [];
  let fence;
  for (const line of document.split('\n')) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
    } else if (marker) {
      fence = marker[1];
    } else {
      visible.push(line);
    }
  }
  return markdownLinks(visible.join('\n').replace(/`[^`\n]*`|!\[[^\]]*\]\([^)]+\)/gu, ''));
}

function section(document, heading) {
  return new RegExp(`^## ${escapeRegex(heading)}\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'mu').exec(document)?.[1] ?? '';
}

async function checkEvaluatorNavigation(read = readRepositoryFile) {
  for (const entry of ['README.md', 'AGENTS.md', 'CLAUDE.md', 'docs/README.md']) {
    let document;
    try {
      document = await read(entry);
    } catch (error) {
      assert.fail(`${entry}: missing evaluation entry point (${error.message})`);
    }
    const links = navigationLinks(document);
    const guideLinks = links.filter(({ target }) => new URL(target, new URL(entry, root)).href === new URL(evaluatorDocs[0], root).href);
    assert.ok(guideLinks.length > 0, `${entry}: ordinary relative evaluator guide link required`);
    for (const { target } of guideLinks) await checkLocalTarget(entry, target, read);

    let authoredLinks = [];
    if (entry === 'README.md') authoredLinks = navigationLinks(section(document, 'Technical review'));
    if (entry === 'AGENTS.md') authoredLinks = navigationLinks(section(document, 'Repository evaluation'));
    if (entry === 'CLAUDE.md' || entry === 'docs/README.md') authoredLinks = links;
    for (const { target } of authoredLinks) await checkLocalTarget(entry, target, read);
    if (entry === 'docs/README.md') {
      const evaluators = document.indexOf('## For evaluators\n');
      const history = document.indexOf('## Process history\n');
      assert.ok(evaluators >= 0 && history > evaluators, `${entry}: evaluators must precede process history`);
    }
  }
}

test('repository entry points expose working evaluator navigation before process history', async () => {
  await checkEvaluatorNavigation();
});

test('evaluator navigation rejects omitted, misspelled, and example-only guide links', async () => {
  const guideLink = '[Evaluation guide](docs/evaluation/README.md)';
  const fixture = new Map([
    ['README.md', `## Technical review\n${guideLink}\n`],
    ['AGENTS.md', `## Repository evaluation\n${guideLink}\n`],
    ['CLAUDE.md', guideLink],
    ['docs/README.md', '## For evaluators\n[Evaluation guide](evaluation/README.md)\n## Process history\n'],
    [evaluatorDocs[0], 'Evaluation guide.\n'],
  ]);
  const read = async (path) => {
    assert.ok(fixture.has(path), `missing fixture ${path}`);
    return fixture.get(path);
  };
  await checkEvaluatorNavigation(read);
  for (const invalid of [
    'docs/evaluation/README.md',
    '[Evaluation guide](docs/evaluation/READM.md)',
    `\`\`\`markdown\n${guideLink}\n\`\`\``,
    `~~~markdown\n${guideLink}\n~~~`,
    `\`${guideLink}\``,
    `!${guideLink}`,
  ]) {
    fixture.set('README.md', `## Technical review\n${invalid}\n`);
    await assert.rejects(checkEvaluatorNavigation(read), /README\.md: ordinary relative evaluator guide link required/u);
  }
  fixture.set('README.md', guideLink);
  fixture.set('docs/README.md', '## For evaluators\n[Evaluation guide](evaluation/README.md)\n[Missing report](missing.md)\n## Process history\n');
  await assert.rejects(checkEvaluatorNavigation(read), /docs\/README\.md: broken target missing\.md: missing file/u);
});
