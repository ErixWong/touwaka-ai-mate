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
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;
const HASHED_RUN_REF_PATTERN = /^run-h-[0-9a-f]{24}$/;

function hash24(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex').slice(0, HASH_LENGTH);
}

/**
 * Canonicalize a scopeRef for storage identifiers.
 *
 * @param {string} value - Complete scopeRef
 * @returns {string} Safe stable run identifier
 */
export function canonicalizeNotesScopeRef(value) {
  if (typeof value !== 'string') {
    throw new TypeError('canonicalizeNotesScopeRef requires a string');
  }
  if (HASHED_RUN_REF_PATTERN.test(value)) return value;
  if (SAFE_ID_PATTERN.test(value)
    && value !== '.'
    && value !== '..'
    && !value.startsWith('run-h-')) {
    return value;
  }
  return `run-h-${hash24(value)}`;
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

// ---------------------------------------------------------------------------
// erix NotesStore 端口的 list filters 语义（issue #1210）
//
// 上游 erix-agent 0.19.0 把 `normalizeListFilters` / `matchesListFilters` 抽进
// src/store/notes-port.js，但**没有从包根导出**（`src/index.js` 里点名不到，`exports`
// 只放开 `.` 与 `./tools`），宿主侧只能自行实现同一份语义——本文件就是那份实现，
// 与上游逐条对齐：
//   · state：标量或数组都收（上游 `Array.isArray(v) ? v : [v]`），**空数组必须抛**
//     （空数组既不是「全不过滤」也不是「静默清空」），非法枚举同样抛；
//   · tag：必须是非空判断之外的「字符串」，否则抛；
//   · source：只认 'agent' | 'auto'，其余（含 null / 未知串）一律抛；
//   · minRelevance：必须是 [0,1] 的有限数字，否则抛；
//   · 未知键（上游同样）忽略，不报错。
// 非法值抛 TypeError 且 message 含 `filters.<键>`：契约套件按 /filters\.state/ 与
// /filters\.source/ 匹配文案，静默不过滤或静默清空都算违约。
// ---------------------------------------------------------------------------

/** NoteRecord 的合法 state 集合（与上游 notes-port.STATES 同集合）。 */
export const NOTE_LIST_STATES = new Set(['active', 'done', 'revoked']);

/** filters.source 的合法取值（与上游 notes-port.normalizeListFilters 同集合）。 */
export const NOTE_LIST_SOURCES = new Set(['agent', 'auto']);

/** relevance 缺失/非有限数字时的兜底值（上游 matchesListFilters 同值）。 */
const DEFAULT_RELEVANCE = 0.5;

/**
 * 归一化 list 请求的 filters（上游 normalizeListFilters 同语义，非法值抛 TypeError）。
 *
 * @param {unknown} filters - 请求里的 request.filters（可为 undefined/null）
 * @returns {{state?: Set<string>, tag?: string, source?: 'agent'|'auto', minRelevance?: number}}
 *   归一化结果；`state` 归成 Set（与上游一致，matchesListFilters 按 Set.has 判定）
 */
export function normalizeListFilters(filters) {
  if (filters === undefined || filters === null) return {};
  if (typeof filters !== 'object' || Array.isArray(filters)) {
    throw new TypeError('NotesStore filters must be an object');
  }

  const normalized = {};

  if (filters.state !== undefined) {
    const states = Array.isArray(filters.state) ? filters.state : [filters.state];
    if (states.length === 0 || states.some((state) => !NOTE_LIST_STATES.has(state))) {
      throw new TypeError('NotesStore filters.state must be "active", "done", "revoked" or an array of them');
    }
    normalized.state = new Set(states);
  }
  if (filters.tag !== undefined) {
    if (typeof filters.tag !== 'string') {
      throw new TypeError('NotesStore filters.tag must be a string');
    }
    normalized.tag = filters.tag;
  }
  if (filters.source !== undefined) {
    if (!NOTE_LIST_SOURCES.has(filters.source)) {
      throw new TypeError('NotesStore filters.source must be "agent" or "auto"');
    }
    normalized.source = filters.source;
  }
  if (filters.minRelevance !== undefined) {
    if (!Number.isFinite(filters.minRelevance)
      || filters.minRelevance < 0
      || filters.minRelevance > 1) {
      throw new TypeError('NotesStore filters.minRelevance must be a number between 0 and 1');
    }
    normalized.minRelevance = filters.minRelevance;
  }
  return normalized;
}

/**
 * 判断记录是否匹配归一化后的 filters（上游 matchesListFilters 同语义）。
 *
 * source 取自 `current.provenance.source`：**只有字面量 'auto' 算 auto**，其余
 * （缺失、拼错、null）一律归 'agent'——上游就是这么分类的，别自作聪明改成白名单。
 * relevance 非有限数字时按 0.5 参与比较（上游同口径）。
 *
 * @param {object} record - NoteRecord（已过 assertNoteRecord 亦可，本函数不校验）
 * @param {{state?: Set<string>|string[], tag?: string, source?: string, minRelevance?: number}} [filters]
 * @returns {boolean}
 */
export function matchesListFilters(record, filters = {}) {
  if (!filters || Object.keys(filters).length === 0) return true;

  if (filters.state !== undefined) {
    const states = filters.state instanceof Set
      ? filters.state
      : new Set(Array.isArray(filters.state) ? filters.state : [filters.state]);
    if (!states.has(record?.state)) return false;
  }
  if (filters.tag !== undefined) {
    const tags = Array.isArray(record?.tags) ? record.tags : [];
    if (!tags.includes(filters.tag)) return false;
  }
  if (filters.source !== undefined) {
    const source = record?.current?.provenance?.source === 'auto' ? 'auto' : 'agent';
    if (source !== filters.source) return false;
  }
  if (filters.minRelevance !== undefined) {
    const relevance = Number.isFinite(record?.relevance) ? record.relevance : DEFAULT_RELEVANCE;
    if (relevance < filters.minRelevance) return false;
  }
  return true;
}
