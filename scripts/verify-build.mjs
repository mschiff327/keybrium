// scripts/verify-build.mjs
// Node 20+, ESM .mjs

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import process from 'node:process';

let failed = false;

const root = process.cwd();
const pkgsDir = path.join(root, 'packages');

async function readJSON(file) {
  try {
    const txt = await fs.readFile(file, 'utf8');
    return JSON.parse(txt);
  } catch (e) {
    fail(`${file}: cannot parse JSON (${e.message})`);
    return null;
  }
}

async function exists(p) {
  try { await fs.stat(p); return true; } catch { return false; }
}

function fail(msg) { console.error(`✖ ${msg}`); failed = true; }
function warn(msg) { console.warn(`! ${msg}`); }

(async function main() {
  // discover workspaces under packages/*
  let dirs = [];
  try {
    dirs = (await fs.readdir(pkgsDir, { withFileTypes: true }))
        .filter(d => d.isDirectory())
        .map(d => path.join('packages', d.name));
  } catch {
    fail('packages/ not found');
    process.exit(1);
  }

  const publishable = [];
  for (const dir of dirs) {
    const pkgPath = path.join(dir, 'package.json');
    if (!(await exists(pkgPath))) continue;
    const pkg = await readJSON(pkgPath);
    if (!pkg) continue;
    if (pkg.private) continue;
    publishable.push({ dir, pkg });
  }

  for (const { dir, pkg } of publishable) {
    const dist = path.join(dir, 'dist');
    // 1) dist exists and is non-empty
    try {
      const list = await fs.readdir(dist);
      if (!list.length) throw new Error('empty');
    } catch {
      fail(`${dir}: missing or empty dist/ (did you run "npm -ws run build"?)`);
      continue;
    }

    // 2) verify that all declared entry fields exist
    const declared = new Set();
    const add = rel => { if (rel && typeof rel === 'string') declared.add(rel); };

    add(pkg.main);
    add(pkg.module);
    add(pkg.types || pkg.typings);

    if (typeof pkg.exports === 'string') {
      add(pkg.exports);
    } else if (typeof pkg.exports === 'object' && pkg.exports) {
      const rootExport = pkg.exports['.'] ?? pkg.exports;
      if (typeof rootExport === 'string') {
        add(rootExport);
      } else if (typeof rootExport === 'object' && rootExport) {
        add(rootExport.import);
        add(rootExport.require);
        add(rootExport.default);
        add(rootExport.types);
      }
    }

    for (const rel of declared) {
      const full = path.join(dir, rel);
      if (!(await exists(full))) {
        // helpful note for common .mjs vs .js mismatch
        if (rel.endsWith('.mjs')) {
          const twin = rel.replace(/\.mjs$/, '.js');
          if (await exists(path.join(dir, twin))) {
            warn(`${dir}: "${rel}" not found but "${twin}" exists. Consider either building an .mjs output or updating package.json to point to .js`);
            continue;
          }
        }
        fail(`${dir}: declared entry "${rel}" does not exist`);
      }
    }

    // 3) recommend that "files" includes dist/ so only built files are published
    if (!Array.isArray(pkg.files) || !pkg.files.some(s => s === 'dist' || s?.startsWith?.('dist/'))) {
      warn(`${dir}: package.json "files" does not include "dist" – not fatal, but recommended`);
    }

    // 4) runtime sanity check (import/require)
    try {
      if (pkg.type === 'module' && pkg.main) {
        execSync(
            `node -e "import('file://${path.resolve(dir, pkg.main)}').then(()=>{}).catch(e=>{console.error(e);process.exit(1)})"`,
            { stdio: 'inherit' }
        );
      } else if (pkg.main) {
        const p = path.resolve(dir, pkg.main).replace(/\\/g, '/');
        execSync(`node -e "require('${p}')"`, { stdio: 'inherit' });
      }
    } catch {
      fail(`${dir}: runtime import/require failed`);
    }

    // 5) npm pack --dry-run to verify publish contents actually include dist/
    try {
      const res = spawnSync('npm', ['pack', '--dry-run', '--json'], { cwd: dir, encoding: 'utf8' });
      if (res.status !== 0) throw new Error(res.stderr || 'npm pack failed');
      const json = JSON.parse(res.stdout);
      const files = json?.[0]?.files?.map(f => f.path) ?? [];
      if (!files.some(f => f.startsWith('dist/'))) {
        fail(`${dir}: npm pack did not include dist/`);
      }
    } catch (e) {
      fail(`${dir}: npm pack --dry-run check failed: ${e.message}`);
    }
  }

  if (failed) process.exit(1);
  console.log('✓ verify-build passed for all publishable packages');
})();
