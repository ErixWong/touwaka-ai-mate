/**
 * 测试 skill-runner 中相对路径按工作目录解析
 *
 * 使用方式:
 * node tests/test-skill-runner-relative-path.js
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SKILL_RUNNER = path.join(__dirname, '..', 'lib', 'skill-runner.js');
const SKILL_PATH = path.join(__dirname, '..', 'data', 'skills', 'fs');

const FS_PROMISES_SKILL_CODE = `
const fs = require('fs');
const path = require('path');

async function execute(toolName, params) {
  switch (toolName) {
    case 'promises_write_read': {
      const { path: filePath, content } = params;
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, content, 'utf-8');
      const readBack = await fs.promises.readFile(filePath, 'utf-8');
      return { success: true, content: readBack };
    }
    case 'promises_rename': {
      const { from, to, content } = params;
      await fs.promises.mkdir(path.dirname(from), { recursive: true });
      await fs.promises.mkdir(path.dirname(to), { recursive: true });
      await fs.promises.writeFile(from, content, 'utf-8');
      await fs.promises.rename(from, to);
      const readBack = await fs.promises.readFile(to, 'utf-8');
      return { success: true, content: readBack };
    }
    default:
      throw new Error('Unknown tool: ' + toolName);
  }
}

module.exports = { execute };
`;

function runSkillTool(skillId, skillPath, toolName, params, envOverrides = {}) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      SKILL_PATH: skillPath,
      SCRIPT_PATH: 'index.js',
      IS_ADMIN: 'false',
      IS_SKILL_CREATOR: 'false',
      ALLOWED_NODE_MODULES: JSON.stringify([
        'fs', 'path', 'url', 'querystring', 'crypto',
        'util', 'stream', 'http', 'https', 'zlib',
        'string_decoder', 'buffer', 'events', 'os'
      ]),
      ALLOWED_PYTHON_PACKAGES: JSON.stringify([]),
      VM_TIMEOUT: '30000',
      PYTHON_TIMEOUT: '300000',
      ...envOverrides,
    };

    const proc = spawn('node', [SKILL_RUNNER, skillId, toolName], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (!stdout.trim()) {
        reject(new Error(`No stdout. exit=${code}\n${stderr}`));
        return;
      }

      try {
        resolve({
          code,
          stderr,
          result: JSON.parse(stdout),
        });
      } catch (error) {
        reject(new Error(`Failed to parse stdout: ${error.message}\nstdout=${stdout}\nstderr=${stderr}`));
      }
    });

    proc.on('error', (error) => {
      reject(error);
    });

    proc.stdin.write(JSON.stringify({ params, context: {} }));
    proc.stdin.end();
  });
}

function runFsTool(toolName, params, envOverrides = {}) {
  return runSkillTool('fs', SKILL_PATH, toolName, params, envOverrides);
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-runner-relative-path-'));
  const dataBasePath = path.join(tempRoot, 'data');
  const workDir = path.join(dataBasePath, 'work', 'user-1', 'task-1');
  const promisesSkillPath = path.join(tempRoot, 'skills', 'fs-promises-skill');

  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(promisesSkillPath, { recursive: true });
  fs.writeFileSync(path.join(promisesSkillPath, 'index.js'), FS_PROMISES_SKILL_CODE, 'utf-8');

  const baseEnv = {
    DATA_BASE_PATH: dataBasePath,
    USER_ID: 'user-1',
    WORKING_DIRECTORY: 'work/user-1/task-1',
  };

  let passed = 0;
  let failed = 0;

  try {
    const writeResult = await runFsTool('write_file', {
      path: 'report.md',
      content: '# hello',
    }, baseEnv);

    const expectedFile = path.join(workDir, 'report.md');
    const content = fs.readFileSync(expectedFile, 'utf-8');
    if (writeResult.code === 0 && content === '# hello') {
      console.log('✅ 测试 1 通过: 相对路径写入到了工作目录');
      passed++;
    } else {
      console.log('❌ 测试 1 失败: 写入结果不正确');
      failed++;
    }

    const nestedWriteResult = await runFsTool('write_file', {
      path: 'docs/nested.md',
      content: 'nested',
    }, baseEnv);

    const nestedFile = path.join(workDir, 'docs', 'nested.md');
    if (nestedWriteResult.code === 0 && fs.readFileSync(nestedFile, 'utf-8') === 'nested') {
      console.log('✅ 测试 2 通过: 子目录相对路径写入成功');
      passed++;
    } else {
      console.log('❌ 测试 2 失败: 子目录写入结果不正确');
      failed++;
    }

    const escapeResult = await runFsTool('write_file', {
      path: '../escape.md',
      content: 'escape',
    }, baseEnv);

    if (escapeResult.code !== 0 && escapeResult.result?.error?.includes('Path not allowed')) {
      console.log('✅ 测试 3 通过: 相对路径越权被正确拦截');
      passed++;
    } else {
      console.log('❌ 测试 3 失败: 越权路径未被拦截');
      failed++;
    }

    const absoluteEscapeResult = await runFsTool('write_file', {
      path: path.join(tempRoot, 'outside.md'),
      content: 'outside',
    }, baseEnv);

    if (absoluteEscapeResult.code !== 0 && absoluteEscapeResult.result?.error?.includes('Absolute path not allowed')) {
      console.log('✅ 测试 4 通过: 绝对路径仍被技能层禁止');
      passed++;
    } else {
      console.log('❌ 测试 4 失败: 绝对路径限制不符合预期');
      failed++;
    }

    const promisesWriteReadResult = await runSkillTool('fs-promises-skill', promisesSkillPath, 'promises_write_read', {
      path: 'promises/report.txt',
      content: 'promises hello',
    }, baseEnv);

    const promisesReportFile = path.join(workDir, 'promises', 'report.txt');
    if (
      promisesWriteReadResult.code === 0 &&
      promisesWriteReadResult.result?.data?.content === 'promises hello' &&
      fs.readFileSync(promisesReportFile, 'utf-8') === 'promises hello'
    ) {
      console.log('✅ 测试 5 通过: 真实 skill-runner 下 fs.promises 写读按工作目录执行');
      passed++;
    } else {
      console.log('❌ 测试 5 失败: fs.promises 写读结果不正确');
      failed++;
    }

    const promisesRenameResult = await runSkillTool('fs-promises-skill', promisesSkillPath, 'promises_rename', {
      from: 'promises/from.txt',
      to: 'promises/to.txt',
      content: 'rename content',
    }, baseEnv);

    const renamedFile = path.join(workDir, 'promises', 'to.txt');
    const oldFile = path.join(workDir, 'promises', 'from.txt');
    if (
      promisesRenameResult.code === 0 &&
      promisesRenameResult.result?.data?.content === 'rename content' &&
      fs.existsSync(renamedFile) &&
      !fs.existsSync(oldFile)
    ) {
      console.log('✅ 测试 6 通过: 真实 skill-runner 下 fs.promises 双路径参数按工作目录执行');
      passed++;
    } else {
      console.log('❌ 测试 6 失败: fs.promises rename 结果不正确');
      failed++;
    }

    const fileUrlPath = pathToFileURL(path.join(workDir, 'file-url.txt')).href;
    const fileUrlResult = await runSkillTool('fs-promises-skill', promisesSkillPath, 'promises_write_read', {
      path: fileUrlPath,
      content: 'file url content',
    }, baseEnv);

    const fileUrlTarget = path.join(workDir, 'file-url.txt');
    if (
      fileUrlResult.code === 0 &&
      fileUrlResult.result?.data?.content === 'file url content' &&
      fs.readFileSync(fileUrlTarget, 'utf-8') === 'file url content'
    ) {
      console.log('✅ 测试 7 通过: file:// 路径按允许目录正常执行');
      passed++;
    } else {
      console.log('❌ 测试 7 失败: file:// 路径结果不正确');
      failed++;
    }

    console.log(`\n测试结果: ${passed} 通过, ${failed} 失败`);
    process.exit(failed > 0 ? 1 : 0);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('测试执行失败:', error);
  process.exit(1);
});
