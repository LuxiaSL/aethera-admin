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
};

// Export for use in other scripts
window.api = api;

