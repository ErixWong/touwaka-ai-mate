/**
 * Test VM Sandbox Helper
 *
 * 提供测试专用的 VM 沙箱环境，用于在测试中模拟 skill-runner 的执行环境。
 * 此模块仅用于开发测试，不应用于生产环境。
 *
 * 使用方法：
 * import { createTestSandbox } from './skill-runtime/vm-sandbox.js';
 *
 * const sandbox = createTestSandbox();
 * const skillModule = sandbox.loadSkill('xlsx');
 * const result = await skillModule.execute('excel_read', { path: 'test.xlsx' });
 *
 * 或使用 createDevSandbox() 创建开发调试专用沙箱：
 * const sandbox = createDevSandbox();
 * const skillModule = sandbox.loadSkill('xlsx');
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
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// 延迟加载大型模块（按需加载）
function lazyLoadModule(modulePath) {
  let moduleCache = null;
  return function() {
    if (moduleCache === null) {
      moduleCache = require(modulePath);
    }
    return moduleCache;
  };
}

// 预加载的模块映射
const moduleMap = {
  // Node.js 内置模块
  fs,
  path,
  url,
  querystring,
  http,
  https,
  crypto,
  util,
  stream,
  zlib,
  os,
  buffer,
  events,
  string_decoder,
  
  // 大型或可选模块（延迟加载）
  exceljs: lazyLoadModule('exceljs'),
  hyperformula: lazyLoadModule('hyperformula'),
  docx: lazyLoadModule('docx'),
  mammoth: lazyLoadModule('mammoth'),
  'adm-zip': lazyLoadModule('adm-zip'),
  xml2js: lazyLoadModule('xml2js'),
  pptxgenjs: lazyLoadModule('pptxgenjs'),
  echarts: lazyLoadModule('echarts'),
  sharp: lazyLoadModule('sharp'),
  'pdfjs-dist': lazyLoadModule('pdfjs-dist'),
  mysql2: lazyLoadModule('mysql2/promise'),
};

/**
 * 创建测试沙箱
 * @param {object} options - 配置选项
 * @param {number} options.timeout - VM 超时时间（毫秒），默认 30000
 * @param {string} options.cwd - 工作目录，默认 process.cwd()
 * @param {boolean} options.adminMode - 是否启用管理员模式，默认 true
 * @param {string} options.dataBasePath - 数据基础路径，默认 process.cwd()/data
 * @returns {object} 沙箱对象
 */
export function createTestSandbox(options = {}) {
  const {
    timeout = 30000,
    cwd = process.cwd(),
    adminMode = true,
    dataBasePath = path.join(process.cwd(), 'data'),
  } = options;

  const safeEnv = { ...process.env };

  if (adminMode) {
    safeEnv.IS_ADMIN = 'true';
  }
  safeEnv.DATA_BASE_PATH = dataBasePath;

  const context = {
    module: { exports: {} },
    exports: {},
    require: createRequireFn(),
    console: {
      log: (...args) => console.log(...args),
      error: (...args) => console.error(...args),
      warn: (...args) => console.warn(...args),
    },
    process: {
      env: safeEnv,
      cwd: () => cwd,
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

  function createRequireFn() {
    return function (moduleName) {
      const mod = moduleMap[moduleName];
      if (mod) {
        // 如果是延迟加载函数，先执行获取实际模块
        if (typeof mod === 'function') {
          return mod();
        }
        return mod;
      }
      throw new Error(`Module '${moduleName}' is not allowed in sandbox`);
    };
  }

  function loadModule(code, skillId) {
    try {
      vm.runInContext(code, context, {
        timeout,
        displayErrors: true,
      });
    } catch (vmError) {
      throw new Error(`VM execution error: ${vmError.message}`);
    }

    const exports = context.module.exports;
    if (Object.keys(exports).length === 0 && Object.keys(context.exports).length > 0) {
      return context.exports;
    }
    return exports;
  }

  return {
    context,
    /**
     * 加载技能模块
     * @param {string} skillName - 技能名称
     * @returns {object} 技能模块
     */
    loadSkill(skillName) {
      const possiblePaths = [
        path.join(process.cwd(), 'data', 'skills', skillName, 'index.js'),
        path.join(process.cwd(), 'data', 'skills', 'installed', skillName, 'index.js'),
      ];

      for (const skillPath of possiblePaths) {
        if (fs.existsSync(skillPath)) {
          const code = fs.readFileSync(skillPath, 'utf-8');
          return loadModule(code, skillName);
        }
      }

      throw new Error(`Skill not found: ${skillName}`);
    },
    /**
     * 执行技能工具
     * @param {object} skillModule - 技能模块
     * @param {string} toolName - 工具名称
     * @param {object} params - 工具参数
     * @param {object} context - 执行上下文
     * @returns {Promise<any>} 执行结果
     */
    execute(skillModule, toolName, params, context = {}) {
      if (typeof skillModule.execute !== 'function') {
        throw new Error('Skill module does not have execute function');
      }
      return skillModule.execute(toolName, params, context);
    },
  };
}

/**
 * 创建开发调试专用沙箱
 * - 自动启用管理员模式
 * - 默认超时 30 秒
 * - 默认 dataBasePath 为 process.cwd()/data
 * @returns {object} 沙箱对象
 */
export function createDevSandbox() {
  return createTestSandbox({
    timeout: 30000,
    adminMode: true,
  });
}

/**
 * 创建生产环境模拟沙箱
 * - 禁用管理员模式
 * - 默认超时 30 秒
 * @returns {object} 沙箱对象
 */
export function createProductionSandbox() {
  return createTestSandbox({
    timeout: 30000,
    adminMode: false,
  });
}