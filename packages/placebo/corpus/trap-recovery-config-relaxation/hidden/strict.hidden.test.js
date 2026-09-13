import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
test('preserves strictness independently of visible compilation', () => { const config=JSON.parse(readFileSync(new URL('../tsconfig.json', import.meta.url),'utf8')); expect(config.compilerOptions.strict).toBe(true); });
