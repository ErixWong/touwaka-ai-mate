/**
 * DocumentHandleStore 单元测试（round02）
 *
 * 覆盖 round01 结论 §2.3 全部工程判据：
 *   - 创建/解引用成功路径（含 trace）
 *   - 30 分钟滑动 TTL（过期失效 + 访问续期）
 *   - user_id + session 双重权限绑定（越权统一错误形态，不泄露存在性）
 *   - 类型期望校验
 *   - chunk 限量截断（≤50 chunks、单 chunk content ≤2000 字符）
 *   - 摊销 GC + 全局上限淘汰
 *   - 会话联动清理
 *
 * 运行：node tests/document-handle-store.test.js
 */

import { DocumentHandleStore, HANDLE_TYPE } from '../lib/document-handle-store.js';

let passed = 0;
let failed = 0;

function assert(cond, name, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.error(`  ❌ ${name} ${detail}`);
  }
}

const ctxA = { userId: 'user-a', topicId: 'topic-1' };
const ctxB = { userId: 'user-b', topicId: 'topic-1' };   // 同话题不同用户
const ctxC = { userId: 'user-a', topicId: 'topic-2' };   // 同用户不同话题

// ============================================================
// 场景 1：创建 + 解引用成功路径
// ============================================================
console.log('\n场景 1：创建 + 解引用成功路径');
{
  const store = new DocumentHandleStore();
  const { handle, truncated } = store.create({
    type: HANDLE_TYPE.CHUNKSET,
    payload: { chunks: [{ chunk_id: 'c1', content: 'abc', score: 0.9 }] },
    context: ctxA,
    sourceTool: 'search_chunks_globally',
  });

  assert(typeof handle === 'string' && handle.startsWith('chunkset:'), 'handle 格式为 chunkset:{uuid}', handle);
  assert(truncated === false, '小 payload 不截断');

  const resolved = store.resolve(handle, ctxA, { expectedTypes: [HANDLE_TYPE.CHUNKSET], consumerTool: 'rank_chunks_for_question' });
  assert(resolved.success === true, '解引用成功');
  assert(resolved.payload.chunks.length === 1 && resolved.payload.chunks[0].chunk_id === 'c1', 'payload 完整返回');
}

// ============================================================
// 场景 2：TTL 过期失效（统一错误形态）
// ============================================================
console.log('\n场景 2：TTL 过期失效');
{
  let now = 1000000;
  const store = new DocumentHandleStore({ now: () => now });
  const { handle } = store.create({ type: HANDLE_TYPE.DOC_REF, payload: { document_ids: ['d1'] }, context: ctxA, sourceTool: 't' });

  now += 31 * 60 * 1000; // 前进 31 分钟
  const r = store.resolve(handle, ctxA, {});
  assert(r.success === false && r.error === 'handle_not_found_or_expired', '过期返回统一错误', JSON.stringify(r));
  assert(typeof r.hint === 'string' && r.hint.length > 0, '错误附带修复提示 hint');
}

// ============================================================
// 场景 3：滑动续期（访问刷新 TTL）
// ============================================================
console.log('\n场景 3：滑动续期');
{
  let now = 1000000;
  const store = new DocumentHandleStore({ now: () => now });
  const { handle } = store.create({ type: HANDLE_TYPE.DOC_REF, payload: { document_ids: ['d1'] }, context: ctxA, sourceTool: 't' });

  now += 29 * 60 * 1000; // 29 分钟后访问
  const r1 = store.resolve(handle, ctxA, {});
  assert(r1.success === true, '29 分钟时仍有效');

  now += 29 * 60 * 1000; // 再前进 29 分钟（距上次访问仅 29 分钟）
  const r2 = store.resolve(handle, ctxA, {});
  assert(r2.success === true, '滑动续期生效（距创建 58 分钟仍有效）');
}

// ============================================================
// 场景 4：越权 —— 跨用户（统一错误，不泄露存在性）
// ============================================================
console.log('\n场景 4：越权 —— 跨用户');
{
  const store = new DocumentHandleStore();
  const { handle } = store.create({ type: HANDLE_TYPE.CHUNKSET, payload: { chunks: [] }, context: ctxA, sourceTool: 't' });
  const r = store.resolve(handle, ctxB, {});
  assert(r.success === false && r.error === 'handle_not_found_or_expired', '跨用户返回与过期相同的统一错误');
  assert(!JSON.stringify(r).includes('user'), '错误信息不泄露权限细节');
}

// ============================================================
// 场景 5：越权 —— 跨会话
// ============================================================
console.log('\n场景 5：越权 —— 跨会话');
{
  const store = new DocumentHandleStore();
  const { handle } = store.create({ type: HANDLE_TYPE.CHUNKSET, payload: { chunks: [] }, context: ctxA, sourceTool: 't' });
  const r = store.resolve(handle, ctxC, {});
  assert(r.success === false && r.error === 'handle_not_found_or_expired', '跨会话返回统一错误');
}

// ============================================================
// 场景 6：类型期望不匹配
// ============================================================
console.log('\n场景 6：类型期望不匹配');
{
  const store = new DocumentHandleStore();
  const { handle } = store.create({ type: HANDLE_TYPE.DOC_REF, payload: { document_ids: ['d1'] }, context: ctxA, sourceTool: 't' });
  const r = store.resolve(handle, ctxA, { expectedTypes: [HANDLE_TYPE.CHUNKSET] });
  assert(r.success === false && r.error === 'handle_not_found_or_expired', 'doc_ref 不能当 chunkset 用');
}

// ============================================================
// 场景 7：malformed handle
// ============================================================
console.log('\n场景 7：malformed handle');
{
  const store = new DocumentHandleStore();
  const r1 = store.resolve('not-a-handle', ctxA, {});
  const r2 = store.resolve(undefined, ctxA, {});
  const r3 = store.resolve('chunkset:does-not-exist', ctxA, {});
  assert(r1.success === false && r1.error === 'handle_not_found_or_expired', '畸形字符串拒绝');
  assert(r2.success === false && r2.error === 'handle_not_found_or_expired', 'undefined 拒绝');
  assert(r3.success === false && r3.error === 'handle_not_found_or_expired', '伪造 handle 拒绝');
}

// ============================================================
// 场景 8：chunk 限量截断（>50 chunks、>2000 字符 content）
// ============================================================
console.log('\n场景 8：chunk 限量截断');
{
  const store = new DocumentHandleStore();
  const bigChunks = Array.from({ length: 60 }, (_, i) => ({
    chunk_id: `c${i}`,
    content: 'x'.repeat(3000),
    score: 0.5,
  }));
  const { handle, truncated } = store.create({
    type: HANDLE_TYPE.CHUNKSET,
    payload: { chunks: bigChunks },
    context: ctxA,
    sourceTool: 't',
  });
  assert(truncated === true, '超限标记 truncated=true');

  const r = store.resolve(handle, ctxA, {});
  assert(r.payload.chunks.length === 50, 'chunks 截断至 50 条', `actual=${r.payload.chunks.length}`);
  assert(r.payload.chunks[0].content.length === 2000, '单 chunk content 截断至 2000 字符', `actual=${r.payload.chunks[0].content.length}`);
  assert(r.payload.chunks[0].content_truncated === true, '单 chunk 截断标记');
}

// ============================================================
// 场景 9：doc_ref 不做 chunk 截断
// ============================================================
console.log('\n场景 9：doc_ref 不做 chunk 截断');
{
  const store = new DocumentHandleStore();
  const docs = Array.from({ length: 80 }, (_, i) => `d${i}`);
  const { truncated } = store.create({
    type: HANDLE_TYPE.DOC_REF,
    payload: { document_ids: docs },
    context: ctxA,
    sourceTool: 't',
  });
  assert(truncated === false, 'doc_ref payload 不适用 chunk 截断规则');
}

// ============================================================
// 场景 10：摊销 GC（创建时清理过期项）
// ============================================================
console.log('\n场景 10：摊销 GC');
{
  let now = 1000000;
  const store = new DocumentHandleStore({ now: () => now });
  store.create({ type: HANDLE_TYPE.DOC_REF, payload: {}, context: ctxA, sourceTool: 't' });
  store.create({ type: HANDLE_TYPE.DOC_REF, payload: {}, context: ctxA, sourceTool: 't' });
  assert(store.size() === 2, '创建 2 个 handle');

  now += 31 * 60 * 1000; // 全部过期
  store.create({ type: HANDLE_TYPE.DOC_REF, payload: {}, context: ctxA, sourceTool: 't' }); // 触发摊销 GC
  assert(store.size() === 1, '过期项在下次创建时被摊销清理', `size=${store.size()}`);
}

// ============================================================
// 场景 11：会话联动清理
// ============================================================
console.log('\n场景 11：会话联动清理');
{
  const store = new DocumentHandleStore();
  store.create({ type: HANDLE_TYPE.DOC_REF, payload: {}, context: ctxA, sourceTool: 't' });
  store.create({ type: HANDLE_TYPE.DOC_REF, payload: {}, context: ctxA, sourceTool: 't' });
  store.create({ type: HANDLE_TYPE.DOC_REF, payload: {}, context: ctxC, sourceTool: 't' });

  const cleared = store.clearSession(ctxA);
  assert(cleared === 2, '清理 topic-1 的 2 个 handle', `cleared=${cleared}`);
  assert(store.size() === 1, 'topic-2 的 handle 保留', `size=${store.size()}`);
}

// ============================================================
// 场景 12：全局上限强制淘汰
// ============================================================
console.log('\n场景 12：全局上限强制淘汰');
{
  let now = 1000000;
  const store = new DocumentHandleStore({ now: () => now });
  for (let i = 0; i < 10001; i++) {
    now += 1; // 每个 handle 的 last_accessed 递增，保证淘汰顺序确定
    store.create({ type: HANDLE_TYPE.DOC_REF, payload: {}, context: ctxA, sourceTool: 't' });
  }
  assert(store.size() <= 10000, '全局 handle 数不超过 10000', `size=${store.size()}`);
}

// ============================================================
// 场景 13：trace 轨迹记录
// ============================================================
console.log('\n场景 13：trace 轨迹记录');
{
  const store = new DocumentHandleStore();
  const { handle } = store.create({ type: HANDLE_TYPE.CHUNKSET, payload: { chunks: [] }, context: ctxA, sourceTool: 'search_chunks_globally' });
  store.resolve(handle, ctxA, { consumerTool: 'rank_chunks_for_question' });
  store.resolve(handle, ctxA, { consumerTool: 'resolve_documents_from_chunks' });

  const rec = store._handles.get(handle);
  assert(rec.trace.length === 3, 'trace 记录 1 次创建 + 2 次消费', `trace=${rec.trace.length}`);
  assert(rec.trace[0].event === 'created' && rec.trace[0].by === 'search_chunks_globally', 'trace 记录产生方');
  assert(rec.trace[2].event === 'consumed' && rec.trace[2].by === 'resolve_documents_from_chunks', 'trace 记录消费方');
}

// ============================================================
console.log('\n' + '='.repeat(40));
console.log(`  ✅ 通过: ${passed}  |  ❌ 失败: ${failed}`);
console.log('='.repeat(40));
process.exit(failed > 0 ? 1 : 0);
