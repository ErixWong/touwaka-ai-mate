/**
 * PackageService - 包管理服务
 * 
 * 提供已安装包列表获取和白名单管理功能
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import logger from '../../lib/logger.js';

const execAsync = promisify(exec);

// 默认白名单配置（空数组，实际值从数据库加载）
const DEFAULT_WHITELIST = {
  allowed_node_modules: [],
  allowed_python_packages: [],
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

  /**
   * 验证包名格式（防止命令注入）
   * @param {string} name - 包名
   * @returns {boolean} 是否合法
   */
  validatePackageName(name) {
    // 允许：字母、数字、连字符、下划线、点、@符号（用于 scope）
    // 格式：@scope/package-name 或 package-name
    const pattern = /^(@[a-zA-Z0-9_-]+\/)?[a-zA-Z0-9_.-]+$/;
    return pattern.test(name);
  }

  /**
   * 验证版本号格式
   * @param {string} version - 版本号
   * @returns {boolean} 是否合法
   */
  validateVersion(version) {
    if (!version) return true; // 可选字段
    // 允许：semver 格式（1.2.3, ^1.2.3, ~1.2.3, 1.2.x, *, latest 等）
    const pattern = /^[\^~]?\d+\.\d+\.\d+(-[\w.]+)?$|^[\^~]?\d+\.\d+\.x$|^[\^~]?\d+\.x$|^\*$|^latest$/;
    return pattern.test(version);
  }

  /**
   * 安装 Node.js 包
   * @param {string} name - 包名
   * @param {string} version - 版本号（可选）
   * @returns {Promise<{success: boolean, message: string, package?: object}>}
   */
  async installNodePackage(name, version = null) {
    if (!this.validatePackageName(name)) {
      return {
        success: false,
        message: `Invalid package name: ${name}`,
      };
    }

    if (version && !this.validateVersion(version)) {
      return {
        success: false,
        message: `Invalid version format: ${version}`,
      };
    }

    try {
      const packageSpec = version ? `${name}@${version}` : name;
      logger.info(`Installing Node.js package: ${packageSpec}`);

      const { stdout, stderr } = await execAsync(`npm install ${packageSpec}`, {
        cwd: process.cwd(),
        maxBuffer: 1024 * 1024 * 5, // 5MB buffer
        timeout: 5 * 60 * 1000, // 5 分钟超时
      });

      // 检查安装结果
      if (stderr && !stderr.includes('npm WARN')) {
        logger.warn(`npm install stderr: ${stderr}`);
      }

      // 获取安装后的版本
      const installedPackages = await this.getNodePackages();
      const installed = installedPackages.find(pkg => pkg.name === name);

      if (installed) {
        logger.info(`Successfully installed Node.js package: ${name}@${installed.version}`);
        return {
          success: true,
          message: 'Package installed successfully',
          package: {
            name: installed.name,
            version: installed.version,
          },
        };
      } else {
        return {
          success: false,
          message: 'Package installation completed but package not found in list',
        };
      }
    } catch (error) {
      logger.error(`Failed to install Node.js package ${name}:`, error);
      return {
        success: false,
        message: `Installation failed: ${error.message}`,
      };
    }
  }

  /**
   * 安装 Python 包
   * @param {string} name - 包名
   * @param {string} version - 版本号（可选）
   * @returns {Promise<{success: boolean, message: string, package?: object}>}
   */
  async installPythonPackage(name, version = null) {
    if (!this.validatePackageName(name)) {
      return {
        success: false,
        message: `Invalid package name: ${name}`,
      };
    }

    if (version && !this.validateVersion(version)) {
      return {
        success: false,
        message: `Invalid version format: ${version}`,
      };
    }

    try {
      const pythonCmd = process.env.PYTHON_PATH || 'python3';
      const packageSpec = version ? `${name}==${version}` : name;
      logger.info(`Installing Python package: ${packageSpec}`);

      const { stdout, stderr } = await execAsync(`"${pythonCmd}" -m pip install ${packageSpec} -i https://pypi.tuna.tsinghua.edu.cn/simple`, {
        maxBuffer: 1024 * 1024 * 5, // 5MB buffer
        timeout: 10 * 60 * 1000, // 10 分钟超时（PyMuPDF 需要更长时间）
      });

      // pip 通常在 stderr 输出信息
      if (stderr && !stderr.includes('Successfully installed')) {
        logger.warn(`pip install stderr: ${stderr}`);
      }

      // 获取安装后的版本
      const installedPackages = await this.getPythonPackages();
      // pip list 返回的包名可能有不同的大小写，需要忽略大小写匹配
      const installed = installedPackages.find(pkg => 
        pkg.name.toLowerCase() === name.toLowerCase()
      );

      if (installed) {
        logger.info(`Successfully installed Python package: ${installed.name}@${installed.version}`);
        return {
          success: true,
          message: 'Package installed successfully',
          package: {
            name: installed.name,
            version: installed.version,
          },
        };
      } else {
        return {
          success: false,
          message: 'Package installation completed but package not found in list',
        };
      }
    } catch (error) {
      logger.error(`Failed to install Python package ${name}:`, error);
      return {
        success: false,
        message: `Installation failed: ${error.message}`,
      };
    }
  }

  /**
   * 安装包（统一入口）
   * @param {string} type - 包类型 ('nodejs' | 'python')
   * @param {string} name - 包名
   * @param {string} version - 版本号（可选）
   * @returns {Promise<{success: boolean, message: string, package?: object}>}
   */
  async installPackage(type, name, version = null) {
    if (type === 'nodejs') {
      return await this.installNodePackage(name, version);
    } else if (type === 'python') {
      return await this.installPythonPackage(name, version);
    } else {
      return {
        success: false,
        message: `Unsupported package type: ${type}`,
      };
    }
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