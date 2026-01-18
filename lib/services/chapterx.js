// lib/services/chapterx.js - ChapterX bot management
// Scans bot configs, manages systemd services, handles deploy slots

const fs = require('fs');
const path = require('path');
const config = require('../../config');
const systemd = require('../systemd');

// ============================================================================
// BOT CONFIG DISCOVERY
// ============================================================================

/**
 * Scan the bots directory for bot configurations
 * @returns {Promise<Array<Object>>} List of discovered bots
 */
async function scanBots() {
  const botsPath = config.BOTS_PATH;
  const bots = [];
  
  if (!fs.existsSync(botsPath)) {
    return bots;
  }
  
  const entries = fs.readdirSync(botsPath, { withFileTypes: true });
  
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue; // Skip hidden
    
    const botPath = path.join(botsPath, entry.name);
    const configPath = path.join(botPath, 'config.yaml');
    const configPathAlt = path.join(botPath, 'config.yml');
    
    // Check if config exists
    const hasConfig = fs.existsSync(configPath) || fs.existsSync(configPathAlt);
    
    if (hasConfig) {
      bots.push({
        name: entry.name,
        path: botPath,
        configPath: fs.existsSync(configPath) ? configPath : configPathAlt,
      });
    }
  }
  
  return bots;
}

/**
 * Get the status of a specific bot
 * @param {string} botName - Bot name
 * @returns {Promise<Object>} Bot status
 */
async function getBotStatus(botName) {
  // Check all available slots dynamically
  const slots = config.getChapterXSlots();
  const slotNames = Object.keys(slots);
  
  const slotStatuses = {};
  let activeSlot = null;
  let activePid = null;
  let activeStartedAt = null;
  
  for (const slotName of slotNames) {
    const serviceName = systemd.getServiceName(botName, slotName);
    const status = await systemd.getServiceStatus(serviceName);
    slotStatuses[slotName] = status;
    
    if (status.running && !activeSlot) {
      activeSlot = slotName;
      activePid = status.pid;
      activeStartedAt = status.startedAt;
    }
  }
  
  const running = activeSlot !== null;
  
  return {
    name: botName,
    running,
    slot: activeSlot,
    slotStatuses, // All slot statuses for transparency
    pid: activePid,
    startedAt: activeStartedAt,
  };
}

/**
 * Get all bots with their statuses
 * @returns {Promise<Array<Object>>} Bots with status info
 */
async function listBots() {
  const discoveredBots = await scanBots();
  const systemdAvailable = await systemd.isSystemdAvailable();
  
  const bots = [];
  
  for (const bot of discoveredBots) {
    let running = false;
    let slot = null;
    let pid = null;
    let state = 'stopped';
    
    if (systemdAvailable) {
      const status = await getBotStatus(bot.name);
      running = status.running;
      slot = status.slot;
      pid = status.pid;
      state = running ? 'running' : 'stopped';
    }
    
    bots.push({
      name: bot.name,
      path: bot.path,
      configPath: bot.configPath,
      running,
      slot,
      pid,
      state,
      systemdAvailable,
    });
  }
  
  // Sort by name
  bots.sort((a, b) => a.name.localeCompare(b.name));
  
  return bots;
}

// ============================================================================
// BOT LIFECYCLE
// ============================================================================

/**
 * Start a bot in a specific slot
 * @param {string} botName - Bot name
 * @param {string} slot - Deployment slot
 * @returns {Promise<Object>} Result
 */
async function startBot(botName, slot = 'main') {
  // Validate slot against available slots
  const availableSlots = config.getChapterXSlots();
  const validSlotNames = Object.keys(availableSlots);
  
  if (!validSlotNames.includes(slot)) {
    throw new Error(`Invalid slot: ${slot}. Available slots: ${validSlotNames.join(', ') || 'none'}`);
  }
  
  // Check systemd availability
  if (!await systemd.isSystemdAvailable()) {
    throw new Error('systemd not available. Bot management requires systemd.');
  }
  
  // Check bot exists
  const bots = await scanBots();
  const bot = bots.find(b => b.name === botName);
  if (!bot) {
    throw new Error(`Bot '${botName}' not found in ${config.BOTS_PATH}`);
  }
  
  // Check not already running
  const status = await getBotStatus(botName);
  if (status.running) {
    throw new Error(`Bot '${botName}' is already running in slot '${status.slot}'`);
  }
  
  // Verify ChapterX directory exists
  const chapterxPath = config.CHAPTERX_SLOTS[slot];
  if (!fs.existsSync(chapterxPath)) {
    throw new Error(`ChapterX slot '${slot}' not found at ${chapterxPath}`);
  }
  
  // Ensure service file exists
  await systemd.ensureServiceFile(botName, slot);
  
  // Start the service
  const serviceName = systemd.getServiceName(botName, slot);
  const success = await systemd.startService(serviceName);
  
  return {
    success,
    name: botName,
    slot,
    serviceName,
  };
}

/**
 * Stop a running bot
 * @param {string} botName - Bot name
 * @param {boolean} force - Force kill (not used with systemd, but kept for API compat)
 * @returns {Promise<Object>} Result
 */
async function stopBot(botName, force = false) {
  const status = await getBotStatus(botName);
  
  if (!status.running) {
    return {
      success: true,
      name: botName,
      wasRunning: false,
    };
  }
  
  const serviceName = systemd.getServiceName(botName, status.slot);
  const success = await systemd.stopService(serviceName);
  
  return {
    success,
    name: botName,
    slot: status.slot,
    wasRunning: true,
  };
}

/**
 * Restart a bot (stop + start)
 * @param {string} botName - Bot name
 * @param {string} slot - Deployment slot (use current if not specified)
 * @returns {Promise<Object>} Result
 */
async function restartBot(botName, slot = null) {
  const status = await getBotStatus(botName);
  
  // Determine slot
  const targetSlot = slot || status.slot || 'main';
  
  // If changing slots, stop old and start new
  if (status.running && status.slot !== targetSlot) {
    await stopBot(botName);
    await new Promise(r => setTimeout(r, 1000));
    return startBot(botName, targetSlot);
  }
  
  // If not running, just start
  if (!status.running) {
    return startBot(botName, targetSlot);
  }
  
  // Restart in same slot
  const serviceName = systemd.getServiceName(botName, status.slot);
  await systemd.ensureServiceFile(botName, status.slot); // Refresh service file
  const success = await systemd.restartService(serviceName);
  
  return {
    success,
    name: botName,
    slot: status.slot,
    serviceName,
  };
}

// ============================================================================
// BOT CONFIGURATION
// ============================================================================

/**
 * Read bot configuration file
 * @param {string} botName - Bot name
 * @returns {Promise<string>} Config file content
 */
async function getBotConfig(botName) {
  const bots = await scanBots();
  const bot = bots.find(b => b.name === botName);
  
  if (!bot) {
    throw new Error(`Bot '${botName}' not found`);
  }
  
  return fs.readFileSync(bot.configPath, 'utf8');
}

/**
 * Write bot configuration file
 * @param {string} botName - Bot name
 * @param {string} content - New config content
 * @returns {Promise<void>}
 */
async function setBotConfig(botName, content) {
  const bots = await scanBots();
  const bot = bots.find(b => b.name === botName);
  
  if (!bot) {
    throw new Error(`Bot '${botName}' not found`);
  }
  
  // Create backup
  const backupPath = bot.configPath + '.backup';
  if (fs.existsSync(bot.configPath)) {
    fs.copyFileSync(bot.configPath, backupPath);
  }
  
  fs.writeFileSync(bot.configPath, content);
}

/**
 * Get bot logs from journalctl
 * @param {string} botName - Bot name
 * @param {number} lines - Number of lines
 * @returns {Promise<string>} Log content
 */
async function getBotLogs(botName, lines = 200) {
  const status = await getBotStatus(botName);
  
  // Try to get logs from whichever slot has/had the bot
  const slot = status.slot || 'main';
  const serviceName = systemd.getServiceName(botName, slot);
  
  return systemd.getServiceLogs(serviceName, lines);
}

// ============================================================================
// DEPLOY SLOTS
// ============================================================================

const { runCmd, runCmdFull } = require('../utils');

/**
 * Get info about deployment slots
 * @returns {Object} Slot information
 */
function getSlotInfo() {
  const availableSlots = config.getChapterXSlots();
  const slots = {};
  
  for (const [name, slotPath] of Object.entries(availableSlots)) {
    const exists = fs.existsSync(slotPath);
    let gitBranch = null;
    
    if (exists) {
      try {
        const gitDir = path.join(slotPath, '.git');
        if (fs.existsSync(gitDir)) {
          // Try to read HEAD for branch
          const headPath = path.join(gitDir, 'HEAD');
          if (fs.existsSync(headPath)) {
            const head = fs.readFileSync(headPath, 'utf8').trim();
            if (head.startsWith('ref: refs/heads/')) {
              gitBranch = head.replace('ref: refs/heads/', '');
            } else {
              gitBranch = head.slice(0, 7); // Detached HEAD, show short SHA
            }
          }
        }
      } catch (e) {
        // Ignore git errors
      }
    }
    
    slots[name] = {
      path: slotPath,
      exists,
      gitBranch,
    };
  }
  
  return slots;
}

// ============================================================================
// SLOT GIT OPERATIONS
// ============================================================================

/**
 * Get detailed git status for a slot
 * @param {string} slot - Slot name
 * @returns {Promise<Object>} Git status
 */
async function getSlotGitStatus(slot) {
  const slots = config.getChapterXSlots();
  const slotPath = slots[slot];
  
  if (!slotPath) {
    const validSlots = Object.keys(slots);
    throw new Error(`Invalid slot: ${slot}. Available: ${validSlots.join(', ') || 'none'}`);
  }
  
  if (!fs.existsSync(slotPath)) {
    return {
      slot,
      exists: false,
      path: slotPath,
    };
  }
  
  const gitDir = path.join(slotPath, '.git');
  if (!fs.existsSync(gitDir)) {
    return {
      slot,
      exists: true,
      isGitRepo: false,
      path: slotPath,
    };
  }
  
  try {
    // Get current branch
    const branchResult = await runCmdFull(`git -C "${slotPath}" rev-parse --abbrev-ref HEAD`);
    const branch = branchResult.code === 0 ? branchResult.stdout.trim() : null;
    
    // Get current commit hash
    const commitResult = await runCmdFull(`git -C "${slotPath}" rev-parse --short HEAD`);
    const commit = commitResult.code === 0 ? commitResult.stdout.trim() : null;
    
    // Get commit message
    const messageResult = await runCmdFull(`git -C "${slotPath}" log -1 --format=%s`);
    const commitMessage = messageResult.code === 0 ? messageResult.stdout.trim() : null;
    
    // Get commit date
    const dateResult = await runCmdFull(`git -C "${slotPath}" log -1 --format=%ci`);
    const commitDate = dateResult.code === 0 ? dateResult.stdout.trim() : null;
    
    // Check for uncommitted changes
    const statusResult = await runCmdFull(`git -C "${slotPath}" status --porcelain`);
    const dirty = statusResult.code === 0 && statusResult.stdout.trim().length > 0;
    
    // Check if behind/ahead of remote
    const behindAheadResult = await runCmdFull(
      `git -C "${slotPath}" rev-list --left-right --count origin/${branch}...HEAD 2>/dev/null`
    );
    let behind = 0;
    let ahead = 0;
    if (behindAheadResult.code === 0) {
      const parts = behindAheadResult.stdout.trim().split(/\s+/);
      behind = parseInt(parts[0], 10) || 0;
      ahead = parseInt(parts[1], 10) || 0;
    }
    
    // Get list of remote branches
    const remoteBranchesResult = await runCmdFull(
      `git -C "${slotPath}" branch -r --format='%(refname:short)'`
    );
    const remoteBranches = remoteBranchesResult.code === 0
      ? remoteBranchesResult.stdout.trim().split('\n')
          .filter(b => b.startsWith('origin/') && !b.includes('HEAD'))
          .map(b => b.replace('origin/', ''))
      : [];
    
    return {
      slot,
      exists: true,
      isGitRepo: true,
      path: slotPath,
      branch,
      commit,
      commitMessage,
      commitDate,
      dirty,
      behind,
      ahead,
      remoteBranches,
    };
  } catch (error) {
    console.error(`Error getting git status for slot ${slot}:`, error);
    return {
      slot,
      exists: true,
      isGitRepo: true,
      path: slotPath,
      error: error.message,
    };
  }
}

/**
 * Get all slots with their git status
 * @returns {Promise<Object>} All slots with status
 */
async function getAllSlotsStatus() {
  const availableSlots = config.getChapterXSlots();
  const slots = {};
  
  for (const slotName of Object.keys(availableSlots)) {
    slots[slotName] = await getSlotGitStatus(slotName);
  }
  
  return slots;
}

/**
 * Git fetch for a slot
 * @param {string} slot - Slot name
 * @returns {Promise<Object>} Result
 */
async function gitFetch(slot) {
  const slots = config.getChapterXSlots();
  const slotPath = slots[slot];
  
  if (!slotPath || !fs.existsSync(slotPath)) {
    throw new Error(`Slot '${slot}' not found`);
  }
  
  try {
    const result = await runCmdFull(`git -C "${slotPath}" fetch origin --prune`);
    
    return {
      success: result.code === 0,
      output: result.stdout + result.stderr,
    };
  } catch (error) {
    throw new Error(`Git fetch failed: ${error.message}`);
  }
}

/**
 * Git pull for a slot
 * @param {string} slot - Slot name
 * @returns {Promise<Object>} Result with code change detection
 */
async function gitPull(slot) {
  const slots = config.getChapterXSlots();
  const slotPath = slots[slot];
  
  if (!slotPath || !fs.existsSync(slotPath)) {
    throw new Error(`Slot '${slot}' not found`);
  }
  
  // Get current commit before pull
  const beforeResult = await runCmdFull(`git -C "${slotPath}" rev-parse HEAD`);
  const beforeCommit = beforeResult.stdout.trim();
  
  try {
    const result = await runCmdFull(`git -C "${slotPath}" pull origin`);
    
    // Get commit after pull
    const afterResult = await runCmdFull(`git -C "${slotPath}" rev-parse HEAD`);
    const afterCommit = afterResult.stdout.trim();
    
    const codeChanged = beforeCommit !== afterCommit;
    
    return {
      success: result.code === 0,
      output: result.stdout + result.stderr,
      codeChanged,
      beforeCommit: beforeCommit.slice(0, 7),
      afterCommit: afterCommit.slice(0, 7),
    };
  } catch (error) {
    throw new Error(`Git pull failed: ${error.message}`);
  }
}

/**
 * Git checkout branch for a slot
 * @param {string} slot - Slot name
 * @param {string} branch - Branch name
 * @returns {Promise<Object>} Result with code change detection
 */
async function gitCheckout(slot, branch) {
  const slots = config.getChapterXSlots();
  const slotPath = slots[slot];
  
  if (!slotPath || !fs.existsSync(slotPath)) {
    throw new Error(`Slot '${slot}' not found`);
  }
  
  if (!branch) {
    throw new Error('Branch name required');
  }
  
  // Get current commit before checkout
  const beforeResult = await runCmdFull(`git -C "${slotPath}" rev-parse HEAD`);
  const beforeCommit = beforeResult.stdout.trim();
  
  try {
    // Try to checkout. If it's a remote branch, track it
    let result = await runCmdFull(`git -C "${slotPath}" checkout ${branch}`);
    
    // If checkout failed, try tracking remote branch
    if (result.code !== 0 && !branch.includes('/')) {
      result = await runCmdFull(`git -C "${slotPath}" checkout -b ${branch} origin/${branch}`);
    }
    
    // Get commit after checkout
    const afterResult = await runCmdFull(`git -C "${slotPath}" rev-parse HEAD`);
    const afterCommit = afterResult.stdout.trim();
    
    const codeChanged = beforeCommit !== afterCommit;
    
    return {
      success: result.code === 0,
      output: result.stdout + result.stderr,
      branch,
      codeChanged,
      beforeCommit: beforeCommit.slice(0, 7),
      afterCommit: afterCommit.slice(0, 7),
    };
  } catch (error) {
    throw new Error(`Git checkout failed: ${error.message}`);
  }
}

/**
 * Get list of bots running on a specific slot
 * @param {string} slot - Slot name
 * @returns {Promise<Array>} List of bot names running on this slot
 */
async function getBotsOnSlot(slot) {
  const bots = await listBots();
  return bots.filter(b => b.running && b.slot === slot).map(b => b.name);
}

/**
 * Restart all bots running on a specific slot
 * @param {string} slot - Slot name
 * @returns {Promise<Array>} Results for each bot
 */
async function restartBotsOnSlot(slot) {
  const botNames = await getBotsOnSlot(slot);
  const results = [];
  
  for (const botName of botNames) {
    try {
      await restartBot(botName);
      results.push({ name: botName, success: true });
    } catch (error) {
      results.push({ name: botName, success: false, error: error.message });
    }
  }
  
  return results;
}

// ============================================================================
// SYSTEMD INFO
// ============================================================================

/**
 * Check if systemd is available
 * @returns {Promise<boolean>}
 */
async function isSystemdAvailable() {
  return systemd.isSystemdAvailable();
}

/**
 * Get systemd configuration info
 * @returns {Object}
 */
function getSystemdInfo() {
  return {
    available: true, // Will be checked async
    useUserServices: systemd.USE_USER_SERVICES,
    serviceDir: systemd.SERVICE_DIR,
    servicePrefix: systemd.SERVICE_PREFIX,
  };
}

module.exports = {
  // Discovery
  scanBots,
  listBots,
  getBotStatus,
  
  // Lifecycle
  startBot,
  stopBot,
  restartBot,
  
  // Configuration
  getBotConfig,
  setBotConfig,
  getBotLogs,
  
  // Slots (basic info)
  getSlotInfo,
  
  // Slots (git operations)
  getSlotGitStatus,
  getAllSlotsStatus,
  gitFetch,
  gitPull,
  gitCheckout,
  getBotsOnSlot,
  restartBotsOnSlot,
  
  // Systemd
  isSystemdAvailable,
  getSystemdInfo,
};
