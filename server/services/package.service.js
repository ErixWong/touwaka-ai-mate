/**
 * PackageService - 包管理服务
 * 
 * 提供已安装包列表获取和白名单管理功能
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import logger from '../../lib/logger.js';

const execAsync = promisify(exec);

// 默认白名单配置
const DEFAULT_WHITELIST = {
  allowed_node_modules: [
    'fs', 'path', 'url', 'querystring', 'crypto',
    'util', 'stream', 'http', 'https', 'zlib',
    'string_decoder', 'buffer', 'events', 'os',
    'mysql2', 'mysql2/promise',
  ],
  allowed_python_packages: [
    'os', 'sys', 'json', 're', 'pathlib', 'typing',
    'datetime', 'collections', 'itertools', 'functools',
    'io', 'math', 'copy', 'tempfile', 'shutil',
  ],
};

class PackageService {
  constructor(db) {
    this.db = db;
    this.SystemSetting = db.getModel('system_setting');
    this.cache = null;
    this.cacheTime = null;
    this.cacheTTL = 60000; // 缓存 60 秒
  }

  /**
   * 获取已安装的 Node.js 包列表
   * @returns {Promise<Array<{name: string, version: string}>>}
   */
  async getNodePackages() {
    try {
      const { stdout } = await execAsync('npm list --json --depth=0', {
        cwd: process.cwd(),
        maxBuffer: 1024 * 1024, // 1MB buffer
      });
      
      const data = JSON.parse(stdout);
      const packages = [];
      
      // npm list 输出格式: { dependencies: { "package-name": { version: "x.x.x" } } }
      if (data.dependencies) {
        for (const [name, info] of Object.entries(data.dependencies)) {
          packages.push({
            name,
            version: info.version || 'unknown',
          });
        }
      }
      
      return packages.sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      logger.error('Failed to get Node.js packages:', error);
      // 如果 npm list 失败，返回空数组
      return [];
    }
  }

  /**
   * 获取已安装的 Python 包列表
   * @returns {Promise<Array<{name: string, version: string}>>}
   */
  async getPythonPackages() {
    try {
      // 检测 Python 命令
      const pythonCmd = process.env.PYTHON_PATH || 'python3';
      
      const { stdout } = await execAsync(`"${pythonCmd}" -m pip list --format=json`, {
        maxBuffer: 1024 * 1024, // 1MB buffer
      });
      
      const packages = JSON.parse(stdout);
      return packages
        .map(pkg => ({
          name: pkg.name,
          version: pkg.version || 'unknown',
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      logger.error('Failed to get Python packages:', error);
      // 如果 pip list 失败，返回空数组
      return [];
    }
  }

  /**
   * 获取所有已安装的包列表
   * @returns {Promise<{node: Array, python: Array}>}
   */
  async getAllPackages() {
    const [node, python] = await Promise.all([
      this.getNodePackages(),
      this.getPythonPackages(),
    ]);
    
    return { node, python };
  }

  /**
   * 获取包白名单配置
   * @param {boolean} forceRefresh - 是否强制刷新缓存
   * @returns {Promise<Object>} 白名单配置
   */
  async getWhitelist(forceRefresh = false) {
    // 检查缓存
    if (!forceRefresh && this.cache && this.cacheTime && (Date.now() - this.cacheTime < this.cacheTTL)) {
      return this.cache;
    }

    try {
      const [nodeSetting, pythonSetting] = await Promise.all([
        this.SystemSetting.findOne({ where: { setting_key: 'allowed_node_modules' }, raw: true }),
        this.SystemSetting.findOne({ where: { setting_key: 'allowed_python_packages' }, raw: true }),
      ]);

      const result = {
        allowed_node_modules: nodeSetting 
          ? JSON.parse(nodeSetting.setting_value) 
          : DEFAULT_WHITELIST.allowed_node_modules,
        allowed_python_packages: pythonSetting 
          ? JSON.parse(pythonSetting.setting_value) 
          : DEFAULT_WHITELIST.allowed_python_packages,
      };

      this.cache = result;
      this.cacheTime = Date.now();
      
      return result;
    } catch (error) {
      logger.error('Failed to get package whitelist:', error);
      return DEFAULT_WHITELIST;
    }
  }

  /**
   * 更新包白名单配置
   * @param {Object} whitelist - 白名单配置
   * @returns {Promise<Object>} 更新后的配置
   */
  async updateWhitelist(whitelist) {
    const updates = [];
    
    if (whitelist.allowed_node_modules) {
      // 验证是否为数组
      if (!Array.isArray(whitelist.allowed_node_modules)) {
        throw new Error('allowed_node_modules must be an array');
      }
      updates.push({
        key: 'allowed_node_modules',
        value: JSON.stringify(whitelist.allowed_node_modules),
      });
    }
    
    if (whitelist.allowed_python_packages) {
      // 验证是否为数组
      if (!Array.isArray(whitelist.allowed_python_packages)) {
        throw new Error('allowed_python_packages must be an array');
      }
      updates.push({
        key: 'allowed_python_packages',
        value: JSON.stringify(whitelist.allowed_python_packages),
      });
    }

    // 批量更新
    for (const update of updates) {
      await this.SystemSetting.upsert({
        setting_key: update.key,
        setting_value: update.value,
        value_type: 'json',
        description: update.key === 'allowed_node_modules' 
          ? 'Node.js 允许的模块白名单' 
          : 'Python 允许的包白名单',
        updated_at: new Date(),
      });
    }

    // 清除缓存
    this.clearCache();

    // 返回更新后的配置
    return await this.getWhitelist(true);
  }

  /**
   * 获取默认白名单
   * @returns {Object} 默认白名单配置
   */
  getDefaultWhitelist() {
    return JSON.parse(JSON.stringify(DEFAULT_WHITELIST));
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this.cache = null;
    this.cacheTime = null;
  }
}

// 单例实例
let instance = null;

/**
 * 获取 PackageService 单例
 * @param {Object} db - 数据库实例
 * @returns {PackageService}
 */
export function getPackageService(db) {
  if (!instance && db) {
    instance = new PackageService(db);
  }
  return instance;
}

export { DEFAULT_WHITELIST };
export default PackageService;