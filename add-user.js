#!/usr/bin/env node
/**
 * Add User CLI for æthera Admin Panel
 * 
 * Usage:
 *   node add-user.js <username> <password>
 *   node add-user.js --list              # List all users
 *   node add-user.js --delete <username> # Delete a user
 * 
 * Examples:
 *   node add-user.js testuser mypassword123
 *   node add-user.js --list
 */

const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const SALT_ROUNDS = 12;

function loadUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) {
      return [];
    }
    const data = fs.readFileSync(USERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading users:', error.message);
    return [];
  }
}

function saveUsers(users) {
  const dir = path.dirname(USERS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2) + '\n');
}

async function addUser(username, password) {
  if (!username || !password) {
    console.error('❌ Usage: node add-user.js <username> <password>');
    process.exit(1);
  }

  if (username.length < 3) {
    console.error('❌ Username must be at least 3 characters');
    process.exit(1);
  }

  if (password.length < 4) {
    console.error('❌ Password must be at least 4 characters');
    process.exit(1);
  }

  const users = loadUsers();
  
  // Check if user exists
  const existingIndex = users.findIndex(u => u.username === username);
  
  // Hash password
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const now = new Date().toISOString();
  
  if (existingIndex !== -1) {
    // Update existing user
    users[existingIndex].passwordHash = passwordHash;
    users[existingIndex].passwordChangedAt = now;
    saveUsers(users);
    console.log(`✅ Updated password for user: ${username}`);
  } else {
    // Add new user
    users.push({
      username,
      passwordHash,
      createdAt: now,
      passwordChangedAt: now
    });
    saveUsers(users);
    console.log(`✅ Created user: ${username}`);
  }
}

function listUsers() {
  const users = loadUsers();
  
  if (users.length === 0) {
    console.log('📭 No users found.');
    return;
  }
  
  console.log(`\n👥 Users (${users.length} total):\n`);
  for (const user of users) {
    const created = new Date(user.createdAt).toLocaleDateString();
    console.log(`  • ${user.username} (created: ${created})`);
  }
  console.log('');
}

function deleteUser(username) {
  if (!username) {
    console.error('❌ Usage: node add-user.js --delete <username>');
    process.exit(1);
  }

  const users = loadUsers();
  const index = users.findIndex(u => u.username === username);
  
  if (index === -1) {
    console.error(`❌ User not found: ${username}`);
    process.exit(1);
  }
  
  users.splice(index, 1);
  saveUsers(users);
  console.log(`✅ Deleted user: ${username}`);
}

function printHelp() {
  console.log(`
æthera Admin - Add User CLI

Usage:
  node add-user.js <username> <password>   Add or update a user
  node add-user.js --list                  List all users
  node add-user.js --delete <username>     Delete a user
  node add-user.js --help                  Show this help

Examples:
  node add-user.js testuser mypassword123
  node add-user.js admin newpassword
  node add-user.js --list
  node add-user.js --delete olduser
`);
}

// Main
const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  printHelp();
  process.exit(0);
}

if (args[0] === '--list') {
  listUsers();
  process.exit(0);
}

if (args[0] === '--delete') {
  deleteUser(args[1]);
  process.exit(0);
}

// Add user
addUser(args[0], args[1]);

