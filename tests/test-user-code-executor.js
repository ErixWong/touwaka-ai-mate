/**
 * 测试 execute 工具（支持 JavaScript 和 Shell 命令）
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
  console.log('  Execute 工具测试 (JavaScript + Shell)');
  console.log('='.repeat(60));

  try {
    // ========== JavaScript 模式测试 ==========
    console.log('\n📦 JavaScript 模式测试');
    console.log('-'.repeat(40));

    // 测试 1: 执行简单的 JavaScript 表达式
    console.log('\n📋 测试 1: 执行简单 JavaScript 表达式');
    const result1 = await runSkillTool('execute', {
      type: 'javascript',
      code: '1 + 1'
    });
    console.log('✅ 结果:', JSON.stringify(result1, null, 2));

    // 测试 2: 执行多行 JavaScript 代码
    console.log('\n📋 测试 2: 执行多行 JavaScript 代码');
    const result2 = await runSkillTool('execute', {
      type: 'javascript',
      code: `
        const x = 10;
        const y = 20;
        x * y;
      `
    });
    console.log('✅ 结果:', JSON.stringify(result2, null, 2));

    // 测试 3: 使用 console.log
    console.log('\n📋 测试 3: 使用 console.log');
    const result3 = await runSkillTool('execute', {
      type: 'javascript',
      code: 'console.log("Hello from sandbox!"); "done"'
    });
    console.log('✅ 结果:', JSON.stringify(result3, null, 2));

    // 测试 4: 错误处理
    console.log('\n📋 测试 4: 错误处理');
    const result4 = await runSkillTool('execute', {
      type: 'javascript',
      code: 'throw new Error("测试错误")'
    });
    console.log('✅ 结果:', JSON.stringify(result4, null, 2));

    // ========== Shell 模式测试 ==========
    console.log('\n📦 Shell 模式测试');
    console.log('-'.repeat(40));

    // 测试 5: 执行 ls 命令
    console.log('\n📋 测试 5: 执行 ls 命令');
    const result5 = await runSkillTool('execute', {
      type: 'shell',
      code: 'ls -la'
    });
    console.log('✅ 结果:', JSON.stringify(result5, null, 2));

    // 测试 6: 执行 grep 命令
    console.log('\n📋 测试 6: 执行 grep 命令');
    const result6 = await runSkillTool('execute', {
      type: 'shell',
      code: 'grep -n "test" tests/test-user-code-executor.js'
    });
    console.log('✅ 结果:', JSON.stringify(result6, null, 2));

    // 测试 7: 执行 cat 命令
    console.log('\n📋 测试 7: 执行 cat 命令');
    const result7 = await runSkillTool('execute', {
      type: 'shell',
      code: 'cat package.json'
    });
    console.log('✅ 结果:', JSON.stringify(result7, null, 2));

    // 测试 8: 危险命令拦截 (rm)
    console.log('\n📋 测试 8: 危险命令拦截 (rm)');
    const result8 = await runSkillTool('execute', {
      type: 'shell',
      code: 'rm -rf /'
    });
    console.log('✅ 结果:', JSON.stringify(result8, null, 2));

    // 测试 9: 不在白名单的命令 (curl)
    console.log('\n📋 测试 9: 不在白名单的命令 (curl)');
    const result9 = await runSkillTool('execute', {
      type: 'shell',
      code: 'curl https://example.com'
    });
    console.log('✅ 结果:', JSON.stringify(result9, null, 2));

    // 测试 10: 绝对路径拦截
    console.log('\n📋 测试 10: 绝对路径拦截');
    const result10 = await runSkillTool('execute', {
      type: 'shell',
      code: 'cat /etc/passwd'
    });
    console.log('✅ 结果:', JSON.stringify(result10, null, 2));

    // 测试 11: 父目录引用拦截
    console.log('\n📋 测试 11: 父目录引用拦截 (../)');
    const result11 = await runSkillTool('execute', {
      type: 'shell',
      code: 'cat ../.env'
    });
    console.log('✅ 结果:', JSON.stringify(result11, null, 2));

    // 测试 12: 管道操作拦截
    console.log('\n📋 测试 12: 管道操作拦截 (|)');
    const result12 = await runSkillTool('execute', {
      type: 'shell',
      code: 'ls | grep test'
    });
    console.log('✅ 结果:', JSON.stringify(result12, null, 2));

    // 测试 13: 重定向拦截
    console.log('\n📋 测试 13: 重定向拦截 (>)');
    const result13 = await runSkillTool('execute', {
      type: 'shell',
      code: 'echo test > file.txt'
    });
    console.log('✅ 结果:', JSON.stringify(result13, null, 2));

    // 测试 14: 命令替换拦截
    console.log('\n📋 测试 14: 命令替换拦截 ($())');
    const result14 = await runSkillTool('execute', {
      type: 'shell',
      code: 'echo $(whoami)'
    });
    console.log('✅ 结果:', JSON.stringify(result14, null, 2));

    // 测试 15: 执行 head 命令
    console.log('\n📋 测试 15: 执行 head 命令');
    const result15 = await runSkillTool('execute', {
      type: 'shell',
      code: 'head -n 5 package.json'
    });
    console.log('✅ 结果:', JSON.stringify(result15, null, 2));

    // 测试 16: 执行 wc 命令
    console.log('\n📋 测试 16: 执行 wc 命令');
    const result16 = await runSkillTool('execute', {
      type: 'shell',
      code: 'wc -l package.json'
    });
    console.log('✅ 结果:', JSON.stringify(result16, null, 2));

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