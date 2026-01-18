// lib/systemd.js - Systemd service management for ChapterX bots
// Uses systemd user services for local dev, system services on server

const fs = require('fs');
const path = require('path');
const os = require('os');
const { runCmd, runCmdFull } = require('./utils');
const config = require('../config');

// ============================================================================
// CONFIGURATION
// ============================================================================

// Detect if we should use user or system services
// On server (running as root or with sudo), use system services
// Locally, use user services
const USE_USER_SERVICES = process.env.SYSTEMD_USER === '1' || 
                          process.getuid?.() !== 0;

const SYSTEMD_FLAG = USE_USER_SERVICES ? '--user' : '';

// Service file directories
const USER_SERVICE_DIR = path.join(os.homedir(), '.config', 'systemd', 'user');
const SYSTEM_SERVICE_DIR = '/etc/systemd/system';
const SERVICE_DIR = USE_USER_SERVICES ? USER_SERVICE_DIR : SYSTEM_SERVICE_DIR;

// Service name prefix
const SERVICE_PREFIX = 'chapterx-';

// ============================================================================
// SERVICE FILE MANAGEMENT
// ============================================================================

/**
 * Get the service name for a bot
 * @param {string} botName - Bot name
 * @param {string} slot - Deployment slot (main/dev)
 * @returns {string} Service name
 */
function getServiceName(botName, slot = 'main') {
  return `${SERVICE_PREFIX}${botName}-${slot}`;
}

/**
 * Generate service file content for a bot
 * @param {string} botName - Bot name
 * @param {string} slot - Deployment slot
 * @returns {string} Service file content
 */
function generateServiceFile(botName, slot) {
  const slots = config.getChapterXSlots();
  const slotNames = Object.keys(slots);
  const defaultSlot = slotNames.includes('main') ? 'main' : slotNames[0];
  const chapterxPath = slots[slot] || slots[defaultSlot];
  
  // ChapterX is a Node.js/TypeScript project
  // It uses EMS_PATH + BOT_NAME environment variables to find config
  //
  // OPTIMIZATION: Use compiled JS (node dist/main.js) when available.
  // Falls back to tsx for development. Using npx tsx spawns 4 processes
  // per bot (~160MB each). Compiled JS uses 1 process (~40MB).
  //
  // To build: cd /opt/aethera-server/chapterx/{slot} && npm run build
  
  // Check if compiled dist/main.js exists
  const distMainPath = path.join(chapterxPath, 'dist', 'main.js');
  const useCompiledJs = fs.existsSync(distMainPath);
  
  let execCmd;
  let comment;
  
  if (useCompiledJs) {
    // Production mode: use compiled JavaScript (single process, fast startup)
    execCmd = `/usr/bin/node dist/main.js`;
    comment = '# Running compiled JavaScript (efficient: single process)';
  } else {
    // Development mode: use tsx directly (skip npx wrapper to reduce processes)
    // This still spawns 2 processes but avoids the npm/npx overhead
    execCmd = `/usr/bin/node ./node_modules/.bin/tsx src/main.ts`;
    comment = '# Running via tsx (dev mode - consider running npm run build for production)';
  }
  
  return `[Unit]
Description=ChapterX Bot: ${botName} (${slot})
After=network.target

[Service]
Type=simple
WorkingDirectory=${chapterxPath}

# Bot configuration
Environment=EMS_PATH=${config.BOTS_PATH}
Environment=BOT_NAME=${botName}
Environment=NODE_ENV=production
Environment=PATH=/usr/local/bin:/usr/bin:/bin

${comment}
ExecStart=${execCmd}

Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
`;
}

/**
 * Ensure the service file exists for a bot
 * @param {string} botName - Bot name
 * @param {string} slot - Deployment slot
 * @returns {Promise<string>} Path to service file
 */
async function ensureServiceFile(botName, slot) {
  const serviceName = getServiceName(botName, slot);
  const servicePath = path.join(SERVICE_DIR, `${serviceName}.service`);
  
  // Ensure directory exists
  if (!fs.existsSync(SERVICE_DIR)) {
    fs.mkdirSync(SERVICE_DIR, { recursive: true });
  }
  
  // Generate and write service file
  const content = generateServiceFile(botName, slot);
  fs.writeFileSync(servicePath, content);
  
  // Reload systemd to pick up new/changed service
  await runCmd(`systemctl ${SYSTEMD_FLAG} daemon-reload`);
  
  return servicePath;
}

/**
 * Remove service file for a bot
 * @param {string} botName - Bot name  
 * @param {string} slot - Deployment slot
 */
async function removeServiceFile(botName, slot) {
  const serviceName = getServiceName(botName, slot);
  const servicePath = path.join(SERVICE_DIR, `${serviceName}.service`);
  
  if (fs.existsSync(servicePath)) {
    fs.unlinkSync(servicePath);
    await runCmd(`systemctl ${SYSTEMD_FLAG} daemon-reload`);
  }
}

// ============================================================================
// SERVICE CONTROL
// ============================================================================

/**
 * Check if systemctl is available
 * @returns {Promise<boolean>}
 */
async function isSystemdAvailable() {
  try {
    await runCmd('systemctl --version');
    return true;
  } catch {
    return false;
  }
}

/**
 * Get status of a service
 * @param {string} serviceName - Service name
 * @returns {Promise<Object>} Status info
 */
async function getServiceStatus(serviceName) {
  try {
    const result = await runCmdFull(
      `systemctl ${SYSTEMD_FLAG} is-active ${serviceName}.service`
    );
    const state = result.stdout.trim();
    
    // Get more details if active
    let details = {};
    if (state === 'active') {
      try {
        const showResult = await runCmd(
          `systemctl ${SYSTEMD_FLAG} show ${serviceName}.service --property=MainPID,ActiveEnterTimestamp`
        );
        const lines = showResult.split('\n');
        for (const line of lines) {
          const [key, value] = line.split('=');
          if (key && value) {
            details[key] = value;
          }
        }
      } catch (e) {
        // Ignore errors getting details
      }
    }
    
    return {
      name: serviceName,
      state, // 'active', 'inactive', 'failed', 'activating', etc.
      running: state === 'active',
      pid: details.MainPID || null,
      startedAt: details.ActiveEnterTimestamp || null,
    };
  } catch (e) {
    // Service doesn't exist or other error
    return {
      name: serviceName,
      state: 'unknown',
      running: false,
      error: e.message,
    };
  }
}

/**
 * Start a service
 * @param {string} serviceName - Service name
 * @returns {Promise<boolean>} Success
 */
async function startService(serviceName) {
  try {
    await runCmd(`systemctl ${SYSTEMD_FLAG} start ${serviceName}.service`);
    
    // Wait briefly and check status
    await new Promise(r => setTimeout(r, 1000));
    const status = await getServiceStatus(serviceName);
    return status.running;
  } catch (e) {
    console.error(`Failed to start ${serviceName}:`, e.message);
    return false;
  }
}

/**
 * Stop a service
 * @param {string} serviceName - Service name
 * @returns {Promise<boolean>} Success
 */
async function stopService(serviceName) {
  try {
    await runCmd(`systemctl ${SYSTEMD_FLAG} stop ${serviceName}.service`);
    return true;
  } catch (e) {
    console.error(`Failed to stop ${serviceName}:`, e.message);
    return false;
  }
}

/**
 * Restart a service
 * @param {string} serviceName - Service name
 * @returns {Promise<boolean>} Success
 */
async function restartService(serviceName) {
  try {
    await runCmd(`systemctl ${SYSTEMD_FLAG} restart ${serviceName}.service`);
    
    await new Promise(r => setTimeout(r, 1000));
    const status = await getServiceStatus(serviceName);
    return status.running;
  } catch (e) {
    console.error(`Failed to restart ${serviceName}:`, e.message);
    return false;
  }
}

/**
 * Get service logs
 * @param {string} serviceName - Service name
 * @param {number} lines - Number of lines to retrieve
 * @returns {Promise<string>} Log content
 */
async function getServiceLogs(serviceName, lines = 200) {
  try {
    const output = await runCmd(
      `journalctl ${SYSTEMD_FLAG} -u ${serviceName}.service -n ${lines} --no-pager --output=short-iso`
    );
    return output || '[No logs available]';
  } catch (e) {
    return `[Error getting logs: ${e.message}]`;
  }
}

/**
 * List all ChapterX services
 * @returns {Promise<Array<Object>>} List of services with status
 */
async function listChapterXServices() {
  try {
    // List service files
    const result = await runCmdFull(
      `systemctl ${SYSTEMD_FLAG} list-units --type=service --all | grep "${SERVICE_PREFIX}" || true`
    );
    
    const services = [];
    const lines = result.stdout.split('\n').filter(l => l.trim());
    
    for (const line of lines) {
      // Parse systemctl list-units output
      const match = line.match(/^\s*(\S+\.service)\s+(\S+)\s+(\S+)\s+(\S+)/);
      if (match) {
        const [, name, load, active, sub] = match;
        const serviceName = name.replace('.service', '');
        
        // Parse bot name and slot from service name
        // Pattern: chapterx-{BotName}-{slot} where slot can be any word
        const botMatch = serviceName.match(/^chapterx-(.+)-([^-]+)$/);
        if (botMatch) {
          services.push({
            serviceName,
            botName: botMatch[1],
            slot: botMatch[2],
            loaded: load === 'loaded',
            active: active === 'active',
            state: sub, // 'running', 'dead', 'failed', etc.
          });
        }
      }
    }
    
    return services;
  } catch (e) {
    console.error('Error listing services:', e.message);
    return [];
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Config
  USE_USER_SERVICES,
  SERVICE_DIR,
  SERVICE_PREFIX,
  
  // Service file management
  getServiceName,
  generateServiceFile,
  ensureServiceFile,
  removeServiceFile,
  
  // Service control
  isSystemdAvailable,
  getServiceStatus,
  startService,
  stopService,
  restartService,
  getServiceLogs,
  listChapterXServices,
};

