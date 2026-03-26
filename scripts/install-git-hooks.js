#!/usr/bin/env node

/**
 * Git Hooks Installation Script
 * 
 * This script copies git hooks from config/git-hooks/ to .git/hooks/
 * It runs automatically after npm install via the postinstall script.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, '..');
const gitHooksSourceDir = path.join(rootDir, 'config', 'git-hooks');
const gitHooksTargetDir = path.join(rootDir, '.git', 'hooks');

// List of hook files to install
const hooksToInstall = ['pre-commit'];

function installGitHooks() {
  console.log('\n🔧 Installing git hooks...\n');

  // Check if .git directory exists
  if (!fs.existsSync(path.join(rootDir, '.git'))) {
    console.log('⚠️  .git directory not found. Skipping git hooks installation.');
    console.log('   If this is a git repository, run: git init\n');
    return;
  }

  // Create hooks directory if it doesn't exist
  if (!fs.existsSync(gitHooksTargetDir)) {
    fs.mkdirSync(gitHooksTargetDir, { recursive: true });
    console.log('📁 Created .git/hooks directory');
  }

  let installedCount = 0;

  for (const hookName of hooksToInstall) {
    const sourcePath = path.join(gitHooksSourceDir, hookName);
    const targetPath = path.join(gitHooksTargetDir, hookName);

    if (!fs.existsSync(sourcePath)) {
      console.log(`⚠️  Source hook not found: ${sourcePath}`);
      continue;
    }

    try {
      // Copy the hook file
      fs.copyFileSync(sourcePath, targetPath);

      // Make the hook executable (chmod +x)
      // On Windows, this is a no-op but doesn't cause errors
      try {
        fs.chmodSync(targetPath, 0o755);
      } catch (chmodError) {
        // chmod may fail on Windows, which is fine
      }

      console.log(`✅ Installed: ${hookName}`);
      installedCount++;
    } catch (error) {
      console.log(`❌ Failed to install ${hookName}: ${error.message}`);
    }
  }

  if (installedCount > 0) {
    console.log(`\n✨ Successfully installed ${installedCount} git hook(s)\n`);
  } else {
    console.log('\n⚠️  No git hooks were installed\n');
  }
}

// Run the installation
installGitHooks();