/**
 * 测试 user-code-executor 技能
 * 
 * 使用方式:
 * node tests/test-user-code-executor.js
 */

import { fileURLToPath } from 'url';
import path from 'path';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 技能路径
const SKILL_PATH = path.join(__dirname, '..', 'data', 'skills', 'user-code-executor');
const SKILL_RUNNER = path.join(__dirname, '..', 'lib', 'skill-runner.js');

/**
 * 执行技能工具
 */
async function runSkillTool(toolName, params) {
  return new Promise((resolve, reject) => {
    // 构建环境变量
    const env = {
      ...process.env,
      SKILL_PATH: SKILL_PATH,
      SCRIPT_PATH: 'index.js',
      DATA_BASE_PATH: path.join(__dirname, '..'),
      WORKING_DIRECTORY: '',
      IS_ADMIN: 'true',
      // 模块白名单 - 添加 vm 和 child_process
      ALLOWED_NODE_MODULES: JSON.stringify([
        'fs', 'path', 'url', 'querystring', 'crypto',
        'util', 'stream', 'http', 'https', 'zlib',
        'string_decoder', 'buffer', 'events', 'os',
        'vm', 'child_process'  // 添加这两个模块
      ]),
      ALLOWED_PYTHON_PACKAGES: JSON.stringify([]),
      VM_TIMEOUT: '30000',
      PYTHON_TIMEOUT: '300000',
    };

    console.log(`\n🚀 执行工具: ${toolName}`);
    console.log(`📌 参数:`, params);
    
    // 启动子进程
    const proc = spawn('node', [SKILL_RUNNER, 'user-code-executor', toolName], {
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
      // 显示子进程日志
      console.error('[stderr]', data.toString().trim());
    });

    proc.on('close', (code) => {
      if (stdout) {
        try {
          const result = JSON.parse(stdout);
          resolve(result);
        } catch (e) {
          reject(new Error(`解析输出失败: ${e.message}\nOutput: ${stdout}`));
        }
      } else {
        reject(new Error(`无输出，退出码: ${code}\nStderr: ${stderr}`));
      }
    });

    proc.on('error', (error) => {
      reject(new Error(`进程错误: ${error.message}`));
    });

    // 发送参数
    const input = JSON.stringify({ params, context: {} });
    proc.stdin.write(input);
    proc.stdin.end();
  });
}

/**
 * 主测试函数
 */
async function main() {
  console.log('='.repeat(60));
  console.log('  User Code Executor 测试');
  console.log('='.repeat(60));

  try {
    // 测试 1: 执行简单的 JavaScript 表达式
    console.log('\n📋 测试 1: 执行简单 JavaScript 表达式');
    const result1 = await runSkillTool('execute_javascript', {
      code: '1 + 1'
    });
    console.log('✅ 结果:', JSON.stringify(result1, null, 2));

    // 测试 2: 执行多行 JavaScript 代码
    console.log('\n📋 测试 2: 执行多行 JavaScript 代码');
    const result2 = await runSkillTool('execute_javascript', {
      code: `
        const x = 10;
        const y = 20;
        x * y;
      `
    });
    console.log('✅ 结果:', JSON.stringify(result2, null, 2));

    // 测试 3: 使用 console.log
    console.log('\n📋 测试 3: 使用 console.log');
    const result3 = await runSkillTool('execute_javascript', {
      code: 'console.log("Hello from sandbox!"); "done"'
    });
    console.log('✅ 结果:', JSON.stringify(result3, null, 2));

    // 测试 4: 错误处理
    console.log('\n📋 测试 4: 错误处理');
    const result4 = await runSkillTool('execute_javascript', {
      code: 'throw new Error("测试错误")'
    });
    console.log('✅ 结果:', JSON.stringify(result4, null, 2));

    console.log('\n' + '='.repeat(60));
    console.log('  所有测试完成！');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('\n❌ 测试失败:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();