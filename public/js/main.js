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
  const stateText = formatGpuState ? formatGpuState(dreams.state) : dreams.state;
  pulseUpdate('statDreams', stateText);
  const dreamsEl = document.getElementById('statDreams');
  if (dreamsEl) {
    dreamsEl.className = `stat-value ${dreams.state === 'running' ? 'success' : ''}`;
  }
  
  // Blog section
  const blog = data.blog || {};
  pulseUpdate('statBlogPosts', blog.total || 0);
}

/**
 * Force refresh dashboard (bypasses stream, immediate fetch)
 */
async function forceRefreshDashboard() {
  showToast('Refreshing dashboard...', 'info');
  try {
    // Fetch all data in parallel
    const [botsData, aetheraData, dreamsData, blogStats] = await Promise.all([
      api.bots.list().catch(() => ({ bots: [], running: 0 })),
      api.services.aetheraStatus().catch(() => ({ running: false })),
      api.dreams.status().catch(() => ({ state: 'unknown' })),
      api.blog.stats().catch(() => ({ total: 0 })),
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
        state: dreamsData.state || 'unknown',
      },
      blog: {
        total: blogStats.total || 0,
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
  // Use live data stream
  loadBotsLive();
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
          ${Object.keys(currentSlots).map((slotName, idx) => `
            <button class="slot-btn ${idx === 0 ? 'active' : ''}" data-slot="${slotName}" 
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

// Bot slot selection state
const selectedSlots = {};

function selectSlot(botName, slot, btn) {
  selectedSlots[botName] = slot;
  
  // Update UI
  const parent = btn.parentElement;
  parent.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function getSelectedSlot(botName) {
  if (selectedSlots[botName]) {
    return selectedSlots[botName];
  }
  // Default to first available slot, or 'main' as fallback
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
window.viewBotLogs = viewBotLogs;
window.refreshLogs = refreshLogs;
window.scrollLogsToBottom = scrollLogsToBottom;
window.closeLogsModal = closeLogsModal;
window.editBotConfig = editBotConfig;
window.saveConfig = saveConfig;
window.closeConfigModal = closeConfigModal;

// ============================================================================
// SERVICES MANAGEMENT
// ============================================================================

let aetheraStatus = null;

async function loadServices() {
  // Use live data stream
  loadServicesLive();
}

/**
 * Load services page with live SSE updates
 */
function loadServicesLive() {
  streams.connect('services', (data) => {
    aetheraStatus = data.aethera || null;
    currentSlots = data.slots || {};
    
    renderAetheraStatus();
    renderSlots();
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
 */
function updateSlotDepsUI(slot) {
  const container = document.getElementById(`slotDeps-${slot}`);
  if (!container) return;
  
  const deps = slotGitDeps[slot];
  if (!deps || !deps.hasGitDeps) {
    container.innerHTML = '';
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
          
          <!-- Git Dependencies Section (populated async) -->
          <div id="slotDeps-${name}" class="slot-deps-container">
            <!-- Loading indicator -->
            <div class="git-deps-loading">
              <span class="spinner-sm"></span> Checking dependencies...
            </div>
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
// DREAMS MANAGEMENT
// ============================================================================

let dreamsStatus = null;

async function loadDreams() {
  // Use live data stream instead of polling
  loadDreamsLive();
}

/**
 * Load dreams page with live SSE updates
 */
function loadDreamsLive() {
  streams.connect('dreams', (data) => {
    dreamsStatus = data;
    renderDreamsStatus();
  });
}

async function refreshDreamsStatus() {
  try {
    dreamsStatus = await api.dreams.status();
    renderDreamsStatus();
  } catch (error) {
    console.error('Error loading dreams status:', error);
    showToast('Failed to load dreams status', 'error');
  }
}

function renderDreamsStatus() {
  if (!dreamsStatus) return;
  
  // Config warning
  const configWarning = document.getElementById('dreamsConfigWarning');
  if (configWarning) {
    configWarning.style.display = dreamsStatus.configured ? 'none' : 'flex';
  }
  
  // State badge
  const stateBadge = document.getElementById('gpuStateBadge');
  const stateText = document.getElementById('gpuStateText');
  if (stateBadge && stateText) {
    const stateMap = {
      running: 'running',
      starting: 'starting',
      idle: 'idle',
      not_configured: 'not_configured',
    };
    const badgeClass = stateMap[dreamsStatus.state] || 'unknown';
    stateBadge.className = `gpu-state-badge ${badgeClass}`;
    stateText.textContent = formatGpuState(dreamsStatus.state);
  }
  
  // Status message
  const statusMessage = document.getElementById('gpuStatusMessage');
  const statusIcon = document.getElementById('gpuStatusIcon');
  const statusText = document.getElementById('gpuStatusText');
  if (statusMessage && statusIcon && statusText) {
    if (dreamsStatus.stateMessage && dreamsStatus.state !== 'idle') {
      statusMessage.style.display = 'flex';
      statusMessage.className = `gpu-status-message ${dreamsStatus.state}`;
      statusIcon.textContent = dreamsStatus.state === 'starting' ? '⏳' : 
                               dreamsStatus.state === 'error' ? '❌' : 'ℹ️';
      statusText.textContent = dreamsStatus.stateMessage;
    } else {
      statusMessage.style.display = 'none';
    }
  }
  
  // Cost display - use pulse for frequently changing values
  const cost = dreamsStatus.cost || {};
  pulseUpdate('gpuCost', `$${(cost.estimatedSessionCost || 0).toFixed(2)}`);
  document.getElementById('gpuRate').textContent = (cost.hourlyRate || 0.19).toFixed(2);
  pulseUpdate('gpuUptime', cost.uptimeFormatted || '0s');
  
  // GPU stats
  const aethera = dreamsStatus.aethera || {};
  const gpu = aethera.gpu || {};
  const generation = aethera.generation || {};
  const viewers = aethera.viewers || {};
  
  pulseUpdate('gpuStateValue', formatGpuState(gpu.state || dreamsStatus.state));
  pulseUpdate('gpuViewers', (viewers.websocket_count || 0) + (viewers.api_active ? ' (+API)' : ''));
  pulseUpdate('gpuFrames', generation.frame_count || 0);
  pulseUpdate('gpuFps', generation.fps ? generation.fps.toFixed(1) : '—');
  
  // Aethera info
  if (aethera.error) {
    document.getElementById('aetheraConnection').textContent = '❌ Error';
    document.getElementById('aetheraConnection').className = 'gpu-stat-value warning';
  } else {
    document.getElementById('aetheraConnection').textContent = '✓ Connected';
    document.getElementById('aetheraConnection').className = 'gpu-stat-value success';
  }
  document.getElementById('aetheraGpuActive').textContent = gpu.active ? '✓ Yes' : '✗ No';
  document.getElementById('aetheraGpuActive').className = `gpu-stat-value ${gpu.active ? 'success' : 'muted'}`;
  document.getElementById('aetheraWsViewers').textContent = viewers.websocket_count || 0;
  document.getElementById('aetheraApiActive').textContent = viewers.api_active ? 'Yes' : 'No';
  
  // RunPod info - use pulse for changing values
  const runpod = dreamsStatus.runpod || {};
  if (runpod.error) {
    document.getElementById('runpodWorkers').textContent = '—';
    document.getElementById('runpodRunning').textContent = '❌';
    document.getElementById('runpodQueued').textContent = '—';
    document.getElementById('runpodCompleted').textContent = '—';
  } else {
    pulseUpdate('runpodWorkers', runpod.workers || 0);
    pulseUpdate('runpodRunning', runpod.workersRunning || 0);
    pulseUpdate('runpodQueued', runpod.jobsInQueue || 0);
    pulseUpdate('runpodCompleted', runpod.jobsCompleted || 0);
  }
  
  // Update action buttons
  updateGpuActionButtons();
}

function formatGpuState(state) {
  const states = {
    running: 'Running',
    starting: 'Starting...',
    idle: 'Idle',
    stopping: 'Stopping...',
    not_configured: 'Not Configured',
    unknown: 'Unknown',
  };
  return states[state] || state;
}

function updateGpuActionButtons() {
  const startBtn = document.getElementById('gpuStartBtn');
  const stopBtn = document.getElementById('gpuStopBtn');
  const restartBtn = document.getElementById('gpuRestartBtn');
  
  if (!dreamsStatus?.configured) {
    startBtn.disabled = true;
    stopBtn.disabled = true;
    restartBtn.disabled = true;
    return;
  }
  
  const state = dreamsStatus.state;
  
  // Start button: enabled when idle
  startBtn.disabled = state !== 'idle';
  
  // Stop button: enabled when running or starting
  stopBtn.disabled = state !== 'running' && state !== 'starting';
  
  // Restart button: enabled when running
  restartBtn.disabled = state !== 'running';
}

async function startGpu() {
  if (!dreamsStatus?.configured) {
    showToast('RunPod not configured', 'error');
    return;
  }
  
  try {
    showToast('Starting GPU...', 'info');
    const result = await api.dreams.start();
    
    if (result.success) {
      if (result.alreadyRunning) {
        showToast('GPU is already running', 'info');
      } else if (result.alreadyStarting) {
        showToast('GPU is already starting', 'info');
      } else {
        showToast('GPU start job submitted', 'success');
      }
      await refreshDreamsStatus();
    }
  } catch (error) {
    showToast(error.message || 'Failed to start GPU', 'error');
  }
}

async function stopGpu() {
  if (!dreamsStatus?.configured) {
    showToast('RunPod not configured', 'error');
    return;
  }
  
  if (!confirm('Stop GPU? This will cancel all running jobs immediately.')) {
    return;
  }
  
  try {
    showToast('Stopping GPU...', 'info');
    const result = await api.dreams.stop();
    
    if (result.success) {
      showToast('GPU stopped', 'success');
      await refreshDreamsStatus();
    }
  } catch (error) {
    showToast(error.message || 'Failed to stop GPU', 'error');
  }
}

async function restartGpu() {
  if (!dreamsStatus?.configured) {
    showToast('RunPod not configured', 'error');
    return;
  }
  
  if (!confirm('Restart GPU? This will stop and start a fresh instance.')) {
    return;
  }
  
  try {
    showToast('Restarting GPU...', 'info');
    const result = await api.dreams.restart();
    
    if (result.success) {
      showToast('GPU restart initiated', 'success');
      await refreshDreamsStatus();
    }
  } catch (error) {
    showToast(error.message || 'Failed to restart GPU', 'error');
  }
}

/**
 * Force refresh dreams status (bypasses stream, immediate fetch)
 */
async function forceRefreshDreams() {
  showToast('Refreshing dreams status...', 'info');
  try {
    dreamsStatus = await api.dreams.status();
    renderDreamsStatus();
    showToast('Status refreshed', 'success');
  } catch (error) {
    showToast(`Refresh failed: ${error.message}`, 'error');
  }
}

function openDreamsViewer(event) {
  event.preventDefault();
  // Open the dreams viewer page on the aethera site
  // The URL should be configurable but defaults to /dreams on aethera
  const baseUrl = 'https://aetherawi.red'; // Could be made configurable
  window.open(`${baseUrl}/dreams`, '_blank');
}

function openRunpodDashboard(event) {
  event.preventDefault();
  window.open('https://www.runpod.io/console/serverless', '_blank');
}

// Make dreams functions global
window.loadDreams = loadDreams;
window.refreshDreamsStatus = refreshDreamsStatus;
window.forceRefreshDreams = forceRefreshDreams;
window.startGpu = startGpu;
window.stopGpu = stopGpu;
window.restartGpu = restartGpu;
window.openDreamsViewer = openDreamsViewer;
window.openRunpodDashboard = openRunpodDashboard;

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

