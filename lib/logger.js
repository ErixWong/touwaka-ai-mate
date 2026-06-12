/**
 * 日志工具
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DEFAULT_MAX_LOG_ARG_LENGTH = 4000;
const DEFAULT_MAX_LOG_LINE_LENGTH = 12000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class Logger {
  constructor(logDir = './logs') {
    this.logDir = logDir;
    this.logFile = path.join(logDir, `log-${Date.now()}.txt`);
    this.maxArgLength = Number(process.env.LOG_MAX_ARG_LENGTH || DEFAULT_MAX_LOG_ARG_LENGTH);
    this.maxLineLength = Number(process.env.LOG_MAX_LINE_LENGTH || DEFAULT_MAX_LOG_LINE_LENGTH);
    
    // 确保日志目录存在
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  safeStringify(value) {
    const seen = new WeakSet();
    return JSON.stringify(value, (key, currentValue) => {
      if (typeof currentValue === 'string') {
        if (currentValue.length > this.maxArgLength) {
          return {
            __type: 'truncated_string',
            length: currentValue.length,
            preview: `${currentValue.slice(0, this.maxArgLength)}…`,
          };
        }
        return currentValue;
      }

      if (typeof currentValue === 'object' && currentValue !== null) {
        if (seen.has(currentValue)) {
          return '[Circular]';
        }
        seen.add(currentValue);
      }

      return currentValue;
    });
  }

  formatArg(arg) {
    if (typeof arg === 'string') {
      return arg.length > this.maxArgLength
        ? `${arg.slice(0, this.maxArgLength)}… [truncated ${arg.length - this.maxArgLength} chars]`
        : arg;
    }

    if (typeof arg === 'object' && arg !== null) {
      try {
        const text = this.safeStringify(arg);
        return text.length > this.maxArgLength
          ? `${text.slice(0, this.maxArgLength)}… [truncated ${text.length - this.maxArgLength} chars]`
          : text;
      } catch (error) {
        return `[Unserializable object: ${error.message}]`;
      }
    }

    const text = String(arg);
    return text.length > this.maxArgLength
      ? `${text.slice(0, this.maxArgLength)}… [truncated ${text.length - this.maxArgLength} chars]`
      : text;
  }

  truncateLogLine(line) {
    if (line.length <= this.maxLineLength) return line;
    return `${line.slice(0, this.maxLineLength)}… [log truncated ${line.length - this.maxLineLength} chars]`;
  }

  formatMessage(level, message, ...args) {
    const timestamp = new Date().toISOString();
    let formattedMessage = message;
    if (args.length > 0) {
      formattedMessage += ' ' + args.map(arg => this.formatArg(arg)).join(' ');
    }
    return this.truncateLogLine(`[${timestamp}] [${level}] ${formattedMessage}`);
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
