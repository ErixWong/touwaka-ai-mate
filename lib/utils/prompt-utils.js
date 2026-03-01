/**
 * 提示词工具函数
 */

/**
 * 格式化列表字段
 * @param {Array|string} field - 列表字段（数组或字符串）
 * @returns {string|null} 格式化后的字符串，空则返回 null
 */
export function formatListField(field) {
  if (!field) return null;
  if (Array.isArray(field)) {
    if (field.length === 0) return null;
    return field.map((v, i) => `${i + 1}. ${v}`).join('\n');
  }
  return field || null;
}