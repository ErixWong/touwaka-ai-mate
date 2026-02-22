/**
 * 日志工具
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class Logger {
  constructor(logDir = './logs') {
    this.logDir = logDir;
    this.logFile = path.join(logDir, `log-${Date.now()}.txt`);
    
    // 确保日志目录存在
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  formatMessage(level, message, ...args) {
    const timestamp = new Date().toISOString();
    let formattedMessage = message;
    if (args.length > 0) {
      formattedMessage += ' ' + args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
      ).join(' ');
    }
    return `[${timestamp}] [${level}] ${formattedMessage}`;
  }

  info(message, ...args) {
    const logLine = this.formatMessage('INFO', message, ...args);
    console.log(logLine);
    fs.appendFileSync(this.logFile, logLine + '\n', 'utf-8');
  }

  error(message, ...args) {
    const logLine = this.formatMessage('ERROR', message, ...args);
    console.error(logLine);
    fs.appendFileSync(this.logFile, logLine + '\n', 'utf-8');
  }

  warn(message, ...args) {
    const logLine = this.formatMessage('WARN', message, ...args);
    console.warn(logLine);
    fs.appendFileSync(this.logFile, logLine + '\n', 'utf-8');
  }

  debug(message, ...args) {
    const logLevel = process.env.LOG_LEVEL || 'info';
    if (logLevel === 'debug') {
      const logLine = this.formatMessage('DEBUG', message, ...args);
      console.log(logLine);
      fs.appendFileSync(this.logFile, logLine + '\n', 'utf-8');
    }
  }
}

// 导出单例实例
export default new Logger();
