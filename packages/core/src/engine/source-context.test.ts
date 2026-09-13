import { describe, expect, it } from 'vitest';

import { sourceDependencyGroups } from './source-context.js';

describe('sourceDependencyGroups', () => {
  it('resolves ESM JavaScript specifiers to bounded TypeScript candidates', () => {
    const groups = sourceDependencyGroups([{
      path: 'packages/core/src/dogfood-add.test.ts', startLine: 1, truncated: false,
      content: "import { add } from './dogfood-add.js';\nexpect(add(2, 3)).toBe(5);\n",
    }], 'node');

    expect(groups).toEqual([{
      sourcePath: 'packages/core/src/dogfood-add.test.ts',
      specifier: './dogfood-add.js',
      candidates: [
        'packages/core/src/dogfood-add.js',
        'packages/core/src/dogfood-add.ts',
        'packages/core/src/dogfood-add.tsx',
      ],
    }]);
  });

  it('recognizes side-effect, export, dynamic, require, and index imports', () => {
    const [group] = sourceDependencyGroups([{
      path: 'src/entry.ts', startLine: 1, truncated: false,
      content: [
        "import './setup';",
        "export { value } from './module.js';",
        "const dynamic = import('./dynamic.mjs');",
        "const legacy = require('./legacy.cjs');",
      ].join('\n'),
    }], 'node');

    expect(group?.candidates).toContain('src/setup.ts');
    expect(sourceDependencyGroups([{
      path: 'src/entry.ts', startLine: 1, truncated: false,
      content: "import './folder';",
    }], 'node')[0]?.candidates).toContain('src/folder/index.ts');
    expect(sourceDependencyGroups([{
      path: 'src/entry.ts', startLine: 1, truncated: false,
      content: "export { value } from './module.js';\nimport('./dynamic.mjs');\nrequire('./legacy.cjs');",
    }], 'node').map(({ specifier }) => specifier)).toEqual([
      './module.js', './dynamic.mjs', './legacy.cjs',
    ]);
  });

  it('resolves bounded Python relative modules without executing them', () => {
    expect(sourceDependencyGroups([{
      path: 'app/tests/test_math.py', startLine: 1, truncated: false,
      content: 'from ..math.ops import add\nfrom . import helpers\n',
    }], 'python')).toEqual([
      {
        sourcePath: 'app/tests/test_math.py', specifier: '..math.ops',
        candidates: ['app/math/ops.py', 'app/math/ops.pyi', 'app/math/ops/__init__.py', 'app/math/ops/__init__.pyi'],
      },
      {
        sourcePath: 'app/tests/test_math.py', specifier: '.helpers',
        candidates: [
          'app/tests/helpers.py', 'app/tests/helpers.pyi',
          'app/tests/helpers/__init__.py', 'app/tests/helpers/__init__.pyi',
        ],
      },
    ]);
  });

  it('resolves multiple aliased same-package Python module imports', () => {
    expect(sourceDependencyGroups([{
      path: 'app/test_value.py', startLine: 1, truncated: false,
      content: 'from . import helpers as h, fixtures\n',
    }], 'python').map(({ specifier }) => specifier)).toEqual([
      '.helpers', '.fixtures',
    ]);
  });

  it('resolves Python absolute imports against the root, the importing directory, and src', () => {
    expect(sourceDependencyGroups([{
      path: 'tests/test_cache.py', startLine: 1, truncated: false,
      content: 'import unittest\n\nfrom cache import cache_key\nimport app.core as core, os\n',
    }], 'python')).toEqual([
      {
        sourcePath: 'tests/test_cache.py', specifier: 'cache',
        candidates: [
          'cache.py', 'cache.pyi', 'cache/__init__.py', 'cache/__init__.pyi',
          'tests/cache.py', 'tests/cache.pyi', 'tests/cache/__init__.py', 'tests/cache/__init__.pyi',
          'src/cache.py', 'src/cache.pyi', 'src/cache/__init__.py', 'src/cache/__init__.pyi',
        ],
      },
      {
        sourcePath: 'tests/test_cache.py', specifier: 'app.core',
        candidates: [
          'app/core.py', 'app/core.pyi', 'app/core/__init__.py', 'app/core/__init__.pyi',
          'tests/app/core.py', 'tests/app/core.pyi', 'tests/app/core/__init__.py', 'tests/app/core/__init__.pyi',
          'src/app/core.py', 'src/app/core.pyi', 'src/app/core/__init__.py', 'src/app/core/__init__.pyi',
        ],
      },
    ]);
  });

  it('scans adversarially padded Python imports in bounded time', () => {
    const content = `from cache import ${' '.repeat(100_000)}cache_key\n`;
    const startedAt = performance.now();
    const groups = sourceDependencyGroups([{
      path: 'tests/test_cache.py', startLine: 1, truncated: false, content,
    }], 'python');

    expect(groups.map(({ specifier }) => specifier)).toEqual(['cache']);
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });

  it('skips Python absolute imports whose module is already in the closure', () => {
    expect(sourceDependencyGroups([{
      path: 'tests/test_app.py', startLine: 1, truncated: false,
      content: 'from app import fetch_name\n',
    }], 'python', new Set(['app.py']))).toEqual([]);
  });

  it('rejects traversal and skips dependencies with an already known variant', () => {
    expect(sourceDependencyGroups([{
      path: 'src/test.ts', startLine: 1, truncated: false,
      content: "import value from '../../outside.js';\nimport local from './local.js';",
    }], 'node', new Set(['src/local.ts']))).toEqual([]);
  });
});
