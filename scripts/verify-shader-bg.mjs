#!/usr/bin/env node
/**
 * verify-shader-bg.mjs — does the shader chain actually compile and render here?
 *
 * There is no glslang on this box, so a real browser is the only validator (the
 * same conclusion ~/.config/ghostty/tools/check_compile.py reached). This serves
 * public/ on an ephemeral port, loads index.html in headless Chrome, and checks:
 *
 *   1. <html data-shader-bg> says "ok: <chain>", not "failed: …"
 *   2. nothing in the console matched a shader compile/link failure
 *   3. the screenshot is not a black or flat frame
 *
 * SwiftShader is fine and expected here — this checks CORRECTNESS. It is not a
 * benchmark, and a number taken from it would be about the CPU rasterizer.
 * Real timing comes from the panel itself: shaderBg.status() / shaderBg.retune().
 *
 *   npm run verify-shaders
 *   node scripts/verify-shader-bg.mjs --keep   # leave the screenshot in place
 */

import { spawn } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { mkdtemp, rm, mkdir, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, '..', 'public');
const OUT_DIR = '/tmp/claude-output';
const SHOT = path.join(OUT_DIR, 'shader-bg-verify.png');

const CHROME_CANDIDATES = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/opt/google/chrome/chrome',
];

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.glsl': 'text/plain', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

function findChrome() {
  const found = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!found) throw new Error(`no chrome found; looked in:\n  ${CHROME_CANDIDATES.join('\n  ')}`);
  return found;
}

function serve(root) {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost');
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/' || rel === '') rel = '/index.html';
      const full = path.join(root, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
      if (!full.startsWith(root)) { res.writeHead(403).end(); return; }
      try {
        const st = await stat(full);
        if (!st.isFile()) throw new Error('not a file');
      } catch {
        // The panel's own /api/* calls 404 here. Expected: this verifies the
        // background, not the API, and a 404 is what the page's own error paths
        // are written against.
        res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(full)] ?? 'application/octet-stream' });
      createReadStream(full).pipe(res);
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function runChrome(chrome, args, timeoutMs = 180_000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`chrome timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
    proc.on('close', () => { clearTimeout(timer); resolve({ stdout, stderr }); });
  });
}

const BASE_FLAGS = (profile) => [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu-sandbox',
  '--enable-unsafe-swiftshader',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  `--user-data-dir=${profile}`,
  '--window-size=1280,800',
  '--hide-scrollbars',
  '--virtual-time-budget=12000',
  '--enable-logging=stderr',
  '--log-level=0',
];

/** Decide pass/fail from the reflected root attribute + console output. */
function analyze(dom, stderr) {
  const problems = [];

  const m = dom.match(/data-shader-bg="([^"]*)"/);
  const state = m ? m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&') : null;

  if (state === null) {
    problems.push('index.html has no data-shader-bg — shader-bg.js never reached init()');
  } else if (!state.startsWith('ok:')) {
    problems.push(`shader-bg reported: ${state}`);
  }

  if (/class="[^"]*\bno-shader-bg\b/.test(dom)) {
    problems.push('<html> carries .no-shader-bg — the chain fell back');
  }

  for (const line of stderr.split('\n')) {
    if (/compile failed|link failed|CONTEXT LOST|not in the browser uniform contract/i.test(line)) {
      problems.push(`console: ${line.trim()}`);
    }
  }

  return { state, problems };
}

async function main() {
  const keep = process.argv.includes('--keep');
  const chrome = findChrome();
  await mkdir(OUT_DIR, { recursive: true });

  const { server, port } = await serve(PUBLIC);
  // shaderbg=force: headless chrome only gets SwiftShader on this box, and
  //   shader-bg.js refuses software renderers in normal use (one frame of
  //   medium.glsl on a CPU takes tens of seconds). Forcing it is the whole
  //   point here — we are asking "does it compile and produce pixels", not
  //   "is it fast", and the answer to the latter is already known to be no.
  // shadert=120: start past the boot animation. Frame 1 is the cathode-glow
  //   phase, which is legitimately almost black — a flat-frame check against
  //   it would fail on a perfectly healthy chain.
  const url = `http://127.0.0.1:${port}/index.html?shaderbg=force&shadert=120`;
  console.log(`  chrome:  ${chrome}`);
  console.log(`  serving: ${PUBLIC} on :${port}\n`);

  const profiles = [];
  try {
    const domProfile = await mkdtemp(path.join(tmpdir(), 'shaderbg-dom-'));
    profiles.push(domProfile);
    const dumped = await runChrome(chrome, [...BASE_FLAGS(domProfile), '--dump-dom', url]);

    const shotProfile = await mkdtemp(path.join(tmpdir(), 'shaderbg-shot-'));
    profiles.push(shotProfile);
    await runChrome(chrome, [...BASE_FLAGS(shotProfile), `--screenshot=${SHOT}`, url]);

    const { state, problems } = analyze(dumped.stdout, dumped.stderr);

    if (state) console.log(`  data-shader-bg = ${state}\n`);

    if (existsSync(SHOT)) {
      const st = await stat(SHOT);
      console.log(`  screenshot: ${SHOT} (${st.size} B)`);
      // A chain that compiles but renders nothing produces a near-uniform PNG,
      // which compresses to almost nothing. Cheap smoke test, no image library.
      if (st.size < 12_000) {
        problems.push(`screenshot is only ${st.size} B — frame is probably flat/black`);
      }
    } else {
      problems.push('chrome produced no screenshot');
    }

    if (problems.length) {
      console.error('\n✗ verification failed:');
      for (const p of problems) console.error(`    ${p}`);
      return 1;
    }

    console.log('\n✓ chain compiles and renders under headless chrome (swiftshader)');
    console.log('  NOTE: this is a correctness check. For real timing, open the');
    console.log('        panel and read shaderBg.status() in the console.');
    return 0;
  } finally {
    server.close();
    for (const p of profiles) await rm(p, { recursive: true, force: true });
    if (!keep && existsSync(SHOT)) { /* left in /tmp/claude-output on purpose */ }
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`✗ verify-shader-bg failed: ${err.message}`);
    process.exit(1);
  });
