// lib/services/dreams.js - Dream Window health monitoring
// Polls core site /api/dreams/status, stores time-series samples,
// computes windowed health analysis (1m, 10m, 30m, 1h).

const fs = require('fs');
const path = require('path');
const config = require('../../config');

const POLL_INTERVAL = 10_000;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const FLUSH_INTERVAL = 60_000;
const DATA_FILE = path.join(config.DATA_DIR, 'dreams-timeseries.json');

const WINDOWS = [
  { name: '1m', seconds: 60 },
  { name: '10m', seconds: 600 },
  { name: '30m', seconds: 1800 },
  { name: '1h', seconds: 3600 },
];

let _samples = [];
let _latestStatus = null;
let _pollTimer = null;
let _flushTimer = null;
let _lastPollError = null;

function _load() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const cutoff = Date.now() - MAX_AGE_MS;
        _samples = parsed.filter(s => s.t > cutoff);
      }
    }
  } catch (e) {
    console.error('[dreams] Failed to load timeseries:', e.message);
    _samples = [];
  }
}

function _flush() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(_samples), 'utf-8');
  } catch (e) {
    console.error('[dreams] Failed to flush timeseries:', e.message);
  }
}

function _prune() {
  const cutoff = Date.now() - MAX_AGE_MS;
  const before = _samples.length;
  _samples = _samples.filter(s => s.t > cutoff);
  if (_samples.length < before) {
    console.log(`[dreams] Pruned ${before - _samples.length} stale samples`);
  }
}

async function _poll() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(`${config.AETHERA_API_URL}/api/dreams/status`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      _lastPollError = `HTTP ${res.status}`;
      _latestStatus = null;
      return;
    }

    const data = await res.json();
    _latestStatus = data;
    _lastPollError = null;

    if (data.gpu?.active) {
      _samples.push({
        t: Date.now(),
        fps: data.generation?.fps ?? 0,
        sessionFps: data.generation?.session_fps ?? 0,
        frames: data.generation?.frame_count ?? 0,
        currentFrame: data.generation?.current_frame ?? 0,
        keyframe: data.generation?.current_keyframe ?? 0,
        viewers: data.viewers?.websocket_count ?? 0,
        bytes: data.stream?.total_bytes ?? 0,
        hasKeyframe: data.stream?.has_video_keyframe ?? false,
      });
    }
  } catch (e) {
    _lastPollError = e.code === 'ABORT_ERR' ? 'timeout' : e.message;
    _latestStatus = null;
  }
}

function _computeWindow(windowSeconds) {
  const cutoff = Date.now() - windowSeconds * 1000;
  const windowSamples = _samples.filter(s => s.t > cutoff);

  if (windowSamples.length === 0) {
    return {
      sampleCount: 0,
      avgFps: null,
      minFps: null,
      maxFps: null,
      avgViewers: null,
      throughputBytesPerSec: null,
      frameDeliveryRate: null,
      longestGapMs: null,
      health: 'no_data',
      flags: [],
    };
  }

  const fpsValues = windowSamples.map(s => s.fps);
  const avgFps = fpsValues.reduce((a, b) => a + b, 0) / fpsValues.length;
  const minFps = Math.min(...fpsValues);
  const maxFps = Math.max(...fpsValues);

  const viewerValues = windowSamples.map(s => s.viewers);
  const avgViewers = viewerValues.reduce((a, b) => a + b, 0) / viewerValues.length;

  const firstSample = windowSamples[0];
  const lastSample = windowSamples[windowSamples.length - 1];
  const timeSpanMs = lastSample.t - firstSample.t;
  const bytesDelta = lastSample.bytes - firstSample.bytes;
  const throughputBytesPerSec = timeSpanMs > 0 ? (bytesDelta / (timeSpanMs / 1000)) : null;

  const frameDelta = lastSample.frames - firstSample.frames;
  const frameDeliveryRate = timeSpanMs > 0 ? (frameDelta / (timeSpanMs / 1000)) : null;

  let longestGapMs = 0;
  for (let i = 1; i < windowSamples.length; i++) {
    const gap = windowSamples[i].t - windowSamples[i - 1].t;
    if (gap > longestGapMs) longestGapMs = gap;
  }

  // FPS trend: simple linear regression slope over the window
  let fpsTrend = 0;
  if (windowSamples.length >= 3) {
    const n = windowSamples.length;
    const xMean = windowSamples.reduce((a, s) => a + s.t, 0) / n;
    const yMean = avgFps;
    let num = 0, den = 0;
    for (const s of windowSamples) {
      num += (s.t - xMean) * (s.fps - yMean);
      den += (s.t - xMean) ** 2;
    }
    fpsTrend = den > 0 ? (num / den) * 1000 : 0; // per second
  }

  const flags = [];

  if (minFps < avgFps * 0.5 && avgFps > 0.5) {
    flags.push('fps_dip');
  }
  if (avgFps > 0 && avgFps < 1.0) {
    flags.push('low_fps');
  }
  if (longestGapMs > POLL_INTERVAL * 3) {
    flags.push('sample_gap');
  }
  if (fpsTrend < -0.1) {
    flags.push('fps_declining');
  }

  let health = 'good';
  if (flags.includes('low_fps') || flags.includes('fps_declining')) {
    health = 'degraded';
  }
  if (flags.length >= 3) {
    health = 'unhealthy';
  }

  return {
    sampleCount: windowSamples.length,
    avgFps: round(avgFps, 2),
    minFps: round(minFps, 2),
    maxFps: round(maxFps, 2),
    avgViewers: round(avgViewers, 1),
    throughputBytesPerSec: throughputBytesPerSec !== null ? round(throughputBytesPerSec, 0) : null,
    frameDeliveryRate: frameDeliveryRate !== null ? round(frameDeliveryRate, 2) : null,
    longestGapMs: round(longestGapMs, 0),
    fpsTrend: round(fpsTrend, 4),
    health,
    flags,
  };
}

function round(val, decimals) {
  const factor = 10 ** decimals;
  return Math.round(val * factor) / factor;
}

// === Public API ===

function start() {
  _load();
  _prune();

  _pollTimer = setInterval(() => {
    _poll().catch(e => console.error('[dreams] Poll error:', e.message));
  }, POLL_INTERVAL);

  _flushTimer = setInterval(() => {
    _prune();
    _flush();
  }, FLUSH_INTERVAL);

  _poll().catch(() => {});
  console.log('  ✓ Dreams health monitor started');
}

function stop() {
  if (_pollTimer) clearInterval(_pollTimer);
  if (_flushTimer) clearInterval(_flushTimer);
  _flush();
}

function getStatus() {
  const gpuConnected = _latestStatus?.gpu?.active ?? false;

  return {
    connected: _latestStatus !== null,
    pollError: _lastPollError,
    gpuConnected,
    status: _latestStatus?.status ?? 'unknown',
    generation: _latestStatus?.generation ?? null,
    viewers: _latestStatus?.viewers ?? null,
    stream: _latestStatus?.stream ?? null,
    sampleCount: _samples.length,
  };
}

function getHealthWindows() {
  const windows = {};
  for (const w of WINDOWS) {
    windows[w.name] = _computeWindow(w.seconds);
  }

  // Overall health: worst of 1m and 10m windows
  const shortTerm = windows['1m'];
  const medTerm = windows['10m'];
  const healthPriority = { unhealthy: 3, degraded: 2, good: 1, no_data: 0 };
  const worstHealth = [shortTerm.health, medTerm.health]
    .reduce((worst, h) => (healthPriority[h] || 0) > (healthPriority[worst] || 0) ? h : worst, 'no_data');

  return {
    overall: worstHealth,
    windows,
  };
}

function getFullStatus() {
  return {
    ...getStatus(),
    health: getHealthWindows(),
  };
}

module.exports = {
  start,
  stop,
  getStatus,
  getHealthWindows,
  getFullStatus,
};
