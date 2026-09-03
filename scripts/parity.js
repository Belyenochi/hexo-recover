#!/usr/bin/env node
/**
 * Semantic parity check between the JavaScript and Python implementations:
 * run both on the same generated site and require byte-identical Markdown for
 * every post, plus identical _config.yml / _config.next.yml / package.json.
 *
 *   node scripts/parity.js <site-dir> [extra recover args...]
 *
 * Needs the Python package installed: python/.venv/bin/hexo-recover, or set
 * HEXO_RECOVER_PY to its path.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [site, ...extra] = process.argv.slice(2);
if (!site) { console.error('usage: parity.js <site-dir> [recover args]'); process.exit(2); }
const py = process.env.HEXO_RECOVER_PY || path.join(here, '..', 'python', '.venv', 'bin', 'hexo-recover');
if (!fs.existsSync(py)) { console.error(`python CLI not found at ${py}`); process.exit(2); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-'));
const jsOut = path.join(tmp, 'js');
const pyOut = path.join(tmp, 'py');
execFileSync('node', [path.join(here, '..', 'src', 'cli.js'), 'recover', site, jsOut, ...extra], { stdio: 'inherit' });
execFileSync(py, ['recover', site, pyOut, ...extra], { stdio: 'inherit' });

let diffs = 0;
const compareDir = (a, b, label) => {
  const fa = fs.existsSync(a) ? fs.readdirSync(a).sort() : [];
  const fb = fs.existsSync(b) ? fs.readdirSync(b).sort() : [];
  if (fa.join() !== fb.join()) { console.log(`  ${label}: file lists differ\n    js: ${fa}\n    py: ${fb}`); diffs++; }
  for (const f of fa) {
    if (!fb.includes(f)) continue;
    const x = fs.readFileSync(path.join(a, f));
    const y = fs.readFileSync(path.join(b, f));
    if (!x.equals(y)) { diffs++; console.log(`  ${label}/${f}: differs`); }
  }
};
compareDir(path.join(jsOut, 'source', '_posts'), path.join(pyOut, 'source', '_posts'), 'source/_posts');
compareDir(path.join(jsOut, '_private'), path.join(pyOut, '_private'), '_private');
for (const f of ['_config.yml', '_config.next.yml', 'package.json']) {
  const x = fs.readFileSync(path.join(jsOut, f), 'utf8');
  const y = fs.readFileSync(path.join(pyOut, f), 'utf8');
  if (x !== y) { diffs++; console.log(`  ${f}: differs`); }
}
const n = fs.readdirSync(path.join(jsOut, 'source', '_posts')).length;
console.log(diffs ? `PARITY FAILED: ${diffs} difference(s)` : `parity ok: ${n} posts and 3 config files byte-identical`);
process.exit(diffs ? 1 : 0);
