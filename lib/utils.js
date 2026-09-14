/**
 * 通用工具函数
 */

import crypto from 'crypto';

// 无混淆字符集：去掉 0/o、1/i/l 等易混淆字符（C 方案）
// 随机部分只用 23456789 + 去掉 i/l/o 的小写字母，避免 LLM 抄写 ID 时看错
const SAFE_CHARS = '23456789abcdefghjkmnpqrstuvwxyz'; // 31 字符
const BASE = SAFE_CHARS.length;
const TS_WIDTH = 9;

function timestampPart(ms) {
  let out = '';
  let value = ms;
  for (let index = 0; index < TS_WIDTH; index += 1) {
    out = SAFE_CHARS[value % BASE] + out;
    value = Math.floor(value / BASE);
  }
  return out;
}

function randomDigits(length) {
  return [...crypto.randomBytes(length)].map(byte => byte % BASE);
}

function increment(digits) {
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    if (digits[index] < BASE - 1) {
      digits[index] += 1;
      return true;
    }
    digits[index] = 0;
  }
  return false;
}

const monotonicStates = new Map();

const Utils = {
  /**
   * 生成唯一 ID
   * @param {number} length - ID 长度
   * @returns {string} 唯一 ID
   */
  newID(length = 20) {
    length = Math.max(Number(length) || 20, 10); // 确保长度至少为10
    if (length <= 15) {
      return randomDigits(length)
        .map(digit => SAFE_CHARS[digit])
        .join('')
        .substring(0, length);
    }

    const tsLen = TS_WIDTH;
    const randLen = length - tsLen;
    const currentMs = Date.now();
    let state = monotonicStates.get(randLen);

    if (!state) {
      state = {
        ms: currentMs,
        digits: randomDigits(randLen),
      };
      monotonicStates.set(randLen, state);
    } else if (currentMs > state.ms) {
      state.ms = currentMs;
      state.digits = randomDigits(randLen);
    } else if (!increment(state.digits)) {
      state.ms += 1;
      state.digits = randomDigits(randLen);
    }

    const value = timestampPart(state.ms)
      + state.digits.map(digit => SAFE_CHARS[digit]).join('');
    return value.substring(0, length);
  },

  /**
   * 延迟执行
   * @param {number} ms - 延迟毫秒数
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  /**
   * 安全的 JSON 解析
   * @param {string} str - JSON 字符串
   * @param {*} defaultValue - 解析失败时的默认值
   * @returns {*} 解析结果
   */
  safeJsonParse(str, defaultValue = null) {
    try {
      return JSON.parse(str);
    } catch {
      return defaultValue;
    }
  },

  /**
   * 格式化日期
   * @param {Date|string|number} date - 日期
   * @param {string} format - 格式
   * @returns {string} 格式化后的日期字符串
   */
  formatDate(date, format = 'YYYY-MM-DD HH:mm:ss') {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');

    return format
      .replace('YYYY', year)
      .replace('MM', month)
      .replace('DD', day)
      .replace('HH', hours)
      .replace('mm', minutes)
      .replace('ss', seconds);
  },
};

export default Utils;
