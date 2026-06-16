/**
 * Execute Script Runner Tests
 * 
 * Tests for nodejs/python script execution with sandbox restrictions
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_WORKSPACE = path.join(__dirname, 'workspace');
const OUTSIDE_PATH = path.join(__dirname, '..', '..', '..');

describe('Execute Script Runner', () => {
  before(() => {
    if (!fs.existsSync(TEST_WORKSPACE)) {
      fs.mkdirSync(TEST_WORKSPACE, { recursive: true });
    }
  });

  after(() => {
    if (fs.existsSync(TEST_WORKSPACE)) {
      fs.rmSync(TEST_WORKSPACE, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    const files = fs.readdirSync(TEST_WORKSPACE);
    for (const file of files) {
      fs.rmSync(path.join(TEST_WORKSPACE, file), { recursive: true, force: true });
    }
  });

  describe('Node.js Sandbox', () => {
    it('should read file inside sandbox successfully', async () => {
      const testFile = path.join(TEST_WORKSPACE, 'test-read.txt');
      fs.writeFileSync(testFile, 'hello from sandbox');
      
      const scriptPath = path.join(TEST_WORKSPACE, 'read-test.js');
      fs.writeFileSync(scriptPath, `
const fs = require('fs');
const content = fs.readFileSync('test-read.txt', 'utf8');
console.log(content);
`);
      
      const { ToolManager } = await import('../../lib/tool-manager.js');
      const result = await ToolManager.prototype.executeNodeScript.call(
        { skillLoader: {} },
        'read-test.js',
        [],
        TEST_WORKSPACE,
        {}
      );
      
      assert.strictEqual(result.success, true);
      assert.ok(result.stdout.includes('hello from sandbox'));
    });

    it('should write file inside sandbox successfully', async () => {
      const scriptPath = path.join(TEST_WORKSPACE, 'write-test.js');
      fs.writeFileSync(scriptPath, `
const fs = require('fs');
fs.writeFileSync('output.txt', 'written from script');
console.log('write success');
`);
      
      const { ToolManager } = await import('../../lib/tool-manager.js');
      const result = await ToolManager.prototype.executeNodeScript.call(
        { skillLoader: {} },
        'write-test.js',
        [],
        TEST_WORKSPACE,
        {}
      );
      
      assert.strictEqual(result.success, true);
      assert.ok(fs.existsSync(path.join(TEST_WORKSPACE, 'output.txt')));
      assert.strictEqual(
        fs.readFileSync(path.join(TEST_WORKSPACE, 'output.txt'), 'utf8'),
        'written from script'
      );
    });

    it('should reject path traversal attack', async () => {
      const scriptPath = path.join(TEST_WORKSPACE, 'escape-test.js');
      fs.writeFileSync(scriptPath, `
const fs = require('fs');
try {
  const content = fs.readFileSync('../../../package.json', 'utf8');
  console.log('ESCAPED:', content.substring(0, 50));
} catch (e) {
  console.log('BLOCKED:', e.message);
}
`);
      
      const { ToolManager } = await import('../../lib/tool-manager.js');
      const result = await ToolManager.prototype.executeNodeScript.call(
        { skillLoader: {} },
        'escape-test.js',
        [],
        TEST_WORKSPACE,
        {}
      );
      
      assert.strictEqual(result.success, true);
      assert.ok(result.stdout.includes('BLOCKED'));
      assert.ok(!result.stdout.includes('ESCAPED'));
    });

    it('should reject absolute path outside sandbox', async () => {
      const scriptPath = path.join(TEST_WORKSPACE, 'absolute-test.js');
      const outsideFile = path.resolve(OUTSIDE_PATH, '.env');
      fs.writeFileSync(scriptPath, `
const fs = require('fs');
try {
  const content = fs.readFileSync('${outsideFile.replace(/\\/g, '\\\\')}', 'utf8');
  console.log('LEAKED:', content.substring(0, 50));
} catch (e) {
  console.log('BLOCKED:', e.message);
}
`);
      
      const { ToolManager } = await import('../../lib/tool-manager.js');
      const result = await ToolManager.prototype.executeNodeScript.call(
        { skillLoader: {} },
        'absolute-test.js',
        [],
        TEST_WORKSPACE,
        {}
      );
      
      assert.strictEqual(result.success, true);
      assert.ok(result.stdout.includes('BLOCKED'));
      assert.ok(!result.stdout.includes('LEAKED'));
    });

    it('should support .cjs extension', async () => {
      const scriptPath = path.join(TEST_WORKSPACE, 'cjs-test.cjs');
      fs.writeFileSync(scriptPath, `
const fs = require('fs');
fs.writeFileSync('cjs-output.txt', 'from cjs script');
console.log('cjs works');
`);
      
      const { ToolManager } = await import('../../lib/tool-manager.js');
      const result = await ToolManager.prototype.executeNodeScript.call(
        { skillLoader: {} },
        'cjs-test.cjs',
        [],
        TEST_WORKSPACE,
        {}
      );
      
      assert.strictEqual(result.success, true);
      assert.ok(result.stdout.includes('cjs works'));
      assert.ok(fs.existsSync(path.join(TEST_WORKSPACE, 'cjs-output.txt')));
    });
  });

  describe('Python Sandbox', () => {
    it('should read file inside sandbox successfully', async () => {
      const testFile = path.join(TEST_WORKSPACE, 'test-read.txt');
      fs.writeFileSync(testFile, 'hello from python sandbox');
      
      const scriptPath = path.join(TEST_WORKSPACE, 'read-test.py');
      fs.writeFileSync(scriptPath, `
import os
with open('test-read.txt', 'r') as f:
    content = f.read()
    print(content)
`);
      
      const { ToolManager } = await import('../../lib/tool-manager.js');
      const result = await ToolManager.prototype.executePythonScript.call(
        { skillLoader: {} },
        'read-test.py',
        [],
        TEST_WORKSPACE,
        {}
      );
      
      assert.strictEqual(result.success, true);
      assert.ok(result.stdout.includes('hello from python sandbox'));
    });

    it('should write file inside sandbox successfully', async () => {
      const scriptPath = path.join(TEST_WORKSPACE, 'write-test.py');
      fs.writeFileSync(scriptPath, `
with open('py-output.txt', 'w') as f:
    f.write('written from python')
print('write success')
`);
      
      const { ToolManager } = await import('../../lib/tool-manager.js');
      const result = await ToolManager.prototype.executePythonScript.call(
        { skillLoader: {} },
        'write-test.py',
        [],
        TEST_WORKSPACE,
        {}
      );
      
      assert.strictEqual(result.success, true);
      assert.ok(fs.existsSync(path.join(TEST_WORKSPACE, 'py-output.txt')));
      assert.strictEqual(
        fs.readFileSync(path.join(TEST_WORKSPACE, 'py-output.txt'), 'utf8'),
        'written from python'
      );
    });

    it('should reject path traversal attack', async () => {
      const scriptPath = path.join(TEST_WORKSPACE, 'escape-test.py');
      fs.writeFileSync(scriptPath, `
import os
try:
    with open('../../../package.json', 'r') as f:
        content = f.read()
        print('ESCAPED:', content[:50])
except Exception as e:
    print('BLOCKED:', str(e))
`);
      
      const { ToolManager } = await import('../../lib/tool-manager.js');
      const result = await ToolManager.prototype.executePythonScript.call(
        { skillLoader: {} },
        'escape-test.py',
        [],
        TEST_WORKSPACE,
        {}
      );
      
      assert.strictEqual(result.success, true);
      assert.ok(result.stdout.includes('BLOCKED'));
      assert.ok(!result.stdout.includes('ESCAPED'));
    });

    it('should reject absolute path outside sandbox', async () => {
      const scriptPath = path.join(TEST_WORKSPACE, 'absolute-test.py');
      const outsideFile = path.resolve(OUTSIDE_PATH, '.env');
      fs.writeFileSync(scriptPath, `
try:
    with open('${outsideFile.replace(/\\/g, '\\\\')}', 'r') as f:
        content = f.read()
        print('LEAKED:', content[:50])
except Exception as e:
    print('BLOCKED:', str(e))
`);
      
      const { ToolManager } = await import('../../lib/tool-manager.js');
      const result = await ToolManager.prototype.executePythonScript.call(
        { skillLoader: {} },
        'absolute-test.py',
        [],
        TEST_WORKSPACE,
        {}
      );
      
      assert.strictEqual(result.success, true);
      assert.ok(result.stdout.includes('BLOCKED'));
      assert.ok(!result.stdout.includes('LEAKED'));
    });

    it('should block forbidden module import', async () => {
      const scriptPath = path.join(TEST_WORKSPACE, 'module-test.py');
      fs.writeFileSync(scriptPath, `
try:
    import subprocess
    print('DANGER: subprocess imported')
except ImportError as e:
    print('BLOCKED:', str(e))
`);
      
      const { ToolManager } = await import('../../lib/tool-manager.js');
      const result = await ToolManager.prototype.executePythonScript.call(
        { skillLoader: {} },
        'module-test.py',
        [],
        TEST_WORKSPACE,
        {}
      );
      
      assert.strictEqual(result.success, true);
      assert.ok(result.stdout.includes('BLOCKED'));
      assert.ok(!result.stdout.includes('DANGER'));
    });

    it('should allow import os but block os.system', async () => {
      const scriptPath = path.join(TEST_WORKSPACE, 'os-test.py');
      fs.writeFileSync(scriptPath, `
import os
print('os imported:', os.name)
try:
    os.system('echo hello')
    print('DANGER: os.system worked')
except PermissionError as e:
    print('BLOCKED:', str(e))
`);
      
      const { ToolManager } = await import('../../lib/tool-manager.js');
      const result = await ToolManager.prototype.executePythonScript.call(
        { skillLoader: {} },
        'os-test.py',
        [],
        TEST_WORKSPACE,
        {}
      );
      
      assert.strictEqual(result.success, true);
      assert.ok(result.stdout.includes('os imported'));
      assert.ok(result.stdout.includes('BLOCKED'));
      assert.ok(!result.stdout.includes('DANGER'));
    });

    it('should allow import sys with restricted path', async () => {
      const scriptPath = path.join(TEST_WORKSPACE, 'sys-test.py');
      fs.writeFileSync(scriptPath, `
import sys
print('sys.argv:', sys.argv)
print('sys.path:', sys.path)
print('sys.version:', sys.version.split()[0])
`);
      
      const { ToolManager } = await import('../../lib/tool-manager.js');
      const result = await ToolManager.prototype.executePythonScript.call(
        { skillLoader: {} },
        'sys-test.py',
        [],
        TEST_WORKSPACE,
        {}
      );
      
      assert.strictEqual(result.success, true);
      assert.ok(result.stdout.includes('sys.argv'));
      assert.ok(result.stdout.includes('sys.path'));
      assert.ok(result.stdout.includes('sys.version'));
    });
  });
});