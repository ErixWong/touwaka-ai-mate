/**
 * 测试 skill-runner 失败时是否返回脚本修复指导
 *
 * 使用方式:
 * node tests/test-skill-runner-error-guidance.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SKILL_RUNNER = path.join(__dirname, '..', 'lib', 'skill-runner.js');

const BAD_NODE_ESM_CODE = 'import fs from "fs";\nexport async function execute() { return { ok: true }; }\n';
const BAD_NODE_WHITELIST_CODE = 'const cp = require("child_process");\nmodule.exports = { execute: async () => ({ ok: !!cp }) };\n';

function runSkill(skillId, skillPath, toolName, envOverrides = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [SKILL_RUNNER, skillId, toolName], {
      env: {
        ...process.env,
        SKILL_PATH: skillPath,
        SCRIPT_PATH: 'index.js',
        DATA_BASE_PATH: path.join(skillPath, '..', 'data'),
        USER_ID: 'user-1',
        WORKING_DIRECTORY: '',
        ALLOWED_NODE_MODULES: JSON.stringify(['fs', 'path', 'url', 'querystring', 'crypto', 'util', 'stream', 'http', 'https', 'zlib', 'string_decoder', 'buffer', 'events', 'os']),
        ALLOWED_PYTHON_PACKAGES: JSON.stringify([]),
        ...envOverrides,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      try {
        resolve({ code, stdout: JSON.parse(stdout), stderr });
      } catch (error) {
        reject(new Error(`parse failed: ${error.message}\nstdout=${stdout}\nstderr=${stderr}`));
      }
    });

    proc.stdin.write(JSON.stringify({ params: {}, context: {} }));
    proc.stdin.end();
  });
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-runner-guidance-'));
  const badNodeSkillPath = path.join(tempRoot, 'bad-node-skill');
  const dataBasePath = path.join(tempRoot, 'data');
  const userTempDir = path.join(dataBasePath, 'work', 'user-1', 'temp');
  fs.mkdirSync(badNodeSkillPath, { recursive: true });
  fs.mkdirSync(userTempDir, { recursive: true });
  fs.writeFileSync(path.join(badNodeSkillPath, 'index.js'), BAD_NODE_ESM_CODE, 'utf-8');

  try {
    const result = await runSkill('bad-node-skill', badNodeSkillPath, 'test', {
      DATA_BASE_PATH: dataBasePath,
    });
    const errorText = result.stdout?.error || '';

    if (result.code === 0) {
      throw new Error('bad skill unexpectedly succeeded');
    }

    const requiredSnippets = [
      '脚本修复建议:',
      'Node.js 技能要求：入口文件必须是 .js，使用 CommonJS 写法，不支持 .mjs / import / export。',
      '检测到 ESM 语法错误：请把 import/export 改为 require() / module.exports。',
    ];

    for (const snippet of requiredSnippets) {
      if (!errorText.includes(snippet)) {
        throw new Error(`missing guidance snippet: ${snippet}\nactual=${errorText}`);
      }
    }

    console.log('✅ 错误指导测试通过: Node.js 脚本失败时返回了可执行修复建议');

    fs.writeFileSync(path.join(badNodeSkillPath, 'index.js'), BAD_NODE_WHITELIST_CODE, 'utf-8');
    const whitelistResult = await runSkill('bad-node-skill', badNodeSkillPath, 'test', {
      DATA_BASE_PATH: dataBasePath,
    });
    const whitelistErrorText = whitelistResult.stdout?.error || '';

    const whitelistSnippets = [
      '请检查该 npm 依赖是否已安装到主项目；如果依赖或模块未在白名单中，请提示管理员将其加入 allowed_node_modules。',
      '脚本修复建议:',
    ];

    for (const snippet of whitelistSnippets) {
      if (!whitelistErrorText.includes(snippet)) {
        throw new Error(`missing whitelist guidance snippet: ${snippet}\nactual=${whitelistErrorText}`);
      }
    }

    console.log('✅ 白名单指导测试通过: 依赖受限时会提示向管理员申请开通');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('测试失败:', error);
  process.exit(1);
});
