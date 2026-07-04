// Bumps the patch number in package.json. Runs as the first step of `npm run build`,
// so every produced dist/manifest.json carries a strictly increasing version
// (vite-plugin-web-extension reads the version from package.json).

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
const raw = await readFile(pkgPath, 'utf8');
const pkg = JSON.parse(raw);

const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(pkg.version || '');
if (!match) {
  console.error(`bump-version: package.json version "${pkg.version}" is not semver MAJOR.MINOR.PATCH`);
  process.exit(1);
}

const [, major, minor, patch] = match;
const next = `${major}.${minor}.${Number(patch) + 1}`;
pkg.version = next;

// Preserve the original indentation (2 spaces + trailing newline) so the diff stays minimal.
await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

console.log(`bump-version: ${match[0]} → ${next}`);
