import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// The seam that took sassi.nooutco.me down for three days, pinned.
//
// webportal/package.json builds with `tsc --noEmit && vite build`, and tsconfig.json
// includes `functions`. Cloudflare builds this project with the root directory set to
// `webportal`, so the only `npm install` that runs is the one inside it, and there is
// no repo-root node_modules at all. A test file inside an included directory imports
// vitest, tsc resolves that by walking up to the root tree, and the build fails.
//
// A laptop has the root tree. CI has the root tree. Both stay green while every deploy
// fails, which is why this needs a test rather than a comment.
const PORTAL = dirname(dirname(fileURLToPath(import.meta.url)));
const TEST_SUFFIXES = ['.test.ts', '.test.tsx'];

/** The tsconfigs carry `//` comments, which JSON.parse will not take. */
function readTsconfig(name: string): { include: string[]; exclude: string[] } {
  const raw = readFileSync(join(PORTAL, name), 'utf8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
  return JSON.parse(raw);
}

function findTestFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) findTestFiles(full, out);
    else if (TEST_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) out.push(full);
  }
  return out;
}

/** Enough of a glob for the shapes a tsconfig exclude list actually uses. */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, ' ')
    .replace(/\*/g, '[^/]*')
    .replace(/ /g, '(?:.*/)?');
  return new RegExp(`^${escaped}(?:/.*)?$`);
}

describe('the production tsconfig cannot compile a test file', () => {
  const production = readTsconfig('tsconfig.json');

  it('leaves no test file inside the compiled program', () => {
    const excluded = production.exclude.map(globToRegExp);
    const leaked = production.include
      .flatMap((dir) => findTestFiles(join(PORTAL, dir)))
      .map((file) => relative(PORTAL, file).split(sep).join('/'))
      .filter((file) => !excluded.some((pattern) => pattern.test(file)));
    expect(leaked).toEqual([]);
  });

  it('still typechecks every test, via tsconfig.test.json', () => {
    // Keeping the tests out of the production program is only safe because a second
    // config picks them up. Let that config grow an exclude list, or lose a directory,
    // and the arrangement stops protecting the build and starts hiding type errors.
    const forTests = readTsconfig('tsconfig.test.json');
    expect(forTests.exclude).toEqual([]);
    for (const dir of [...production.include, 'functions-tests']) {
      expect(forTests.include).toContain(dir);
    }
  });
});
