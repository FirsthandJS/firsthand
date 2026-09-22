/**
 * What the compiler case suites compile with.
 *
 * One filename and one package name for all of them, because a stable build id
 * is derived from both and several tests assert on it.
 */

import { transform } from '@/api.js';

export const compile = (code: string, typescript = false): string =>
  transform(code, { filename: 'src/demo.tsx', packageName: 'demo', typescript });

export const IMPORTS = "import { component } from '@firsthandjs/core';\n";
