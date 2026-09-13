export { canonicalJson, contentHash } from './canonical.js';
export {
  CASE_LAB_CASE_IDS,
  CASE_LAB_CASES,
  CASE_LAB_OUTCOMES,
  CaseLabRequestError,
  caseLabCase,
  isCaseLabCaseId,
  isCaseLabOutcome,
} from './cases.js';
export type {
  CaseLabCase,
  CaseLabCaseId,
  CaseLabMaterializer,
  CaseLabOutcome,
} from './cases.js';
export {
  MAX_REQUEST_BYTES,
  parseCaseLabRequest,
  parseCaseLabRequestText,
} from './request.js';
export type { CaseLabRequest } from './request.js';
export {
  CASE_LAB_LIMITS,
  caseLabDispatchDecision,
  retryAfterSeconds,
  runsInLastHour,
  runsToday,
  startOfUtcDay,
} from './limits.js';
export type {
  CaseLabDispatchDecision,
  CaseLabLimits,
  CaseLabRefusalReason,
  DispatchWindow,
  RunTimestamp,
} from './limits.js';
export {
  CASE_LAB_RESULT_SCHEMA_VERSION,
  CaseLabResultError,
  MAX_RESULT_BYTES,
  assertCaseLabResultPublicSafe,
  createCaseLabResult,
  publicGitHubUrl,
  validateCaseLabCaseFile,
  validateCaseLabResult,
} from './result.js';
export type {
  CaseLabCaseFile,
  CaseLabResult,
  CaseLabResultBase,
  CaseLabResultLinks,
} from './result.js';
export {
  LIVE_REQUEST_ID_PATTERN,
  MODES,
  MODE_LABELS,
  OUTCOME_LABELS,
  isCaseLabMode,
  isPublicHttpsUrl,
  modeLabel,
} from './labels.js';
export type { CaseLabMode, ModeDescription } from './labels.js';
export { SHA256_PATTERN, SHA_PATTERN, isRecord, readBoundedJson, stringLeaves } from './util.js';
export {
  GitHubDispatchError,
  createGitHubDispatchClient,
} from './github.js';
export type {
  FetchLike,
  GitHubDispatchClient,
  GitHubDispatchClientOptions,
  WorkflowRunSummary,
} from './github.js';
export {
  CASE_LAB_WORKFLOW_FILE,
  CASE_LAB_WORKFLOW_REF,
  CaseLabConfigurationError,
  DEMO_REPOSITORY,
  FORBIDDEN_DISPATCHER_ENV,
  caseLabEnvironment,
  createCaseLabHandler,
  liveRequestId,
} from './dispatcher.js';
export type {
  CaseLabEnvironment,
  CaseLabHandler,
  CaseLabHandlerDependencies,
  CaseLabHttpRequest,
  CaseLabHttpResponse,
  ReleaseIdentity,
} from './dispatcher.js';
export {
  CaseLabEvidenceError,
  RECORDED_LEDGER_FILE,
  RECORDED_RESULT_FILE,
  loadRecordedEvidence,
  recordedEvaluation,
} from './evidence.js';
export type {
  RecordedEvaluation,
  RecordedEvidence,
  RecordedLedgerEntry,
  RecordedLedgerFile,
  RecordedResultFile,
} from './evidence.js';
export {
  CaseLabReplayError,
  PACKAGE_DIR,
  REPLAY_DIR,
  REPLAY_FIXTURE_SCHEMA_VERSION,
  REPOSITORY_ROOT,
  parseReplayFixture,
  caseFileCost,
  deterministicResult,
  loadRelease,
  plainCaseFile,
  readReplayBundleFile,
  recordedResult,
  replayCatalog,
  replayedResult,
} from './replay.js';
export type {
  RecordedResultOptions,
  ReplayCatalogOptions,
  ReplayFixture,
  ReplayedResultOptions,
} from './replay.js';
export { CaseLabCliError, USAGE, runCaseLabCli, valueAfter, writeNew } from './cli.js';
export type { CliDependencies, CliIo } from './cli.js';
export { ACCEPTANCE_SCHEMA_VERSION, acceptance } from './acceptance.js';
export type { AcceptanceCheck, AcceptanceOptions, AcceptanceRecord } from './acceptance.js';
export {
  ABOUT_DESCRIPTION,
  ABOUT_PATH,
  ABOUT_TITLE,
  CONSENT_STORAGE_KEY,
  PRIVACY_DESCRIPTION,
  PRIVACY_PATH,
  PRIVACY_TITLE,
  REPOSITORY_URL,
  consentTools,
  cookielessIdentifiers,
  escapeHtml,
  isRenderableResult,
  markdownHref,
  modeBadge,
  outcomeBadge,
  renderAboutBody,
  renderCaseCard,
  renderCounterfactual,
  renderIndexBody,
  renderInlineMarkdown,
  renderMarkdown,
  renderPage,
  renderPageLinks,
  renderPendingBody,
  renderPrivacyBody,
  renderResultBody,
  resultPageTitle,
} from './render.js';
export type { CatalogCard, ConsentTool, IndexOptions, PageShellOptions, PendingState, SiteIdentifiers } from './render.js';
export { createStaticServer, listen } from './serve.js';
export { ABOUT_SOURCE_FILE, buildSite, bundleClient } from './site.js';
export type { BuildSiteOptions } from './site.js';
export { SITE_CONFIG_FILE, SITE_CONFIG_SCHEMA_VERSION, loadSiteConfig } from './site-config.js';
export type { SiteConfig } from './site-config.js';
export { CaseLabPinError, DEMO_WORKFLOW_FILE, parseDemoWorkflowPins, verifyPin, withControllerSha } from './pin.js';
export type { DemoWorkflowPins } from './pin.js';
export { normalizeOutcome, publishResult } from './publish.js';
export type { PublishInputs } from './publish.js';
export {
  buildTwoPatchComparison,
  RegressionComparisonError,
  renderTwoPatchComparison,
} from './regression.js';
export type {
  ComparisonArm,
  ComparisonBaseline,
  IndependentCheck,
  TwoPatchComparison,
} from './regression.js';
export { caseVerdict, FORBIDDEN_VERDICT_CLAIMS, renderVerdict } from './verdict.js';
export type { CaseVerdict, VerdictTone } from './verdict.js';
