import type { Diagnosis } from '../domain.js';
import { checkRepairAuthorization, isAuthorizedRepairTarget, repairAuthorizationCommandMatches, type RepairAuthorizationContext } from './repair-authorization.js';
import type { RepairSourceExcerpt } from './repair.js';
import {
  isConventionalTestPath,
  parseUnifiedDiff,
} from '../diff/unified.js';
import {
  containsPassWithNoTestsBypass,
  isShellCommandPath,
  isTestCommandPath,
} from './test-bypass.js';
import { addsEsModuleSyntax, isCommonJsPath } from './module-syntax.js';
import {
  hasBroadPythonSuppression,
  hasPythonSkip,
  hasRelaxedPythonConfig,
  hasSwallowedPythonException,
  isPythonControlPath,
} from './python-safety.js';

export interface PatchVerdict {
  ok: boolean;
  violations: string[];
}

interface FileChange {
  path: string;
  deleted: boolean;
}

const TOOL_CONFIG =
  /(?:^|\/)(?:tsconfig(?:\.[^/]+)?\.json|eslint\.config\.[^/]+|\.eslintrc(?:\.[^/]+)?|\.eslintignore|vitest\.(?:config|workspace)\.[^/]+|vite\.config\.[^/]+|ruff\.toml|mypy\.ini|pytest\.ini|pyproject\.toml)$/;

function repairPathViolations(path: string, authorized = false): string[] {
  const violations: string[] = [];
  if (!authorized && isConventionalTestPath(path)) {
    violations.push(`touches test file: ${path}`);
  }
  if (!authorized && TOOL_CONFIG.test(path)) {
    violations.push(`touches tool config: ${path}`);
  }
  return violations;
}

export function isRepairPathAdmissible(path: string, diagnosis: Diagnosis, authorization?: RepairAuthorizationContext, source?: RepairSourceExcerpt): boolean {
  const authorized = authorization !== undefined && source !== undefined && source.path === path && repairAuthorizationCommandMatches(authorization, diagnosis.failingCmd) && isAuthorizedRepairTarget(authorization.session, authorization.baseline, source);
  return repairPathViolations(path, authorized).length === 0;
}
function parseChanges(diff: string): { changes: FileChange[]; valid: boolean } {
  const parsed = parseUnifiedDiff(diff);
  const changes = new Map<string, FileChange>();

  const addChange = (path: string | null, deleted: boolean): void => {
    if (!path) {
      return;
    }
    const existing = changes.get(path);
    changes.set(path, { path, deleted: deleted || existing?.deleted === true });
  };

  for (const file of parsed.files) {
    if (file.deleted) {
      addChange(file.oldPath, true);
    } else if (file.renamed) {
      addChange(file.oldPath, true);
      addChange(file.newPath, false);
    } else {
      addChange(file.oldPath, false);
      addChange(file.newPath, false);
    }
  }

  return { changes: [...changes.values()], valid: parsed.valid };
}

function addsPassWithNoTestsBypass(diff: string): boolean {
  const parsed = parseUnifiedDiff(diff);
  const allAdditions = parsed.files.flatMap((file) =>
    file.hunks.flatMap((hunk) => hunk.additions),
  );
  if (containsPassWithNoTestsBypass(allAdditions)) return true;
  return parsed.files.some((file) => {
    const path = file.newPath ?? file.oldPath ?? '';
    return isTestCommandPath(path) && containsPassWithNoTestsBypass(
      file.hunks.flatMap((hunk) => hunk.additions),
      {
        allowComposed: true,
        decodePackageJson: path === 'package.json',
        shellCommands: isShellCommandPath(path),
      },
    );
  });
}

export function vetPatch(diff: string, diagnosis: Diagnosis, authorization?: RepairAuthorizationContext): PatchVerdict {
  const parsed = parseChanges(diff);
  if (!parsed.valid) {
    return {
      ok: false,
      violations: ['patch contains an unrecognized or incomplete file change'],
    };
  }
  if (parsed.changes.length === 0) {
    return { ok: false, violations: ['patch has no recognized file changes'] };
  }

  const violations: string[] = [];
  if (addsPassWithNoTestsBypass(diff)) {
    violations.push('adds pass-with-no-tests bypass');
  }
  for (const change of parsed.changes) {
    if (change.deleted && isConventionalTestPath(change.path)) {
      violations.push(`deletes test file: ${change.path}`);
    } else {
      const authorized = authorization !== undefined && repairAuthorizationCommandMatches(authorization, diagnosis.failingCmd) && checkRepairAuthorization(authorization.session, authorization.baseline, diff, change.path);
      violations.push(...repairPathViolations(change.path, authorized));
    }
  }
  const unified = parseUnifiedDiff(diff);
  for (const file of unified.files) {
    const path = file.newPath ?? file.oldPath ?? '';
    for (const hunk of file.hunks) {
      const additions = hunk.additions;
      if (/\.pyi?$/u.test(path) && (
        hasPythonSkip(additions) ||
        hasBroadPythonSuppression(additions) ||
        hasSwallowedPythonException(additions)
      )) violations.push(`adds unsafe Python shortcut: ${path}`);
      if (isPythonControlPath(path) && hasRelaxedPythonConfig(path, additions)) {
        violations.push(`relaxes Python tool config: ${path}`);
      }
      if (isCommonJsPath(path) && addsEsModuleSyntax(additions)) {
        violations.push(`adds ES module syntax to CommonJS file: ${path}`);
      }
    }
  }

  return { ok: violations.length === 0, violations: [...new Set(violations)] };
}
