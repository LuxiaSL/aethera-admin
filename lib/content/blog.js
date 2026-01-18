// lib/content/blog.js - Blog content management via SQLite
// Direct access to the aethera blog database for admin operations

const Database = require('better-sqlite3');
const path = require('path');
const config = require('../../config');

// ============================================================================
// DATABASE CONNECTION
// ============================================================================

let db = null;

/**
 * Get the database connection (lazy initialization)
 * @returns {Database} SQLite database connection
 */
function getDb() {
  if (!db) {
    try {
      db = new Database(config.BLOG_DB, { readonly: false });
      // Enable WAL mode for better concurrent access
      db.pragma('journal_mode = WAL');
    } catch (error) {
      console.error('Failed to connect to blog database:', error.message);
      throw new Error(`Cannot connect to blog database: ${error.message}`);
    }
  }
  return db;
}

/**
 * Check if database is accessible
 * @returns {boolean}
 */
function isDatabaseAvailable() {
  try {
    const testDb = new Database(config.BLOG_DB, { readonly: true });
    testDb.close();
    return true;
  } catch (e) {
    return false;
  }
}

// ============================================================================
// POST QUERIES
// ============================================================================

/**
 * List all posts (both published and drafts)
 * @param {Object} options - Query options
 * @param {number} options.page - Page number (1-indexed)
 * @param {number} options.perPage - Items per page
 * @param {boolean} options.includeContent - Include full content (default false for list)
 * @param {string} options.filter - Filter: 'all', 'published', 'drafts'
 * @returns {Object} { posts, total, page, perPage, hasNext }
 */
function listPosts({ page = 1, perPage = 20, includeContent = false, filter = 'all' } = {}) {
  const db = getDb();
  const offset = (page - 1) * perPage;
  
  // Build WHERE clause based on filter
  let whereClause = '';
  if (filter === 'published') {
    whereClause = 'WHERE published = 1';
  } else if (filter === 'drafts') {
    whereClause = 'WHERE published = 0';
  }
  
  // Get total count
  const countQuery = `SELECT COUNT(*) as total FROM post ${whereClause}`;
  const { total } = db.prepare(countQuery).get();
  
  // Build SELECT fields
  const fields = includeContent
    ? 'id, title, slug, author, content, content_html, excerpt, published, created_at, updated_at, tags, categories, canonical_url, license'
    : 'id, title, slug, author, excerpt, published, created_at, updated_at, tags, categories';
  
  // Get posts
  const query = `
    SELECT ${fields}
    FROM post
    ${whereClause}
    ORDER BY updated_at DESC
    LIMIT ? OFFSET ?
  `;
  const posts = db.prepare(query).all(perPage, offset);
  
  // Convert SQLite integers to booleans for published field
  const normalizedPosts = posts.map(normalizePost);
  
  return {
    posts: normalizedPosts,
    total,
    page,
    perPage,
    hasNext: offset + posts.length < total,
  };
}

/**
 * Get a single post by ID
 * @param {number} id - Post ID
 * @returns {Object|null} Post object or null if not found
 */
function getPostById(id) {
  const db = getDb();
  const query = `
    SELECT id, title, slug, author, content, content_html, excerpt, published,
           created_at, updated_at, tags, categories, canonical_url, license
    FROM post
    WHERE id = ?
  `;
  const post = db.prepare(query).get(id);
  return post ? normalizePost(post) : null;
}

/**
 * Get a single post by slug
 * @param {string} slug - Post slug
 * @returns {Object|null} Post object or null if not found
 */
function getPostBySlug(slug) {
  const db = getDb();
  const query = `
    SELECT id, title, slug, author, content, content_html, excerpt, published,
           created_at, updated_at, tags, categories, canonical_url, license
    FROM post
    WHERE slug = ?
  `;
  const post = db.prepare(query).get(slug);
  return post ? normalizePost(post) : null;
}

/**
 * Create a new post
 * @param {Object} postData - Post data
 * @returns {Object} Created post
 */
function createPost({
  title,
  content,
  author = 'luxia',
  tags = null,
  categories = null,
  canonicalUrl = null,
  license = 'CC BY 4.0',
  published = false,
  slug = null,
}) {
  const db = getDb();
  
  // Generate slug if not provided
  if (!slug) {
    slug = generateUniqueSlug(title);
  }
  
  // Render markdown to HTML (simplified - actual rendering happens server-side on aethera)
  // For now, we store raw markdown and let aethera render on display
  // However, we should render HTML here for preview purposes
  const contentHtml = renderMarkdownSimple(content);
  
  // Generate excerpt
  const excerpt = createExcerpt(content);
  
  const now = new Date().toISOString();
  
  const query = `
    INSERT INTO post (title, slug, author, content, content_html, excerpt, published, created_at, updated_at, tags, categories, canonical_url, license)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  
  const result = db.prepare(query).run(
    title,
    slug,
    author,
    content,
    contentHtml,
    excerpt,
    published ? 1 : 0,
    now,
    now,
    tags,
    categories,
    canonicalUrl,
    license
  );
  
  return getPostById(result.lastInsertRowid);
}

/**
 * Update an existing post
 * @param {number} id - Post ID
 * @param {Object} updates - Fields to update
 * @returns {Object} Updated post
 */
function updatePost(id, {
  title,
  content,
  author,
  tags,
  categories,
  canonicalUrl,
  license,
  published,
}) {
  const db = getDb();
  
  // Get existing post
  const existing = getPostById(id);
  if (!existing) {
    throw new Error(`Post with ID ${id} not found`);
  }
  
  // Merge updates with existing values
  const updatedTitle = title !== undefined ? title : existing.title;
  const updatedContent = content !== undefined ? content : existing.content;
  const updatedAuthor = author !== undefined ? author : existing.author;
  const updatedTags = tags !== undefined ? tags : existing.tags;
  const updatedCategories = categories !== undefined ? categories : existing.categories;
  const updatedCanonicalUrl = canonicalUrl !== undefined ? canonicalUrl : existing.canonicalUrl;
  const updatedLicense = license !== undefined ? license : existing.license;
  const updatedPublished = published !== undefined ? published : existing.published;
  
  // Re-render content if changed
  let contentHtml = existing.contentHtml;
  let excerpt = existing.excerpt;
  if (content !== undefined) {
    contentHtml = renderMarkdownSimple(updatedContent);
    excerpt = createExcerpt(updatedContent);
  }
  
  const now = new Date().toISOString();
  
  const query = `
    UPDATE post
    SET title = ?, content = ?, content_html = ?, excerpt = ?, author = ?,
        tags = ?, categories = ?, canonical_url = ?, license = ?, published = ?, updated_at = ?
    WHERE id = ?
  `;
  
  db.prepare(query).run(
    updatedTitle,
    updatedContent,
    contentHtml,
    excerpt,
    updatedAuthor,
    updatedTags,
    updatedCategories,
    updatedCanonicalUrl,
    updatedLicense,
    updatedPublished ? 1 : 0,
    now,
    id
  );
  
  return getPostById(id);
}

/**
 * Delete a post
 * @param {number} id - Post ID
 * @returns {boolean} Success
 */
function deletePost(id) {
  const db = getDb();
  
  // First delete associated comments
  db.prepare('DELETE FROM comment WHERE post_id = ?').run(id);
  
  // Then delete the post
  const result = db.prepare('DELETE FROM post WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * Publish a post
 * @param {number} id - Post ID
 * @returns {Object} Updated post
 */
function publishPost(id) {
  return updatePost(id, { published: true });
}

/**
 * Unpublish a post (revert to draft)
 * @param {number} id - Post ID
 * @returns {Object} Updated post
 */
function unpublishPost(id) {
  return updatePost(id, { published: false });
}

// ============================================================================
// STATISTICS
// ============================================================================

/**
 * Get blog statistics
 * @returns {Object} Stats
 */
function getStats() {
  const db = getDb();
  
  const total = db.prepare('SELECT COUNT(*) as count FROM post').get().count;
  const published = db.prepare('SELECT COUNT(*) as count FROM post WHERE published = 1').get().count;
  const drafts = db.prepare('SELECT COUNT(*) as count FROM post WHERE published = 0').get().count;
  const comments = db.prepare('SELECT COUNT(*) as count FROM comment').get().count;
  
  // Recent activity
  const recentPost = db.prepare(`
    SELECT title, slug, updated_at 
    FROM post 
    ORDER BY updated_at DESC 
    LIMIT 1
  `).get();
  
  return {
    total,
    published,
    drafts,
    comments,
    recentPost: recentPost || null,
  };
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Normalize a post object (convert SQLite types to JS types)
 * @param {Object} post - Raw post from SQLite
 * @returns {Object} Normalized post
 */
function normalizePost(post) {
  if (!post) return null;
  return {
    ...post,
    id: post.id,
    published: Boolean(post.published),
    createdAt: post.created_at,
    updatedAt: post.updated_at,
    contentHtml: post.content_html,
    canonicalUrl: post.canonical_url,
    // Remove snake_case versions
    created_at: undefined,
    updated_at: undefined,
    content_html: undefined,
    canonical_url: undefined,
  };
}

/**
 * Generate a unique slug from a title
 * @param {string} title - Post title
 * @returns {string} Unique slug
 */
function generateUniqueSlug(title) {
  const db = getDb();
  
  // Basic slugify
  let baseSlug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  
  if (!baseSlug) baseSlug = 'post';
  
  let slug = baseSlug;
  let counter = 1;
  
  // Check for uniqueness
  while (true) {
    const existing = db.prepare('SELECT id FROM post WHERE slug = ?').get(slug);
    if (!existing) break;
    counter++;
    slug = `${baseSlug}-${counter}`;
  }
  
  return slug;
}

/**
 * Create an excerpt from content
 * @param {string} content - Markdown content
 * @param {number} maxLength - Maximum length
 * @returns {string|null} Excerpt
 */
function createExcerpt(content, maxLength = 160) {
  if (!content) return null;
  
  // Get first paragraph
  const firstPara = content.trim().split('\n\n')[0] || '';
  
  // Remove markdown headings
  const cleaned = firstPara
    .split('\n')
    .map(line => line.replace(/^#{1,6}\s+/, ''))
    .filter(line => line.trim())
    .join(' ');
  
  const excerpt = cleaned.slice(0, maxLength).trim();
  return excerpt || null;
}

/**
 * Simple markdown to HTML renderer
 * Note: This is a simplified version. Full rendering is done by aethera's markdown_it
 * @param {string} markdown - Markdown content
 * @returns {string} HTML content
 */
function renderMarkdownSimple(markdown) {
  if (!markdown) return '';
  
  // This is a basic conversion - the real rendering happens in aethera
  // We do this so previews work in the admin panel
  let html = markdown;
  
  // Headers
  html = html.replace(/^### (.*$)/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gm, '<h1>$1</h1>');
  
  // Bold and italic
  html = html.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  
  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  
  // Images
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');
  
  // Paragraphs (split by double newlines)
  html = html.split('\n\n').map(para => {
    para = para.trim();
    if (!para) return '';
    // Don't wrap if already a block element
    if (para.startsWith('<h') || para.startsWith('<pre') || para.startsWith('<ul') || para.startsWith('<ol')) {
      return para;
    }
    return `<p>${para.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
  
  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr>');
  
  return html;
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Database
  isDatabaseAvailable,
  getDb,
  
  // Posts
  listPosts,
  getPostById,
  getPostBySlug,
  createPost,
  updatePost,
  deletePost,
  publishPost,
  unpublishPost,
  
  // Stats
  getStats,
  
  // Helpers (exported for testing)
  generateUniqueSlug,
  createExcerpt,
  renderMarkdownSimple,
};

