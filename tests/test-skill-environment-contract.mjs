/**
 * Contract tests for SkillLoader.buildSkillEnvironment().
 *
 * These tests define the Loader -> Runner environment boundary without
 * invoking external tools, databases, or live skill execution.
 *
 * Usage:
 *   node tests/test-skill-environment-contract.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import SkillLoader from '../lib/skill-loader.js';

function snapshotEnv(keys) {
  return Object.fromEntries(keys.map(key => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function withTempRuntimeEnv(callback) {
  const envKeys = ['DATA_BASE_PATH', 'SKILLS_BASE_PATH', 'FONTS_BASE_PATH', 'API_BASE'];
  const snapshot = snapshotEnv(envKeys);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-env-contract-'));

  process.env.DATA_BASE_PATH = path.join(tempRoot, 'data');
  process.env.SKILLS_BASE_PATH = path.join(tempRoot, 'skills');
  process.env.FONTS_BASE_PATH = path.join(tempRoot, 'fonts');
  process.env.API_BASE = 'http://127.0.0.1:3017';

  try {
    fs.mkdirSync(process.env.DATA_BASE_PATH, { recursive: true });
    fs.mkdirSync(process.env.SKILLS_BASE_PATH, { recursive: true });
    fs.mkdirSync(process.env.FONTS_BASE_PATH, { recursive: true });
    return callback(tempRoot);
  } finally {
    restoreEnv(snapshot);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function testBuildsCompleteSkillRuntimeEnv() {
  withTempRuntimeEnv((tempRoot) => {
    const loader = new SkillLoader({});
    const workingDirectory = path.join(tempRoot, 'work', 'user-1', 'task-1');
    const env = loader.buildSkillEnvironment(
      'demo-skill',
      {
        url: 'https://example.test',
        retry_count: 3,
        user_access_token: 'must-not-shadow-user-token',
      },
      'demo-skill',
      'index.js',
      {
        userId: 'user-1',
        expertId: 'expert-1',
        accessToken: 'token-1',
        workingDirectory,
        isAdmin: true,
        isSkillCreator: true,
      },
      {
        allowed_node_modules: ['fs', 'path'],
        allowed_python_packages: ['pypdf'],
      },
      {
        vm_execution: 12,
        python_execution: 240,
      }
    );

    assert.equal(env.SKILL_ID, 'demo-skill');
    assert.equal(env.SKILL_PATH, path.join(process.env.SKILLS_BASE_PATH, 'demo-skill'));
    assert.equal(env.SCRIPT_PATH, 'index.js');
    assert.equal(env.DATA_BASE_PATH, process.env.DATA_BASE_PATH);
    assert.equal(env.SKILLS_BASE_PATH, process.env.SKILLS_BASE_PATH);
    assert.equal(env.FONTS_BASE_PATH, process.env.FONTS_BASE_PATH);
    assert.equal(env.SKILL_CONFIG, JSON.stringify({
      url: 'https://example.test',
      retry_count: 3,
      user_access_token: 'must-not-shadow-user-token',
    }));

    assert.equal(env.USER_ACCESS_TOKEN, 'token-1');
    assert.equal(env.USER_ID, 'user-1');
    assert.equal(env.EXPERT_ID, 'expert-1');
    assert.equal(env.IS_ADMIN, 'true');
    assert.equal(env.IS_SKILL_CREATOR, 'true');
    assert.equal(env.API_BASE, 'http://127.0.0.1:3017');
    assert.equal(env.WORKING_DIRECTORY, workingDirectory);
    assert.equal(env.PROJECT_ROOT, process.cwd());
    assert.equal(env.NODE_OPTIONS, '--max-old-space-size=128');

    assert.deepEqual(JSON.parse(env.ALLOWED_NODE_MODULES), ['fs', 'path']);
    assert.deepEqual(JSON.parse(env.ALLOWED_PYTHON_PACKAGES), ['pypdf']);
    assert.equal(env.VM_TIMEOUT, '12000');
    assert.equal(env.PYTHON_TIMEOUT, '240000');

    assert.equal(env.SKILL_URL, 'https://example.test');
    assert.equal(env.SKILL_RETRY_COUNT, '3');
    assert.equal(env.SKILL_USER_ACCESS_TOKEN, 'must-not-shadow-user-token');
    assert.equal(env.INTERNAL_API_SECRET, undefined, 'internal secrets must not be inherited from system env by default');
  });
}

function testRejectsRelativeWorkingDirectory() {
  withTempRuntimeEnv(() => {
    const loader = new SkillLoader({});

    assert.throws(
      () => loader.buildSkillEnvironment(
        'demo-skill',
        {},
        'demo-skill',
        'index.js',
        {
          userId: 'user-1',
          workingDirectory: 'relative/path',
        }
      ),
      /工作目录必须是绝对路径/
    );
  });
}

function testRequiresSourcePath() {
  withTempRuntimeEnv(() => {
    const loader = new SkillLoader({});

    assert.throws(
      () => loader.buildSkillEnvironment('demo-skill', {}, null),
      /has no source_path configured/
    );
  });
}

function testOptionalContractFieldsStayAbsentWhenNotConfigured() {
  withTempRuntimeEnv(() => {
    const loader = new SkillLoader({});
    const env = loader.buildSkillEnvironment(
      'demo-skill',
      {},
      'demo-skill',
      'index.js',
      {
        userId: 'user-1',
      }
    );

    assert.equal(env.WORKING_DIRECTORY, '');
    assert.equal(env.USER_ACCESS_TOKEN, '');
    assert.equal(env.EXPERT_ID, '');
    assert.equal(env.IS_ADMIN, 'false');
    assert.equal(env.IS_SKILL_CREATOR, 'false');
    assert.equal(env.ALLOWED_NODE_MODULES, undefined);
    assert.equal(env.ALLOWED_PYTHON_PACKAGES, undefined);
    assert.equal(env.VM_TIMEOUT, undefined);
    assert.equal(env.PYTHON_TIMEOUT, undefined);
  });
}

function main() {
  testBuildsCompleteSkillRuntimeEnv();
  testRejectsRelativeWorkingDirectory();
  testRequiresSourcePath();
  testOptionalContractFieldsStayAbsentWhenNotConfigured();

  console.log('SkillLoader buildSkillEnvironment contract tests passed.');
}

main();
