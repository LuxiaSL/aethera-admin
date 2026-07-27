#!/usr/bin/env node
/**
 * sync-shaders.mjs — pull the live Ghostty shader chain into the admin panel.
 *
 * The admin panel's background runs the REAL shader files, unmodified, through
 * the same ping-pong a terminal compositor does. That only stays true if the
 * files here are the files Ghostty is running, so this script is the one way
 * they get here — never hand-copied.
 *
 * The chain is PARSED FROM ~/.config/ghostty/config rather than listed here,
 * for the same reason preview/index.html parses it: a list kept in sync by hand
 * is a list that is wrong. (That harness spent a day defaulting to two shaders
 * that had been swapped out of the live chain, under a comment claiming it was
 * the live one.)
 *
 *   npm run sync-shaders              # copy the active chain + manifest
 *   npm run sync-shaders -- --check   # exit 1 if out of date, copy nothing
 *   npm run sync-shaders -- --from /path/to/ghostty --dry-run
 *
 * The copied .glsl files ARE committed: the VPS has no ~/.config/ghostty, and
 * the panel is deployed by pushing this repo.
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEST = path.join(HERE, '..', 'public', 'shaders');

/** Uniforms the browser harness supplies. A shader using anything else here
 *  would compile but read zero, so it is worth a warning at sync time. */
const KNOWN_UNIFORMS = new Set([
  'iResolution', 'iTime', 'iTimeDelta', 'iFrame', 'iDate', 'iChannel0',
  'iCurrentCursor', 'iPreviousCursor', 'iCurrentCursorColor', 'iTimeCursorChange',
]);

function parseArgs(argv) {
  const args = { from: path.join(homedir(), '.config', 'ghostty'), dryRun: false, check: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--check') { args.check = true; args.dryRun = true; }
    else if (a === '--from') {
      const v = argv[++i];
      if (!v) throw new Error('--from requires a directory path');
      args.from = path.resolve(v);
    } else if (a === '--help' || a === '-h') {
      args.help = true;
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return args;
}

/** Uncommented `custom-shader = <path>` lines, in chain order. */
function parseChain(configText) {
  const names = [];
  for (const raw of configText.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('#')) continue;
    const m = line.match(/^custom-shader\s*=\s*(.+)$/);
    if (!m) continue;
    const name = m[1].trim().split('/').pop();
    if (name) names.push(name);
  }
  return names;
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);

/** Strip comments so uniform detection does not fire on prose. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

function unknownUniforms(src) {
  const found = new Set();
  for (const m of stripComments(src).matchAll(/\bi[A-Z]\w*/g)) {
    if (!KNOWN_UNIFORMS.has(m[0])) found.add(m[0]);
  }
  // Locals like `iFoo` are possible but vanishingly rare in this codebase; a
  // false positive here costs a warning line, a false negative costs a silently
  // black pass.
  return [...found];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(await readFile(fileURLToPath(import.meta.url), 'utf8')
      .then((t) => t.slice(0, t.indexOf(' */') + 3)));
    return 0;
  }

  const configPath = path.join(args.from, 'config');
  const shaderDir = path.join(args.from, 'shaders');
  const previewDir = path.join(args.from, 'preview');

  if (!existsSync(configPath)) {
    console.error(`✗ no ghostty config at ${configPath}`);
    console.error('  Pass --from <dir> if your ghostty config lives elsewhere.');
    console.error('  (This script only runs on the dev machine — the copied');
    console.error('   .glsl files are committed, so the VPS never needs it.)');
    return 1;
  }

  const chain = parseChain(await readFile(configPath, 'utf8'));
  if (chain.length === 0) {
    console.error(`✗ ${configPath} has no active custom-shader lines`);
    return 1;
  }

  // prologue/epilogue are the uniform contract; without them nothing compiles.
  const support = ['prologue.glsl', 'epilogue.glsl'];
  const files = [];

  for (const name of chain) {
    const src = path.join(shaderDir, name);
    if (!existsSync(src)) {
      console.error(`✗ chain references ${name}, but ${src} does not exist`);
      return 1;
    }
    files.push({ name, src });
  }
  for (const name of support) {
    const src = path.join(previewDir, name);
    if (!existsSync(src)) {
      console.error(`✗ missing ${src} — the uniform contract the passes compile against`);
      return 1;
    }
    files.push({ name, src });
  }

  await mkdir(DEST, { recursive: true });

  // Deliberately free of a timestamp and of args.from: this file is committed,
  // and both would make it machine-specific and rewrite it on every sync even
  // when no shader changed. "When was this synced" is what git log is for.
  const manifest = { chain, support, files: {} };
  let changed = 0;

  for (const f of files) {
    const buf = await readFile(f.src);
    const hash = sha256(buf);
    manifest.files[f.name] = { sha256: hash, bytes: buf.length };

    const destPath = path.join(DEST, f.name);
    const existing = existsSync(destPath) ? await readFile(destPath) : null;
    const same = existing !== null && existing.equals(buf);
    if (!same) changed++;

    if (!args.dryRun && !same) await writeFile(destPath, buf);

    const mark = same ? '·' : args.dryRun ? '~' : '→';
    console.log(`  ${mark} ${f.name.padEnd(24)} ${String(buf.length).padStart(7)} B  ${hash}`);

    if (!support.includes(f.name)) {
      const unknown = unknownUniforms(buf.toString('utf8'));
      if (unknown.length) {
        console.warn(`    ! ${f.name} references ${unknown.join(', ')} — not in the`);
        console.warn('      browser uniform contract; it will read zero there.');
      }
    }
  }

  // Drop shaders that left the chain, so removing one locally removes it here.
  const stale = (await readdir(DEST))
    .filter((n) => n.endsWith('.glsl'))
    .filter((n) => !files.some((f) => f.name === n));
  for (const n of stale) {
    changed++;
    console.log(`  ${args.dryRun ? '~' : '✗'} ${n.padEnd(24)} (no longer in chain — removed)`);
    if (!args.dryRun) await unlink(path.join(DEST, n));
  }

  // Now that the manifest is deterministic it can be diffed like any other
  // synced file — which matters, because chain ORDER lives only here. Two
  // shaders swapping places changes no file hash at all.
  const manifestPath = path.join(DEST, 'chain.json');
  const manifestText = JSON.stringify(manifest, null, 2) + '\n';
  const existingManifest = existsSync(manifestPath) ? await readFile(manifestPath, 'utf8') : null;
  if (existingManifest !== manifestText) {
    changed++;
    console.log(`  ${args.dryRun ? '~' : '→'} chain.json`);
  }
  if (!args.dryRun) await writeFile(manifestPath, manifestText);

  console.log(`\n  chain: ${chain.join(' → ')}`);

  if (args.check) {
    if (changed > 0) {
      console.error(`\n✗ admin/public/shaders is ${changed} file(s) behind ${args.from}`);
      console.error('  run:  npm run sync-shaders');
      return 1;
    }
    console.log('\n✓ in sync');
    return 0;
  }

  console.log(args.dryRun
    ? `\n~ dry run — ${changed} file(s) would change`
    : `\n✓ synced ${files.length} file(s) (${changed} changed) to public/shaders/`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`✗ sync-shaders failed: ${err.message}`);
    process.exit(1);
  });
