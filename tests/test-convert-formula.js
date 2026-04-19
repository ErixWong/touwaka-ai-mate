/**
 * 测试 excel_convert 的公式识别功能
 * 
 * 验证：当 JSON 数据中包含以 = 开头的字符串时，
 * excel_convert 应将其识别为公式并正确写入
 */

import vm from 'vm';
import fs from 'fs';
import path from 'path';
import url from 'url';
import http from 'http';
import https from 'https';
import crypto from 'crypto';
import util from 'util';
import stream from 'stream';
import zlib from 'zlib';
import os from 'os';
import buffer from 'buffer';
import events from 'events';
import string_decoder from 'string_decoder';
import querystring from 'querystring';
import { fileURLToPath } from 'url';
import exceljs from 'exceljs';
import hyperformula from 'hyperformula';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 设置环境变量
process.env.IS_ADMIN = 'true';
process.env.DATA_BASE_PATH = path.join(__dirname, '..');

/**
 * 加载技能代码
 */
function loadSkillCode(skillName) {
  const skillPath = path.join(process.cwd(), 'data', 'skills', skillName, 'index.js');
  if (fs.existsSync(skillPath)) {
    return fs.readFileSync(skillPath, 'utf-8');
  }
  throw new Error(`找不到技能: ${skillName}`);
}

/**
 * 执行技能代码（使用 vm 沙箱）
 */
function executeSkill(code, skillId) {
  const safeEnv = { ...process.env };
  
  const context = {
    module: { exports: {} },
    exports: {},
    require: (moduleName) => {
      const moduleMap = {
        'fs': fs,
        'path': path,
        'url': url,
        'querystring': querystring,
        'http': http,
        'https': https,
        'crypto': crypto,
        'util': util,
        'stream': stream,
        'zlib': zlib,
        'os': os,
        'buffer': buffer,
        'events': events,
        'string_decoder': string_decoder,
        'exceljs': exceljs,
        'hyperformula': hyperformula,
      };
      
      if (moduleMap[moduleName]) {
        return moduleMap[moduleName];
      }
      
      throw new Error(`Module '${moduleName}' is not allowed in sandbox`);
    },
    console: {
      log: (...args) => console.log(`[${skillId}]`, ...args),
      error: (...args) => console.error(`[${skillId}:ERROR]`, ...args),
      warn: (...args) => console.warn(`[${skillId}:WARN]`, ...args),
    },
    process: {
      env: safeEnv,
      cwd: () => process.cwd(),
    },
    Buffer,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
  
  vm.createContext(context);
  vm.runInContext(code, context, { timeout: 30000, displayErrors: true });
  
  const exports = context.module.exports;
  if (Object.keys(exports).length === 0 && Object.keys(context.exports).length > 0) {
    return context.exports;
  }
  
  return exports;
}

async function testConvertFormula() {
  console.log('=== 测试 excel_convert 公式识别 ===\n');
  
  const testFile = path.join(__dirname, 'test-convert-formula.xlsx');
  
  // 清理旧测试文件
  if (fs.existsSync(testFile)) {
    fs.unlinkSync(testFile);
  }
  
  // 测试数据：包含公式字符串
  const testData = [
    ['产品', '单价', '数量', '总价'],
    ['苹果', 5, 10, '=B2*C2'],
    ['香蕉', 3, 20, '=B3*C3'],
    ['橙子', 4, 15, '=B4*C4'],
    ['合计', '', '', '=SUM(D2:D4)']
  ];
  
  console.log('测试数据:');
  console.table(testData);
  
  try {
    // 加载技能
    const code = loadSkillCode('xlsx');
    const skillModule = executeSkill(code, 'xlsx');
    
    // 1. 使用 excel_convert 写入数据
    console.log('\n1. 使用 excel_convert 写入数据...');
    const convertResult = await skillModule.execute('excel_convert', {
      path: testFile,
      format: 'json',
      direction: 'from',
      data: testData
    });
    console.log('写入结果:', convertResult);
    
    // 2. 读取文件验证公式
    console.log('\n2. 读取文件验证公式...');
    const readResult = await skillModule.execute('excel_read', {
      path: testFile,
      scope: 'sheet'
    });
    console.log('读取数据:');
    console.table(readResult.data);
    
    // 3. 使用 excel_calc 验证公式计算
    console.log('\n3. 使用 excel_calc 验证公式计算...');
    const calcResult = await skillModule.execute('excel_calc', {
      path: testFile
    });
    console.log('公式计算结果:');
    calcResult.formulas.forEach(f => {
      console.log(`  ${f.cell}: ${f.formula} = ${f.value}`);
    });
    
    // 4. 读取单元格验证公式属性
    console.log('\n4. 读取单元格验证公式属性...');
    const cellsToCheck = ['D2', 'D3', 'D4', 'D5'];
    for (const cell of cellsToCheck) {
      const cellResult = await skillModule.execute('excel_read', {
        path: testFile,
        scope: 'cell',
        cell: cell
      });
      console.log(`  ${cell}: value=${cellResult.value}, formula=${cellResult.formula || '(无)'}`);
    }
    
    // 验证结果
    console.log('\n=== 验证结果 ===');
    
    // 检查公式是否正确写入
    const expectedFormulas = [
      { cell: 'D2', formula: 'B2*C2', expectedValue: 50 },
      { cell: 'D3', formula: 'B3*C3', expectedValue: 60 },
      { cell: 'D4', formula: 'B4*C4', expectedValue: 60 },
      { cell: 'D5', formula: 'SUM(D2:D4)', expectedValue: 170 }
    ];
    
    let allPassed = true;
    for (const expected of expectedFormulas) {
      const cellResult = await skillModule.execute('excel_read', {
        path: testFile,
        scope: 'cell',
        cell: expected.cell
      });
      
      const formulaMatch = cellResult.formula === expected.formula;
      const valueMatch = cellResult.value === expected.expectedValue;
      
      if (formulaMatch && valueMatch) {
        console.log(`✓ ${expected.cell}: 公式="${expected.formula}", 值=${expected.expectedValue}`);
      } else {
        console.log(`✗ ${expected.cell}: 期望公式="${expected.formula}" 值=${expected.expectedValue}`);
        console.log(`  实际公式="${cellResult.formula}" 值=${cellResult.value}`);
        allPassed = false;
      }
    }
    
    if (allPassed) {
      console.log('\n✅ 所有测试通过！公式识别功能正常工作。');
    } else {
      console.log('\n❌ 部分测试失败，请检查实现。');
    }
    
  } catch (error) {
    console.error('测试失败:', error);
    console.error(error.stack);
  } finally {
    // 清理测试文件
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
      console.log('\n测试文件已清理');
    }
  }
}

testConvertFormula();