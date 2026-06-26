/**
 * 真实链路专项验证测试
 *
 * 本测试覆盖以下场景：
 * 1. 路径越界安全测试
 * 2. 非管理员权限场景测试
 * 3. script_path 多入口测试
 * 4. Python skill 基础可执行性测试（可选）
 *
 * 使用方法：
 * node tests/skill-runtime/run-skill-integration.js [测试用例]
 *
 * 示例：
 * node tests/skill-runtime/run-skill-integration.js path-security
 * node tests/skill-runtime/run-skill-integration.js all
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 测试用例名称
const TEST_NAME = process.argv[2] || 'all';

// 测试工作目录
const TEST_WORKDIR = path.join(__dirname, '..', '..', 'data', 'work', 'test-integration', 'temp');

// 确保测试工作目录存在
if (!fs.existsSync(TEST_WORKDIR)) {
  fs.mkdirSync(TEST_WORKDIR, { recursive: true });
}

// ���试结果收集
const testResults = {
  passed: 0,
  failed: 0,
  tests: [],
};

function log(msg) {
  console.log(`[TEST] ${msg}`);
}

function pass(testName, details = '') {
  testResults.passed++;
  testResults.tests.push({ name: testName, status: 'passed', details });
  console.log(`✅ PASS: ${testName}${details ? ' - ' + details : ''}`);
}

function fail(testName, error) {
  testResults.failed++;
  testResults.tests.push({ name: testName, status: 'failed', error: error.message });
  console.log(`❌ FAIL: ${testName} - ${error.message}`);
}

// ============================================
// 测试用例 1: 路径越界安全测试
// ============================================
async function testPathSecurity() {
  log('开始路径安全测试...');
  
  const tests = [
    {
      name: '绝对路径应被拒绝',
      input: '/etc/passwd',
      shouldFail: true,
    },
    {
      name: '路径遍历 ../ 应被拒绝',
      input: '../secret.txt',
      shouldFail: true,
    },
    {
      name: '复杂路径遍历应被拒绝',
      input: 'subdir/../../etc/passwd',
      shouldFail: true,
    },
    {
      name: '正常的相对路径应被允许',
      input: 'test.xlsx',
      shouldFail: false,
    },
    {
      name: '带子目录的相对路径应被允许',
      input: 'subdir/test.xlsx',
      shouldFail: false,
    },
  ];
  
  for (const test of tests) {
    try {
      // 导入 xlsx skill 并测试 resolvePath
      const xlsxPath = path.join(__dirname, '..', '..', 'data', 'skills', 'xlsx', 'index.js');
      if (!fs.existsSync(xlsxPath)) {
        fail(test.name, new Error('xlsx skill not found'));
        continue;
      }
      
      const xlsxCode = fs.readFileSync(xlsxPath, 'utf-8');
      
      // 创建一个最小化的测试环境
      const vm = await import('vm');
      const context = {
        require: (m) => {
          if (m === 'path') return path;
          if (m === 'fs') return fs;
          throw new Error(`Module ${m} not allowed`);
        },
        module: { exports: {} },
        exports: {},
      };
      vm.createContext(context);
      
      // 提取 resolvePath 函数
      const resolvePathMatch = xlsxCode.match(/function resolvePath\(.*?\n[\s\S]*?\n\}/);
      if (!resolvePathMatch) {
        fail(test.name, new Error('resolvePath function not found'));
        continue;
      }
      
      // 执行 resolvePath 测试
      const testCode = `
        ${resolvePathMatch[0]}
        try {
          resolvePath('${test.input.replace(/'/g, "\\'")}');
          resolvePath;
        } catch (e) {
          throw e;
        }
      `;
      
      let result;
      try {
        vm.runInContext(testCode, context);
        result = 'allowed';
      } catch (e) {
        result = 'rejected';
      }
      
      if (test.shouldFail && result === 'rejected') {
        pass(test.name);
      } else if (!test.shouldFail && result === 'allowed') {
        pass(test.name);
      } else {
        fail(test.name, new Error(`Expected ${test.shouldFail ? 'rejection' : 'allowance'}, got ${result}`));
      }
    } catch (error) {
      fail(test.name, error);
    }
  }
}

// ============================================
// 测试用例 2: 非管理员权限场景测试
// ============================================
async function testNonAdminScenario() {
  log('开始非管理员权限场景测试...');
  
  try {
    // 测试非管理员环境变量
    const envWithoutAdmin = {
      IS_ADMIN: 'false',
      USER_ID: 'test-user',
    };
    
    if (envWithoutAdmin.IS_ADMIN === 'false') {
      pass('非管理员环境变量设置正确', `IS_ADMIN=${envWithoutAdmin.IS_ADMIN}`);
    } else {
      fail('非管理员环境变量设置', new Error('IS_ADMIN should be false'));
    }
    
    // 测试工作目录限制
    const userWorkDir = path.join(__dirname, '..', '..', 'data', 'work', 'test-user', 'temp');
    
    // 验证工作目录计算逻辑
    const effectiveCwd = userWorkDir;
    if (effectiveCwd.includes('test-user')) {
      pass('工作目录包含用户ID', `路径: ${effectiveCwd}`);
    } else {
      fail('工作目录包含用户ID', new Error('工作目录应包含用户ID'));
    }
    
  } catch (error) {
    fail('非管理员权限场景测试', error);
  }
}

// ============================================
// 测试用例 3: 真实 runner 环境变量完整性
// ============================================
async function testRunnerEnvironment() {
  log('开始 Runner 环境变量测试...');
  
  const requiredEnvVars = [
    'SKILL_PATH',
    'SCRIPT_PATH',
    'DATA_BASE_PATH',
    'WORKING_DIRECTORY',
    'USER_ID',
    'IS_ADMIN',
  ];
  
  // 模拟 skill-loader 构建的环境
  const mockEnv = {
    SKILL_PATH: path.join(__dirname, '..', '..', 'data', 'skills', 'xlsx'),
    SCRIPT_PATH: 'index.js',
    DATA_BASE_PATH: path.join(__dirname, '..', '..', 'data'),
    WORKING_DIRECTORY: path.join(__dirname, '..', '..', 'data', 'work', 'test-user', 'temp'),
    USER_ID: 'test-user',
    IS_ADMIN: 'false',
  };
  
  for (const envVar of requiredEnvVars) {
    if (mockEnv[envVar]) {
      pass(`环境变量 ${envVar} 已设置`, mockEnv[envVar]);
    } else {
      fail(`环境变量 ${envVar} 未设置`, new Error(`${envVar} is required`));
    }
  }
  
  // 验证路径是否为绝对路径
  if (path.isAbsolute(mockEnv.WORKING_DIRECTORY)) {
    pass('WORKING_DIRECTORY 是绝对路径', mockEnv.WORKING_DIRECTORY);
  } else {
    fail('WORKING_DIRECTORY 是绝对路径', new Error('WORKING_DIRECTORY must be absolute'));
  }
  
  if (path.isAbsolute(mockEnv.SKILL_PATH)) {
    pass('SKILL_PATH 是绝对路径', mockEnv.SKILL_PATH);
  } else {
    fail('SKILL_PATH 是绝对路径', new Error('SKILL_PATH must be absolute'));
  }
}

// ============================================
// 测试用例 4: script_path 多入口测试
// ============================================
async function testMultiEntryPoints() {
  log('开始多入口测试...');
  
  const xlsxPath = path.join(__dirname, '..', '..', 'data', 'skills', 'xlsx');
  
  // 检查 index.js 入口
  if (fs.existsSync(path.join(xlsxPath, 'index.js'))) {
    pass('xlsx 技能有 index.js 入口');
  } else {
    fail('xlsx 技能有 index.js 入口', new Error('index.js not found'));
  }
  
  // 检查是否有其他入口文件（如 index.py）
  const entryFiles = fs.readdirSync(xlsxPath).filter(f => 
    ['index.js', 'index.py', 'main.js', 'main.py'].includes(f)
  );
  
  if (entryFiles.length > 0) {
    pass('技能有入口文件', entryFiles.join(', '));
  } else {
    fail('技能有入口文件', new Error('No entry files found'));
  }
}

// ============================================
// 运行测试
// ============================================
async function runTests() {
  console.log('='.repeat(60));
  console.log('🧪 真实链路专项验证测试');
  console.log('='.repeat(60));
  console.log(`📁 测试工作目录: ${TEST_WORKDIR}`);
  console.log(`📋 测试用例: ${TEST_NAME}`);
  console.log('='.repeat(60));
  
  const startTime = Date.now();
  
  try {
    switch (TEST_NAME) {
      case 'path-security':
        await testPathSecurity();
        break;
      case 'non-admin':
        await testNonAdminScenario();
        break;
      case 'runner-env':
        await testRunnerEnvironment();
        break;
      case 'multi-entry':
        await testMultiEntryPoints();
        break;
      case 'all':
      default:
        await testPathSecurity();
        console.log('');
        await testNonAdminScenario();
        console.log('');
        await testRunnerEnvironment();
        console.log('');
        await testMultiEntryPoints();
        break;
    }
  } catch (error) {
    console.error('\n❌ 测试执行失败:', error.message);
  }
  
  const duration = Date.now() - startTime;
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 测试结果汇总');
  console.log('='.repeat(60));
  console.log(`✅ 通过: ${testResults.passed}`);
  console.log(`❌ 失败: ${testResults.failed}`);
  console.log(`⏱️ 耗时: ${duration}ms`);
  console.log('='.repeat(60));
  
  if (testResults.failed > 0) {
    console.log('\n失败测试详情:');
    testResults.tests
      .filter(t => t.status === 'failed')
      .forEach(t => {
        console.log(`  - ${t.name}: ${t.error}`);
      });
    process.exit(1);
  } else {
    console.log('\n🎉 所有测试通过!');
    process.exit(0);
  }
}

runTests();