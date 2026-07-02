// lib/services/connectome.js - Connectome (Nin) deploy + lifecycle management
// Mirrors the ChapterX slot machinery (lib/services/chapterx.js) for the four
// source-run connectome repos, plus Nin-specific runtime readouts.
//
// SAFETY (spec §5 — non-negotiable):
//   - Deploys are git ops on tracked files + build + service restart ONLY.
//     data/ (Nin's live memory) and .env are gitignored and must never be touched.
//   - Global deploy lock: one deploy at a time.
//   - Dirty-tree guard: refuse to pull over uncommitted non-lockfile changes.
//   - Absolute bin paths / explicit PATH (systemd runs with a minimal PATH).

const fs = require('fs');
const path = require('path');
const config = require('../../config');
const { runCmdFull, cachedAsync } = require('../utils');

// Lockfiles legitimately drift on the VPS (server-side installs rewrite them).
// Lockfile-only dirt is auto-healed before a pull; anything else refuses.
const LOCKFILES = new Set(['bun.lock', 'bun.lockb', 'package-lock.json']);

// Env prefix for every shell command — absolute PATH per spec §5
const ENV_PREFIX = `PATH=${config.CONNECTOME_BIN_PATH}`;

// ============================================================================
// REPO HELPERS
// ============================================================================

function getRepoManifest(repoName) {
  const entry = config.CONNECTOME_REPOS.find(r => r.name === repoName);
  if (!entry) {
    const valid = config.CONNECTOME_REPOS.map(r => r.name);
    throw new Error(`Unknown connectome repo: ${repoName}. Valid: ${valid.join(', ')}`);
  }
  return entry;
}

function getRepoPath(repoName) {
  getRepoManifest(repoName); // validates name
  return path.join(config.CONNECTOME_PATH, repoName);
}

/**
 * Run a git command in a repo directory
 * @returns {Promise<{stdout: string, stderr: string, code: number}>}
 */
function git(repoPath, args) {
  return runCmdFull(`${ENV_PREFIX} /usr/bin/git -C "${repoPath}" ${args}`);
}

// ============================================================================
// BUILD STALENESS
// ============================================================================

/** Newest file mtime (ms) under a directory, recursive. null if missing/empty. */
function newestMtime(dir) {
  let newest = null;
  let stack;
  try {
    stack = [dir];
  } catch { return null; }
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch { continue; }
    for (const e of entries) {
      const p = path.join(current, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) {
        try {
          const m = fs.statSync(p).mtimeMs;
          if (newest === null || m > newest) newest = m;
        } catch { /* raced */ }
      }
    }
  }
  return newest;
}

/**
 * dist/ older than newest src/ file (or missing) → the running build doesn't
 * reflect the checked-out source. Happens after a failed build mid-deploy.
 */
function isBuildStale(repoPath) {
  const srcNewest = newestMtime(path.join(repoPath, 'src'));
  const distNewest = newestMtime(path.join(repoPath, 'dist'));
  if (srcNewest === null) return false; // no src dir — nothing to judge
  if (distNewest === null) return true; // never built
  return srcNewest > distNewest;
}

// ============================================================================
// GIT STATUS
// ============================================================================

/**
 * Get git status for one repo (branch, head, behind/ahead, dirty)
 * @param {string} repoName
 * @returns {Promise<Object>}
 */
async function getRepoGitStatus(repoName) {
  const manifest = getRepoManifest(repoName);
  const repoPath = getRepoPath(repoName);

  const base = {
    name: repoName,
    path: repoPath,
    build: manifest.build,
    restarts: manifest.restarts,
  };

  if (!fs.existsSync(repoPath)) {
    return { ...base, exists: false };
  }
  if (!fs.existsSync(path.join(repoPath, '.git'))) {
    return { ...base, exists: true, isGitRepo: false };
  }

  try {
    const [branchR, headR, subjectR, statusR, countR] = await Promise.all([
      git(repoPath, 'rev-parse --abbrev-ref HEAD'),
      git(repoPath, 'rev-parse --short HEAD'),
      git(repoPath, 'log -1 --format=%s'),
      git(repoPath, 'status --porcelain -uno'), // tracked changes only (untracked recipes/logs are expected)
      git(repoPath, 'rev-list --left-right --count origin/main...HEAD'),
    ]);

    const dirtyFiles = statusR.stdout.trim()
      ? statusR.stdout.trim().split('\n').map(l => l.slice(3))
      : [];
    const lockfileOnly = dirtyFiles.length > 0 && dirtyFiles.every(f => LOCKFILES.has(path.basename(f)));

    let behind = 0, ahead = 0;
    if (countR.code === 0) {
      const parts = countR.stdout.trim().split(/\s+/);
      behind = parseInt(parts[0], 10) || 0;
      ahead = parseInt(parts[1], 10) || 0;
    }

    return {
      ...base,
      exists: true,
      isGitRepo: true,
      branch: branchR.code === 0 ? branchR.stdout.trim() : null,
      head: headR.code === 0 ? headR.stdout.trim() : null,
      headSubject: subjectR.code === 0 ? subjectR.stdout.trim() : null,
      behind,
      ahead,
      dirty: dirtyFiles.length > 0,
      dirtyFiles,
      lockfileOnly,
      buildStale: manifest.build ? isBuildStale(repoPath) : false,
    };
  } catch (error) {
    console.error(`[connectome] git status failed for ${repoName}:`, error.message);
    return { ...base, exists: true, isGitRepo: true, error: error.message };
  }
}

/**
 * Git fetch for a repo
 * @param {string} repoName
 */
async function gitFetch(repoName) {
  const repoPath = getRepoPath(repoName);
  if (!fs.existsSync(path.join(repoPath, '.git'))) {
    throw new Error(`${repoName} is not a git repo at ${repoPath}`);
  }
  const result = await git(repoPath, 'fetch origin --prune');
  return {
    success: result.code === 0,
    output: (result.stdout + result.stderr).trim(),
  };
}

// Cached fetch-all: SSE polls status every few seconds, but we only want to hit
// GitHub about once a minute. Fetch failures are non-fatal (offline = stale counts).
const _fetchAllCached = cachedAsync(async () => {
  const results = await Promise.allSettled(
    config.CONNECTOME_REPOS.map(r => gitFetch(r.name))
  );
  return results.map((r, i) => ({
    name: config.CONNECTOME_REPOS[i].name,
    ok: r.status === 'fulfilled' && r.value.success,
  }));
}, 60000);

// ============================================================================
// NIN SERVICE STATUS (systemctl show — richer than lib/systemd's is-active)
// ============================================================================

/**
 * Get detailed status for a system-level service
 * @param {string} serviceName - e.g. 'nin' (unit = nin.service)
 */
async function getNinServiceStatus(serviceName) {
  try {
    const result = await runCmdFull(
      `systemctl show ${serviceName}.service --property=ActiveState,SubState,MainPID,ActiveEnterTimestamp,NRestarts,MemoryCurrent`
    );
    const props = {};
    for (const line of result.stdout.split('\n')) {
      const idx = line.indexOf('=');
      if (idx > 0) props[line.slice(0, idx)] = line.slice(idx + 1);
    }
    const memBytes = parseInt(props.MemoryCurrent, 10);
    return {
      name: serviceName,
      state: props.ActiveState || 'unknown',
      subState: props.SubState || null,
      running: props.ActiveState === 'active',
      pid: props.MainPID && props.MainPID !== '0' ? parseInt(props.MainPID, 10) : null,
      startedAt: props.ActiveEnterTimestamp || null,
      restartCount: parseInt(props.NRestarts, 10) || 0,
      memoryBytes: Number.isFinite(memBytes) ? memBytes : null,
    };
  } catch (e) {
    return { name: serviceName, state: 'unknown', running: false, error: e.message };
  }
}

// ============================================================================
// RUNTIME READOUTS (memory, MCP children, Discord, laptop, heartbeat)
// ============================================================================

/**
 * Nin's memory readout: active session id + records.log size.
 * Read-only — this is the canary that deploys must never disturb.
 */
function getMemoryInfo() {
  try {
    if (!fs.existsSync(config.NIN_SESSIONS_FILE)) {
      return { available: false };
    }
    const sessions = JSON.parse(fs.readFileSync(config.NIN_SESSIONS_FILE, 'utf8'));
    const sessionId = sessions.activeSessionId || null;
    let recordsLogBytes = null;
    if (sessionId) {
      const recordsPath = path.join(config.NIN_SESSION_DIR, sessionId, 'records.log');
      if (fs.existsSync(recordsPath)) {
        recordsLogBytes = fs.statSync(recordsPath).size;
      }
    }
    return { available: true, sessionId, recordsLogBytes };
  } catch (e) {
    return { available: false, error: e.message };
  }
}

/**
 * MCP child processes of the nin.service main PID.
 * Expected: discord, heartbeat, exa, 2× terminal-sessions = 5.
 */
async function getMcpChildren(mainPid) {
  if (!mainPid) return { count: 0, expected: 5, children: [] };
  try {
    const result = await runCmdFull(`pgrep -P ${mainPid} -a`);
    if (result.code !== 0) return { count: 0, expected: 5, children: [] };
    const children = result.stdout.trim().split('\n').filter(Boolean).map(line => {
      const cmd = line.replace(/^\d+\s+/, '');
      let label = 'unknown';
      if (cmd.includes('terminal-sessions-mcp')) label = 'terminal-sessions';
      else if (cmd.includes('heartbeat-mcpl')) label = 'heartbeat';
      else if (cmd.includes('discord-mcpl')) label = 'discord';
      else if (cmd.includes('exa-mcp')) label = 'exa';
      return label;
    });
    return { count: children.length, expected: 5, children };
  } catch (e) {
    return { count: 0, expected: 5, children: [], error: e.message };
  }
}

/**
 * Discord connectivity: discord child running + recent activity markers
 * in data/discord-mcpl-debug.log (sweep:done / registerDiscordChannels).
 */
async function getDiscordStatus(mcpChildren) {
  const childRunning = (mcpChildren.children || []).includes('discord');
  let lastMarker = null;
  try {
    if (fs.existsSync(config.NIN_DISCORD_DEBUG_LOG)) {
      const result = await runCmdFull(
        `tail -n 300 "${config.NIN_DISCORD_DEBUG_LOG}" | grep -E "sweep:done|registerDiscordChannels" | tail -1`
      );
      const line = result.stdout.trim();
      const tsMatch = line.match(/^(\S+)\s/);
      if (tsMatch) {
        const ts = new Date(tsMatch[1]);
        if (!isNaN(ts.getTime())) lastMarker = ts.toISOString();
      }
    }
  } catch (e) {
    // Log unavailable — fall back to child process check alone
  }
  return {
    connected: childRunning && lastMarker !== null,
    childRunning,
    lastMarker,
  };
}

/** Laptop-daemon reachability probe (kataletheia). Offline is a normal state. */
async function checkLaptopReach() {
  try {
    const result = await runCmdFull(`curl -s -m 5 -o /dev/null -w "%{http_code}" "${config.LAPTOP_HEALTH_URL}"`);
    const code = result.stdout.trim();
    return { reachable: result.code === 0 && code.startsWith('2'), httpCode: code || null };
  } catch (e) {
    return { reachable: false, error: e.message };
  }
}

/** Heartbeat config (interval + paused) from data/heartbeat-littleguy.json */
function getHeartbeatInfo() {
  try {
    if (!fs.existsSync(config.NIN_HEARTBEAT_FILE)) return { available: false };
    const hb = JSON.parse(fs.readFileSync(config.NIN_HEARTBEAT_FILE, 'utf8'));
    return {
      available: true,
      intervalSeconds: hb.intervalSeconds ?? null,
      paused: hb.paused ?? null,
    };
  } catch (e) {
    return { available: false, error: e.message };
  }
}

// ============================================================================
// AGGREGATE STATUS
// ============================================================================

/**
 * Full connectome status: repos + nin services + runtime readouts.
 * This is the SSE payload — everything the frontend page renders.
 */
async function getStatus() {
  // Kick the cached fetch so behind/ahead counts stay fresh (≤60s stale).
  // Deliberately not awaited on the hot path beyond the cache: cachedAsync
  // dedupes concurrent calls, so this settles quickly once per minute.
  const fetchResults = await _fetchAllCached().catch(() => null);

  const [repos, nin, ninSession] = await Promise.all([
    Promise.all(config.CONNECTOME_REPOS.map(r => getRepoGitStatus(r.name))),
    getNinServiceStatus('nin'),
    getNinServiceStatus('nin-session'),
  ]);

  const memory = getMemoryInfo();
  const mcpChildren = await getMcpChildren(nin.pid);
  const [discord, laptop] = await Promise.all([
    getDiscordStatus(mcpChildren),
    checkLaptopReach(),
  ]);
  const heartbeat = getHeartbeatInfo();

  return {
    repos,
    nin: { host: nin, session: ninSession },
    runtime: {
      memory,
      mcpChildren,
      discord,
      laptop,
      heartbeat,
      lastCostReport: lastCostReport, // cached result of the last manual run
    },
    fetchStatus: fetchResults,
    deploy: getDeployState(), // live deploy progress (null when idle)
  };
}

// ============================================================================
// DEPLOY (pull → build → restart) with global lock
// ============================================================================

// Global deploy lock — one deploy at a time (spec §5)
let activeDeploy = null; // { repo, startedAt, steps: [...], status } while running
let lastDeploy = null;   // finished record, kept for the SSE/status pane

function getDeployState() {
  return activeDeploy || lastDeploy;
}

function pushStep(deploy, name) {
  const step = { name, status: 'running', startedAt: Date.now(), output: null };
  deploy.steps.push(step);
  return step;
}

function finishStep(step, ok, output) {
  step.status = ok ? 'ok' : 'failed';
  step.finishedAt = Date.now();
  if (output) step.output = String(output).slice(-4000); // keep step logs bounded
}

/**
 * Deploy one repo: dirty-guard → pull → (install) → (build) → restart services.
 * Verifies Nin's records.log size before/after — memory must survive intact.
 *
 * @param {string} repoName
 * @param {Object} options
 * @param {boolean} options.autoRestart - restart affected services (default true)
 * @returns {Promise<Object>} step-by-step result log
 */
async function deploy(repoName, options = {}) {
  const { autoRestart = true } = options;
  const manifest = getRepoManifest(repoName);
  const repoPath = getRepoPath(repoName);

  if (activeDeploy) {
    throw new Error(
      `A deploy of '${activeDeploy.repo}' is already in progress (started ${new Date(activeDeploy.startedAt).toISOString()}). One deploy at a time.`
    );
  }

  const deployState = {
    repo: repoName,
    startedAt: Date.now(),
    status: 'running',
    steps: [],
  };
  activeDeploy = deployState;

  const memBefore = getMemoryInfo();

  try {
    // --- Step: dirty-tree guard -------------------------------------------
    let step = pushStep(deployState, 'check working tree');
    const status = await getRepoGitStatus(repoName);
    if (!status.isGitRepo) {
      finishStep(step, false, `${repoName} is not a git repo`);
      throw new Error(`${repoName} is not a git repo at ${repoPath}`);
    }
    if (status.dirty && !status.lockfileOnly) {
      finishStep(step, false, `Uncommitted changes in tracked files: ${status.dirtyFiles.join(', ')}`);
      throw new Error(
        `Refusing to deploy ${repoName}: uncommitted changes on the VPS (${status.dirtyFiles.join(', ')}). Resolve manually — the panel will not reset them.`
      );
    }
    if (status.dirty && status.lockfileOnly) {
      // Server-side installs rewrite lockfiles; restore to HEAD so pull can ff.
      for (const f of status.dirtyFiles) {
        await git(repoPath, `checkout -- "${f}"`);
      }
      finishStep(step, true, `clean (auto-restored lockfiles: ${status.dirtyFiles.join(', ')})`);
    } else {
      finishStep(step, true, 'clean');
    }

    // --- Step: git pull (ff-only — never merge/rebase on the server) -------
    step = pushStep(deployState, 'git pull');
    const beforeR = await git(repoPath, 'rev-parse HEAD');
    const beforeCommit = beforeR.stdout.trim();
    const pullR = await git(repoPath, 'pull --ff-only origin main');
    if (pullR.code !== 0) {
      finishStep(step, false, pullR.stdout + pullR.stderr);
      throw new Error(`git pull failed for ${repoName}: ${(pullR.stderr || pullR.stdout).trim()}`);
    }
    const afterR = await git(repoPath, 'rev-parse HEAD');
    const afterCommit = afterR.stdout.trim();
    const codeChanged = beforeCommit !== afterCommit;
    finishStep(step, true, codeChanged
      ? `${beforeCommit.slice(0, 7)} → ${afterCommit.slice(0, 7)}`
      : 'already up to date');

    // A build is needed when code changed OR a previous deploy left dist/
    // stale (e.g. pull succeeded but the build step failed).
    const buildNeeded = Boolean(manifest.build) && (codeChanged || isBuildStale(repoPath));

    // --- Step: dependency install --------------------------------------------
    // Build repos: always install before building — cheap, and guarantees the
    // toolchain (tsc lives in devDependencies; --production=false because the
    // admin panel runs with NODE_ENV=production, which would prune dev deps).
    // connectome-host (no build, bun runs src directly): install only when the
    // pulled range touched package.json / lockfile.
    let installNeeded = buildNeeded;
    if (!manifest.build && codeChanged) {
      const depsR = await git(repoPath, `diff --name-only ${beforeCommit} ${afterCommit}`);
      const changedFiles = depsR.stdout.trim().split('\n').filter(Boolean);
      installNeeded = changedFiles.some(f =>
        f === 'package.json' || LOCKFILES.has(path.basename(f))
      );
    }
    if (installNeeded) {
      step = pushStep(deployState, 'install dependencies');
      const installCmd = repoName === 'connectome-host'
        ? `cd "${repoPath}" && ${ENV_PREFIX} /root/.bun/bin/bun install`
        : `cd "${repoPath}" && ${ENV_PREFIX} npm install --no-audit --no-fund --production=false`;
      const installR = await runCmdFull(installCmd);
      finishStep(step, installR.code === 0, installR.stdout + installR.stderr);
      if (installR.code !== 0) {
        throw new Error(`dependency install failed for ${repoName}`);
      }
    }

    // --- Step: build --------------------------------------------------------
    let buildRan = false;
    if (buildNeeded) {
      step = pushStep(deployState, `build (${manifest.build})`);
      const buildR = await runCmdFull(`cd "${repoPath}" && ${ENV_PREFIX} ${manifest.build}`);
      finishStep(step, buildR.code === 0, buildR.stdout + buildR.stderr);
      if (buildR.code !== 0) {
        throw new Error(`build failed for ${repoName} — services NOT restarted (still running previous build)`);
      }
      buildRan = true;
      // Stamp dist/ so staleness clears even when tsc's incremental build
      // emits nothing (dist content current, but mtimes older than src).
      try {
        fs.writeFileSync(path.join(repoPath, 'dist', '.panel-build-stamp'), new Date().toISOString());
      } catch (e) {
        console.error(`[connectome] failed to write build stamp for ${repoName}:`, e.message);
      }
    }

    // --- Step: restart affected services ------------------------------------
    const restarted = [];
    if ((codeChanged || buildRan) && autoRestart) {
      for (const svc of manifest.restarts) {
        step = pushStep(deployState, `restart ${svc}.service`);
        const restartR = await runCmdFull(`systemctl restart ${svc}.service`);
        await new Promise(r => setTimeout(r, 1500));
        const svcStatus = await getNinServiceStatus(svc);
        const ok = restartR.code === 0 && svcStatus.running;
        finishStep(step, ok, ok ? `active (pid ${svcStatus.pid})` : `state: ${svcStatus.state}`);
        restarted.push({ service: svc, success: ok });
        if (!ok) {
          throw new Error(`${svc}.service failed to come back after restart — check logs`);
        }
      }
    }

    // --- Step: verify Nin's memory survived ---------------------------------
    step = pushStep(deployState, 'verify memory intact');
    const memAfter = getMemoryInfo();
    const memOk =
      memAfter.available &&
      memAfter.sessionId === memBefore.sessionId &&
      memAfter.recordsLogBytes !== null &&
      (memBefore.recordsLogBytes === null || memAfter.recordsLogBytes >= memBefore.recordsLogBytes);
    finishStep(step, memOk,
      `records.log ${memBefore.recordsLogBytes ?? '?'} → ${memAfter.recordsLogBytes ?? '?'} bytes (session ${memAfter.sessionId ?? '?'})`);
    if (!memOk) {
      // Don't throw the deploy away — code is already live — but flag loudly.
      console.error('[connectome] MEMORY CHECK FAILED after deploy of', repoName, { memBefore, memAfter });
    }

    deployState.status = 'done';
    return {
      success: true,
      repo: repoName,
      codeChanged,
      beforeCommit: beforeCommit.slice(0, 7),
      afterCommit: afterCommit.slice(0, 7),
      restarted,
      memoryCheck: { ok: memOk, before: memBefore.recordsLogBytes, after: memAfter.recordsLogBytes },
      steps: deployState.steps,
    };
  } catch (error) {
    deployState.status = 'failed';
    deployState.error = error.message;
    return {
      success: false,
      repo: repoName,
      error: error.message,
      steps: deployState.steps,
    };
  } finally {
    // Release the lock immediately; keep the finished record for the status pane.
    deployState.finishedAt = Date.now();
    lastDeploy = deployState;
    activeDeploy = null;
    _getStatusCached.invalidate();
  }
}

/**
 * Deploy every repo that is behind origin/main (sequentially — the lock is per
 * deploy() call, so we release/reacquire between repos on purpose: each repo
 * gets its own step log and a failure in one doesn't block the rest).
 */
async function deployAll(options = {}) {
  const { onlyBehind = true } = options;
  await _fetchAllCached.invalidate();
  await _fetchAllCached();

  const results = [];
  for (const { name } of config.CONNECTOME_REPOS) {
    const status = await getRepoGitStatus(name);
    if (onlyBehind && !(status.behind > 0) && !status.buildStale) {
      results.push({ repo: name, skipped: true, reason: 'up to date' });
      continue;
    }
    const result = await deploy(name, options);
    results.push(result);
  }
  return {
    success: results.every(r => r.skipped || r.success),
    results,
  };
}

// ============================================================================
// NIN LIFECYCLE
// ============================================================================

async function restartService(svc) {
  const memBefore = getMemoryInfo();
  const result = await runCmdFull(`systemctl restart ${svc}.service`);
  await new Promise(r => setTimeout(r, 1500));
  const status = await getNinServiceStatus(svc);
  const memAfter = getMemoryInfo();
  return {
    success: result.code === 0 && status.running,
    service: svc,
    status,
    memoryCheck: { before: memBefore.recordsLogBytes, after: memAfter.recordsLogBytes },
  };
}

/** Restart the host only (MCP daemons are children — they restart with it) */
async function restartNin() {
  return restartService('nin');
}

/** Restart nin + the session daemon */
async function restartNinFull() {
  const nin = await restartService('nin');
  const session = await restartService('nin-session');
  return { success: nin.success && session.success, nin, session };
}

async function restartSession() {
  return restartService('nin-session');
}

/** journalctl logs for nin.service */
async function getLogs(lines = 200) {
  const n = Math.min(Math.max(parseInt(lines, 10) || 200, 10), 2000);
  const result = await runCmdFull(
    `journalctl -u nin.service -n ${n} --no-pager --output=short-iso`
  );
  return {
    logs: result.stdout || result.stderr || '[No logs available]',
    lines: n,
  };
}

// ============================================================================
// COST REPORT
// ============================================================================

let lastCostReport = null; // { at, total, models, raw }

/**
 * Run scripts/nin-cost.mjs in connectome-host and parse the table.
 * Table shape:
 *   model  calls  in  out  cache-rd  cost
 *   TOTAL  93  $6.76
 */
async function runCostReport() {
  const hostPath = getRepoPath('connectome-host');
  const scriptPath = path.join(hostPath, 'scripts', 'nin-cost.mjs');
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Cost script not found: ${scriptPath}`);
  }

  const result = await runCmdFull(
    `cd "${hostPath}" && ${ENV_PREFIX} /usr/bin/node scripts/nin-cost.mjs`
  );
  if (result.code !== 0) {
    throw new Error(`Cost report failed: ${(result.stderr || result.stdout).trim().slice(0, 500)}`);
  }

  const raw = result.stdout;
  const models = [];
  let total = null;
  let totalCalls = null;

  for (const line of raw.split('\n')) {
    const totalMatch = line.match(/^\s*TOTAL\s+(\d+)\s+.*\$([\d,.]+)/);
    if (totalMatch) {
      totalCalls = parseInt(totalMatch[1], 10);
      total = parseFloat(totalMatch[2].replace(/,/g, ''));
      continue;
    }
    // model rows: name, calls, in, out, cache-rd, $cost
    const modelMatch = line.match(/^\s{2}(\S[\S ]*?)\s{2,}(\d+)\s+([\d.]+[kM]?)\s+([\d.]+[kM]?)\s+([\d.]+[kM]?|0)\s+\$([\d,.]+)/);
    if (modelMatch && modelMatch[1] !== 'model') {
      models.push({
        model: modelMatch[1].trim(),
        calls: parseInt(modelMatch[2], 10),
        cost: parseFloat(modelMatch[6].replace(/,/g, '')),
      });
    }
  }

  lastCostReport = {
    at: new Date().toISOString(),
    total,
    totalCalls,
    models,
    raw,
  };
  return lastCostReport;
}

// ============================================================================
// EXPORTS
// ============================================================================

// Cached status for the SSE hot path (stream polls every ~4s)
const _getStatusCached = cachedAsync(getStatus, 3000);

module.exports = {
  // Status (cached — SSE hot path)
  getStatus: _getStatusCached,
  getRepoGitStatus,

  // Git ops (NOT cached — actions)
  gitFetch,

  // Deploy
  deploy,
  deployAll,
  getDeployState,

  // Nin lifecycle
  restartNin,
  restartNinFull,
  restartSession,
  getLogs,

  // Cost
  runCostReport,

  // Cache invalidation (after actions, so the next SSE tick is fresh)
  invalidateCache: () => {
    _getStatusCached.invalidate();
    _fetchAllCached.invalidate();
  },
};
