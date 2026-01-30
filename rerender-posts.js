#!/usr/bin/env node
/**
 * Re-render all posts' HTML content
 * 
 * Use this after updating the markdown renderer to regenerate
 * all posts' content_html from their markdown content.
 * 
 * Usage:
 *   node rerender-posts.js           # Re-render all posts
 *   node rerender-posts.js --dry-run # Preview without saving
 */

const { getDb, renderMarkdownSimple } = require('./lib/content/blog');

function rerenderPosts(dryRun = false) {
  const db = getDb();
  
  // Get all posts
  const posts = db.prepare(`
    SELECT id, title, slug, content 
    FROM post 
    ORDER BY id
  `).all();
  
  console.log(`\n📝 Re-rendering ${posts.length} posts...\n`);
  
  let updated = 0;
  
  for (const post of posts) {
    const newHtml = renderMarkdownSimple(post.content);
    
    // Count segments and blockquotes for info
    const segments = (newHtml.match(/post-segment/g) || []).length;
    const blockquotes = (newHtml.match(/<blockquote/g) || []).length;
    
    console.log(`  ${post.id}. ${post.title}`);
    console.log(`     slug: ${post.slug}`);
    console.log(`     segments: ${segments}, blockquotes: ${blockquotes}`);
    
    if (!dryRun) {
      const now = new Date().toISOString();
      db.prepare(`
        UPDATE post 
        SET content_html = ?, updated_at = ?
        WHERE id = ?
      `).run(newHtml, now, post.id);
      updated++;
    }
    
    console.log(`     ${dryRun ? '(dry run - not saved)' : '✓ updated'}`);
    console.log('');
  }
  
  if (dryRun) {
    console.log(`\n🔍 Dry run complete. ${posts.length} posts would be updated.`);
    console.log('   Run without --dry-run to apply changes.\n');
  } else {
    console.log(`\n✅ Re-rendered ${updated} posts.\n`);
  }
}

// Main
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

rerenderPosts(dryRun);

