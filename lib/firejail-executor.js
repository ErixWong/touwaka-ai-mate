/**
 * FirejailExecutor - Linux Firejail 沙箱执行器
 * 
 * 使用 Firejail 实现用户隔离
 * 需要 Firejail 已安装: apt install firejail
 */

import { spawn, exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import logger from './logger.js';

// 项目根目录
const PROJECT_ROOT = path.resolve(process.cwd());
const CONFIG_DIR = path.join(PROJECT_ROOT, 'config', 'firejail');

class FirejailExecutor {
  constructor() {
    this.firejailPath = '/usr/bin/firejail';
    this.configDir = CONFIG_DIR;
    
    // 角色到配置文件的映射
    this.roleProfiles = {
      'admin': 'admin.profile',
      'power_user': 'power-user.profile',
      'user': 'user.profile',
    };
  }

  /**
   * 检查 Firejail 是否可用
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    return new Promise((resolve) => {
      exec('which firejail', (error, stdout) => {
        if (error) {
          logger.warn('[FirejailExecutor] Firejail not found');
          resolve(false);
        } else {
          this.firejailPath = stdout.trim();
          logger.info(`[FirejailExecutor] Firejail found at: ${this.firejailPath}`);
          resolve(true);
        }
      });
    });
  }

  /**
   * 获取角色对应的配置文件名
   * @param {string} role - 用户角色
   * @returns {string} 配置文件名
   */
  getProfileName(role) {
    return this.roleProfiles[role] || 'user.profile';
  }

  /**
   * 获取配置文件路径
   * @param {string} role - 用户角色
   * @returns {string} 配置文件完整路径
   */
  getProfilePath(role) {
    return path.join(this.configDir, this.getProfileName(role));
  }

  /**
   * 获取处理后的配置文件内容（替换变量占位符）
   * @param {string} role - 用户角色
   * @param {string} userId - 用户ID
   * @returns {string} 处理后的配置内容
   */
  getProcessedProfileContent(role, userId) {
    const profilePath = this.getProfilePath(role);
    
    // 如果配置文件存在，读取并替换变量
    if (fs.existsSync(profilePath)) {
      let content = fs.readFileSync(profilePath, 'utf-8');
      
      // 替换变量占位符
      content = content
        .replace(/\$\{USER_ID\}/g, userId)
        .replace(/\$\{PROJECT_ROOT\}/g, PROJECT_ROOT);
      
      return content;
    }
    
    // 如果不存在，使用生成的默认配置
    return this.generateProfileContent(role, userId);
  }

  /**
   * 在沙箱中执行命令
   * @param {string} userId - 用户ID
   * @param {string} role - 用户角色
   * @param {string} command - 要执行的命令
   * @param {object} options - 执行选项
   */
  async execute(userId, role, command, options = {}) {
    const timeout = options.timeout || 30000;
    
    // 工作目录
    const workDir = options.cwd 
      ? this.resolveWorkPath(options.cwd, userId)
      : this.getUserWorkDir(userId);

    // 确保工作目录存在
    if (!fs.existsSync(workDir)) {
      fs.mkdirSync(workDir, { recursive: true });
    }

    // 构建 Firejail 参数
    // 注意：不使用配置文件中的变量，而是通过命令行参数直接指定
    const args = this.buildFirejailArgs(userId, role, workDir, command, timeout);

    logger.debug(`[FirejailExecutor] Executing for user ${userId} (role: ${role})`);
    logger.debug(`[FirejailExecutor] WorkDir: ${workDir}`);

    return new Promise((resolve, reject) => {
      const child = spawn(this.firejailPath, args, {
        cwd: workDir,
        env: {
          PATH: process.env.PATH,
          USER_ID: userId,
          WORK_DIR: workDir,
          ROLE: role,
          HOME: workDir,
        },
        timeout,
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        resolve({
          success: code === 0,
          code,
          stdout: stdout.slice(0, 50000),  // 限制输出大小
          stderr: stderr.slice(0, 10000),
          timedOut,
        });
      });

      child.on('error', (error) => {
        logger.error(`[FirejailExecutor] Process error: ${error.message}`);
        reject(new Error(`Firejail execution failed: ${error.message}`));
      });

      // 超时处理
      setTimeout(() => {
        timedOut = true;
        child.kill();
        resolve({
          success: false,
          code: -1,
          stdout,
          stderr: stderr + '\n[Timeout] Command execution timed out',
          timedOut: true,
        });
      }, timeout);
    });
  }

  /**
   * 构建 Firejail 命令行参数
   * 根据角色动态构建权限参数，不依赖配置文件中的变量占位符
   * @param {string} userId - 用户ID
   * @param {string} role - 用户角色
   * @param {string} workDir - 工作目录
   * @param {string} command - 要执行的命令
   * @param {number} timeout - 超时时间
   * @returns {Array} Firejail 参数数组
   */
  buildFirejailArgs(userId, role, workDir, command, timeout) {
    const userWorkDir = this.getUserWorkDir(userId);
    const skillsDir = path.join(PROJECT_ROOT, 'skills');
    
    // 基础参数
    const args = [
      '--quiet',
      `--env=USER_ID=${userId}`,
      `--env=WORK_DIR=${workDir}`,
      `--env=ROLE=${role}`,
    ];

    // 根据角色添加权限控制
    if (role === 'admin') {
      // 管理员：完整项目访问
      args.push(`--private=${PROJECT_ROOT}`);
      args.push('--rlimit-as=2G');
      args.push('--rlimit-nproc=200');
    } else if (role === 'power_user') {
      // Power User：技能目录读写 + 用户工作目录
      args.push(`--whitelist=${skillsDir}`);
      args.push(`--whitelist=${userWorkDir}`);
      args.push(`--blacklist=${path.join(PROJECT_ROOT, '.env')}`);
      args.push('--rlimit-as=1G');
      args.push('--rlimit-nproc=100');
    } else {
      // 普通用户：用户工作目录读写 + 技能目录只读
      args.push(`--whitelist=${userWorkDir}`);
      args.push(`--read-only=${skillsDir}`);
      args.push(`--blacklist=${path.join(PROJECT_ROOT, '.env')}`);
      args.push('--rlimit-as=512M');
      args.push('--rlimit-nproc=50');
    }

    // 安全增强
    args.push('--seccomp');
    if (role !== 'admin') {
      args.push('--caps.drop=all');
    }

    // 网络
    args.push('--netfilter');

    // 执行命令
    args.push('sh', '-c', command);

    return args;
  }

  /**
   * 获取用户工作目录
   * @param {string} userId - 用户ID
   * @returns {string} 工作目录路径
   */
  getUserWorkDir(userId) {
    return path.join(PROJECT_ROOT, 'data', 'work', userId);
  }

  /**
   * 解析工作路径
   * @param {string} cwd - 相对或绝对路径
   * @param {string} userId - 用户ID
   * @returns {string} 解析后的路径
   */
  resolveWorkPath(cwd, userId) {
    if (path.isAbsolute(cwd)) {
      return cwd;
    }
    
    // 相对路径基于用户工作目录
    return path.join(this.getUserWorkDir(userId), cwd);
  }

  /**
   * 生成 Firejail 配置文件内容
   * @param {string} role - 用户角色
   * @returns {string} 配置文件内容
   */
  generateProfileContent(role) {
    const projectRoot = PROJECT_ROOT;
    
    const profiles = {
      'user': `# Firejail profile for regular users
# User work directory (read-write)
whitelist ${projectRoot}/data/work/\${USER_ID}

# Skills directory (read-only)
read-only ${projectRoot}/skills

# Block sensitive files
blacklist ${projectRoot}/.env
blacklist ${projectRoot}/*.key
blacklist ${projectRoot}/*.pem

# Resource limits
rlimit-as 512M
rlimit-nproc 50

# Network
netfilter
`,
      'power_user': `# Firejail profile for power users
# Skills directory (read-write)
whitelist ${projectRoot}/skills

# User work directory (read-write)
whitelist ${projectRoot}/data/work/\${USER_ID}

# Block sensitive files
blacklist ${projectRoot}/.env
blacklist ${projectRoot}/*.key
blacklist ${projectRoot}/*.pem

# Resource limits
rlimit-as 1G
rlimit-nproc 100

# Network
netfilter
`,
      'admin': `# Firejail profile for admin
# Full access to project
private ${projectRoot}

# Network
netfilter
`,
    };

    return profiles[role] || profiles['user'];
  }

  /**
   * 初始化配置文件目录
   * 创建默认的 Firejail 配置文件
   */
  async initializeConfigDir() {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }

    for (const role of Object.keys(this.roleProfiles)) {
      const profilePath = this.getProfilePath(role);
      if (!fs.existsSync(profilePath)) {
        const content = this.generateProfileContent(role);
        fs.writeFileSync(profilePath, content, 'utf-8');
        logger.info(`[FirejailExecutor] Created profile: ${profilePath}`);
      }
    }
  }
}

export default FirejailExecutor;