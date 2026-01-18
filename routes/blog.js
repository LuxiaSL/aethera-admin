// routes/blog.js - Blog management API endpoints
// CRUD operations for blog posts via direct SQLite access

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/require-auth');
const blog = require('../lib/content/blog');

// All blog routes require authentication
router.use(requireAuth);

// ============================================================================
// POSTS
// ============================================================================

/**
 * GET /api/blog/posts
 * List all posts with pagination and filtering
 */
router.get('/posts', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const perPage = Math.min(parseInt(req.query.perPage) || 20, 100);
    const filter = req.query.filter || 'all'; // 'all', 'published', 'drafts'
    const includeContent = req.query.includeContent === 'true';
    
    const result = blog.listPosts({ page, perPage, filter, includeContent });
    res.json(result);
  } catch (error) {
    console.error('Error listing posts:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/blog/posts/:id
 * Get a single post by ID
 */
router.get('/posts/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid post ID' });
    }
    
    const post = blog.getPostById(id);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    res.json({ post });
  } catch (error) {
    console.error('Error getting post:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/blog/posts
 * Create a new post
 */
router.post('/posts', async (req, res) => {
  try {
    const {
      title,
      content,
      author = 'luxia',
      tags,
      categories,
      canonicalUrl,
      license = 'CC BY 4.0',
      published = false,
    } = req.body;
    
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title is required' });
    }
    
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Content is required' });
    }
    
    const post = blog.createPost({
      title: title.trim(),
      content,
      author,
      tags,
      categories,
      canonicalUrl,
      license,
      published,
    });
    
    res.status(201).json({ post, message: 'Post created successfully' });
  } catch (error) {
    console.error('Error creating post:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/blog/posts/:id
 * Update an existing post
 */
router.put('/posts/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid post ID' });
    }
    
    const {
      title,
      content,
      author,
      tags,
      categories,
      canonicalUrl,
      license,
      published,
    } = req.body;
    
    const post = blog.updatePost(id, {
      title,
      content,
      author,
      tags,
      categories,
      canonicalUrl,
      license,
      published,
    });
    
    res.json({ post, message: 'Post updated successfully' });
  } catch (error) {
    console.error('Error updating post:', error);
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/blog/posts/:id
 * Delete a post
 */
router.delete('/posts/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid post ID' });
    }
    
    const deleted = blog.deletePost(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    res.json({ success: true, message: 'Post deleted successfully' });
  } catch (error) {
    console.error('Error deleting post:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// PUBLISH/UNPUBLISH
// ============================================================================

/**
 * POST /api/blog/posts/:id/publish
 * Publish a post
 */
router.post('/posts/:id/publish', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid post ID' });
    }
    
    const post = blog.publishPost(id);
    res.json({ post, message: 'Post published successfully' });
  } catch (error) {
    console.error('Error publishing post:', error);
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/blog/posts/:id/unpublish
 * Unpublish a post (revert to draft)
 */
router.post('/posts/:id/unpublish', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid post ID' });
    }
    
    const post = blog.unpublishPost(id);
    res.json({ post, message: 'Post unpublished (reverted to draft)' });
  } catch (error) {
    console.error('Error unpublishing post:', error);
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// PREVIEW
// ============================================================================

/**
 * POST /api/blog/preview
 * Preview markdown content as HTML (without saving)
 */
router.post('/preview', async (req, res) => {
  try {
    const { content } = req.body;
    
    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }
    
    const html = blog.renderMarkdownSimple(content);
    res.json({ html });
  } catch (error) {
    console.error('Error previewing content:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// STATS
// ============================================================================

/**
 * GET /api/blog/stats
 * Get blog statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = blog.getStats();
    res.json(stats);
  } catch (error) {
    console.error('Error getting blog stats:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/blog/status
 * Get blog database status (for health checks)
 */
router.get('/status', async (req, res) => {
  try {
    const available = blog.isDatabaseAvailable();
    
    if (!available) {
      return res.status(503).json({
        available: false,
        error: 'Blog database not accessible',
      });
    }
    
    const stats = blog.getStats();
    res.json({
      available: true,
      ...stats,
    });
  } catch (error) {
    res.status(500).json({
      available: false,
      error: error.message,
    });
  }
});

module.exports = router;

