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
// Use a file that is guaranteed to exist so an access-control test cannot pass
// merely because the target file is missing.
const OUTSIDE_FILE = path.resolve(__dirname, '..', '..', 'package.json');
const OUTSIDE_FILE_LITERAL = JSON.stringify(OUTSIDE_FILE);

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

  describe('Execute tool entrypoint', () => {
    it('should execute nodejs scripts through the public execute entrypoint', async () => {
      const scriptPath = path.join(TEST_WORKSPACE, 'entrypoint-test.js');
      fs.writeFileSync(scriptPath, `
console.log(JSON.stringify({
  args: process.argv.slice(2),
  userId: process.env.USER_ID,
  expertId: process.env.EXPERT_ID,
}));
      `);

      const { default: ToolManager } = await import('../../lib/tool-manager.js');
      const toolManager = {
        skillLoader: {},
        executeNodeScript: ToolManager.prototype.executeNodeScript,
        executePythonScript: ToolManager.prototype.executePythonScript,
      };
      const result = await ToolManager.prototype.executeCode.call(
        toolManager,
        {
          type: 'nodejs',
          script_path: 'entrypoint-test.js',
          args: ['first', 'second'],
        },
        {
          userId: 'execute-script-test-user',
          expertId: 'execute-script-test-expert',
          taskContext: {
            absolute_workspace_path: TEST_WORKSPACE,
          },
        },
        'execute'
      );

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.type, 'nodejs');
      assert.strictEqual(result.data.success, true);
      assert.deepStrictEqual(JSON.parse(result.data.stdout.trim()), {
        args: ['first', 'second'],
        userId: 'execute-script-test-user',
        expertId: 'execute-script-test-expert',
      });
    });

    it('should validate script execution parameters before spawning a process', async () => {
      const { default: ToolManager } = await import('../../lib/tool-manager.js');
      const executeCode = ToolManager.prototype.executeCode;

      const missingScriptPath = await executeCode.call(
        { skillLoader: {} },
        { type: 'nodejs' },
        { userId: 'execute-script-test-user' },
        'execute'
      );
      assert.strictEqual(missingScriptPath.success, false);
      assert.match(missingScriptPath.error, /script_path is required/);

      const missingWorkingDirectory = await executeCode.call(
        { skillLoader: {} },
        { type: 'python', script_path: 'test.py' },
        {},
        'execute'
      );
      assert.strictEqual(missingWorkingDirectory.success, false);
      assert.match(missingWorkingDirectory.error, /working directory/);
    });
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
      
      const { default: ToolManager } = await import('../../lib/tool-manager.js');
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
      
      const { default: ToolManager } = await import('../../lib/tool-manager.js');
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
      
      const { default: ToolManager } = await import('../../lib/tool-manager.js');
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
      fs.writeFileSync(scriptPath, `
const fs = require('fs');
try {
  const content = fs.readFileSync(${OUTSIDE_FILE_LITERAL}, 'utf8');
  console.log('LEAKED:', content.substring(0, 50));
} catch (e) {
  console.log('BLOCKED:', e.message);
}
`);
      
      const { default: ToolManager } = await import('../../lib/tool-manager.js');
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

    it('should reject unsafe script paths before spawning', async () => {
      const { default: ToolManager } = await import('../../lib/tool-manager.js');
      const executeNodeScript = ToolManager.prototype.executeNodeScript;

      await assert.rejects(
        () => executeNodeScript.call(
          { skillLoader: {} },
          '../../../package.json',
          [],
          TEST_WORKSPACE,
          {}
        ),
        /Path traversal not allowed/
      );

      await assert.rejects(
        () => executeNodeScript.call(
          { skillLoader: {} },
          OUTSIDE_FILE,
          [],
          TEST_WORKSPACE,
          {}
        ),
        /Absolute path not allowed/
      );

      await assert.rejects(
        () => executeNodeScript.call(
          { skillLoader: {} },
          'missing.js',
          [],
          TEST_WORKSPACE,
          {}
        ),
        /Script file not found/
      );
    });

    it('should support .cjs extension', async () => {
      const scriptPath = path.join(TEST_WORKSPACE, 'cjs-test.cjs');
      fs.writeFileSync(scriptPath, `
const fs = require('fs');
fs.writeFileSync('cjs-output.txt', 'from cjs script');
console.log('cjs works');
`);
      
      const { default: ToolManager } = await import('../../lib/tool-manager.js');
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
      
      const { default: ToolManager } = await import('../../lib/tool-manager.js');
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
      
      const { default: ToolManager } = await import('../../lib/tool-manager.js');
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
      
      const { default: ToolManager } = await import('../../lib/tool-manager.js');
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
      fs.writeFileSync(scriptPath, `
try:
    with open(${OUTSIDE_FILE_LITERAL}, 'r') as f:
        content = f.read()
        print('LEAKED:', content[:50])
except Exception as e:
    print('BLOCKED:', str(e))
`);
      
      const { default: ToolManager } = await import('../../lib/tool-manager.js');
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
      
      const { default: ToolManager } = await import('../../lib/tool-manager.js');
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
      
      const { default: ToolManager } = await import('../../lib/tool-manager.js');
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
      
      const { default: ToolManager } = await import('../../lib/tool-manager.js');
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

    it('should block os.remove outside sandbox', async () => {
      const scriptPath = path.join(TEST_WORKSPACE, 'os-remove-test.py');
      fs.writeFileSync(scriptPath, `
import os
try:
    os.remove('../../../outside.should.not.exist')
    print('ESCAPED: os.remove worked')
except Exception as e:
    print('BLOCKED:', type(e).__name__, str(e)[:80])
`);
      
      const { default: ToolManager } = await import('../../lib/tool-manager.js');
      const result = await ToolManager.prototype.executePythonScript.call(
        { skillLoader: {} },
        'os-remove-test.py',
        [],
        TEST_WORKSPACE,
        {}
      );
      
      assert.strictEqual(result.success, true);
      assert.ok(result.stdout.includes('BLOCKED'));
      assert.ok(!result.stdout.includes('ESCAPED'));
    });

    it('should block os.listdir outside sandbox', async () => {
      const scriptPath = path.join(TEST_WORKSPACE, 'os-listdir-test.py');
      fs.writeFileSync(scriptPath, `
import os
try:
    files = os.listdir('../../')
    print('ESCAPED: listdir returned', len(files), 'files')
except Exception as e:
    print('BLOCKED:', type(e).__name__, str(e)[:80])
`);
      
      const { default: ToolManager } = await import('../../lib/tool-manager.js');
      const result = await ToolManager.prototype.executePythonScript.call(
        { skillLoader: {} },
        'os-listdir-test.py',
        [],
        TEST_WORKSPACE,
        {}
      );
      
      assert.strictEqual(result.success, true);
      assert.ok(result.stdout.includes('BLOCKED'));
      assert.ok(!result.stdout.includes('ESCAPED'));
    });
  });
});
