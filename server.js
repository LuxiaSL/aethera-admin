// server.js - Aethera Admin Panel
// Personal server management for aethera, dreams, chapterx bots

require('dotenv').config();

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const config = require('./config');
const { loadSessions } = require('./lib/auth/sessions');
const { userExists, createUser } = require('./lib/auth/users');

// Route modules
const authRoutes = require('./routes/auth');
const botsRoutes = require('./routes/bots');
const servicesRoutes = require('./routes/services');
const slotsRoutes = require('./routes/slots');
const dreamsRoutes = require('./routes/dreams');
const blogRoutes = require('./routes/blog');
const serverRoutes = require('./routes/server');

const app = express();

// ============================================================================
// EXPRESS SETUP
// ============================================================================

app.use(express.json());
app.use(cookieParser());

// Trust proxy for correct IP detection behind reverse proxy
app.set('trust proxy', 1);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================================
// API ROUTES
// ============================================================================

app.use('/api/auth', authRoutes);
app.use('/api/bots', botsRoutes);
app.use('/api/services', servicesRoutes);
app.use('/api/slots', slotsRoutes);
app.use('/api/dreams', dreamsRoutes);
app.use('/api/blog', blogRoutes);
app.use('/api/server', serverRoutes);

// Placeholder routes - will be implemented in later phases
// app.use('/api/irc', require('./routes/irc'));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version: require('./package.json').version,
  });
});

// Serve the SPA for all other routes (Express 5 syntax)
app.get('/*splat', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ============================================================================
// STARTUP
// ============================================================================

async function startup() {
  console.log('');
  console.log('='.repeat(60));
  console.log('  æthera admin panel');
  console.log('='.repeat(60));
  
  // Load sessions from file
  loadSessions();
  console.log('  ✓ Sessions loaded');
  
  // Check if user exists, if not create default admin
  if (!userExists()) {
    console.log('');
    console.log('  ⚠ No user configured - creating default admin...');
    
    // Generate a random initial password
    const initialPassword = crypto.randomBytes(12).toString('base64').slice(0, 16);
    
    try {
      await createUser('admin', initialPassword);
      console.log('');
      console.log('  ┌─────────────────────────────────────────────┐');
      console.log('  │  Default admin account created:             │');
      console.log('  │                                             │');
      console.log(`  │    Username: admin                          │`);
      console.log(`  │    Password: ${initialPassword.padEnd(28)}│`);
      console.log('  │                                             │');
      console.log('  │  ⚠ Change this password after first login! │');
      console.log('  └─────────────────────────────────────────────┘');
      console.log('');
    } catch (e) {
      console.error('  ✗ Failed to create admin user:', e.message);
    }
  } else {
    console.log('  ✓ User configured');
  }
  
  // Start server
  app.listen(config.PORT, config.HOST, () => {
    console.log('');
    console.log(`  ✓ Server running at http://${config.HOST}:${config.PORT}`);
    console.log('');
    console.log('  Paths:');
    console.log(`    Base:     ${config.BASE_PATH}`);
    console.log(`    Core:     ${config.CORE_PATH}`);
    console.log(`    Bots:     ${config.BOTS_PATH}`);
    console.log(`    ChapterX: ${config.CHAPTERX_PATH}`);
    console.log('');
    console.log('  Integrations:');
    console.log(`    Aethera:  ${config.AETHERA_API_URL}`);
    console.log(`    Blog DB:  ${config.BLOG_DB}`);
    console.log(`    RunPod:   ${config.RUNPOD_API_KEY ? '✓ Configured' : '✗ Not configured'}`);
    console.log('');
    console.log('='.repeat(60));
    console.log('');
  });
}

startup().catch(err => {
  console.error('Startup failed:', err);
  process.exit(1);
});

