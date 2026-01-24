// api.js - API client for aethera-admin

const api = {
  /**
   * Make an API request
   * @param {string} endpoint - API endpoint (without /api prefix)
   * @param {Object} options - Fetch options
   * @returns {Promise<Object>} Response data
   */
  async request(endpoint, options = {}) {
    const url = `/api${endpoint}`;
    
    const config = {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    };
    
    if (options.body && typeof options.body === 'object') {
      config.body = JSON.stringify(options.body);
    }
    
    try {
      const response = await fetch(url, config);
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      
      return data;
    } catch (error) {
      console.error(`API Error [${endpoint}]:`, error);
      throw error;
    }
  },
  
  // ============================================================================
  // AUTH
  // ============================================================================
  
  auth: {
    async login(username, password) {
      return api.request('/auth/login', {
        method: 'POST',
        body: { username, password },
      });
    },
    
    async logout() {
      return api.request('/auth/logout', {
        method: 'POST',
      });
    },
    
    async check() {
      return api.request('/auth/check');
    },
    
    async changePassword(oldPassword, newPassword) {
      return api.request('/auth/change-password', {
        method: 'POST',
        body: { oldPassword, newPassword },
      });
    },
    
    async getUser() {
      return api.request('/auth/user');
    },
  },
  
  // ============================================================================
  // HEALTH
  // ============================================================================
  
  async health() {
    return api.request('/health');
  },
  
  // ============================================================================
  // BOTS
  // ============================================================================
  
  bots: {
    async list() {
      return api.request('/bots');
    },
    
    async get(name) {
      return api.request(`/bots/${name}`);
    },
    
    async start(name, slot = 'main') {
      return api.request(`/bots/${name}/start`, { 
        method: 'POST',
        body: { slot },
      });
    },
    
    async stop(name, force = false) {
      return api.request(`/bots/${name}/stop`, { 
        method: 'POST',
        body: { force },
      });
    },
    
    async restart(name, slot = null) {
      return api.request(`/bots/${name}/restart`, { 
        method: 'POST',
        body: { slot },
      });
    },
    
    async logs(name, lines = 200) {
      return api.request(`/bots/${name}/logs?lines=${lines}`);
    },
    
    async getConfig(name) {
      return api.request(`/bots/${name}/config`);
    },
    
    async saveConfig(name, config) {
      return api.request(`/bots/${name}/config`, {
        method: 'POST',
        body: { config },
      });
    },
    
    async rescan() {
      return api.request('/bots/rescan', { method: 'POST' });
    },
    
    async getSlots() {
      return api.request('/bots/slots/info');
    },
    
    /**
     * Set preferred slot for a bot (persists selection)
     * @param {string} name - Bot name
     * @param {string} slot - Slot name
     */
    async setSlot(name, slot) {
      return api.request(`/bots/${name}/slot`, {
        method: 'POST',
        body: { slot },
      });
    },
  },
  
  // ============================================================================
  // SERVICES
  // ============================================================================
  
  services: {
    async list() {
      return api.request('/services');
    },
    
    async aetheraStatus() {
      return api.request('/services/aethera/status');
    },
    
    async aetheraLogs(lines = 200) {
      return api.request(`/services/aethera/logs?lines=${lines}`);
    },
    
    async aetheraRestart() {
      return api.request('/services/aethera/restart', { method: 'POST' });
    },
    
    async aetheraStart() {
      return api.request('/services/aethera/start', { method: 'POST' });
    },
    
    async aetheraStop() {
      return api.request('/services/aethera/stop', { method: 'POST' });
    },
    
    async aetheraHealth() {
      return api.request('/services/aethera/health');
    },
  },
  
  // ============================================================================
  // SLOTS (ChapterX Git Operations)
  // ============================================================================
  
  slots: {
    async list() {
      return api.request('/slots');
    },
    
    async status(slot) {
      return api.request(`/slots/${slot}/status`);
    },
    
    async fetch(slot) {
      return api.request(`/slots/${slot}/fetch`, { method: 'POST' });
    },
    
    async pull(slot, autoRestart = false) {
      return api.request(`/slots/${slot}/pull`, {
        method: 'POST',
        body: { autoRestart },
      });
    },
    
    async checkout(slot, branch, autoRestart = false) {
      return api.request(`/slots/${slot}/checkout`, {
        method: 'POST',
        body: { branch, autoRestart },
      });
    },
    
    async restartBots(slot) {
      return api.request(`/slots/${slot}/restart-bots`, { method: 'POST' });
    },
    
    async getBots(slot) {
      return api.request(`/slots/${slot}/bots`);
    },
    
    /**
     * Get git diff for a slot (modified files and changes)
     * @param {string} slot - Slot name
     */
    async diff(slot) {
      return api.request(`/slots/${slot}/diff`);
    },
    
    /**
     * Discard all local changes in a slot
     * @param {string} slot - Slot name
     */
    async discard(slot) {
      return api.request(`/slots/${slot}/discard`, { method: 'POST' });
    },
    
    /**
     * Get git dependencies status for a slot
     * @param {string} slot - Slot name
     * @returns {Promise<Object>} Dependencies with current/latest commits
     */
    async depsStatus(slot) {
      return api.request(`/slots/${slot}/deps`);
    },
    
    /**
     * Update git dependencies for a slot
     * @param {string} slot - Slot name
     * @param {Object} options - Update options
     * @param {string} options.package - Package name or 'all'
     * @param {boolean} options.autoRestart - Restart bots after update
     */
    async updateDeps(slot, { package: packageName = 'all', autoRestart = false } = {}) {
      return api.request(`/slots/${slot}/update-deps`, {
        method: 'POST',
        body: { package: packageName, autoRestart },
      });
    },
  },
  
  // ============================================================================
  // DREAMS (RunPod GPU Management)
  // ============================================================================
  
  dreams: {
    /**
     * Get comprehensive dreams status (aethera + RunPod)
     */
    async status() {
      return api.request('/dreams/status');
    },
    
    /**
     * Get dreams configuration status
     */
    async config() {
      return api.request('/dreams/config');
    },
    
    /**
     * Get aethera dreams status directly
     */
    async aetheraStatus() {
      return api.request('/dreams/aethera');
    },
    
    /**
     * Get RunPod endpoint health
     */
    async runpodHealth() {
      return api.request('/dreams/runpod');
    },
    
    /**
     * Force start the GPU (admin override)
     */
    async start() {
      return api.request('/dreams/start', { method: 'POST' });
    },
    
    /**
     * Force stop the GPU (admin override)
     * @param {string} [jobId] - Specific job ID to cancel (optional)
     */
    async stop(jobId = null) {
      return api.request('/dreams/stop', { 
        method: 'POST',
        body: jobId ? { jobId } : {},
      });
    },
    
    /**
     * Restart the GPU (stop then start)
     */
    async restart() {
      return api.request('/dreams/restart', { method: 'POST' });
    },
    
    /**
     * Get status of a specific RunPod job
     * @param {string} jobId - Job ID
     */
    async jobStatus(jobId) {
      return api.request(`/dreams/jobs/${jobId}`);
    },
    
    // === Two-Pod Architecture ===
    
    /**
     * Get comprehensive two-pod status (ComfyUI + DreamGen + Aethera)
     */
    async podsStatus() {
      return api.request('/dreams/pods/status');
    },
    
    /**
     * Start both pods in sequence
     */
    async podsStart() {
      return api.request('/dreams/pods/start', { method: 'POST' });
    },
    
    /**
     * Stop both pods
     */
    async podsStop() {
      return api.request('/dreams/pods/stop', { method: 'POST' });
    },
    
    /**
     * Update both pods (pull latest Docker images)
     */
    async podsUpdate() {
      return api.request('/dreams/pods/update', { method: 'POST' });
    },
    
    /**
     * Update ComfyUI pod only
     * @param {boolean} stopFirst - Stop pod before updating
     */
    async updateComfyUI(stopFirst = false) {
      return api.request('/dreams/pods/comfyui/update', { 
        method: 'POST',
        body: { stopFirst },
      });
    },
    
    /**
     * Update DreamGen pod only
     * @param {boolean} stopFirst - Stop pod before updating
     */
    async updateDreamGen(stopFirst = false) {
      return api.request('/dreams/pods/dreamgen/update', { 
        method: 'POST',
        body: { stopFirst },
      });
    },
    
    /**
     * Get ComfyUI registry status
     */
    async registry() {
      return api.request('/dreams/registry');
    },
    
    /**
     * Get saved generation state info
     */
    async stateInfo() {
      return api.request('/dreams/state');
    },
    
    /**
     * Clear saved generation state
     */
    async clearState() {
      return api.request('/dreams/state', { method: 'DELETE' });
    },
    
    /**
     * Terminate (delete) ComfyUI pod entirely
     * WARNING: This deletes the pod - you'll need to recreate it!
     */
    async terminateComfyUI() {
      return api.request('/dreams/pods/comfyui', { method: 'DELETE' });
    },
    
    /**
     * Terminate (delete) DreamGen pod entirely
     * WARNING: This deletes the pod - you'll need to recreate it!
     */
    async terminateDreamGen() {
      return api.request('/dreams/pods/dreamgen', { method: 'DELETE' });
    },
    
    /**
     * Get current error states
     */
    async getErrors() {
      return api.request('/dreams/errors');
    },
    
    /**
     * Clear error for a pod
     * @param {string} pod - 'comfyui', 'dreamgen', or 'general'
     */
    async clearError(pod) {
      return api.request(`/dreams/errors/${pod}`, { method: 'DELETE' });
    },
    
    /**
     * Clear all errors
     */
    async clearAllErrors() {
      return api.request('/dreams/errors', { method: 'DELETE' });
    },
    
    /**
     * Get billing info for dream pods
     * @param {string} period - 'day', 'week', 'month'
     */
    async billing(period = 'day') {
      return api.request(`/dreams/billing?period=${period}`);
    },
    
    // === Lifecycle Management ===
    
    /**
     * List all RunPod pods in the account
     * @param {boolean} refresh - Force cache refresh
     */
    async listPods(refresh = false) {
      return api.request(`/dreams/lifecycle/pods?refresh=${refresh}`);
    },
    
    /**
     * Discover ComfyUI and DreamGen pods by name
     */
    async discoverPods() {
      return api.request('/dreams/lifecycle/discover');
    },
    
    /**
     * Get pod configuration templates
     */
    async getTemplates() {
      return api.request('/dreams/lifecycle/templates');
    },
    
    /**
     * Ensure a pod exists and is running (create if needed)
     * @param {string} podType - 'comfyui' or 'dreamgen'
     * @param {Object} options - Options for pod management
     */
    async ensurePod(podType, options = {}) {
      return api.request(`/dreams/lifecycle/ensure/${podType}`, {
        method: 'POST',
        body: options,
      });
    },
    
    /**
     * Force create a new pod from template
     * @param {string} podType - 'comfyui' or 'dreamgen'
     * @param {Object} secretOverrides - Secret overrides
     */
    async createPod(podType, secretOverrides = {}) {
      return api.request(`/dreams/lifecycle/create/${podType}`, {
        method: 'POST',
        body: { secretOverrides },
      });
    },
    
    /**
     * Get secrets configuration status (no actual secrets)
     */
    async secretsStatus() {
      return api.request('/dreams/secrets-status');
    },
  },
  
  // ============================================================================
  // BLOG
  // ============================================================================
  
  blog: {
    /**
     * List posts with pagination and filtering
     * @param {Object} options - Query options
     * @param {number} options.page - Page number (1-indexed)
     * @param {number} options.perPage - Items per page
     * @param {string} options.filter - 'all', 'published', or 'drafts'
     * @param {boolean} options.includeContent - Include full content
     */
    async list({ page = 1, perPage = 20, filter = 'all', includeContent = false } = {}) {
      const params = new URLSearchParams({
        page: page.toString(),
        perPage: perPage.toString(),
        filter,
        includeContent: includeContent.toString(),
      });
      return api.request(`/blog/posts?${params}`);
    },
    
    /**
     * Get a single post by ID
     * @param {number} id - Post ID
     */
    async get(id) {
      return api.request(`/blog/posts/${id}`);
    },
    
    /**
     * Create a new post
     * @param {Object} postData - Post data
     */
    async create(postData) {
      return api.request('/blog/posts', {
        method: 'POST',
        body: postData,
      });
    },
    
    /**
     * Update an existing post
     * @param {number} id - Post ID
     * @param {Object} updates - Fields to update
     */
    async update(id, updates) {
      return api.request(`/blog/posts/${id}`, {
        method: 'PUT',
        body: updates,
      });
    },
    
    /**
     * Delete a post
     * @param {number} id - Post ID
     */
    async delete(id) {
      return api.request(`/blog/posts/${id}`, {
        method: 'DELETE',
      });
    },
    
    /**
     * Publish a post
     * @param {number} id - Post ID
     */
    async publish(id) {
      return api.request(`/blog/posts/${id}/publish`, {
        method: 'POST',
      });
    },
    
    /**
     * Unpublish a post (revert to draft)
     * @param {number} id - Post ID
     */
    async unpublish(id) {
      return api.request(`/blog/posts/${id}/unpublish`, {
        method: 'POST',
      });
    },
    
    /**
     * Preview markdown content as HTML
     * @param {string} content - Markdown content
     */
    async preview(content) {
      return api.request('/blog/preview', {
        method: 'POST',
        body: { content },
      });
    },
    
    /**
     * Get blog statistics
     */
    async stats() {
      return api.request('/blog/stats');
    },
    
    /**
     * Get blog status (database accessibility)
     */
    async status() {
      return api.request('/blog/status');
    },
  },
  
  // ============================================================================
  // IRC (placeholder - Phase 6)
  // ============================================================================
  
  irc: {
    async queue() {
      // TODO: Implement in Phase 6
      return { fragments: [] };
    },
  },
  
  // ============================================================================
  // USAGE TRACKING
  // ============================================================================
  
  usage: {
    /**
     * Sync usage data from trace files
     * @param {boolean} fullRescan - Whether to do a full rescan (vs incremental)
     */
    async sync(fullRescan = false) {
      return api.request('/usage/sync', {
        method: 'POST',
        body: { fullRescan },
      });
    },
    
    /**
     * Get usage summary for all bots
     * @param {string} period - 'day', 'week', 'month', or 'all'
     */
    async summary(period = 'day') {
      return api.request(`/usage/summary?period=${period}`);
    },
    
    /**
     * Get detailed usage for a specific bot
     * @param {string} botName - Bot name
     * @param {string} period - 'day', 'week', 'month', or 'all'
     */
    async bot(botName, period = 'day') {
      return api.request(`/usage/bot/${encodeURIComponent(botName)}?period=${period}`);
    },
    
    /**
     * Get recent usage records
     * @param {number} limit - Number of records to return
     */
    async recent(limit = 50) {
      return api.request(`/usage/recent?limit=${limit}`);
    },
  },
  
  // ============================================================================
  // SERVER MONITORING
  // ============================================================================
  
  server: {
    /**
     * Get all system metrics (CPU, memory, disk, load)
     */
    async metrics() {
      return api.request('/server/metrics');
    },
    
    /**
     * Get CPU usage
     */
    async cpu() {
      return api.request('/server/cpu');
    },
    
    /**
     * Get memory usage
     */
    async memory() {
      return api.request('/server/memory');
    },
    
    /**
     * Get disk usage
     */
    async disk() {
      return api.request('/server/disk');
    },
    
    /**
     * Get load average
     */
    async load() {
      return api.request('/server/load');
    },
    
    /**
     * Get system uptime
     */
    async uptime() {
      return api.request('/server/uptime');
    },
    
    /**
     * Check network connectivity
     */
    async network() {
      return api.request('/server/network');
    },
    
    /**
     * Ping a specific host
     * @param {string} host - Host to ping
     */
    async ping(host = '8.8.8.8') {
      return api.request('/server/ping', {
        method: 'POST',
        body: { host },
      });
    },
    
    /**
     * Get log sizes (journal, docker)
     */
    async logSizes() {
      return api.request('/server/logs/sizes');
    },
    
    /**
     * Trim journal logs
     * @param {Object} options
     * @param {string} options.size - Max size (e.g., '500M')
     * @param {string} options.time - Max age (e.g., '7d')
     */
    async trimJournal(options = {}) {
      return api.request('/server/logs/trim/journal', {
        method: 'POST',
        body: options,
      });
    },
    
    /**
     * Prune Docker system
     */
    async pruneDocker() {
      return api.request('/server/logs/trim/docker', {
        method: 'POST',
      });
    },
    
    /**
     * Get all service health statuses
     */
    async services() {
      return api.request('/server/services');
    },
    
    /**
     * Get process info (zombies, active child processes)
     */
    async processes() {
      return api.request('/server/processes');
    },
    
    /**
     * Force cleanup of zombie processes
     */
    async cleanupZombies() {
      return api.request('/server/processes/cleanup', {
        method: 'POST',
      });
    },
  },
};

// Export for use in other scripts
window.api = api;

