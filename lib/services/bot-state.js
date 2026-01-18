// lib/services/bot-state.js - Persistent bot state management
// Tracks bot slot preferences and last-known states
// State is synced with discovered bots on each listBots() call

const fs = require('fs');
const path = require('path');
const config = require('../../config');

// State file path
const STATE_FILE = path.join(config.DATA_DIR, 'bot-state.json');

// In-memory cache
let _state = null;

/**
 * Load state from disk
 * @returns {Object} State object
 */
function loadState() {
  if (_state !== null) {
    return _state;
  }
  
  try {
    if (fs.existsSync(STATE_FILE)) {
      const content = fs.readFileSync(STATE_FILE, 'utf8');
      _state = JSON.parse(content);
    } else {
      _state = { bots: {} };
    }
  } catch (error) {
    console.error('Error loading bot state:', error.message);
    _state = { bots: {} };
  }
  
  return _state;
}

/**
 * Save state to disk
 */
function saveState() {
  try {
    // Ensure data directory exists
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(STATE_FILE, JSON.stringify(_state, null, 2));
  } catch (error) {
    console.error('Error saving bot state:', error.message);
  }
}

/**
 * Get stored state for a bot
 * @param {string} botName - Bot name
 * @returns {Object|null} Bot state or null if not found
 */
function getBotState(botName) {
  const state = loadState();
  return state.bots[botName] || null;
}

/**
 * Get the preferred slot for a bot
 * Falls back to 'main' if no preference stored
 * @param {string} botName - Bot name
 * @returns {string} Slot name
 */
function getPreferredSlot(botName) {
  const botState = getBotState(botName);
  if (botState && botState.preferredSlot) {
    // Verify the slot still exists
    const slots = config.getChapterXSlots();
    if (slots[botState.preferredSlot]) {
      return botState.preferredSlot;
    }
  }
  
  // Default to 'main' if it exists, otherwise first available slot
  const slots = config.getChapterXSlots();
  const slotNames = Object.keys(slots);
  return slotNames.includes('main') ? 'main' : (slotNames[0] || 'main');
}

/**
 * Set the preferred slot for a bot
 * @param {string} botName - Bot name
 * @param {string} slot - Slot name
 */
function setPreferredSlot(botName, slot) {
  const state = loadState();
  
  if (!state.bots[botName]) {
    state.bots[botName] = {};
  }
  
  state.bots[botName].preferredSlot = slot;
  state.bots[botName].lastUpdated = new Date().toISOString();
  
  saveState();
}

/**
 * Record that a bot was started in a slot
 * Updates the preferred slot to match
 * @param {string} botName - Bot name
 * @param {string} slot - Slot used
 */
function recordBotStart(botName, slot) {
  const state = loadState();
  
  if (!state.bots[botName]) {
    state.bots[botName] = {};
  }
  
  state.bots[botName].preferredSlot = slot;
  state.bots[botName].lastStartedSlot = slot;
  state.bots[botName].lastStartedAt = new Date().toISOString();
  state.bots[botName].lastUpdated = new Date().toISOString();
  
  saveState();
}

/**
 * Record that a bot was stopped
 * @param {string} botName - Bot name
 * @param {string} slot - Slot it was running in
 */
function recordBotStop(botName, slot) {
  const state = loadState();
  
  if (!state.bots[botName]) {
    state.bots[botName] = {};
  }
  
  // Keep the slot as preferred so it's remembered
  if (slot) {
    state.bots[botName].preferredSlot = slot;
    state.bots[botName].lastStoppedSlot = slot;
  }
  state.bots[botName].lastStoppedAt = new Date().toISOString();
  state.bots[botName].lastUpdated = new Date().toISOString();
  
  saveState();
}

/**
 * Get all bot states
 * @returns {Object} Map of botName to state
 */
function getAllBotStates() {
  const state = loadState();
  return state.bots;
}

/**
 * Ensure a bot has state initialized (called when bot is discovered)
 * Does NOT overwrite existing state - only creates if missing
 * @param {string} botName - Bot name
 * @returns {Object} The bot's state
 */
function ensureBotState(botName) {
  const state = loadState();
  
  if (!state.bots[botName]) {
    // Initialize with defaults
    const slots = config.getChapterXSlots();
    const slotNames = Object.keys(slots);
    const defaultSlot = slotNames.includes('main') ? 'main' : (slotNames[0] || 'main');
    
    state.bots[botName] = {
      preferredSlot: defaultSlot,
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    };
    
    saveState();
    console.log(`[bot-state] Initialized state for new bot '${botName}' (slot: ${defaultSlot})`);
  }
  
  return state.bots[botName];
}

/**
 * Sync state with discovered bots - adds new bots, removes deleted ones
 * @param {Array<string>} discoveredBotNames - List of bot names that currently exist
 * @returns {Object} Summary of changes { added: [], removed: [] }
 */
function syncWithDiscoveredBots(discoveredBotNames) {
  const state = loadState();
  const changes = { added: [], removed: [] };
  
  // Add new bots
  for (const botName of discoveredBotNames) {
    if (!state.bots[botName]) {
      ensureBotState(botName);
      changes.added.push(botName);
    }
  }
  
  // Remove bots that no longer exist
  const existingBotNames = Object.keys(state.bots);
  for (const botName of existingBotNames) {
    if (!discoveredBotNames.includes(botName)) {
      delete state.bots[botName];
      changes.removed.push(botName);
      console.log(`[bot-state] Removed state for deleted bot '${botName}'`);
    }
  }
  
  if (changes.removed.length > 0) {
    saveState();
  }
  
  return changes;
}

/**
 * Clear state for a bot (e.g., if bot is deleted)
 * @param {string} botName - Bot name
 */
function clearBotState(botName) {
  const state = loadState();
  delete state.bots[botName];
  saveState();
}

/**
 * Force reload state from disk (useful after external changes)
 */
function reloadState() {
  _state = null;
  return loadState();
}

module.exports = {
  getBotState,
  getPreferredSlot,
  setPreferredSlot,
  recordBotStart,
  recordBotStop,
  getAllBotStates,
  ensureBotState,
  syncWithDiscoveredBots,
  clearBotState,
  reloadState,
  STATE_FILE,
};

