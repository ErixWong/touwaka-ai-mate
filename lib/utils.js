/**
 * 通用工具函数
 */

import crypto from 'crypto';

const Utils = {
  /**
   * 生成唯一 ID
   * @param {number} length - ID 长度
   * @returns {string} 唯一 ID
   */
  newID(length = 20) {
    length = Math.max(Number(length) || 20, 10); // 确保长度至少为10
    // 生成指定长度的随机字节并转换为36进制字符串
    let value = [...crypto.randomBytes(Math.ceil(length * 0.8))].map(byte => (byte % 36).toString(36)).join('');

    // 前8位用时间戳，方便数据库排序
    if (length > 15) {
        value = Date.now().toString(36) + value;
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
