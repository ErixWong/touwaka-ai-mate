/**
 * DocumentHandleStore — 文档检索原子链的结果引用（handle）基础设施
 *
 * 依据：docs/tasks/active/docs-260719-01-pr963-pr964-code-audit/round01-atomic-route-conclusion.md §2
 *
 * 职责（且仅这些职责）：
 *   - 结果引用：上游原子 tool 的 payload 留存服务端，LLM 只持 handle 交接
 *   - 生命周期：会话绑定 + 30 分钟滑动过期 + 摊销 GC
 *   - trace：记录产生 / 消费轨迹，供观测与链未闭合检测
 *
 * 职责红线：
 *   - 不替 LLM 决策下一步（不内嵌"建议调用哪个 tool"字段）
 *   - 不基于引用关系自动触发下游调用（不重建隐式编排黑盒）
 *
 * 工程判据取值（结论 §2.3）：
 *   - 存储介质：进程内存 Map（项目无 Redis 依赖，技能开发阶段最简可用）
 *   - 重启语义：全部失效；消费方收到统一 handle_not_found_or_expired + hint
 *   - TTL：会话绑定 + 30 分钟滑动过期（按 last_accessed_at 续期）
 *   - 权限绑定：生成时绑定 user_id + session_key（topicId 优先），消费时双重校验
 *   - 越权行为：与真过期同形态返回，不泄露 handle 存在性；日志记录越权尝试
 *   - 数据量上限：单 chunkset ≤ 50 chunks；单 chunk content ≤ 2000 字符（截断标记）
 *   - GC：创建时摊销扫描过期项；全局 > 10000 时按最旧 last_accessed_at 强制淘汰
 */

import { randomUUID } from 'crypto';
import logger from './logger.js';

export const HANDLE_TYPE = Object.freeze({
  DOC_REF: 'doc_ref',
  CHUNKSET: 'chunkset',
  RANKED_CHUNKSET: 'ranked_chunkset',
});

const HANDLE_PREFIX = Object.freeze({
  [HANDLE_TYPE.DOC_REF]: 'docref',
  [HANDLE_TYPE.CHUNKSET]: 'chunkset',
  [HANDLE_TYPE.RANKED_CHUNKSET]: 'rankedset',
});

const TTL_MS = 30 * 60 * 1000; // 30 分钟滑动过期
const MAX_HANDLES = 10000;
const MAX_CHUNKS_PER_SET = 50;
const MAX_CHUNK_CONTENT_CHARS = 2000;

/** 统一失效/越权错误形态（不泄露 handle 存在性） */
function invalidHandleError(hint) {
  return {
    success: false,
    error: 'handle_not_found_or_expired',
    hint: hint || 'handle 已过期或不存在，请重新调用上游检索工具获取新 handle',
  };
}

class DocumentHandleStore {
  /**
   * @param {Object} [deps]
   * @param {Function} [deps.now] - 时钟注入（测试用）
   */
  constructor(deps = {}) {
    this._now = deps.now || (() => Date.now());
    /** @type {Map<string, Object>} handleId -> record */
    this._handles = new Map();
  }

  /**
   * 从执行上下文提取会话绑定键。
   * 聊天场景下 topicId 是对话的稳定标识（同一话题内多轮 tool 调用共享 handle）。
   */
  _sessionKey(context = {}) {
    return context.topicId || context.session?.id || 'global';
  }

  _userId(context = {}) {
    return context.userId || context.user_id || null;
  }

  /**
   * chunk 类 payload 限量截断（判据：≤50 chunks、单 chunk content ≤2000 字符）
   */
  _truncatePayload(type, payload) {
    if (type === HANDLE_TYPE.DOC_REF) return { payload, truncated: false };
    const chunks = Array.isArray(payload?.chunks) ? payload.chunks : null;
    if (!chunks) return { payload, truncated: false };

    let truncated = false;
    let out = chunks.slice(0, MAX_CHUNKS_PER_SET);
    if (chunks.length > MAX_CHUNKS_PER_SET) truncated = true;
    out = out.map(c => {
      if (typeof c?.content === 'string' && c.content.length > MAX_CHUNK_CONTENT_CHARS) {
        truncated = true;
        return { ...c, content: c.content.substring(0, MAX_CHUNK_CONTENT_CHARS), content_truncated: true };
      }
      return c;
    });
    return { payload: { ...payload, chunks: out }, truncated };
  }

  /** 摊销 GC：每次创建时顺带清理过期项；达上限则按最旧访问时间强制淘汰（为新 handle 腾位） */
  _gcAmortized() {
    const now = this._now();
    for (const [id, rec] of this._handles) {
      if (now - rec.last_accessed_at > TTL_MS) this._handles.delete(id);
    }
    // 使用 >= 保证稳态 size ≤ MAX_HANDLES（淘汰到 MAX-1，为即将创建的 handle 腾出 1 位）
    if (this._handles.size >= MAX_HANDLES) {
      const sorted = [...this._handles.entries()].sort((a, b) => a[1].last_accessed_at - b[1].last_accessed_at);
      const evictCount = this._handles.size - MAX_HANDLES + 1;
      for (let i = 0; i < evictCount; i++) this._handles.delete(sorted[i][0]);
      logger.warn('[DocHandleStore] 强制淘汰最旧 handle:', { evicted: evictCount });
    }
  }

  /**
   * 创建 handle
   *
   * @param {Object} args
   * @param {string} args.type - HANDLE_TYPE 枚举
   * @param {Object} args.payload - 留存服务端的完整数据（doc 列表 / chunks 等）
   * @param {Object} args.context - 执行上下文（user_id / topicId / session）
   * @param {string} args.sourceTool - 产生方 tool 名（trace）
   * @returns {{ handle: string, truncated: boolean }}
   */
  create({ type, payload, context, sourceTool }) {
    if (!HANDLE_PREFIX[type]) {
      throw new Error(`Unknown handle type: ${type}`);
    }
    this._gcAmortized();

    const { payload: storedPayload, truncated } = this._truncatePayload(type, payload);
    const id = `${HANDLE_PREFIX[type]}:${randomUUID()}`;
    const now = this._now();
    this._handles.set(id, {
      type,
      user_id: this._userId(context),
      session_key: this._sessionKey(context),
      created_at: now,
      last_accessed_at: now,
      payload: storedPayload,
      source_tool: sourceTool || 'unknown',
      trace: [{ event: 'created', at: now, by: sourceTool || 'unknown' }],
    });
    return { handle: id, truncated };
  }

  /**
   * 解引用 handle
   *
   * 成功：滑动续期 + 追加消费 trace + 返回 payload。
   * 失败（不存在 / 过期 / 越权）：统一 handle_not_found_or_expired，不泄露存在性。
   *
   * @param {string} handleId
   * @param {Object} context - 执行上下文
   * @param {Object} [opts]
   * @param {string[]} [opts.expectedTypes] - 期望的 handle 类型（类型不符视同无效）
   * @param {string} [opts.consumerTool] - 消费方 tool 名（trace）
   * @param {string} [opts.hint] - 自定义修复提示（默认通用提示）
   * @returns {Object} { success: true, type, payload } | { success: false, error, hint }
   */
  resolve(handleId, context = {}, opts = {}) {
    const fail = (reason) => {
      logger.warn('[DocHandleStore] handle 解引用失败:', {
        reason,
        handle_prefix: typeof handleId === 'string' ? handleId.split(':')[0] : null,
        consumer: opts.consumerTool || 'unknown',
        user_id: this._userId(context),
      });
      return invalidHandleError(opts.hint);
    };

    if (typeof handleId !== 'string' || !handleId.includes(':')) return fail('malformed');
    const rec = this._handles.get(handleId);
    if (!rec) return fail('not_found');
    if (this._now() - rec.last_accessed_at > TTL_MS) {
      this._handles.delete(handleId);
      return fail('expired');
    }
    // 权限双重校验：user_id + session_key（不匹配视同无效，防枚举）
    if (rec.user_id && rec.user_id !== this._userId(context)) return fail('cross_user');
    if (rec.session_key !== 'global' && rec.session_key !== this._sessionKey(context)) return fail('cross_session');
    if (opts.expectedTypes?.length > 0 && !opts.expectedTypes.includes(rec.type)) return fail('type_mismatch');

    // 滑动续期 + 消费 trace
    rec.last_accessed_at = this._now();
    rec.trace.push({ event: 'consumed', at: rec.last_accessed_at, by: opts.consumerTool || 'unknown' });
    return { success: true, type: rec.type, payload: rec.payload };
  }

  /** 会话结束联动清理（判据：会话删除时清理其全部 handle） */
  clearSession(context = {}) {
    const key = this._sessionKey(context);
    let cleared = 0;
    for (const [id, rec] of this._handles) {
      if (rec.session_key === key) {
        this._handles.delete(id);
        cleared++;
      }
    }
    return cleared;
  }

  /** 观测用：当前存活 handle 数 */
  size() {
    return this._handles.size;
  }
}

export { DocumentHandleStore };
export default DocumentHandleStore;
