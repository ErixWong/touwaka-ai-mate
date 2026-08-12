/**
 * 通用工具函数
 */

import crypto from 'crypto';

// 无混淆字符集：去掉 0/o、1/i/l 等易混淆字符（C 方案）
// 随机部分只用 23456789 + 去掉 i/l/o 的小写字母，避免 LLM 抄写 ID 时看错
const SAFE_CHARS = '23456789abcdefghjkmnpqrstuvwxyz'; // 31 字符

// 时间戳前缀（base36）中可能出现的混淆字符 → 安全映射
// 0→2, o→p, 1→3, i→j, l→m（映射到字符集中仍存在的字符）
const CONFUSABLE_MAP = {
  '0': '2',
  'o': 'p',
  '1': '3',
  'i': 'j',
  'l': 'm',
};

function toSafeChars(str) {
  let out = '';
  for (const ch of str) {
    out += CONFUSABLE_MAP[ch] || ch;
  }
  return out;
}

const Utils = {
  /**
   * 生成唯一 ID
   * @param {number} length - ID 长度
   * @returns {string} 唯一 ID
   */
  newID(length = 20) {
    length = Math.max(Number(length) || 20, 10); // 确保长度至少为10
    // 随机部分：从无混淆字符集中采样（31 字符，mod 31 无偏）
    let value = [...crypto.randomBytes(length)]
      .map(byte => SAFE_CHARS[byte % SAFE_CHARS.length])
      .join('');

    // 前 8 位用时间戳，方便数据库排序（时间戳转 36 进制后替换混淆字符）
    if (length > 15) {
      const ts = toSafeChars(Date.now().toString(36));
      value = ts + value;
    }

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
