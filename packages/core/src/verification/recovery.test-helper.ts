import { readFileSync } from 'node:fs';
import type { DiagnosisRecoveryEvidence } from '../diagnose/hypotheses.js';

export function grantedRecovery(): DiagnosisRecoveryEvidence {
  return JSON.parse(readFileSync(new URL('./__fixtures__/recovery.json', import.meta.url), 'utf8')) as DiagnosisRecoveryEvidence;
}
