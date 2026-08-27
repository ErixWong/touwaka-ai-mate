/**
 * User Validation Service - 用户名校验共享规则
 *
 * 创建用户（user.controller.js）与注册（auth.controller.js）共用，
 * 保证两端用户名规则完全一致，避免规则漂移。
 *
 * 规则：
 * - 普通用户名：字母开头，仅字母、数字、下划线，6-16 位
 * - 邮箱用户名：允许使用合法邮箱格式作为用户名（如 alice@corp.com）
 */

// 普通用户名：字母开头，仅字母、数字、下划线，6-16 位
export const USERNAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_]{5,15}$/;

// 邮箱格式（与 email 字段共用同一套规则）
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 用户名最大长度（与数据库 username VARCHAR(32) 对齐，邮箱用户名同样受限）
export const USERNAME_MAX_LENGTH = 32;

/**
 * 判断字符串是否为合法邮箱格式
 * @param {string} value
 * @returns {boolean}
 */
export function isEmailFormat(value) {
  if (typeof value !== 'string') return false;
  return EMAIL_REGEX.test(value);
}

/**
 * 判断用户名是否合法（普通用户名 或 邮箱格式）
 * @param {string} username
 * @returns {boolean}
 */
export function isValidUsername(username) {
  if (typeof username !== 'string') return false;
  if (username.length > USERNAME_MAX_LENGTH) return false;
  return USERNAME_REGEX.test(username) || EMAIL_REGEX.test(username);
}

/**
 * 用户名格式错误提示文案
 * @returns {string}
 */
export function usernameErrorHint() {
  return '用户名格式不正确：需以字母开头、仅字母、数字、下划线、长度6-16位，或使用合法邮箱格式';
}
