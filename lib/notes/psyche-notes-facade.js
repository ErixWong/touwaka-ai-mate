/**
 * Psyche Notes Facade - 宿主 Psyche 侧笔记门面
 *
 * 唯一宿主入口：`take(user_id, expert_id, key, note, ttl)`（DESIGN-REVIEW §2）：
 * - 宿主 note {content, type, relevance, metadata} → erix NoteRecord；
 * - 单次直写（LWW，issue #1203：同 key 并发后写覆盖，不重试、不做版本校验）；
 * - 统一注入 expires_at（expires_at 为 TTL 唯一权威， MariaDB 列与该字段同源）；
 * - 只返回 {overwritten: boolean}，不让 PsycheManager 感知 erix 细节；
 * - 不实现 erix NotesStore 端口（无 write/read/list/complete/janitor）——
 *   与 ErixNotesStoreAdapter 互不依赖、互不实现对方接口（禁止两栖）。
 */

import {
  NOTES_TTL_SECONDS,
  buildNotesScopeRef,
  expiresAtIso,
} from './notes-policy.js';

const MAX_SUPERSEDED = 3;

function buildRecord({ key, scopeRef, note, old, nowMs, ttlSeconds }) {
  const ts = new Date(nowMs).toISOString();
  const previousCurrent = old?.current && typeof old.current === 'object'
    ? { ...old.current, invalid: true }
    : null;
  const superseded = old
    ? [...(Array.isArray(old.superseded) ? old.superseded : []), previousCurrent].filter(Boolean).slice(-MAX_SUPERSEDED)
    : [];
  const noteType = typeof note?.type === 'string' && note.type ? note.type : 'general';
  const content = typeof note?.content === 'string' ? note.content : '';

  return {
    key,
    scope: 'run',
    scopeRef,
    current: {
      content,
      provenance: { source: 'auto', verified: true, ts },
      ts,
    },
    superseded,
    folded: 0,
    pinned: false,
    tags: [noteType],
    relevance: Number.isFinite(note?.relevance) ? note.relevance : 0.5,
    state: 'active',
    created_at: typeof old?.created_at === 'string' ? old.created_at : ts,
    updated_at: ts,
    expires_at: expiresAtIso(ttlSeconds, nowMs),
    ...(note?.metadata && typeof note.metadata === 'object'
      ? { legacy_metadata: { ...note.metadata, note_type: noteType } }
      : {}),
    // record_version 由底层 store 生成与管理（每次写一个新串，仅作写入指纹，
    // 不再作并发判据，issue #1203），此处不预置
  };
}

export class PsycheNotesFacade {
  /**
   * @param {object} options
   * @param {object} options.store - DbNoteRecordStore（或其 duck-type 等价物，测试注入）
   * @param {() => number} [options.clock] - 时钟（ms）
   * @param {number} [options.ttlSeconds] - 默认 TTL（秒），默认 NOTES_TTL_SECONDS
   */
  constructor({ store, clock = () => Date.now(), ttlSeconds = NOTES_TTL_SECONDS }) {
    if (!store || typeof store.read !== 'function' || typeof store.write !== 'function') {
      throw new TypeError('PsycheNotesFacade requires a note record store');
    }
    this.store = store;
    this.clock = clock;
    this.ttlSeconds = Number.isSafeInteger(ttlSeconds) && ttlSeconds > 0
      ? ttlSeconds
      : NOTES_TTL_SECONDS;
  }

  /**
   * 保存一条宿主笔记（PsycheManager.compress 的唯一笔记写入入口）。
   *
   * @param {string} user_id - 用户 ID
   * @param {string} expert_id - 专家 ID
   * @param {string} key - 笔记 key
   * @param {object} note - {content, type?, relevance?, metadata?}
   * @param {number} [ttl] - TTL（秒），默认策略 TTL
   * @returns {Promise<{overwritten: boolean}>}
   */
  async take(user_id, expert_id, key, note, ttl = this.ttlSeconds) {
    if (typeof user_id !== 'string' || user_id.length === 0) {
      throw new TypeError('PsycheNotesFacade.take requires a non-empty user_id');
    }
    if (typeof expert_id !== 'string' || expert_id.length === 0) {
      throw new TypeError('PsycheNotesFacade.take requires a non-empty expert_id');
    }
    if (typeof key !== 'string' || key.length === 0) {
      throw new TypeError('PsycheNotesFacade.take requires a non-empty key');
    }
    const scopeRef = buildNotesScopeRef(user_id, expert_id);
    const ttlSeconds = Number.isSafeInteger(ttl) && ttl > 0 ? ttl : this.ttlSeconds;

    // 单次直写（LWW，#1203）：先读一次只为拼 superseded / 报 overwritten，
    // 真正的同 key 并发由存储层后写覆盖，既不重试也不抛版本冲突
    const old = await this.store.read(scopeRef, key);
    const record = buildRecord({
      key,
      scopeRef,
      note,
      old,
      nowMs: this.clock(),
      ttlSeconds,
    });
    await this.store.write(scopeRef, key, record, { ttlSeconds });
    return { overwritten: Boolean(old) };
  }
}

export default PsycheNotesFacade;
