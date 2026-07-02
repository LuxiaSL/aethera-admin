// main.js - Main application logic for aethera-admin

// ============================================================================
// STATE
// ============================================================================

const state = {
  authenticated: false,
  username: null,
  currentPage: 'dashboard',
};

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  // Check auth status
  await checkAuth();
  
  // Setup event listeners
  setupEventListeners();
  
  // Setup live status indicator
  setupLiveStatusIndicator();
});

// ============================================================================
// LIVE DATA INTEGRATION
// ============================================================================

/**
 * Setup the live status indicator in the header
 */
function setupLiveStatusIndicator() {
  streams.onStatusChange(updateLiveStatusIndicator);
}

/**
 * Update the live status indicator based on connection state
 * @param {'connected'|'connecting'|'reconnecting'|'disconnected'} status
 * @param {string} [domain] - Current stream domain
 */
function updateLiveStatusIndicator(status, domain) {
  const indicator = document.getElementById('liveStatus');
  if (!indicator) return;
  
  const dot = indicator.querySelector('.live-status-dot');
  const text = indicator.querySelector('.live-status-text');
  
  // Update class for styling
  indicator.className = `live-status ${status}`;
  
  // Update text
  switch (status) {
    case 'connected':
      text.textContent = 'Live';
      break;
    case 'connecting':
      text.textContent = 'Connecting';
      break;
    case 'reconnecting':
      text.textContent = 'Reconnecting';
      break;
    case 'disconnected':
    default:
      text.textContent = 'Offline';
      break;
  }
}

async function checkAuth() {
  try {
    const result = await api.auth.check();
    
    if (result.authenticated) {
      state.authenticated = true;
      state.username = result.username;
      showApp();
    } else {
      showLogin();
    }
  } catch (e) {
    console.error('Auth check failed:', e);
    showLogin();
  }
}

// ============================================================================
// VIEW SWITCHING
// ============================================================================

function showLogin() {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('mainApp').style.display = 'none';
  state.authenticated = false;
  
  // Focus username field
  setTimeout(() => {
    document.getElementById('username').focus();
  }, 100);
}

function showApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('mainApp').style.display = 'block';
  
  // Update username display
  document.getElementById('currentUser').textContent = state.username;
  
  // Load initial data
  loadDashboard();
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

function setupEventListeners() {
  // Login form
  document.getElementById('loginForm').addEventListener('submit', handleLogin);
  
  // Navigation tabs
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const page = tab.dataset.page;
      navigateTo(page);
    });
  });
  
  // Change password form
  document.getElementById('changePasswordForm').addEventListener('submit', handleChangePassword);
}

// ============================================================================
// AUTHENTICATION
// ============================================================================

async function handleLogin(e) {
  e.preventDefault();
  
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const errorDiv = document.getElementById('loginError');
  const btnText = document.getElementById('loginBtnText');
  const spinner = document.getElementById('loginSpinner');
  
  // Show loading
  btnText.style.display = 'none';
  spinner.style.display = 'inline-block';
  errorDiv.style.display = 'none';
  
  try {
    const result = await api.auth.login(username, password);
    
    state.authenticated = true;
    state.username = result.username;
    
    showApp();
    showToast('Welcome back!', 'success');
  } catch (error) {
    errorDiv.textContent = error.message || 'Login failed';
    errorDiv.style.display = 'block';
    
    // Clear password field
    document.getElementById('password').value = '';
    document.getElementById('password').focus();
  } finally {
    btnText.style.display = 'inline';
    spinner.style.display = 'none';
  }
}

async function logout() {
  try {
    await api.auth.logout();
  } catch (e) {
    console.error('Logout error:', e);
  }
  
  state.authenticated = false;
  state.username = null;
  
  showLogin();
  showToast('Logged out', 'info');
}

async function handleChangePassword(e) {
  e.preventDefault();
  
  const currentPassword = document.getElementById('currentPassword').value;
  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;
  
  if (newPassword !== confirmPassword) {
    showToast('Passwords do not match', 'error');
    return;
  }
  
  try {
    await api.auth.changePassword(currentPassword, newPassword);
    showToast('Password changed. Please log in again.', 'success');
    showLogin();
  } catch (error) {
    showToast(error.message || 'Failed to change password', 'error');
  }
}

// ============================================================================
// NAVIGATION
// ============================================================================

function navigateTo(page) {
  // Disconnect any active stream when leaving a page
  streams.disconnect();
  
  // Update tabs
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.page === page);
  });
  
  // Update pages
  document.querySelectorAll('.page-content').forEach(content => {
    content.classList.remove('active');
  });
  
  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) {
    pageEl.classList.add('active');
  }
  
  state.currentPage = page;
  
  // Load page-specific data
  switch (page) {
    case 'dashboard':
      loadDashboard();
      break;
    case 'bots':
      loadBots();
      break;
    case 'services':
      loadServices();
      break;
    case 'dreams':
      loadDreams();
      break;
    case 'connectome':
      loadConnectome();
      break;
    case 'blog':
      loadBlog();
      break;
    case 'irc':
      loadIRC();
      break;
    case 'server':
      loadServer();
      break;
  }
}

// ============================================================================
// DATA LOADING
// ============================================================================

async function loadDashboard() {
  // Use live data stream
  loadDashboardLive();
}

/**
 * Load dashboard page with live SSE updates
 */
function loadDashboardLive() {
  streams.connect('dashboard', (data) => {
    renderDashboardData(data);
  });
}

/**
 * Render dashboard data from SSE stream
 */
function renderDashboardData(data) {
  // Bots section
  const bots = data.bots || {};
  pulseUpdate('statBotsRunning', bots.running || 0);
  
  const botsList = bots.list || [];
  if (botsList.length === 0) {
    document.getElementById('dashboardBots').innerHTML = `
      <div class="empty-state" style="padding: var(--space-lg);">
        <p style="color: var(--text-secondary);">No bots configured yet</p>
        <p style="font-size: var(--text-sm); color: var(--text-muted);">Add bot configs to /opt/aethera-server/bots/</p>
      </div>
    `;
  } else {
    document.getElementById('dashboardBots').innerHTML = botsList.map(bot => `
      <div style="display: flex; align-items: center; gap: var(--space-md); padding: var(--space-sm) 0; border-bottom: 1px solid var(--border-subtle);">
        <span class="status-dot ${bot.running ? 'running' : 'stopped'}"></span>
        <span style="flex: 1;">${escapeHtml(bot.name)}</span>
        <span style="font-size: var(--text-sm); color: ${bot.running ? 'var(--status-success)' : 'var(--text-muted)'};">
          ${bot.running ? `Running (${bot.slot})` : 'Stopped'}
        </span>
      </div>
    `).join('') + (bots.total > 5 ? `
      <div style="padding: var(--space-sm); text-align: center;">
        <a href="#" onclick="navigateTo('bots'); return false;" style="font-size: var(--text-sm);">View all ${bots.total} bots →</a>
      </div>
    ` : '');
  }
  
  // Services section
  const services = data.services || {};
  const aethera = services.aethera || {};
  const running = aethera.running || false;
  const health = aethera.health || '';
  
  pulseUpdate('statServices', running ? '1/1' : '0/1');
  
  document.getElementById('dashboardServices').innerHTML = `
    <div style="display: flex; align-items: center; gap: var(--space-md); padding: var(--space-sm) 0;">
      <span class="status-dot ${running ? 'running' : 'stopped'}"></span>
      <span style="flex: 1;">æthera</span>
      <span style="color: ${running ? 'var(--status-success)' : 'var(--text-muted)'}; font-size: var(--text-sm);">
        ${running ? 'Running' : 'Stopped'}${health === 'healthy' ? ' ✓' : health === 'unhealthy' ? ' ✗' : ''}
      </span>
    </div>
  `;
  
  // Dreams section
  const dreams = data.dreams || {};
  const dreamsLabel = dreams.gpuConnected
    ? `${dreams.fps != null ? dreams.fps.toFixed(1) + ' FPS' : 'Active'}`
    : 'Offline';
  pulseUpdate('statDreams', dreamsLabel);
  const dreamsEl = document.getElementById('statDreams');
  if (dreamsEl) {
    dreamsEl.className = `stat-value ${dreams.gpuConnected ? 'success' : ''}`;
  }

  // Blog section
  const blog = data.blog || {};
  pulseUpdate('statBlogPosts', blog.total || 0);
  
  // Usage section
  const usage = data.usage || {};
  if (usage.today) {
    const todayCost = usage.today.cost || 0;
    const costDisplay = todayCost > 0 ? `$${todayCost.toFixed(2)}` : '$0.00';
    pulseUpdate('statTodayCost', costDisplay);
    
    // Update class based on cost
    const costEl = document.getElementById('statTodayCost');
    if (costEl) {
      costEl.className = `stat-value ${todayCost > 1 ? 'warning' : todayCost > 0 ? '' : 'success'}`;
    }
  }
}

/**
 * Force refresh dashboard (bypasses stream, immediate fetch)
 */
async function forceRefreshDashboard() {
  showToast('Refreshing dashboard...', 'info');
  try {
    // Fetch all data in parallel
    const [botsData, aetheraData, dreamsData, blogStats, usageData] = await Promise.all([
      api.bots.list().catch(() => ({ bots: [], running: 0 })),
      api.services.aetheraStatus().catch(() => ({ running: false })),
      api.dreams.status().catch(() => ({ gpuConnected: false, status: 'unknown' })),
      api.blog.stats().catch(() => ({ total: 0 })),
      api.usage.summary('day').catch(() => ({ totals: {} })),
    ]);
    
    const bots = botsData.bots || [];
    const runningBots = bots.filter(b => b.running);
    
    renderDashboardData({
      bots: {
        total: bots.length,
        running: runningBots.length,
        list: bots.slice(0, 5).map(b => ({
          name: b.name,
          running: b.running,
          slot: b.slot,
        })),
      },
      services: {
        aethera: {
          running: aetheraData.running || false,
          health: aetheraData.health || '',
        },
      },
      dreams: {
        gpuConnected: dreamsData.gpuConnected || false,
        fps: dreamsData.generation?.fps ?? null,
      },
      blog: {
        total: blogStats.total || 0,
      },
      usage: {
        today: {
          cost: usageData.totals?.total_cost_usd || 0,
          requests: usageData.totals?.total_requests || 0,
        },
      },
    });
    
    showToast('Dashboard refreshed', 'success');
  } catch (error) {
    showToast(`Refresh failed: ${error.message}`, 'error');
  }
}

// ============================================================================
// BOT MANAGEMENT
// ============================================================================

let currentBots = [];
let currentSlots = {};
let currentSystemd = { available: false };
let currentLogsBotName = null;
let currentConfigBotName = null;

async function loadBots() {
  // Load the appropriate sub-tab based on current state
  if (currentBotsSubtab === 'usage') {
    loadUsageLive();
  } else {
    loadBotsLive();
  }
}

/**
 * Load bots page with live SSE updates
 */
function loadBotsLive() {
  streams.connect('bots', (data) => {
    currentBots = data.bots || [];
    currentSlots = data.slots || {};
    currentSystemd = data.systemd || { available: false };
    
    // Update stats with pulse animation
    pulseUpdate('botsTotal', data.count || 0);
    pulseUpdate('botsRunning', data.running || 0);
    
    // Render UI
    renderSlotsInfo();
    renderBotsGrid();
  });
}

/**
 * Force refresh bots (bypasses stream, immediate fetch)
 */
async function forceRefreshBots() {
  showToast('Refreshing bots...', 'info');
  try {
    const data = await api.bots.list();
    currentBots = data.bots || [];
    currentSlots = data.slots || {};
    currentSystemd = data.systemd || { available: false };
    
    pulseUpdate('botsTotal', data.count || 0);
    pulseUpdate('botsRunning', data.running || 0);
    
    renderSlotsInfo();
    renderBotsGrid();
    showToast('Bots refreshed', 'success');
  } catch (error) {
    console.error('Error loading bots:', error);
    showToast('Failed to load bots', 'error');
  }
}

function renderSlotsInfo() {
  const container = document.getElementById('slotsInfo');
  
  const html = Object.entries(currentSlots).map(([name, slot]) => `
    <div class="slot-card">
      <div class="slot-card-header">
        <span class="slot-card-name ${name}">${name.toUpperCase()}</span>
        ${slot.exists ? '' : '<span style="color: var(--status-error); font-size: var(--text-xs);">Not found</span>'}
      </div>
      ${slot.gitBranch ? `
        <div class="slot-card-branch">
          Branch: <span class="branch-name">${slot.gitBranch}</span>
        </div>
      ` : ''}
    </div>
  `).join('');
  
  container.innerHTML = html;
}

function renderBotsGrid() {
  const container = document.getElementById('botsGrid');
  
  // Show systemd warning if not available
  const systemdWarning = !currentSystemd.available ? `
    <div class="systemd-warning" style="grid-column: 1 / -1; background: rgba(251, 191, 36, 0.1); border: 1px solid var(--status-warning); border-radius: var(--radius-md); padding: var(--space-md); margin-bottom: var(--space-md); display: flex; align-items: center; gap: var(--space-sm);">
      <span>⚠️</span>
      <span style="color: var(--status-warning);">systemd not available - bot start/stop disabled. This is expected in local development.</span>
    </div>
  ` : '';
  
  if (currentBots.length === 0) {
    container.innerHTML = systemdWarning + `
      <div class="bots-empty" style="grid-column: 1 / -1;">
        <div class="bots-empty-icon">🤖</div>
        <p class="bots-empty-title">No bots configured</p>
        <p class="bots-empty-description">Add bot configurations to get started</p>
        <code class="bots-empty-path">/opt/aethera-server/bots/</code>
      </div>
    `;
    return;
  }
  
  const canControl = currentSystemd.available;
  
  const html = currentBots.map(bot => `
    <div class="bot-card ${bot.running ? 'running' : 'stopped'}">
      <div class="bot-card-header">
        <div class="bot-name-area">
          <div class="bot-name">
            <span class="status-dot ${bot.running ? 'running' : 'stopped'}"></span>
            ${escapeHtml(bot.name)}
          </div>
          <div class="bot-status-badge ${bot.running ? 'running' : 'stopped'}">
            ${bot.running ? 'Running' : 'Stopped'}
          </div>
          ${bot.slot ? `
            <div class="bot-slot">
              Slot: <span class="slot-name">${bot.slot}</span>
            </div>
          ` : ''}
        </div>
        
        <div class="bot-menu">
          <button class="bot-menu-trigger" onclick="toggleBotMenu('${bot.name}')">⋮</button>
          <div id="botMenu-${bot.name}" class="bot-menu-dropdown">
            <button class="bot-menu-item" onclick="viewBotLogs('${bot.name}')">
              📜 View Logs
            </button>
            <button class="bot-menu-item" onclick="editBotConfig('${bot.name}')">
              ⚙️ Edit Config
            </button>
            ${canControl && bot.running ? `
              <div class="bot-menu-divider"></div>
              <button class="bot-menu-item danger" onclick="forceStopBot('${bot.name}')">
                ☠️ Force Kill
              </button>
            ` : ''}
          </div>
        </div>
      </div>
      
      ${!bot.running && canControl && Object.keys(currentSlots).length > 0 ? `
        <div class="slot-selector">
          ${Object.keys(currentSlots).map((slotName) => `
            <button class="slot-btn ${slotName === getDefaultSlotForBot(bot) ? 'active' : ''}" data-slot="${slotName}" 
                    onclick="selectSlot('${bot.name}', '${slotName}', this)">${slotName}</button>
          `).join('')}
        </div>
      ` : ''}
      
      <div class="bot-card-actions">
        ${bot.running ? `
          <button class="btn-secondary" onclick="stopBot('${bot.name}')" ${!canControl ? 'disabled' : ''}>⏹️ Stop</button>
          <button class="btn-primary" onclick="restartBot('${bot.name}')" ${!canControl ? 'disabled' : ''}>🔄 Restart</button>
        ` : `
          <button class="btn-primary" onclick="startBot('${bot.name}')" ${!canControl ? 'disabled' : ''}>▶️ Start</button>
        `}
      </div>
    </div>
  `).join('');
  
  container.innerHTML = systemdWarning + html;
}

// Bot slot selection state (local cache, also persisted to backend)
const selectedSlots = {};

async function selectSlot(botName, slot, btn) {
  selectedSlots[botName] = slot;
  
  // Update UI immediately
  const parent = btn.parentElement;
  parent.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  
  // Persist to backend (so auto-refresh preserves the selection)
  try {
    await api.bots.setSlot(botName, slot);
  } catch (error) {
    console.error('Failed to persist slot selection:', error);
    // Don't show error toast - the local selection still works
  }
}

function getSelectedSlot(botName) {
  // First check if user has manually selected a slot this session
  if (selectedSlots[botName]) {
    return selectedSlots[botName];
  }
  
  // Then check if the bot has a stored preferred slot from the backend
  const bot = currentBots.find(b => b.name === botName);
  if (bot && bot.preferredSlot && currentSlots[bot.preferredSlot]) {
    return bot.preferredSlot;
  }
  
  // Default to 'main' if it exists, otherwise first available slot
  const slotNames = Object.keys(currentSlots);
  return slotNames.includes('main') ? 'main' : (slotNames[0] || 'main');
}

/**
 * Get the default slot for a bot (what should be highlighted in UI)
 * This should match what getSelectedSlot returns for consistency
 */
function getDefaultSlotForBot(bot) {
  // Check stored preference from backend
  if (bot.preferredSlot && currentSlots[bot.preferredSlot]) {
    return bot.preferredSlot;
  }
  
  // Default to 'main' if it exists, otherwise first available slot
  const slotNames = Object.keys(currentSlots);
  return slotNames.includes('main') ? 'main' : (slotNames[0] || 'main');
}

// Bot menu toggle
function toggleBotMenu(botName) {
  // Close all other menus
  document.querySelectorAll('.bot-menu-dropdown').forEach(m => {
    if (m.id !== `botMenu-${botName}`) {
      m.classList.remove('show');
    }
  });
  
  const menu = document.getElementById(`botMenu-${botName}`);
  menu.classList.toggle('show');
}

// Close menus when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.bot-menu')) {
    document.querySelectorAll('.bot-menu-dropdown').forEach(m => m.classList.remove('show'));
  }
});

// Bot actions
async function startBot(botName) {
  if (!currentSystemd.available) {
    showToast('systemd not available - cannot start bots in dev mode', 'warning');
    return;
  }
  
  const slot = getSelectedSlot(botName);
  
  try {
    showToast(`Starting ${botName} in ${slot}...`, 'info');
    await api.bots.start(botName, slot);
    showToast(`${botName} started successfully`, 'success');
    await loadBots();
  } catch (error) {
    showToast(error.message || 'Failed to start bot', 'error');
  }
}

async function stopBot(botName) {
  if (!currentSystemd.available) {
    showToast('systemd not available - cannot stop bots in dev mode', 'warning');
    return;
  }
  
  try {
    showToast(`Stopping ${botName}...`, 'info');
    await api.bots.stop(botName);
    showToast(`${botName} stopped`, 'success');
    await loadBots();
  } catch (error) {
    showToast(error.message || 'Failed to stop bot', 'error');
  }
}

async function restartBot(botName) {
  if (!currentSystemd.available) {
    showToast('systemd not available - cannot restart bots in dev mode', 'warning');
    return;
  }
  
  try {
    showToast(`Restarting ${botName}...`, 'info');
    await api.bots.restart(botName);
    showToast(`${botName} restarted`, 'success');
    await loadBots();
  } catch (error) {
    showToast(error.message || 'Failed to restart bot', 'error');
  }
}

async function forceStopBot(botName) {
  if (!currentSystemd.available) {
    showToast('systemd not available', 'warning');
    return;
  }
  
  if (!confirm(`Force kill ${botName}? This may cause data loss.`)) {
    return;
  }
  
  try {
    await api.bots.stop(botName, true);
    showToast(`${botName} stopped`, 'warning');
    await loadBots();
  } catch (error) {
    showToast(error.message || 'Failed to stop bot', 'error');
  }
}

async function refreshBots() {
  // Alias for forceRefreshBots for backwards compatibility
  await forceRefreshBots();
}

// Logs modal
async function viewBotLogs(botName) {
  currentLogsBotName = botName;
  document.getElementById('logsModalTitle').textContent = `Logs: ${botName}`;
  document.getElementById('logsOutput').textContent = '[Loading...]';
  document.getElementById('logsModal').classList.add('active');
  
  await refreshLogs();
}

async function refreshLogs() {
  if (!currentLogsBotName) return;
  
  try {
    const data = await api.bots.logs(currentLogsBotName);
    // Update title to show which slot's logs we're viewing
    const slotInfo = data.slot ? ` (${data.slot})` : '';
    document.getElementById('logsModalTitle').textContent = `Logs: ${currentLogsBotName}${slotInfo}`;
    document.getElementById('logsOutput').textContent = data.logs || '[No logs available]';
    scrollLogsToBottom();
  } catch (error) {
    document.getElementById('logsOutput').textContent = `[Error: ${error.message}]`;
  }
}

function scrollLogsToBottom() {
  const output = document.getElementById('logsOutput');
  output.scrollTop = output.scrollHeight;
}

function closeLogsModal(event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById('logsModal').classList.remove('active');
  currentLogsBotName = null;
}

// Config modal
async function editBotConfig(botName) {
  currentConfigBotName = botName;
  document.getElementById('configModalTitle').textContent = `Config: ${botName}`;
  document.getElementById('configEditor').value = '[Loading...]';
  document.getElementById('configModal').classList.add('active');
  
  try {
    const data = await api.bots.getConfig(botName);
    document.getElementById('configEditor').value = data.config || '';
  } catch (error) {
    document.getElementById('configEditor').value = `# Error: ${error.message}`;
  }
}

async function saveConfig() {
  if (!currentConfigBotName) return;
  
  const config = document.getElementById('configEditor').value;
  
  try {
    await api.bots.saveConfig(currentConfigBotName, config);
    showToast('Config saved successfully', 'success');
    closeConfigModal();
  } catch (error) {
    showToast(error.message || 'Failed to save config', 'error');
  }
}

function closeConfigModal(event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById('configModal').classList.remove('active');
  currentConfigBotName = null;
}

// Escape key closes modals
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeLogsModal();
    closeConfigModal();
    closeAetheraLogsModal();
    closeMembraneApiLogsModal();
    // Blog modals
    if (typeof closePostEditor === 'function') closePostEditor();
    if (typeof closeDeleteModal === 'function') closeDeleteModal();
  }
});

// HTML escaping utility
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Make functions global
window.loadBots = loadBots;
window.refreshBots = refreshBots;
window.forceRefreshBots = forceRefreshBots;
window.startBot = startBot;
window.stopBot = stopBot;
window.restartBot = restartBot;
window.forceStopBot = forceStopBot;
window.toggleBotMenu = toggleBotMenu;
window.selectSlot = selectSlot;
window.getDefaultSlotForBot = getDefaultSlotForBot;
window.viewBotLogs = viewBotLogs;
window.refreshLogs = refreshLogs;
window.scrollLogsToBottom = scrollLogsToBottom;
window.closeLogsModal = closeLogsModal;
window.editBotConfig = editBotConfig;
window.saveConfig = saveConfig;
window.closeConfigModal = closeConfigModal;

// ============================================================================
// BOTS SUB-TAB SWITCHING
// ============================================================================

let currentBotsSubtab = 'management';

function switchBotsSubtab(subtab) {
  // Disconnect current stream
  streams.disconnect();
  
  currentBotsSubtab = subtab;
  
  // Update tab buttons
  document.querySelectorAll('.bots-sub-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.subtab === subtab);
  });
  
  // Update content panels
  document.querySelectorAll('.bots-subtab-content').forEach(content => {
    content.classList.remove('active');
  });
  const panel = document.getElementById(`bots-subtab-${subtab}`);
  if (panel) {
    panel.classList.add('active');
  }
  
  // Load appropriate data
  if (subtab === 'management') {
    loadBotsLive();
  } else if (subtab === 'usage') {
    loadUsageLive();
  }
}

window.switchBotsSubtab = switchBotsSubtab;

// ============================================================================
// USAGE TRACKING
// ============================================================================

let usageData = null;
let currentUsagePeriod = 'day';

/**
 * Load usage data with live SSE updates
 */
function loadUsageLive() {
  streams.connect('usage', (data) => {
    usageData = data;
    renderUsageData();
  });
}

/**
 * Set the usage period filter
 */
function setUsagePeriod(period) {
  currentUsagePeriod = period;
  
  // Update period tab buttons
  document.querySelectorAll('.usage-period-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.period === period);
  });
  
  // Reload data with new period (not using SSE for this, direct API call)
  loadUsageForPeriod(period);
}

/**
 * Load usage data for a specific period
 */
async function loadUsageForPeriod(period) {
  try {
    const summary = await api.usage.summary(period);
    usageData = summary;
    renderUsageData();
  } catch (error) {
    console.error('Error loading usage for period:', error);
    showToast('Failed to load usage data', 'error');
  }
}

/**
 * Force sync usage data from trace files
 */
async function syncUsageData() {
  const statusEl = document.getElementById('usageSyncStatus');
  const textEl = document.getElementById('usageSyncText');
  
  statusEl.classList.add('syncing');
  textEl.textContent = 'Syncing...';
  
  try {
    showToast('Syncing usage data...', 'info');
    const result = await api.usage.sync();
    
    statusEl.classList.remove('syncing');
    statusEl.classList.add('synced');
    
    if (result.totalNewRecords > 0) {
      showToast(`Synced ${result.totalNewRecords} new records`, 'success');
    } else {
      showToast('Already up to date', 'info');
    }
    
    textEl.textContent = `Last sync: just now`;
    
    // Reload data
    await loadUsageForPeriod(currentUsagePeriod);
  } catch (error) {
    statusEl.classList.remove('syncing');
    textEl.textContent = `Sync failed: ${error.message}`;
    showToast('Failed to sync usage data', 'error');
  }
}

/**
 * Force refresh usage (bypass stream, immediate fetch)
 */
async function forceRefreshUsage() {
  showToast('Refreshing usage data...', 'info');
  await loadUsageForPeriod(currentUsagePeriod);
  showToast('Usage refreshed', 'success');
}

/**
 * Render usage data to the UI
 */
function renderUsageData() {
  if (!usageData) return;
  
  // Support both SSE format (totalsByPeriod) and API format (totals)
  let totals, bots;
  if (usageData.totalsByPeriod) {
    // SSE stream format - pick current period
    totals = usageData.totalsByPeriod[currentUsagePeriod] || usageData.totalsByPeriod.day || {};
    bots = usageData.botsByPeriod?.[currentUsagePeriod] || usageData.botsByPeriod?.day || [];
  } else {
    // Direct API format
    totals = usageData.totals || {};
    bots = usageData.bots || [];
  }
  
  // Update totals cards
  pulseUpdate('usageTotalCost', formatCurrency(totals.total_cost_usd || 0));
  pulseUpdate('usageTotalRequests', formatNumber(totals.total_requests || 0));
  pulseUpdate('usageTotalTokens', formatNumber(totals.total_tokens || 0));
  pulseUpdate('usageCacheHitRate', formatPercent(totals.cache_hit_ratio || 0));
  
  // Update cache stats
  pulseUpdate('cacheTotalWrites', formatNumber(totals.total_cache_write_tokens || 0));
  pulseUpdate('cacheTotalReads', formatNumber(totals.total_cache_read_tokens || 0));
  pulseUpdate('cacheEstimatedSavings', formatCurrency(totals.cache_savings_estimate || 0));
  
  // Update sync status
  if (usageData.lastSync) {
    const statusEl = document.getElementById('usageSyncStatus');
    const textEl = document.getElementById('usageSyncText');
    statusEl.classList.add('synced');
    textEl.textContent = `Last sync: ${formatRelativeTime(usageData.lastSync) || 'just now'}`;
  }
  
  // Render per-bot breakdown
  renderUsageBotsGrid(bots || []);
}

/**
 * Render the per-bot usage breakdown
 */
function renderUsageBotsGrid(bots) {
  const container = document.getElementById('usageBotsGrid');
  
  if (!bots || bots.length === 0) {
    container.innerHTML = `
      <div class="usage-empty">
        <div class="usage-empty-icon">📊</div>
        <p class="usage-empty-title">No usage data yet</p>
        <p class="usage-empty-description">
          Run some bots and click "Sync Now" to load trace data.
        </p>
      </div>
    `;
    return;
  }
  
  container.innerHTML = bots.map(bot => {
    const cacheHitPercent = (bot.cache_hit_ratio || 0) * 100;
    const totalTokens = bot.total_tokens || 0;
    
    return `
      <div class="usage-bot-card">
        <div class="usage-bot-header">
          <div>
            <div class="usage-bot-name">
              🤖 ${escapeHtml(bot.bot_name)}
            </div>
            ${bot.model ? `<div class="usage-bot-model">${escapeHtml(bot.model)}</div>` : ''}
          </div>
          <div class="usage-bot-cost">${formatCurrency(bot.total_cost_usd || 0)}</div>
        </div>
        
        <div class="usage-bot-stats">
          <div class="usage-bot-stat">
            <span class="usage-bot-stat-label">Requests</span>
            <span class="usage-bot-stat-value">${formatNumber(bot.request_count || 0)}</span>
          </div>
          <div class="usage-bot-stat">
            <span class="usage-bot-stat-label">Input Tokens</span>
            <span class="usage-bot-stat-value">${formatNumber(bot.total_input_tokens || 0)}</span>
          </div>
          <div class="usage-bot-stat">
            <span class="usage-bot-stat-label">Output Tokens</span>
            <span class="usage-bot-stat-value">${formatNumber(bot.total_output_tokens || 0)}</span>
          </div>
          <div class="usage-bot-stat">
            <span class="usage-bot-stat-label">Avg Duration</span>
            <span class="usage-bot-stat-value">${formatDuration(bot.avg_duration_ms || 0)}</span>
          </div>
          <div class="usage-bot-stat">
            <span class="usage-bot-stat-label">Cache Writes</span>
            <span class="usage-bot-stat-value highlight">${formatNumber(bot.total_cache_write_tokens || 0)}</span>
          </div>
          <div class="usage-bot-stat">
            <span class="usage-bot-stat-label">Cache Reads</span>
            <span class="usage-bot-stat-value success">${formatNumber(bot.total_cache_read_tokens || 0)}</span>
          </div>
        </div>
        
        ${totalTokens > 0 ? `
          <div class="usage-cache-bar">
            <div class="usage-cache-bar-label">
              <span>Cache Hit Rate</span>
              <span>${cacheHitPercent.toFixed(1)}%</span>
            </div>
            <div class="usage-cache-bar-track">
              <div class="usage-cache-bar-fill" style="width: ${cacheHitPercent}%"></div>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

// ============================================================================
// USAGE FORMATTING HELPERS
// ============================================================================

function formatCurrency(value) {
  if (value == null) return '$0.00';
  return `$${value.toFixed(2)}`;
}

function formatNumber(value) {
  if (value == null) return '0';
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return value.toLocaleString();
}

function formatPercent(ratio) {
  if (ratio == null) return '0%';
  return `${(ratio * 100).toFixed(1)}%`;
}

function formatDuration(ms) {
  if (ms == null || ms === 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

// Make usage functions global
window.loadUsageLive = loadUsageLive;
window.setUsagePeriod = setUsagePeriod;
window.syncUsageData = syncUsageData;
window.forceRefreshUsage = forceRefreshUsage;
window.formatCurrency = formatCurrency;
window.formatNumber = formatNumber;
window.formatPercent = formatPercent;
window.formatDuration = formatDuration;

// ============================================================================
// SERVICES MANAGEMENT
// ============================================================================

let aetheraStatus = null;
let membraneApiStatus = null;

async function loadServices() {
  // Use live data stream
  loadServicesLive();
}

/**
 * Load services page with live SSE updates
 */
function loadServicesLive() {
  // Track if we've done the initial deps load
  let initialDepsLoaded = false;
  
  streams.connect('services', (data) => {
    aetheraStatus = data.aethera || null;
    membraneApiStatus = data.membraneApi || null;
    currentSlots = data.slots || {};
    
    renderAetheraStatus();
    renderMembraneApiStatus();
    renderSlots();
    
    // Re-apply cached deps UI after renderSlots rebuilds the DOM
    for (const slotName of Object.keys(currentSlots)) {
      if (slotGitDeps[slotName]) {
        updateSlotDepsUI(slotName);
      }
    }
    
    // Load git deps status for each slot (only once on initial load)
    if (!initialDepsLoaded) {
      initialDepsLoaded = true;
      for (const slotName of Object.keys(currentSlots)) {
        loadSlotDeps(slotName);
      }
    }
  });
}

/**
 * Force refresh services (bypasses stream, immediate fetch)
 */
async function forceRefreshServices() {
  showToast('Refreshing services...', 'info');
  try {
    await refreshAetheraStatus();
    await loadSlots();
    showToast('Services refreshed', 'success');
  } catch (error) {
    showToast(`Refresh failed: ${error.message}`, 'error');
  }
}

async function refreshAetheraStatus() {
  try {
    aetheraStatus = await api.services.aetheraStatus();
    renderAetheraStatus();
  } catch (error) {
    console.error('Error loading aethera status:', error);
    showToast('Failed to load æthera status', 'error');
  }
}

function renderAetheraStatus() {
  if (!aetheraStatus) return;
  
  // Docker availability warning
  const dockerWarning = document.getElementById('dockerWarning');
  if (dockerWarning) {
    dockerWarning.style.display = aetheraStatus.available === false ? 'flex' : 'none';
  }
  
  // Status badge
  const statusBadge = document.getElementById('aetheraStatusBadge');
  if (statusBadge) {
    const running = aetheraStatus.running;
    const statusText = aetheraStatus.exists === false ? 'Not Found' : 
                       running ? 'Running' : 'Stopped';
    statusBadge.className = `service-status-badge ${running ? 'running' : 'stopped'}`;
    statusBadge.innerHTML = `<span class="status-dot ${running ? 'running' : 'stopped'}"></span> ${statusText}`;
  }
  
  // Health badge
  const healthBadge = document.getElementById('aetheraHealthBadge');
  if (healthBadge) {
    const health = aetheraStatus.health;
    healthBadge.className = `service-health-badge ${health}`;
    healthBadge.textContent = health === 'healthy' ? '✓ Healthy' : health === 'unhealthy' ? '✗ Unhealthy' : '—';
  }
  
  // Stats
  document.getElementById('aetheraContainer').textContent = aetheraStatus.containerName || '—';
  document.getElementById('aetheraImage').textContent = aetheraStatus.image ? 
    aetheraStatus.image.split(':').pop() || aetheraStatus.image : '—';
  document.getElementById('aetheraUptime').textContent = aetheraStatus.uptime ? 
    formatUptime(aetheraStatus.uptime) : '—';
  document.getElementById('aetheraRestarts').textContent = aetheraStatus.restartCount ?? '—';
  
  // Action buttons
  const startBtn = document.getElementById('aetheraStartBtn');
  const stopBtn = document.getElementById('aetheraStopBtn');
  const restartBtn = document.getElementById('aetheraRestartBtn');
  
  if (aetheraStatus.exists && aetheraStatus.available) {
    if (aetheraStatus.running) {
      startBtn.style.display = 'none';
      stopBtn.style.display = 'inline-flex';
      restartBtn.disabled = false;
    } else {
      startBtn.style.display = 'inline-flex';
      stopBtn.style.display = 'none';
      restartBtn.disabled = true;
    }
  } else {
    startBtn.style.display = 'none';
    stopBtn.style.display = 'none';
    restartBtn.disabled = true;
  }
}

function formatUptime(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

async function startAethera() {
  try {
    showToast('Starting æthera...', 'info');
    await api.services.aetheraStart();
    showToast('æthera started', 'success');
    await refreshAetheraStatus();
  } catch (error) {
    showToast(error.message || 'Failed to start æthera', 'error');
  }
}

async function stopAethera() {
  if (!confirm('Stop æthera? The blog will be unavailable.')) return;
  
  try {
    showToast('Stopping æthera...', 'info');
    await api.services.aetheraStop();
    showToast('æthera stopped', 'success');
    await refreshAetheraStatus();
  } catch (error) {
    showToast(error.message || 'Failed to stop æthera', 'error');
  }
}

async function restartAethera() {
  try {
    showToast('Restarting æthera...', 'info');
    await api.services.aetheraRestart();
    showToast('æthera restarted', 'success');
    await refreshAetheraStatus();
  } catch (error) {
    showToast(error.message || 'Failed to restart æthera', 'error');
  }
}

// Aethera Logs
async function viewAetheraLogs() {
  document.getElementById('aetheraLogsOutput').textContent = '[Loading...]';
  document.getElementById('aetheraLogsModal').classList.add('active');
  await refreshAetheraLogs();
}

async function refreshAetheraLogs() {
  try {
    const data = await api.services.aetheraLogs(300);
    document.getElementById('aetheraLogsOutput').textContent = data.logs || '[No logs available]';
    scrollAetheraLogsToBottom();
  } catch (error) {
    document.getElementById('aetheraLogsOutput').textContent = `[Error: ${error.message}]`;
  }
}

function scrollAetheraLogsToBottom() {
  const output = document.getElementById('aetheraLogsOutput');
  output.scrollTop = output.scrollHeight;
}

function closeAetheraLogsModal(event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById('aetheraLogsModal').classList.remove('active');
}

// ============================================================================
// MEMBRANE-API MANAGEMENT
// ============================================================================

async function refreshMembraneApiStatus() {
  try {
    membraneApiStatus = await api.services.membraneApiStatus();
    renderMembraneApiStatus();
  } catch (error) {
    console.error('Error loading membrane-api status:', error);
    showToast('Failed to load membrane-api status', 'error');
  }
}

function renderMembraneApiStatus() {
  if (!membraneApiStatus) return;
  
  // Status badge
  const statusBadge = document.getElementById('membraneApiStatusBadge');
  if (statusBadge) {
    const running = membraneApiStatus.running;
    const statusText = membraneApiStatus.available === false ? 'Not Found' : 
                       running ? 'Running' : 'Stopped';
    statusBadge.className = `service-status-badge ${running ? 'running' : 'stopped'}`;
    statusBadge.innerHTML = `<span class="status-dot ${running ? 'running' : 'stopped'}"></span> ${statusText}`;
  }
  
  // Health badge
  const healthBadge = document.getElementById('membraneApiHealthBadge');
  if (healthBadge) {
    const health = membraneApiStatus.health;
    healthBadge.className = `service-health-badge ${health}`;
    healthBadge.textContent = health === 'healthy' ? '✓ Healthy' : health === 'unhealthy' ? '✗ Unhealthy' : '—';
  }
  
  // Stats
  const serviceEl = document.getElementById('membraneApiService');
  const pidEl = document.getElementById('membraneApiPid');
  const uptimeEl = document.getElementById('membraneApiUptime');
  const memoryEl = document.getElementById('membraneApiMemory');
  
  if (serviceEl) serviceEl.textContent = membraneApiStatus.serviceName || '—';
  if (pidEl) pidEl.textContent = membraneApiStatus.pid || '—';
  if (uptimeEl) uptimeEl.textContent = membraneApiStatus.uptime ? formatUptime(membraneApiStatus.uptime) : '—';
  if (memoryEl) memoryEl.textContent = membraneApiStatus.memoryMb ? `${membraneApiStatus.memoryMb} MB` : '—';
  
  // Providers display
  const providersContainer = document.getElementById('membraneApiProviders');
  const providersList = document.getElementById('membraneApiProvidersList');
  if (providersContainer && providersList && membraneApiStatus.healthDetails?.providers) {
    const providers = membraneApiStatus.healthDetails.providers;
    const providerNames = Object.keys(providers).filter(p => providers[p] === 'ready');
    
    if (providerNames.length > 0) {
      providersContainer.style.display = 'flex';
      providersList.innerHTML = providerNames.map(p => 
        `<span class="provider-badge">${escapeHtml(p)}</span>`
      ).join('');
    } else {
      providersContainer.style.display = 'none';
    }
  }
  
  // Action buttons
  const startBtn = document.getElementById('membraneApiStartBtn');
  const stopBtn = document.getElementById('membraneApiStopBtn');
  const restartBtn = document.getElementById('membraneApiRestartBtn');
  
  if (membraneApiStatus.available) {
    if (membraneApiStatus.running) {
      startBtn.style.display = 'none';
      stopBtn.style.display = 'inline-flex';
      restartBtn.disabled = false;
    } else {
      startBtn.style.display = 'inline-flex';
      stopBtn.style.display = 'none';
      restartBtn.disabled = true;
    }
  } else {
    startBtn.style.display = 'none';
    stopBtn.style.display = 'none';
    restartBtn.disabled = true;
  }
}

async function startMembraneApi() {
  try {
    showToast('Starting membrane-api...', 'info');
    await api.services.membraneApiStart();
    showToast('membrane-api started', 'success');
    await refreshMembraneApiStatus();
  } catch (error) {
    showToast(error.message || 'Failed to start membrane-api', 'error');
  }
}

async function stopMembraneApi() {
  if (!confirm('Stop membrane-api? LLM services will be unavailable.')) return;
  
  try {
    showToast('Stopping membrane-api...', 'info');
    await api.services.membraneApiStop();
    showToast('membrane-api stopped', 'success');
    await refreshMembraneApiStatus();
  } catch (error) {
    showToast(error.message || 'Failed to stop membrane-api', 'error');
  }
}

async function restartMembraneApi() {
  try {
    showToast('Restarting membrane-api...', 'info');
    await api.services.membraneApiRestart();
    showToast('membrane-api restarted', 'success');
    await refreshMembraneApiStatus();
  } catch (error) {
    showToast(error.message || 'Failed to restart membrane-api', 'error');
  }
}

async function viewMembraneApiLogs() {
  document.getElementById('membraneApiLogsOutput').textContent = '[Loading...]';
  document.getElementById('membraneApiLogsModal').classList.add('active');
  await refreshMembraneApiLogs();
}

async function refreshMembraneApiLogs() {
  try {
    const data = await api.services.membraneApiLogs(300);
    document.getElementById('membraneApiLogsOutput').textContent = data.logs || '[No logs available]';
    scrollMembraneApiLogsToBottom();
  } catch (error) {
    document.getElementById('membraneApiLogsOutput').textContent = `[Error: ${error.message}]`;
  }
}

function scrollMembraneApiLogsToBottom() {
  const output = document.getElementById('membraneApiLogsOutput');
  output.scrollTop = output.scrollHeight;
}

function closeMembraneApiLogsModal(event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById('membraneApiLogsModal').classList.remove('active');
}

// ============================================================================
// SLOT MANAGEMENT
// ============================================================================

// Note: currentSlots is already declared in BOT MANAGEMENT section
// and shared between bots page and services page for slot info

// Store git deps status per slot
let slotGitDeps = {};

async function loadSlots() {
  try {
    const data = await api.slots.list();
    currentSlots = data.slots || {};
    renderSlots();
    
    // Load git deps status for each slot (async, will update UI when ready)
    for (const slotName of Object.keys(currentSlots)) {
      loadSlotDeps(slotName);
    }
  } catch (error) {
    console.error('Error loading slots:', error);
    showToast('Failed to load slots', 'error');
  }
}

/**
 * Load git dependencies status for a slot
 */
async function loadSlotDeps(slot) {
  try {
    const status = await api.slots.depsStatus(slot);
    slotGitDeps[slot] = status;
    updateSlotDepsUI(slot);
  } catch (error) {
    console.error(`Error loading deps for ${slot}:`, error);
  }
}

/**
 * Update the deps section in a slot card
 * @param {string} slot - Slot name
 * @param {boolean} forceLoading - If true, show loading state even if cached data exists
 */
function updateSlotDepsUI(slot, forceLoading = false) {
  const container = document.getElementById(`slotDeps-${slot}`);
  if (!container) return;
  
  const deps = slotGitDeps[slot];
  
  // If no deps data yet and not forcing loading, leave as is (may show cached render)
  if (!deps && !forceLoading) {
    return;
  }
  
  // If deps loaded and has no git deps, hide the section
  if (deps && !deps.hasGitDeps) {
    container.innerHTML = '';
    return;
  }
  
  // If still loading (no cached data), show loading indicator
  if (!deps) {
    container.innerHTML = `
      <div class="git-deps-loading">
        <span class="spinner-sm"></span> Checking dependencies...
      </div>
    `;
    return;
  }
  
  const needsUpdate = deps.needsUpdate;
  const depsHtml = deps.dependencies.map(dep => {
    const shortInstalled = dep.installedCommit?.slice(0, 7) || '???';
    const shortLatest = dep.latestCommit?.slice(0, 7) || '???';
    const statusClass = dep.needsUpdate ? 'needs-update' : 'up-to-date';
    
    return `
      <div class="git-dep-item ${statusClass}">
        <span class="git-dep-name">${escapeHtml(dep.name)}</span>
        <span class="git-dep-commits">
          <span class="commit installed" title="Installed">${shortInstalled}</span>
          ${dep.needsUpdate ? `→ <span class="commit latest" title="Latest available">${shortLatest}</span>` : ''}
        </span>
      </div>
    `;
  }).join('');
  
  container.innerHTML = `
    <div class="slot-git-deps ${needsUpdate ? 'has-updates' : ''}">
      <div class="git-deps-header">
        <span class="git-deps-title">📦 Git Dependencies</span>
        ${needsUpdate ? `
          <span class="git-deps-badge update-available">${deps.updateCount} update${deps.updateCount > 1 ? 's' : ''}</span>
        ` : `
          <span class="git-deps-badge up-to-date">✓ Up to date</span>
        `}
      </div>
      <div class="git-deps-list">
        ${depsHtml}
      </div>
      ${needsUpdate ? `
        <button class="btn-secondary btn-sm" onclick="updateSlotDeps('${slot}')">
          ⬆️ Update Dependencies
        </button>
      ` : ''}
    </div>
  `;
}

/**
 * Update git dependencies for a slot
 */
async function updateSlotDeps(slot) {
  // Check if there are running bots
  const slotData = currentSlots[slot];
  let autoRestart = false;
  
  if (slotData?.runningBots?.length > 0) {
    const message = `Bots running on ${slot}: ${slotData.runningBots.join(', ')}\n\nThis will update git dependencies (like membrane).\n\nRestart bots after update?`;
    autoRestart = confirm(message);
  } else if (!confirm(`Update git dependencies for ${slot}?\n\nThis will fetch the latest versions from their repositories.`)) {
    return;
  }
  
  try {
    showToast(`Updating dependencies for ${slot}...`, 'info');
    const result = await api.slots.updateDeps(slot, { autoRestart });
    
    if (result.success) {
      if (result.skipped) {
        showToast(result.reason, 'info');
      } else {
        const updated = result.results.filter(r => r.success).map(r => r.name);
        if (updated.length > 0) {
          showToast(`Updated: ${updated.join(', ')}`, 'success');
        }
        if (result.restartResults) {
          const restarted = result.restartResults.filter(r => r.success).map(r => r.name);
          if (restarted.length > 0) {
            showToast(`Restarted: ${restarted.join(', ')}`, 'info');
          }
        }
      }
      // Reload deps status
      await loadSlotDeps(slot);
    } else {
      const failed = result.results.filter(r => !r.success).map(r => r.name);
      showToast(`Failed to update: ${failed.join(', ')}`, 'error');
    }
  } catch (error) {
    showToast(error.message || 'Failed to update dependencies', 'error');
  }
}

function renderSlots() {
  const container = document.getElementById('slotsGrid');
  if (!container) return;
  
  const slotNames = Object.keys(currentSlots);
  
  if (slotNames.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <div class="empty-state-icon">📦</div>
        <p class="empty-state-title">No slots configured</p>
        <p class="empty-state-description">ChapterX deployment slots not found</p>
      </div>
    `;
    return;
  }
  
  container.innerHTML = slotNames.map(name => {
    const slot = currentSlots[name];
    
    if (!slot.exists) {
      return `
        <div class="slot-card-full">
          <div class="slot-card-header">
            <div class="slot-card-title">
              <span class="slot-name-badge ${name}">${name.toUpperCase()}</span>
              <span class="slot-exists-badge missing">Not Found</span>
            </div>
          </div>
          <div class="slot-card-body">
            <p style="color: var(--text-muted);">Slot directory not found at:</p>
            <code style="font-size: var(--text-sm); color: var(--text-secondary);">${slot.path}</code>
          </div>
        </div>
      `;
    }
    
    if (!slot.isGitRepo) {
      return `
        <div class="slot-card-full">
          <div class="slot-card-header">
            <div class="slot-card-title">
              <span class="slot-name-badge ${name}">${name.toUpperCase()}</span>
              <span class="slot-exists-badge missing">Not a Git Repo</span>
            </div>
          </div>
          <div class="slot-card-body">
            <p style="color: var(--text-muted);">Directory exists but is not a git repository</p>
          </div>
        </div>
      `;
    }
    
    // Build status indicators
    const dirtyIndicator = slot.dirty 
      ? `<span class="slot-git-value dirty">● Modified</span>
         <button class="btn-link btn-xs" onclick="viewSlotDiff('${name}')" title="View changes">View</button>`
      : '';
    const behindIndicator = slot.behind > 0 ? `<span class="slot-git-value behind">↓ ${slot.behind} behind</span>` : '';
    const aheadIndicator = slot.ahead > 0 ? `<span class="slot-git-value ahead">↑ ${slot.ahead} ahead</span>` : '';
    
    // Branch options for selector
    const branchOptions = (slot.remoteBranches || [])
      .filter(b => b !== slot.branch)
      .map(b => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`)
      .join('');
    
    return `
      <div class="slot-card-full" data-slot="${name}">
        <div class="slot-card-header">
          <div class="slot-card-title">
            <span class="slot-name-badge ${name}">${name.toUpperCase()}</span>
            <span class="slot-exists-badge exists">Active</span>
          </div>
          <button class="btn-ghost" onclick="refreshSlot('${name}')" title="Refresh">🔄</button>
        </div>
        <div class="slot-card-body">
          <div class="slot-git-info">
            <div class="slot-git-row">
              <span class="slot-git-label">Branch</span>
              <span class="slot-git-value branch">${escapeHtml(slot.branch || 'unknown')}</span>
              ${dirtyIndicator}
            </div>
            <div class="slot-git-row">
              <span class="slot-git-label">Commit</span>
              <span class="slot-git-value commit">${escapeHtml(slot.commit || '—')}</span>
              ${behindIndicator}
              ${aheadIndicator}
            </div>
            ${slot.commitMessage ? `
              <div class="slot-git-row">
                <span class="slot-git-label">Message</span>
                <span class="slot-commit-message" title="${escapeHtml(slot.commitMessage)}">${escapeHtml(slot.commitMessage)}</span>
              </div>
            ` : ''}
          </div>
          
          ${slot.runningBots && slot.runningBots.length > 0 ? `
            <div class="slot-running-bots">
              <span class="slot-running-bots-label">Running bots:</span>
              <span class="slot-running-bots-list">${slot.runningBots.join(', ')}</span>
            </div>
          ` : ''}
          
          <!-- Git Dependencies Section (populated async, preserved on re-render) -->
          <div id="slotDeps-${name}" class="slot-deps-container">
            ${slotGitDeps[name] ? '' : `
              <div class="git-deps-loading">
                <span class="spinner-sm"></span> Checking dependencies...
              </div>
            `}
          </div>
          
          <div class="slot-actions">
            <button class="btn-secondary" onclick="fetchSlot('${name}')">📥 Fetch</button>
            <button class="btn-primary" onclick="pullSlot('${name}')">⬇️ Pull</button>
            ${branchOptions ? `
              <div class="branch-selector">
                <select id="branchSelect-${name}" onchange="checkoutSlot('${name}', this.value)">
                  <option value="">Switch branch...</option>
                  ${branchOptions}
                </select>
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function refreshSlot(slot) {
  try {
    const data = await api.slots.status(slot);
    currentSlots[slot] = data;
    renderSlots();
  } catch (error) {
    showToast(`Failed to refresh ${slot}`, 'error');
  }
}

async function fetchSlot(slot) {
  try {
    showToast(`Fetching ${slot}...`, 'info');
    const result = await api.slots.fetch(slot);
    
    if (result.success) {
      showToast(`Fetched ${slot} successfully`, 'success');
      currentSlots[slot] = result.status;
      renderSlots();
    } else {
      showToast(`Fetch failed: ${result.output}`, 'error');
    }
  } catch (error) {
    showToast(error.message || 'Fetch failed', 'error');
  }
}

async function pullSlot(slot) {
  // Check if there are running bots
  const slotData = currentSlots[slot];
  let autoRestart = false;
  
  if (slotData?.runningBots?.length > 0) {
    const message = `Bots running on ${slot}: ${slotData.runningBots.join(', ')}\n\nRestart them after pull?`;
    autoRestart = confirm(message);
  }
  
  try {
    showToast(`Pulling ${slot}...`, 'info');
    const result = await api.slots.pull(slot, autoRestart);
    
    if (result.success) {
      if (result.codeChanged) {
        showToast(`Pulled ${slot}: ${result.beforeCommit} → ${result.afterCommit}`, 'success');
        if (result.restartResults) {
          const restarted = result.restartResults.filter(r => r.success).map(r => r.name);
          if (restarted.length > 0) {
            showToast(`Restarted: ${restarted.join(', ')}`, 'info');
          }
        }
      } else {
        showToast(`${slot} already up to date`, 'info');
      }
      currentSlots[slot] = result.status;
      renderSlots();
    } else {
      showToast(`Pull failed: ${result.output}`, 'error');
    }
  } catch (error) {
    showToast(error.message || 'Pull failed', 'error');
  }
}

async function checkoutSlot(slot, branch) {
  if (!branch) return;
  
  // Reset the select
  const select = document.getElementById(`branchSelect-${slot}`);
  if (select) select.value = '';
  
  // Check if there are running bots
  const slotData = currentSlots[slot];
  let autoRestart = false;
  
  if (slotData?.runningBots?.length > 0) {
    const message = `Switching ${slot} to branch '${branch}'.\n\nBots running: ${slotData.runningBots.join(', ')}\n\nRestart them after checkout?`;
    autoRestart = confirm(message);
  } else if (!confirm(`Switch ${slot} to branch '${branch}'?`)) {
    return;
  }
  
  try {
    showToast(`Checking out ${branch} on ${slot}...`, 'info');
    const result = await api.slots.checkout(slot, branch, autoRestart);
    
    if (result.success) {
      showToast(`Switched ${slot} to ${branch}`, 'success');
      if (result.restartResults) {
        const restarted = result.restartResults.filter(r => r.success).map(r => r.name);
        if (restarted.length > 0) {
          showToast(`Restarted: ${restarted.join(', ')}`, 'info');
        }
      }
      currentSlots[slot] = result.status;
      renderSlots();
    } else {
      showToast(`Checkout failed: ${result.output}`, 'error');
    }
  } catch (error) {
    showToast(error.message || 'Checkout failed', 'error');
  }
}

// ============================================================================
// GIT DIFF MODAL
// ============================================================================

let currentDiffSlot = null;

async function viewSlotDiff(slot) {
  currentDiffSlot = slot;
  const modal = document.getElementById('diffModal');
  const title = document.getElementById('diffModalTitle');
  const fileCount = document.getElementById('diffFileCount');
  const filesList = document.getElementById('diffFilesList');
  const diffOutput = document.getElementById('diffOutput');
  const truncatedWarning = document.getElementById('diffTruncatedWarning');
  
  // Show modal using active class pattern
  modal.classList.add('active');
  title.textContent = `Git Changes - ${slot.toUpperCase()}`;
  diffOutput.textContent = '[Loading...]';
  filesList.innerHTML = '<li>Loading...</li>';
  truncatedWarning.style.display = 'none';
  
  try {
    const data = await api.slots.diff(slot);
    
    // Update file count
    fileCount.textContent = data.fileCount || 0;
    
    // Render file list
    if (data.files && data.files.length > 0) {
      filesList.innerHTML = data.files.map(f => {
        const statusClass = {
          'modified': 'file-modified',
          'added': 'file-added',
          'deleted': 'file-deleted',
          'untracked': 'file-untracked',
          'renamed': 'file-renamed',
          'conflict': 'file-conflict',
        }[f.status] || '';
        
        return `<li class="${statusClass}">
          <span class="file-status">${f.status.toUpperCase()}</span>
          <span class="file-path">${escapeHtml(f.path)}</span>
        </li>`;
      }).join('');
    } else {
      filesList.innerHTML = '<li class="no-changes">No modified files</li>';
    }
    
    // Store raw diff for copy functionality
    currentRawDiff = data.diff || data.diffStat || '';
    
    // Render diff output
    if (data.diff) {
      diffOutput.innerHTML = formatDiffOutput(data.diff);
    } else if (data.diffStat) {
      diffOutput.textContent = data.diffStat;
    } else {
      diffOutput.textContent = 'No tracked file changes (may only have untracked files)';
      currentRawDiff = '';
    }
    
    // Show truncation warning
    if (data.truncated) {
      truncatedWarning.style.display = 'block';
    }
  } catch (error) {
    diffOutput.textContent = `Error: ${error.message}`;
    filesList.innerHTML = '<li class="error">Failed to load</li>';
  }
}

function formatDiffOutput(diff) {
  // Syntax highlight the diff output
  const lines = diff.split('\n');
  return lines.map(line => {
    if (line.startsWith('+++') || line.startsWith('---')) {
      return `<span class="diff-file-header">${escapeHtml(line)}</span>`;
    } else if (line.startsWith('@@')) {
      return `<span class="diff-hunk">${escapeHtml(line)}</span>`;
    } else if (line.startsWith('+')) {
      return `<span class="diff-add">${escapeHtml(line)}</span>`;
    } else if (line.startsWith('-')) {
      return `<span class="diff-del">${escapeHtml(line)}</span>`;
    } else if (line.startsWith('diff --git')) {
      return `<span class="diff-header">${escapeHtml(line)}</span>`;
    }
    return escapeHtml(line);
  }).join('\n');
}

function closeDiffModal(event) {
  if (event && event.target !== event.currentTarget) return;
  const modal = document.getElementById('diffModal');
  modal.classList.remove('active');
  currentDiffSlot = null;
}

// Store raw diff for copying
let currentRawDiff = '';

async function copyDiffToClipboard() {
  if (!currentRawDiff) {
    showToast('No diff to copy', 'warning');
    return;
  }
  
  try {
    await navigator.clipboard.writeText(currentRawDiff);
    showToast('Diff copied to clipboard', 'success');
  } catch (error) {
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = currentRawDiff;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showToast('Diff copied to clipboard', 'success');
  }
}

async function discardSlotChanges() {
  if (!currentDiffSlot) return;
  
  const confirmed = confirm(`⚠️ DANGER: This will permanently discard ALL local changes in the ${currentDiffSlot.toUpperCase()} slot.\n\nThis includes:\n- Modified files\n- Untracked files\n\nThis action cannot be undone. Continue?`);
  
  if (!confirmed) return;
  
  try {
    showToast(`Discarding changes in ${currentDiffSlot}...`, 'info');
    const result = await api.slots.discard(currentDiffSlot);
    
    if (result.success) {
      showToast(`Discarded all changes in ${currentDiffSlot}`, 'success');
      currentSlots[currentDiffSlot] = result.status;
      renderSlots();
      closeDiffModal();
    } else {
      showToast('Failed to discard changes', 'error');
    }
  } catch (error) {
    showToast(error.message || 'Failed to discard changes', 'error');
  }
}

// Make services functions global
window.loadServices = loadServices;
window.forceRefreshServices = forceRefreshServices;
window.refreshAetheraStatus = refreshAetheraStatus;
window.startAethera = startAethera;
window.stopAethera = stopAethera;
window.restartAethera = restartAethera;
window.viewAetheraLogs = viewAetheraLogs;
window.refreshAetheraLogs = refreshAetheraLogs;
window.scrollAetheraLogsToBottom = scrollAetheraLogsToBottom;
window.closeAetheraLogsModal = closeAetheraLogsModal;
window.startMembraneApi = startMembraneApi;
window.stopMembraneApi = stopMembraneApi;
window.restartMembraneApi = restartMembraneApi;
window.viewMembraneApiLogs = viewMembraneApiLogs;
window.refreshMembraneApiLogs = refreshMembraneApiLogs;
window.scrollMembraneApiLogsToBottom = scrollMembraneApiLogsToBottom;
window.closeMembraneApiLogsModal = closeMembraneApiLogsModal;
window.loadSlots = loadSlots;
window.refreshSlot = refreshSlot;
window.fetchSlot = fetchSlot;
window.pullSlot = pullSlot;
window.checkoutSlot = checkoutSlot;
window.viewSlotDiff = viewSlotDiff;
window.closeDiffModal = closeDiffModal;
window.discardSlotChanges = discardSlotChanges;
window.copyDiffToClipboard = copyDiffToClipboard;
window.loadSlotDeps = loadSlotDeps;
window.updateSlotDeps = updateSlotDeps;

// ============================================================================
// DREAMS MONITORING
// ============================================================================

function loadDreams() {
  streams.connect('dreams', renderDreamsPage);
}

async function forceRefreshDreams() {
  try {
    const data = await api.dreams.status();
    renderDreamsPage(data);
  } catch (e) {
    showToast('Failed to refresh dreams status', 'error');
  }
}

function renderDreamsPage(data) {
  if (!data) return;

  // GPU badge
  const badge = document.getElementById('dreamsGpuBadge');
  const label = document.getElementById('dreamsGpuLabel');
  const msg = document.getElementById('dreamsStatusMessage');
  if (badge && label) {
    if (data.pollError) {
      badge.className = 'dreams-gpu-badge error';
      label.textContent = 'Unreachable';
    } else if (data.gpuConnected) {
      badge.className = 'dreams-gpu-badge connected';
      label.textContent = 'GPU Connected';
    } else {
      badge.className = 'dreams-gpu-badge disconnected';
      label.textContent = 'Disconnected';
    }
  }
  if (msg) {
    if (data.pollError) {
      msg.textContent = `Cannot reach core site: ${data.pollError}`;
    } else if (data.gpuConnected) {
      msg.textContent = `Streaming at ${data.generation?.fps?.toFixed(1) || '?'} FPS`;
    } else {
      msg.textContent = 'GPU not connected — waiting for Heimdall';
    }
  }

  // Stats
  const gen = data.generation || {};
  const viewers = data.viewers || {};
  const stream = data.stream || {};

  pulseUpdate('dreamsFps', gen.fps != null ? gen.fps.toFixed(1) : '—');
  pulseUpdate('dreamsFrames', gen.frame_count != null ? gen.frame_count.toLocaleString() : '—');
  pulseUpdate('dreamsKeyframe', gen.current_keyframe ?? '—');
  pulseUpdate('dreamsViewers', viewers.websocket_count ?? '—');
  pulseUpdate('dreamsSamples', data.sampleCount ?? 0);

  if (stream.total_bytes != null && stream.total_bytes > 0) {
    pulseUpdate('dreamsThroughput', formatBytes(stream.total_bytes));
  } else {
    pulseUpdate('dreamsThroughput', '—');
  }

  // Poll error
  const errorEl = document.getElementById('dreamsPollError');
  if (errorEl) {
    if (data.pollError) {
      errorEl.textContent = `Poll error: ${data.pollError}`;
      errorEl.style.display = 'block';
    } else {
      errorEl.style.display = 'none';
    }
  }

  // Health windows
  if (data.health) {
    renderDreamsHealth(data.health);
  }

  // Preview iframe
  renderDreamsPreview(data.gpuConnected);
}

function renderDreamsHealth(health) {
  // Overall badge
  const overallBadge = document.getElementById('dreamsOverallBadge');
  if (overallBadge) {
    const labels = { good: 'Healthy', degraded: 'Degraded', unhealthy: 'Unhealthy', no_data: 'No Data' };
    overallBadge.className = `dreams-overall-badge ${health.overall}`;
    overallBadge.textContent = labels[health.overall] || health.overall;
  }

  const grid = document.getElementById('dreamsHealthGrid');
  if (!grid || !health.windows) return;

  const windowLabels = { '1m': '1 Minute', '10m': '10 Minutes', '30m': '30 Minutes', '1h': '1 Hour' };

  grid.innerHTML = Object.entries(health.windows).map(([key, w]) => {
    const healthColors = { good: 'success', degraded: 'warning', unhealthy: 'error', no_data: '' };
    const healthLabels = { good: 'Good', degraded: 'Degraded', unhealthy: 'Unhealthy', no_data: 'No Data' };

    const flagsHtml = w.flags?.length
      ? `<div class="dreams-window-flags">${w.flags.map(f => `<span class="dreams-flag">${f.replace('_', ' ')}</span>`).join('')}</div>`
      : '';

    if (w.sampleCount === 0) {
      return `
        <div class="dreams-health-window no_data">
          <div class="dreams-window-header">
            <span class="dreams-window-name">${windowLabels[key] || key}</span>
            <span class="dreams-window-health" style="color: var(--text-muted);">No Data</span>
          </div>
          <div style="font-size: var(--text-xs); color: var(--text-muted);">No samples in window</div>
        </div>
      `;
    }

    return `
      <div class="dreams-health-window ${w.health}">
        <div class="dreams-window-header">
          <span class="dreams-window-name">${windowLabels[key] || key}</span>
          <span class="dreams-window-health" style="color: var(--${healthColors[w.health] || 'text-muted'});">${healthLabels[w.health] || w.health}</span>
        </div>
        <div class="dreams-window-stats">
          <div class="dreams-window-stat">
            <span>Avg FPS</span>
            <span class="dreams-window-stat-value">${w.avgFps ?? '—'}</span>
          </div>
          <div class="dreams-window-stat">
            <span>Min FPS</span>
            <span class="dreams-window-stat-value">${w.minFps ?? '—'}</span>
          </div>
          <div class="dreams-window-stat">
            <span>Delivery</span>
            <span class="dreams-window-stat-value">${w.frameDeliveryRate != null ? w.frameDeliveryRate.toFixed(1) + '/s' : '—'}</span>
          </div>
          <div class="dreams-window-stat">
            <span>Samples</span>
            <span class="dreams-window-stat-value">${w.sampleCount}</span>
          </div>
          <div class="dreams-window-stat">
            <span>Throughput</span>
            <span class="dreams-window-stat-value">${w.throughputBytesPerSec != null ? formatBytes(w.throughputBytesPerSec) + '/s' : '—'}</span>
          </div>
          <div class="dreams-window-stat">
            <span>Max Gap</span>
            <span class="dreams-window-stat-value">${w.longestGapMs != null ? (w.longestGapMs / 1000).toFixed(1) + 's' : '—'}</span>
          </div>
        </div>
        ${flagsHtml}
      </div>
    `;
  }).join('');
}

let _dreamsPreviewLoaded = false;
function renderDreamsPreview(gpuConnected) {
  const container = document.getElementById('dreamsPreviewContainer');
  const offline = document.getElementById('dreamsPreviewOffline');
  if (!container) return;

  if (gpuConnected && !_dreamsPreviewLoaded) {
    container.innerHTML = `<iframe src="${window.location.protocol}//${window.location.hostname.replace('admin.', '')}/dreams?embed=1" loading="lazy" allow="autoplay"></iframe>`;
    _dreamsPreviewLoaded = true;
  } else if (!gpuConnected && _dreamsPreviewLoaded) {
    container.innerHTML = '<div class="dreams-preview-offline">GPU not connected — no stream available</div>';
    _dreamsPreviewLoaded = false;
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1073741824).toFixed(2) + ' GB';
}

function openDreamsViewer(event) {
  event.preventDefault();
  const baseUrl = window.location.protocol + '//' + window.location.hostname.replace('admin.', '');
  window.open(`${baseUrl}/dreams`, '_blank');
}

function openDreamsApi(event) {
  event.preventDefault();
  const baseUrl = window.location.protocol + '//' + window.location.hostname.replace('admin.', '');
  window.open(`${baseUrl}/dreams/api`, '_blank');
}

window.loadDreams = loadDreams;
window.forceRefreshDreams = forceRefreshDreams;
window.openDreamsViewer = openDreamsViewer;
window.openDreamsApi = openDreamsApi;

// ============================================================================
// CONNECTOME (Nin deploy panel)
// ============================================================================

let connectomeData = null;
let connectomeActionInFlight = false; // disable buttons while an action runs

function loadConnectome() {
  streams.connect('connectome', (data) => {
    connectomeData = data;
    renderConnectomePage(data);
  });
}

async function forceRefreshConnectome() {
  try {
    const data = await api.connectome.status();
    connectomeData = data;
    renderConnectomePage(data);
    showToast('Connectome status refreshed', 'success');
  } catch (error) {
    showToast(error.message || 'Refresh failed', 'error');
  }
}

function renderConnectomePage(data) {
  if (!data || data.error) return;
  renderNinCard(data);
  renderConnectomeRepos(data);
  renderDeployPane(data.deploy);
}

function renderNinCard(data) {
  const host = data.nin?.host || {};
  const session = data.nin?.session || {};
  const rt = data.runtime || {};

  // Status badges
  const badge = document.getElementById('ninStatusBadge');
  if (badge) {
    const cls = host.running ? 'running' : (host.state === 'failed' ? 'error' : 'stopped');
    badge.className = `service-status-badge ${cls}`;
    badge.innerHTML = `<span class="status-dot ${cls}"></span> ${escapeHtml(host.state || 'unknown')}`;
  }
  const sessionBadge = document.getElementById('ninSessionBadge');
  if (sessionBadge) {
    sessionBadge.textContent = `session: ${session.running ? 'active' : (session.state || 'unknown')}`;
    sessionBadge.className = `service-health-badge ${session.running ? 'healthy' : 'unhealthy'}`;
  }

  // Uptime from systemd timestamp
  let uptime = '—';
  if (host.startedAt) {
    const started = new Date(host.startedAt).getTime();
    if (!isNaN(started)) uptime = formatUptime(Math.floor((Date.now() - started) / 1000));
  }
  pulseUpdate('ninUptime', uptime);
  pulseUpdate('ninRss', host.memoryBytes != null ? formatBytes(host.memoryBytes) : '—');
  pulseUpdate('ninRestarts', host.restartCount ?? '—');

  // Memory readout
  const mem = rt.memory || {};
  document.getElementById('ninSessionId').textContent = mem.sessionId || '—';
  pulseUpdate('ninMemorySize', mem.recordsLogBytes != null ? formatBytes(mem.recordsLogBytes) : '—');

  // MCP children
  const mcp = rt.mcpChildren || {};
  const mcpEl = document.getElementById('ninMcpChildren');
  if (mcpEl) {
    mcpEl.textContent = `${mcp.count ?? 0}/${mcp.expected ?? 5}`;
    mcpEl.className = `service-stat-value ${(mcp.count ?? 0) >= (mcp.expected ?? 5) ? 'ok' : 'warn'}`;
    mcpEl.title = (mcp.children || []).join(', ');
  }

  // Discord / laptop
  const discord = rt.discord || {};
  const discordEl = document.getElementById('ninDiscord');
  if (discordEl) {
    discordEl.textContent = discord.connected ? '✓ connected' : (discord.childRunning ? '~ child up' : '✗ down');
    discordEl.className = `service-stat-value ${discord.connected ? 'ok' : 'warn'}`;
    if (discord.lastMarker) discordEl.title = `last activity marker: ${discord.lastMarker}`;
  }
  const laptop = rt.laptop || {};
  const laptopEl = document.getElementById('ninLaptop');
  if (laptopEl) {
    laptopEl.textContent = laptop.reachable ? '✓ reachable' : '✗ offline';
    laptopEl.className = `service-stat-value ${laptop.reachable ? 'ok' : 'muted'}`;
  }

  // Heartbeat
  const hb = rt.heartbeat || {};
  const hbEl = document.getElementById('ninHeartbeat');
  if (hbEl) {
    if (!hb.available) hbEl.textContent = '—';
    else if (hb.paused) hbEl.textContent = '⏸ paused';
    else hbEl.textContent = `every ${formatUptime(hb.intervalSeconds || 0)}`;
  }

  // Cost (last manual run)
  const cost = rt.lastCostReport;
  const costEl = document.getElementById('ninCost');
  if (costEl) {
    costEl.textContent = cost && cost.total != null ? `$${cost.total.toFixed(2)}` : 'not run';
    if (cost) costEl.title = `as of ${cost.at}`;
  }
}

function renderConnectomeRepos(data) {
  const container = document.getElementById('connectomeRepos');
  if (!container) return;

  const repos = data.repos || [];
  const deployRunning = data.deploy && data.deploy.status === 'running';
  const anyBehind = repos.some(r => r.behind > 0 || r.buildStale);

  const deployAllBtn = document.getElementById('connectomeDeployAllBtn');
  if (deployAllBtn) deployAllBtn.disabled = !anyBehind || deployRunning || connectomeActionInFlight;

  if (repos.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📦</div>
        <p class="empty-state-title">No repos found</p>
        <p class="empty-state-description">Expected git repos under /opt/connectome</p>
      </div>
    `;
    return;
  }

  container.innerHTML = repos.map(repo => {
    if (!repo.exists || !repo.isGitRepo) {
      return `
        <div class="connectome-repo-row error">
          <div class="repo-name">${escapeHtml(repo.name)}</div>
          <div class="repo-status-text">${!repo.exists ? 'directory missing' : 'not a git repo'} — ${escapeHtml(repo.path || '')}</div>
        </div>
      `;
    }

    const deployable = repo.behind > 0 || repo.buildStale;
    let badge;
    if (repo.error) badge = `<span class="repo-badge error">error</span>`;
    else if (repo.behind > 0) badge = `<span class="repo-badge behind">↓ ${repo.behind} behind</span>`;
    else if (repo.buildStale) badge = `<span class="repo-badge behind" title="dist/ is older than src/ — rebuild needed">build stale</span>`;
    else badge = `<span class="repo-badge uptodate">up to date</span>`;

    const dirtyBadge = repo.dirty
      ? `<span class="repo-badge dirty" title="${escapeHtml((repo.dirtyFiles || []).join(', '))}">${repo.lockfileOnly ? 'lockfile drift' : '● dirty'}</span>`
      : '';
    const aheadBadge = repo.ahead > 0 ? `<span class="repo-badge ahead">↑ ${repo.ahead} ahead</span>` : '';

    const restartTargets = (repo.restarts || []).join(' + ');
    const disabled = deployRunning || connectomeActionInFlight ? 'disabled' : '';
    const deployDisabled = !deployable || deployRunning || connectomeActionInFlight || (repo.dirty && !repo.lockfileOnly) ? 'disabled' : '';

    return `
      <div class="connectome-repo-row" data-repo="${repo.name}">
        <div class="repo-main">
          <div class="repo-name">${escapeHtml(repo.name)}</div>
          <div class="repo-git-line">
            <span class="repo-branch">${escapeHtml(repo.branch || '?')}</span>
            <span class="repo-commit" title="${escapeHtml(repo.headSubject || '')}">${escapeHtml(repo.head || '—')} · ${escapeHtml(truncateStr(repo.headSubject || '', 56))}</span>
          </div>
          <div class="repo-meta-line">
            ${badge} ${aheadBadge} ${dirtyBadge}
            <span class="repo-restarts" title="services restarted on deploy">↻ ${escapeHtml(restartTargets)}</span>
            ${repo.build ? `<span class="repo-build" title="build step">🔨 ${escapeHtml(repo.build)}</span>` : ''}
          </div>
        </div>
        <div class="repo-actions">
          <button class="btn-secondary" onclick="checkConnectomeRepo('${repo.name}')" ${disabled}>📥 Check</button>
          <button class="btn-primary" onclick="deployConnectomeRepo('${repo.name}')" ${deployDisabled}>🚀 Deploy</button>
        </div>
      </div>
    `;
  }).join('');
}

function truncateStr(str, n) {
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

function renderDeployPane(deploy) {
  const section = document.getElementById('connectomeDeploySection');
  if (!section) return;

  if (!deploy) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';

  document.getElementById('deployPaneTitle').textContent =
    `${deploy.repo} — started ${new Date(deploy.startedAt).toLocaleTimeString()}`;

  const statusEl = document.getElementById('deployPaneStatus');
  statusEl.textContent = deploy.status;
  statusEl.className = `deploy-status-badge ${deploy.status}`;

  const stepsEl = document.getElementById('deploySteps');
  stepsEl.innerHTML = (deploy.steps || []).map(step => {
    const icon = step.status === 'ok' ? '✓' : step.status === 'failed' ? '✗' : '⟳';
    return `
      <div class="deploy-step ${step.status}">
        <span class="deploy-step-icon">${icon}</span>
        <span class="deploy-step-name">${escapeHtml(step.name)}</span>
        ${step.output ? `<pre class="deploy-step-output">${escapeHtml(step.output)}</pre>` : ''}
      </div>
    `;
  }).join('') + (deploy.error ? `<div class="deploy-step failed"><span class="deploy-step-icon">✗</span><span class="deploy-step-name">${escapeHtml(deploy.error)}</span></div>` : '');
}

// --- Actions ----------------------------------------------------------------

async function checkConnectomeRepo(repo) {
  if (connectomeActionInFlight) return;
  connectomeActionInFlight = true;
  try {
    showToast(`Checking ${repo}...`, 'info');
    const result = await api.connectome.fetch(repo);
    if (result.status) {
      const s = result.status;
      showToast(s.behind > 0 ? `${repo}: ${s.behind} commit(s) behind` : `${repo} is up to date`, s.behind > 0 ? 'warning' : 'success');
    }
    await forceRefreshConnectomeQuiet();
  } catch (error) {
    showToast(error.message || 'Check failed', 'error');
  } finally {
    connectomeActionInFlight = false;
  }
}

async function deployConnectomeRepo(repo) {
  if (connectomeActionInFlight) return;
  const repoData = (connectomeData?.repos || []).find(r => r.name === repo);
  const restarts = (repoData?.restarts || []).join(' + ');
  if (!confirm(`Deploy ${repo}?\n\nThis will git pull${repoData?.build ? ' → build' : ''} → restart ${restarts}.\nNin will blip off Discord for ~15s. data/ and .env are untouched.`)) {
    return;
  }
  connectomeActionInFlight = true;
  try {
    showToast(`Deploying ${repo}...`, 'info');
    const result = await api.connectome.deploy(repo, true);
    if (result.success) {
      showToast(
        result.codeChanged
          ? `Deployed ${repo}: ${result.beforeCommit} → ${result.afterCommit}`
          : `${repo} already up to date`,
        'success'
      );
      if (result.memoryCheck && result.memoryCheck.ok === false) {
        showToast('⚠️ MEMORY CHECK FAILED — verify Nin\'s records.log!', 'error');
      }
    } else {
      showToast(`Deploy failed: ${result.error || 'unknown error'}`, 'error');
    }
    renderDeployPane({ ...result, repo, startedAt: Date.now(), status: result.success ? 'done' : 'failed' });
    await forceRefreshConnectomeQuiet();
  } catch (error) {
    showToast(error.message || 'Deploy failed', 'error');
  } finally {
    connectomeActionInFlight = false;
  }
}

async function deployAllConnectome() {
  if (connectomeActionInFlight) return;
  const behind = (connectomeData?.repos || []).filter(r => r.behind > 0).map(r => r.name);
  if (behind.length === 0) {
    showToast('Everything is up to date', 'info');
    return;
  }
  if (!confirm(`Deploy all repos behind origin/main?\n\n${behind.join('\n')}\n\nServices restart as needed; Nin blips off Discord ~15s.`)) {
    return;
  }
  connectomeActionInFlight = true;
  try {
    showToast(`Deploying ${behind.length} repo(s)...`, 'info');
    const result = await api.connectome.deployAll(true);
    const deployed = (result.results || []).filter(r => !r.skipped);
    const failed = deployed.filter(r => !r.success);
    if (failed.length === 0) {
      showToast(`Deployed: ${deployed.map(r => r.repo).join(', ') || 'nothing to do'}`, 'success');
    } else {
      showToast(`Deploy failures: ${failed.map(r => r.repo).join(', ')}`, 'error');
    }
    await forceRefreshConnectomeQuiet();
  } catch (error) {
    showToast(error.message || 'Deploy-all failed', 'error');
  } finally {
    connectomeActionInFlight = false;
  }
}

async function restartNin() {
  if (!confirm('Restart Nin?\n\nNin drops off Discord ~15s and resumes the same session. Memory (data/) is untouched.')) return;
  try {
    showToast('Restarting Nin...', 'info');
    const result = await api.connectome.restartNin();
    showToast(result.success ? 'Nin restarted' : 'Restart failed — check logs', result.success ? 'success' : 'error');
    if (result.memoryCheck) {
      showToast(`records.log: ${formatBytes(result.memoryCheck.before || 0)} → ${formatBytes(result.memoryCheck.after || 0)}`, 'info');
    }
    await forceRefreshConnectomeQuiet();
  } catch (error) {
    showToast(error.message || 'Restart failed', 'error');
  }
}

async function restartNinFull() {
  if (!confirm('Restart Nin + session daemon?\n\nBoth nin.service and nin-session.service restart. Nin drops off Discord ~15s.')) return;
  try {
    showToast('Restarting Nin + daemons...', 'info');
    const result = await api.connectome.restartNinFull();
    showToast(result.success ? 'Nin + session daemon restarted' : 'Restart failed — check logs', result.success ? 'success' : 'error');
    await forceRefreshConnectomeQuiet();
  } catch (error) {
    showToast(error.message || 'Restart failed', 'error');
  }
}

async function forceRefreshConnectomeQuiet() {
  try {
    const data = await api.connectome.status();
    connectomeData = data;
    renderConnectomePage(data);
  } catch (e) {
    // SSE will refresh shortly anyway
  }
}

// --- Logs modal ---------------------------------------------------------------

function viewNinLogs() {
  document.getElementById('ninLogsModal').classList.add('active');
  refreshNinLogs();
}

async function refreshNinLogs() {
  const output = document.getElementById('ninLogsOutput');
  output.textContent = '[Loading...]';
  try {
    const result = await api.connectome.logs(300);
    output.textContent = result.logs || '[No logs]';
    scrollNinLogsToBottom();
  } catch (error) {
    output.textContent = `[Error: ${error.message}]`;
  }
}

function scrollNinLogsToBottom() {
  const output = document.getElementById('ninLogsOutput');
  output.scrollTop = output.scrollHeight;
}

function closeNinLogsModal(event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById('ninLogsModal').classList.remove('active');
}

// --- Cost modal -----------------------------------------------------------------

async function runNinCostReport() {
  document.getElementById('ninCostModal').classList.add('active');
  const output = document.getElementById('ninCostOutput');
  output.textContent = '[Running cost report...]';
  try {
    const result = await api.connectome.costReport();
    output.textContent = result.raw || JSON.stringify(result, null, 2);
    await forceRefreshConnectomeQuiet();
  } catch (error) {
    output.textContent = `[Error: ${error.message}]`;
  }
}

function closeNinCostModal(event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById('ninCostModal').classList.remove('active');
}

window.loadConnectome = loadConnectome;
window.forceRefreshConnectome = forceRefreshConnectome;
window.checkConnectomeRepo = checkConnectomeRepo;
window.deployConnectomeRepo = deployConnectomeRepo;
window.deployAllConnectome = deployAllConnectome;
window.restartNin = restartNin;
window.restartNinFull = restartNinFull;
window.viewNinLogs = viewNinLogs;
window.refreshNinLogs = refreshNinLogs;
window.scrollNinLogsToBottom = scrollNinLogsToBottom;
window.closeNinLogsModal = closeNinLogsModal;
window.runNinCostReport = runNinCostReport;
window.closeNinCostModal = closeNinCostModal;

// ============================================================================
// BLOG MANAGEMENT
// ============================================================================

let blogPosts = [];
let blogStats = { total: 0, published: 0, drafts: 0 };
let currentBlogPage = 1;
let currentBlogFilter = 'all';
let currentEditingPostId = null;
let editorPublishState = false;
let deletePostId = null;

async function loadBlog() {
  // Check database status first
  try {
    const status = await api.blog.status();
    const warning = document.getElementById('blogDbWarning');
    if (!status.available) {
      warning.style.display = 'flex';
      return;
    }
    warning.style.display = 'none';
  } catch (e) {
    document.getElementById('blogDbWarning').style.display = 'flex';
    return;
  }
  
  // Setup filter tabs
  setupBlogFilterTabs();
  
  // Load posts (initial load)
  await loadBlogPosts();
  
  // Use live data stream for stats updates
  loadBlogLive();
}

/**
 * Load blog page with live SSE updates for stats
 * Note: Posts are loaded on-demand via API, only stats are streamed
 */
function loadBlogLive() {
  streams.connect('blog', (data) => {
    if (data.available && data.stats) {
      // Update stats with pulse animation
      pulseUpdate('blogTotal', data.stats.total || 0);
      pulseUpdate('blogPublished', data.stats.published || 0);
      pulseUpdate('blogDrafts', data.stats.drafts || 0);
      
      // Store for local use
      blogStats = data.stats;
    }
  });
}

/**
 * Force refresh blog (bypasses stream, immediate fetch)
 */
async function forceRefreshBlog() {
  showToast('Refreshing blog...', 'info');
  await loadBlogStats();
  await loadBlogPosts();
  showToast('Blog refreshed', 'success');
}

function setupBlogFilterTabs() {
  document.querySelectorAll('.blog-filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.blog-filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentBlogFilter = tab.dataset.filter;
      currentBlogPage = 1;
      loadBlogPosts();
    });
  });
}

async function loadBlogStats() {
  try {
    blogStats = await api.blog.stats();
    document.getElementById('blogTotal').textContent = blogStats.total || 0;
    document.getElementById('blogPublished').textContent = blogStats.published || 0;
    document.getElementById('blogDrafts').textContent = blogStats.drafts || 0;
  } catch (e) {
    console.error('Error loading blog stats:', e);
  }
}

async function loadBlogPosts() {
  const tableContainer = document.getElementById('postsTableContainer');
  const emptyState = document.getElementById('blogEmptyState');
  const loading = document.getElementById('postsLoading');
  const pagination = document.getElementById('blogPagination');
  
  // Show loading
  tableContainer.style.display = 'none';
  emptyState.style.display = 'none';
  loading.style.display = 'flex';
  
  try {
    const result = await api.blog.list({
      page: currentBlogPage,
      perPage: 20,
      filter: currentBlogFilter,
    });
    
    blogPosts = result.posts || [];
    
    loading.style.display = 'none';
    
    if (blogPosts.length === 0) {
      emptyState.style.display = 'flex';
      pagination.style.display = 'none';
      return;
    }
    
    tableContainer.style.display = 'block';
    renderPostsTable();
    
    // Update pagination
    const start = (currentBlogPage - 1) * 20 + 1;
    const end = start + blogPosts.length - 1;
    document.getElementById('paginationStart').textContent = start;
    document.getElementById('paginationEnd').textContent = end;
    document.getElementById('paginationTotal').textContent = result.total;
    document.getElementById('prevPageBtn').disabled = currentBlogPage <= 1;
    document.getElementById('nextPageBtn').disabled = !result.hasNext;
    pagination.style.display = result.total > 20 ? 'flex' : 'none';
    
  } catch (error) {
    console.error('Error loading posts:', error);
    loading.style.display = 'none';
    showToast('Failed to load posts', 'error');
  }
}

function loadBlogPage(page) {
  currentBlogPage = page;
  loadBlogPosts();
}

function renderPostsTable() {
  const tbody = document.getElementById('postsTableBody');
  
  tbody.innerHTML = blogPosts.map(post => `
    <tr>
      <td>
        <div class="post-title-cell">
          <span class="post-title">${escapeHtml(post.title)}</span>
          <span class="post-slug">/${escapeHtml(post.slug)}</span>
        </div>
      </td>
      <td>
        <span class="post-status ${post.published ? 'published' : 'draft'}">
          <span class="status-dot"></span>
          ${post.published ? 'Published' : 'Draft'}
        </span>
      </td>
      <td>
        <div class="post-date">${formatDate(post.updatedAt)}</div>
        <div class="post-date-relative">${formatRelativeTime(post.updatedAt)}</div>
      </td>
      <td>${escapeHtml(post.author)}</td>
      <td>
        <div class="post-tags">
          ${post.tags ? post.tags.split(',').slice(0, 3).map(t => 
            `<span class="post-tag">${escapeHtml(t.trim())}</span>`
          ).join('') : '<span style="color: var(--text-muted);">—</span>'}
        </div>
      </td>
      <td>
        <div class="post-actions">
          <button class="btn-icon" onclick="editPost(${post.id})" title="Edit">✏️</button>
          <button class="btn-icon" onclick="previewPostFromList(${post.id}, '${escapeHtml(post.slug)}', ${post.published})" 
                  title="Preview">👁️</button>
          <button class="btn-icon" onclick="${post.published ? 'unpublishPost' : 'publishPost'}(${post.id})" 
                  title="${post.published ? 'Unpublish' : 'Publish'}">
            ${post.published ? '📤' : '📥'}
          </button>
          <button class="btn-icon" onclick="viewPostOnSite(${post.id}, '${escapeHtml(post.slug)}')" 
                  title="View on site" ${!post.published ? 'disabled' : ''}>🔗</button>
          <button class="btn-icon delete" onclick="confirmDeletePost(${post.id}, '${escapeHtml(post.title)}')" 
                  title="Delete">🗑️</button>
        </div>
      </td>
    </tr>
  `).join('');
}

// Date formatting helpers
function formatDate(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric' 
  });
}

function formatRelativeTime(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffDays > 30) return '';
  if (diffDays > 0) return `${diffDays}d ago`;
  if (diffHours > 0) return `${diffHours}h ago`;
  if (diffMins > 0) return `${diffMins}m ago`;
  return 'just now';
}

async function refreshBlogPosts() {
  // Alias for forceRefreshBlog for backwards compatibility
  await forceRefreshBlog();
}

// ============================================================================
// POST EDITOR
// ============================================================================

function openPostEditor(postId = null) {
  currentEditingPostId = postId;
  editorPublishState = false;
  
  // Reset form
  document.getElementById('postTitleInput').value = '';
  document.getElementById('postContentEditor').value = '';
  document.getElementById('postAuthorInput').value = 'luxia';
  document.getElementById('postTagsInput').value = '';
  document.getElementById('postCategoriesInput').value = '';
  document.getElementById('postLicenseInput').value = 'CC BY 4.0';
  document.getElementById('postPreviewContent').innerHTML = '<p style="color: var(--text-muted); font-style: italic;">Preview will appear here...</p>';
  document.getElementById('postPublishToggle').classList.remove('active');
  
  document.getElementById('postEditorTitle').textContent = postId ? 'Edit Post' : 'New Post';
  document.getElementById('savePostBtn').textContent = postId ? 'Update Post' : 'Create Post';
  
  // Show modal
  document.getElementById('postEditorModal').classList.add('active');
  
  // Focus title
  setTimeout(() => {
    document.getElementById('postTitleInput').focus();
  }, 100);
  
  // Setup live preview
  const editor = document.getElementById('postContentEditor');
  let previewTimeout;
  editor.addEventListener('input', () => {
    clearTimeout(previewTimeout);
    previewTimeout = setTimeout(refreshPreview, 500);
  });
}

async function editPost(id) {
  openPostEditor(id);
  
  try {
    const result = await api.blog.get(id);
    const post = result.post;
    
    document.getElementById('postTitleInput').value = post.title || '';
    document.getElementById('postContentEditor').value = post.content || '';
    document.getElementById('postAuthorInput').value = post.author || 'luxia';
    document.getElementById('postTagsInput').value = post.tags || '';
    document.getElementById('postCategoriesInput').value = post.categories || '';
    document.getElementById('postLicenseInput').value = post.license || 'CC BY 4.0';
    
    editorPublishState = post.published;
    document.getElementById('postPublishToggle').classList.toggle('active', post.published);
    
    // Refresh preview
    refreshPreview();
  } catch (error) {
    showToast('Failed to load post', 'error');
    closePostEditor();
  }
}

function togglePublishState() {
  editorPublishState = !editorPublishState;
  document.getElementById('postPublishToggle').classList.toggle('active', editorPublishState);
}

async function refreshPreview() {
  const content = document.getElementById('postContentEditor').value;
  const previewEl = document.getElementById('postPreviewContent');
  
  if (!content.trim()) {
    previewEl.innerHTML = '<p style="color: var(--text-muted); font-style: italic;">Preview will appear here...</p>';
    return;
  }
  
  try {
    const result = await api.blog.preview(content);
    previewEl.innerHTML = result.html;
  } catch (error) {
    previewEl.innerHTML = `<p style="color: var(--status-error);">Preview error: ${error.message}</p>`;
  }
}

async function savePost() {
  const title = document.getElementById('postTitleInput').value.trim();
  const content = document.getElementById('postContentEditor').value;
  const author = document.getElementById('postAuthorInput').value.trim() || 'luxia';
  const tags = document.getElementById('postTagsInput').value.trim() || null;
  const categories = document.getElementById('postCategoriesInput').value.trim() || null;
  const license = document.getElementById('postLicenseInput').value;
  
  if (!title) {
    showToast('Title is required', 'error');
    document.getElementById('postTitleInput').focus();
    return;
  }
  
  if (!content.trim()) {
    showToast('Content is required', 'error');
    document.getElementById('postContentEditor').focus();
    return;
  }
  
  const postData = {
    title,
    content,
    author,
    tags,
    categories,
    license,
    published: editorPublishState,
  };
  
  try {
    if (currentEditingPostId) {
      await api.blog.update(currentEditingPostId, postData);
      showToast('Post updated successfully', 'success');
    } else {
      await api.blog.create(postData);
      showToast('Post created successfully', 'success');
    }
    
    closePostEditor();
    await loadBlogStats();
    await loadBlogPosts();
  } catch (error) {
    showToast(error.message || 'Failed to save post', 'error');
  }
}

function closePostEditor(event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById('postEditorModal').classList.remove('active');
  currentEditingPostId = null;
}

// ============================================================================
// POST ACTIONS
// ============================================================================

async function publishPost(id) {
  try {
    await api.blog.publish(id);
    showToast('Post published', 'success');
    await loadBlogStats();
    await loadBlogPosts();
  } catch (error) {
    showToast(error.message || 'Failed to publish', 'error');
  }
}

async function unpublishPost(id) {
  try {
    await api.blog.unpublish(id);
    showToast('Post unpublished (reverted to draft)', 'info');
    await loadBlogStats();
    await loadBlogPosts();
  } catch (error) {
    showToast(error.message || 'Failed to unpublish', 'error');
  }
}

function viewPostOnSite(id, slug) {
  // Open the post on the public blog
  const baseUrl = 'https://aetherawi.red';
  window.open(`${baseUrl}/posts/${slug}`, '_blank');
}

function confirmDeletePost(id, title) {
  deletePostId = id;
  document.getElementById('deletePostTitle').textContent = `"${title}"`;
  document.getElementById('deletePostModal').classList.add('active');
}

async function confirmDeletePostAction() {
  if (!deletePostId) return;
  
  try {
    await api.blog.delete(deletePostId);
    showToast('Post deleted', 'success');
    closeDeleteModal();
    await loadBlogStats();
    await loadBlogPosts();
  } catch (error) {
    showToast(error.message || 'Failed to delete post', 'error');
  }
}

function closeDeleteModal(event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById('deletePostModal').classList.remove('active');
  deletePostId = null;
}

// ============================================================================
// LIVE PREVIEW (Draft Preview in iframe)
// ============================================================================

let livePreviewConfig = null;
let currentPreviewSlug = null;

/**
 * Open the live preview modal with the current post
 * First saves the post as a draft if needed, then opens preview
 */
async function openLivePreview() {
  const title = document.getElementById('postTitleInput').value.trim();
  const content = document.getElementById('postContentEditor').value;
  
  if (!title) {
    showToast('Enter a title before previewing', 'error');
    document.getElementById('postTitleInput').focus();
    return;
  }
  
  if (!content.trim()) {
    showToast('Enter content before previewing', 'error');
    document.getElementById('postContentEditor').focus();
    return;
  }
  
  // Get preview config (cached or fresh)
  if (!livePreviewConfig) {
    try {
      livePreviewConfig = await api.blog.previewConfig();
    } catch (error) {
      showToast('Failed to get preview configuration', 'error');
      return;
    }
  }
  
  if (!livePreviewConfig.available) {
    showPreviewUnavailable(livePreviewConfig.error || 'Preview not configured');
    return;
  }
  
  // Save as draft first if this is a new post or content changed
  try {
    const postData = {
      title,
      content,
      author: document.getElementById('postAuthorInput').value.trim() || 'luxia',
      tags: document.getElementById('postTagsInput').value.trim() || null,
      categories: document.getElementById('postCategoriesInput').value.trim() || null,
      license: document.getElementById('postLicenseInput').value,
      published: editorPublishState,
    };
    
    let slug;
    if (currentEditingPostId) {
      // Update existing post
      const result = await api.blog.update(currentEditingPostId, postData);
      slug = result.post.slug;
      showToast('Post saved', 'info');
    } else {
      // Create new post as draft
      const result = await api.blog.create(postData);
      currentEditingPostId = result.post.id;
      slug = result.post.slug;
      showToast('Draft saved', 'info');
    }
    
    // Now open preview
    currentPreviewSlug = slug;
    const previewUrl = `${livePreviewConfig.blogUrl}/preview/${slug}?token=${livePreviewConfig.token}`;
    
    // Update modal UI
    document.getElementById('livePreviewSlug').textContent = `/${slug}`;
    const statusEl = document.getElementById('livePreviewStatus');
    statusEl.textContent = editorPublishState ? 'Published' : 'Draft';
    statusEl.className = `live-preview-status ${editorPublishState ? 'published' : 'draft'}`;
    
    // Load iframe
    const frame = document.getElementById('livePreviewFrame');
    const previewBody = frame.parentElement;
    previewBody.classList.add('loading');
    
    frame.onload = () => {
      previewBody.classList.remove('loading');
    };
    
    frame.src = previewUrl;
    
    // Show modal
    document.getElementById('livePreviewModal').classList.add('active');
    
  } catch (error) {
    showToast(error.message || 'Failed to save post for preview', 'error');
  }
}

/**
 * Refresh the live preview iframe
 */
function refreshLivePreview() {
  if (!currentPreviewSlug || !livePreviewConfig?.available) return;
  
  const frame = document.getElementById('livePreviewFrame');
  const previewBody = frame.parentElement;
  previewBody.classList.add('loading');
  
  // Reload with cache bust
  const previewUrl = `${livePreviewConfig.blogUrl}/preview/${currentPreviewSlug}?token=${livePreviewConfig.token}&_t=${Date.now()}`;
  frame.src = previewUrl;
}

/**
 * Close the live preview modal
 */
function closeLivePreview(event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById('livePreviewModal').classList.remove('active');
  document.getElementById('livePreviewFrame').src = 'about:blank';
  currentPreviewSlug = null;
}

/**
 * Show preview unavailable state
 */
function showPreviewUnavailable(reason) {
  const previewBody = document.querySelector('.live-preview-body');
  previewBody.innerHTML = `
    <div class="live-preview-unavailable">
      <div class="live-preview-unavailable-icon">🔒</div>
      <h3 class="live-preview-unavailable-title">Preview Not Available</h3>
      <p class="live-preview-unavailable-text">
        ${reason}<br><br>
        To enable preview, set the <code>BLOG_PREVIEW_TOKEN</code> environment variable 
        in both the admin panel and the blog (core) service.
      </p>
    </div>
  `;
  document.getElementById('livePreviewModal').classList.add('active');
}

/**
 * Preview a post directly from the list (without opening editor)
 */
async function previewPostFromList(id, slug, isPublished) {
  // Get preview config (cached or fresh)
  if (!livePreviewConfig) {
    try {
      livePreviewConfig = await api.blog.previewConfig();
    } catch (error) {
      showToast('Failed to get preview configuration', 'error');
      return;
    }
  }
  
  if (!livePreviewConfig.available) {
    showPreviewUnavailable(livePreviewConfig.error || 'Preview not configured');
    return;
  }
  
  currentPreviewSlug = slug;
  const previewUrl = `${livePreviewConfig.blogUrl}/preview/${slug}?token=${livePreviewConfig.token}`;
  
  // Update modal UI
  document.getElementById('livePreviewSlug').textContent = `/${slug}`;
  const statusEl = document.getElementById('livePreviewStatus');
  statusEl.textContent = isPublished ? 'Published' : 'Draft';
  statusEl.className = `live-preview-status ${isPublished ? 'published' : 'draft'}`;
  
  // Ensure we have a proper iframe in the body (reset from error state)
  const previewBody = document.querySelector('.live-preview-body');
  if (!previewBody.querySelector('iframe')) {
    previewBody.innerHTML = '<iframe id="livePreviewFrame" src="about:blank" frameborder="0"></iframe>';
  }
  
  // Load iframe
  const frame = document.getElementById('livePreviewFrame');
  previewBody.classList.add('loading');
  
  frame.onload = () => {
    previewBody.classList.remove('loading');
  };
  
  frame.src = previewUrl;
  
  // Show modal
  document.getElementById('livePreviewModal').classList.add('active');
}

// Make blog functions global
window.loadBlog = loadBlog;
window.refreshBlogPosts = refreshBlogPosts;
window.forceRefreshBlog = forceRefreshBlog;
window.loadBlogPage = loadBlogPage;
window.openPostEditor = openPostEditor;
window.editPost = editPost;
window.savePost = savePost;
window.closePostEditor = closePostEditor;
window.togglePublishState = togglePublishState;
window.refreshPreview = refreshPreview;
window.publishPost = publishPost;
window.unpublishPost = unpublishPost;
window.viewPostOnSite = viewPostOnSite;
window.confirmDeletePost = confirmDeletePost;
window.confirmDeletePostAction = confirmDeletePostAction;
window.closeDeleteModal = closeDeleteModal;
window.openLivePreview = openLivePreview;
window.refreshLivePreview = refreshLivePreview;
window.closeLivePreview = closeLivePreview;
window.previewPostFromList = previewPostFromList;

async function loadIRC() {
  // TODO: Implement in Phase 6
}

// ============================================================================
// SERVER MONITORING
// ============================================================================

let serverMetrics = null;

async function loadServer() {
  // Use live data stream instead of polling
  loadServerLive();
}

/**
 * Load server page with live SSE updates
 */
function loadServerLive() {
  streams.connect('server', (data) => {
    serverMetrics = data;
    renderServerMetrics();
  });
  
  // These don't need to be live (user-triggered or less frequent)
  refreshNetworkStatus();
  refreshLogSizes();
  refreshServiceHealth();
  refreshProcessInfo();
}

async function refreshServerMetrics() {
  try {
    serverMetrics = await api.server.metrics();
    renderServerMetrics();
  } catch (error) {
    console.error('Error loading server metrics:', error);
  }
}

function renderServerMetrics() {
  if (!serverMetrics) return;
  
  // Server info header
  document.getElementById('serverHostname').textContent = serverMetrics.hostname || '—';
  document.getElementById('serverUptime').textContent = serverMetrics.uptime?.formatted || '—';
  document.getElementById('serverPlatform').textContent = 
    `${serverMetrics.platform || '—'} (${serverMetrics.arch || '—'})`;
  
  // CPU - use pulseUpdate for the percentage value
  const cpu = serverMetrics.cpu || {};
  const cpuPercent = cpu.percent ?? 0;
  const cpuEl = document.getElementById('cpuPercent');
  const oldCpuValue = cpuEl.textContent.replace('%', '');
  cpuEl.innerHTML = `${cpuPercent}<span class="metric-card-unit">%</span>`;
  if (oldCpuValue !== String(cpuPercent)) {
    cpuEl.classList.add('pulse-update');
    setTimeout(() => cpuEl.classList.remove('pulse-update'), 600);
  }
  document.getElementById('cpuCores').textContent = `${cpu.cores || '—'} cores`;
  
  const cpuBar = document.getElementById('cpuBar');
  cpuBar.style.width = `${cpuPercent}%`;
  cpuBar.className = `metric-bar-fill ${getBarClass(cpuPercent)}`;
  
  // Memory - use pulseUpdate for the percentage value
  const mem = serverMetrics.memory || {};
  const memPercent = mem.percent ?? 0;
  const memEl = document.getElementById('memPercent');
  const oldMemValue = memEl.textContent.replace('%', '');
  memEl.innerHTML = `${memPercent}<span class="metric-card-unit">%</span>`;
  if (oldMemValue !== String(memPercent)) {
    memEl.classList.add('pulse-update');
    setTimeout(() => memEl.classList.remove('pulse-update'), 600);
  }
  document.getElementById('memUsage').textContent = 
    `${mem.usedFormatted || '—'} / ${mem.totalFormatted || '—'}`;
  
  const memBar = document.getElementById('memBar');
  memBar.style.width = `${memPercent}%`;
  memBar.className = `metric-bar-fill ${getBarClass(memPercent)}`;
  
  // Load averages - use pulseUpdate
  const load = serverMetrics.load || {};
  pulseUpdate('load1', load.load1 || '—');
  pulseUpdate('load5', load.load5 || '—');
  pulseUpdate('load15', load.load15 || '—');
  
  // Disk table
  renderDiskTable(serverMetrics.disk || []);
  
  // Journal size (if available in metrics)
  if (serverMetrics.journal?.size) {
    document.getElementById('journalSize').textContent = serverMetrics.journal.size;
  }
}

function getBarClass(percent) {
  if (percent >= 90) return 'error';
  if (percent >= 70) return 'warning';
  return 'success';
}

function renderDiskTable(disks) {
  const tbody = document.getElementById('diskTableBody');
  
  if (!disks || disks.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="color: var(--text-muted); text-align: center;">No disk data available</td>
      </tr>
    `;
    return;
  }
  
  tbody.innerHTML = disks.map(disk => `
    <tr>
      <td class="mount-path">${escapeHtml(disk.mount)}</td>
      <td class="disk-size">${disk.sizeFormatted}</td>
      <td class="disk-size">${disk.usedFormatted}</td>
      <td class="disk-size">${disk.availableFormatted}</td>
      <td>
        <div class="metric-bar-label">
          <span></span>
          <span>${disk.percent}%</span>
        </div>
        <div class="metric-bar disk-bar">
          <div class="metric-bar-fill ${getBarClass(disk.percent)}" style="width: ${disk.percent}%;"></div>
        </div>
      </td>
    </tr>
  `).join('');
}

async function refreshNetworkStatus() {
  try {
    const network = await api.server.network();
    renderNetworkStatus(network);
  } catch (error) {
    console.error('Error loading network status:', error);
    document.getElementById('networkStatusBadge').className = 'network-status-badge offline';
    document.getElementById('networkStatusBadge').textContent = 'Error';
  }
}

function renderNetworkStatus(network) {
  // Status badge
  const badge = document.getElementById('networkStatusBadge');
  badge.className = `network-status-badge ${network.status}`;
  badge.textContent = network.status === 'connected' ? '✓ Connected' :
                      network.status === 'degraded' ? '⚠ Degraded' : '✗ Offline';
  
  // Host list
  const hostsContainer = document.getElementById('networkHosts');
  hostsContainer.innerHTML = (network.hosts || []).map(host => `
    <div class="network-host">
      <span class="network-host-name">${escapeHtml(host.name)}</span>
      <span class="network-host-latency ${host.success ? 'success' : 'error'}">
        ${host.success ? `${host.latencyMs}` : '✗'}
      </span>
    </div>
  `).join('');
}

async function runPingTest() {
  const host = document.getElementById('pingHostInput').value.trim();
  const resultDiv = document.getElementById('pingResult');
  
  if (!host) {
    resultDiv.style.display = 'block';
    resultDiv.className = 'ping-result error';
    resultDiv.textContent = 'Please enter a host';
    return;
  }
  
  resultDiv.style.display = 'block';
  resultDiv.className = 'ping-result';
  resultDiv.textContent = `Pinging ${host}...`;
  
  try {
    const result = await api.server.ping(host);
    
    if (result.success) {
      resultDiv.className = 'ping-result success';
      resultDiv.textContent = `✓ ${host}: ${result.latencyMs} RTT`;
    } else {
      resultDiv.className = 'ping-result error';
      resultDiv.textContent = `✗ ${host}: ${result.error || 'Unreachable'}`;
    }
  } catch (error) {
    resultDiv.className = 'ping-result error';
    resultDiv.textContent = `✗ Error: ${error.message}`;
  }
}

async function refreshLogSizes() {
  try {
    const sizes = await api.server.logSizes();
    
    // Journal size
    if (sizes.journal?.available) {
      document.getElementById('journalSize').textContent = sizes.journal.size || '—';
    } else {
      document.getElementById('journalSize').textContent = 'N/A';
    }
    
    // Docker size (simplified)
    if (sizes.docker?.available) {
      document.getElementById('dockerSize').textContent = 'Available';
    } else {
      document.getElementById('dockerSize').textContent = sizes.docker?.error || 'N/A';
    }
  } catch (error) {
    console.error('Error loading log sizes:', error);
  }
}

async function trimJournalLogs(size) {
  const resultDiv = document.getElementById('logTrimResult');
  const pre = resultDiv.querySelector('pre');
  
  resultDiv.style.display = 'block';
  pre.textContent = `Trimming journal logs to ${size}...`;
  
  try {
    showToast(`Trimming journal logs to ${size}...`, 'info');
    const result = await api.server.trimJournal({ size });
    
    if (result.success) {
      pre.textContent = `✓ Trimmed successfully\n\nBefore: ${result.sizeBefore || '—'}\nAfter: ${result.sizeAfter || '—'}\n\n${result.output || ''}`;
      showToast('Journal logs trimmed', 'success');
      
      // Refresh sizes
      await refreshLogSizes();
    } else {
      pre.textContent = `✗ Trim failed\n\n${result.error || result.output || 'Unknown error'}`;
      showToast('Failed to trim logs', 'error');
    }
  } catch (error) {
    pre.textContent = `✗ Error: ${error.message}`;
    showToast('Failed to trim logs', 'error');
  }
}

async function pruneDockerSystem() {
  const resultDiv = document.getElementById('logTrimResult');
  const pre = resultDiv.querySelector('pre');
  
  if (!confirm('Prune Docker system? This will remove unused containers, networks, and images.')) {
    return;
  }
  
  resultDiv.style.display = 'block';
  pre.textContent = 'Pruning Docker system...';
  
  try {
    showToast('Pruning Docker system...', 'info');
    const result = await api.server.pruneDocker();
    
    if (result.success) {
      pre.textContent = `✓ Docker pruned successfully\n\n${result.output || ''}`;
      showToast('Docker system pruned', 'success');
      
      // Refresh sizes
      await refreshLogSizes();
    } else {
      pre.textContent = `✗ Prune failed\n\n${result.error || result.output || 'Unknown error'}`;
      showToast('Failed to prune Docker', 'error');
    }
  } catch (error) {
    pre.textContent = `✗ Error: ${error.message}`;
    showToast('Failed to prune Docker', 'error');
  }
}

async function refreshServiceHealth() {
  try {
    const services = await api.server.services();
    renderServiceHealth(services);
  } catch (error) {
    console.error('Error loading service health:', error);
  }
}

async function refreshProcessInfo() {
  try {
    const info = await api.server.processes();
    renderProcessInfo(info);
  } catch (error) {
    console.error('Error loading process info:', error);
  }
}

function renderProcessInfo(info) {
  const zombieCount = document.getElementById('zombieCount');
  const activeProcs = document.getElementById('activeChildProcs');
  const cleanupBtn = document.getElementById('zombieCleanupBtn');
  
  if (zombieCount) {
    pulseUpdate('zombieCount', info.zombies || 0);
    zombieCount.className = `process-stat-value ${info.zombies > 0 ? 'warning' : 'success'}`;
  }
  
  if (activeProcs) {
    pulseUpdate('activeChildProcs', info.activeChildProcesses || 0);
  }
  
  if (cleanupBtn) {
    cleanupBtn.disabled = (info.zombies || 0) === 0;
  }
}

async function cleanupZombies() {
  try {
    showToast('Cleaning up zombie processes...', 'info');
    const result = await api.server.cleanupZombies();
    
    if (result.cleaned > 0) {
      showToast(`Cleaned ${result.cleaned} zombie process${result.cleaned > 1 ? 'es' : ''}`, 'success');
    } else if (result.before === 0) {
      showToast('No zombie processes to clean', 'info');
    } else {
      showToast(`${result.after} zombie${result.after > 1 ? 's' : ''} remaining (may need admin restart)`, 'warning');
    }
    
    // Refresh process info
    await refreshProcessInfo();
  } catch (error) {
    showToast(`Cleanup failed: ${error.message}`, 'error');
  }
}

function renderServiceHealth(services) {
  const grid = document.getElementById('servicesHealthGrid');
  const items = [];
  
  // Admin service (self)
  if (services.admin) {
    items.push({
      name: 'aethera-admin',
      running: true,
      status: 'running',
    });
  }
  
  // Aethera (Docker)
  if (services.aethera) {
    items.push({
      name: 'aethera (blog)',
      running: services.aethera.running,
      status: services.aethera.running ? 
        (services.aethera.health === 'healthy' ? 'running' : 'error') : 'stopped',
    });
  }
  
  // Membrane API (Systemd)
  if (services.membraneApi) {
    items.push({
      name: 'membrane-api',
      running: services.membraneApi.running,
      status: services.membraneApi.running ? 
        (services.membraneApi.health === 'healthy' ? 'running' : 'error') : 'stopped',
    });
  }
  
  // Bots
  if (services.bots?.list) {
    for (const bot of services.bots.list) {
      items.push({
        name: `bot: ${bot.name}`,
        running: bot.running,
        status: bot.running ? 'running' : (bot.state === 'error' ? 'error' : 'stopped'),
      });
    }
  }
  
  if (items.length === 0) {
    grid.innerHTML = `
      <div class="service-health-item">
        <span class="status-dot stopped"></span>
        <span class="service-health-name">No services found</span>
      </div>
    `;
    return;
  }
  
  grid.innerHTML = items.map(item => `
    <div class="service-health-item">
      <span class="status-dot ${item.running ? 'running' : 'stopped'}"></span>
      <span class="service-health-name">${escapeHtml(item.name)}</span>
      <span class="service-health-status ${item.status}">${item.status}</span>
    </div>
  `).join('');
}

// startServerAutoRefresh removed - now using SSE via loadServerLive()

/**
 * Force refresh server metrics (bypasses stream, immediate fetch)
 */
async function forceRefreshServer() {
  showToast('Refreshing server metrics...', 'info');
  try {
    serverMetrics = await api.server.metrics();
    renderServerMetrics();
    showToast('Metrics refreshed', 'success');
  } catch (error) {
    showToast(`Refresh failed: ${error.message}`, 'error');
  }
}

// Make server functions global
window.loadServer = loadServer;
window.refreshServerMetrics = refreshServerMetrics;
window.forceRefreshServer = forceRefreshServer;
window.refreshNetworkStatus = refreshNetworkStatus;
window.runPingTest = runPingTest;
window.refreshLogSizes = refreshLogSizes;
window.trimJournalLogs = trimJournalLogs;
window.pruneDockerSystem = pruneDockerSystem;
window.refreshServiceHealth = refreshServiceHealth;
window.refreshProcessInfo = refreshProcessInfo;
window.cleanupZombies = cleanupZombies;

// ============================================================================
// UTILITIES
// ============================================================================

function togglePassword() {
  const input = document.getElementById('password');
  const toggle = document.querySelector('.password-toggle');
  
  if (input.type === 'password') {
    input.type = 'text';
    toggle.textContent = '🙈';
  } else {
    input.type = 'password';
    toggle.textContent = '👁';
  }
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  
  container.appendChild(toast);
  
  // Remove after 4 seconds
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Make functions globally available
window.togglePassword = togglePassword;
window.logout = logout;
window.showToast = showToast;
window.loadDashboard = loadDashboard;
window.forceRefreshDashboard = forceRefreshDashboard;

