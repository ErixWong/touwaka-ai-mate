/**
 * Notes Policy - Notes 治理策略单一来源
 *
 * 设计（issue #1132 决策 3 修订，原 Redis 方案作废）：
 * - NOTES_TTL_SECONDS 是 Notes TTL 的唯一配置入口；
 * - note_record.expires_at（BIGINT ms）为 TTL 唯一权威，record.expires_at 是同一 deadline 的镜像；
 * - scopeRef = user_id + expert_id 稳定派生（跨请求工作记忆），禁用 request_id/run_id；
 * - erix 协议字段保留 camelCase（scopeRef/expires_at 等），touwaka 自有扩展字段用 snake_case。
 */

import { createHash } from 'node:crypto';
import { isNoteRecord } from 'erix-agent';

/**
 * Notes TTL 单一来源（秒）。旧实现散落在 tool-manager / psyche-store /
 * notes-manager 三处，本文件为唯一权威。
 */
export const NOTES_TTL_SECONDS = Number.parseInt(process.env.NOTES_TTL_SECONDS || '86400', 10);

const SCOPE_REF_PREFIX = 'notes-v1';
const HASH_LENGTH = 24;

function hash24(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, HASH_LENGTH);
}

/**
 * 由 user_id + expert_id 稳定派生 erix scopeRef。
 * 同一 (user_id, expert_id) 永远得到同一 scopeRef（跨请求工作记忆）；
 * 禁止传入 request_id/run_id 等单请求标识。
 *
 * @param {string} user_id - 用户 ID
 * @param {string} expert_id - 专家 ID
 * @returns {string} 稳定 scopeRef，形如 notes-v1:<sha256-24>
 */
export function buildNotesScopeRef(user_id, expert_id) {
  if (typeof user_id !== 'string' || user_id.length === 0) {
    throw new TypeError('buildNotesScopeRef requires a non-empty user_id');
  }
  if (typeof expert_id !== 'string' || expert_id.length === 0) {
    throw new TypeError('buildNotesScopeRef requires a non-empty expert_id');
  }
  return `${SCOPE_REF_PREFIX}:${hash24(`${user_id}\u0000${expert_id}`)}`;
}

/**
 * 校验并返回 NoteRecord，非法时抛 TypeError（不静默）。
 * 复用 erix 0.10.0 的 isNoteRecord 契约，保留额外扩展字段。
 *
 * @param {unknown} record - 待校验记录
 * @param {{key?: string, scopeRef?: string}} [expected] - 期望的 key / scopeRef
 * @returns {object} 原 record（类型收窄为 NoteRecord）
 */
export function assertNoteRecord(record, expected = {}) {
  if (!isNoteRecord(record, expected)) {
    throw new TypeError('Notes store requires a valid erix NoteRecord');
  }
  return record;
}

/**
 * 统一注入 expires_at：note_record.expires_at 列为唯一权威，本字段为同一 deadline 的镜像。
 * erix note_take 默认保留旧记录的 expires_at（src/tools/notes.js），适配层必须覆盖，
 * 否则双源漂移。
 *
 * @param {object} record - NoteRecord
 * @param {number} ttlSeconds - TTL（秒）
 * @param {number} nowMs - 当前时间（ms）
 * @returns {object} 注入了 expires_at 的新记录（不改原对象）
 */
export function withUniformExpiresAt(record, ttlSeconds, nowMs) {
  const expiresMs = nowMs + ttlSeconds * 1000;
  return {
    ...record,
    expires_at: new Date(expiresMs).toISOString(),
  };
}

/**
 * 计算 expires_at ISO 串（与 PXAT 同一 deadline）。
 * @param {number} ttlSeconds
 * @param {number} nowMs
 * @returns {string} ISO 时间串
 */
export function expiresAtIso(ttlSeconds, nowMs) {
  return new Date(nowMs + ttlSeconds * 1000).toISOString();
}
