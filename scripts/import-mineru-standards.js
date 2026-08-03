/**
 * MinerU 网关任务批量导入脚本（Erix Test 调用方）
 *
 * 用途：把 MinerU 网关（ocr.ai.erix.vip）上调用方为 Erix Test 的已完成解析任务，
 * 通过文档平台官方"按任务ID导入"功能（POST /api/docs/intakes/import-task）批量导入。
 * 导入后文档从 pending_clean 进入流水线（clean → outline → chunk → embedding → ready）。
 *
 * 特性：
 * - 小波次控制：每批 N 篇，批内全部到达终态（ready/error）才进入下一批
 * - 幂等断点：平台对重复 task_id 返回 409 already_imported，脚本视为跳过，可反复执行
 * - 预检：导入前探测平台网关凭证能否看到 Erix Test 任务（不能则中止并提示）
 * - doc_type 修正：官方导入硬编码 doc_type='knowledge'，脚本入库后统一修正为 'standard'
 *
 * 用法：
 *   node scripts/import-mineru-standards.js --max=5            # 试点：只导 5 篇
 *   node scripts/import-mineru-standards.js                    # 全量导入
 *   node scripts/import-mineru-standards.js --dry-run          # 只列任务不导入
 *   node scripts/import-mineru-standards.js --batch=3 --max=10 # 自定义批次与总量
 *
 * 环境：需要 .env（DB_*、JWT_SECRET）；需要 API 服务运行中（默认 http://localhost:3017）。
 */

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

// ---------- 配置 ----------

const API_BASE = process.env.IMPORT_API_BASE || 'http://localhost:3017';
const MINERU_MCP_URL = process.env.MINERU_MCP_URL || 'https://ocr.ai.erix.vip/mcp';
const MINERU_CALLER_KEY = process.env.MINERU_ERIX_TEST_KEY
  || 'c7ab85a1dc5bfca8fbf5f8efa394bcdba988b0b2bd4e69c67dfd846e71fe30a6';
const COLLECTION_NAME = process.env.IMPORT_COLLECTION_NAME || '0803标准库';
const DOC_TYPE = 'standard';
const REPORT_FILE = process.env.IMPORT_REPORT_FILE
  || path.join('temp', `import-mineru-report-${new Date().toISOString().slice(0, 10)}.jsonl`);

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));
const BATCH_SIZE = parseInt(args.batch || '5', 10);
const MAX_TOTAL = args.max ? parseInt(args.max, 10) : Infinity;
const DRY_RUN = args['dry-run'] === true;
const POLL_INTERVAL_MS = 30000;
const BATCH_TIMEOUT_MS = 90 * 60 * 1000; // LLM 阶段较慢，单批最长等 90 分钟

// ---------- 工具 ----------

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

async function mcpCall(toolName, toolArgs = {}) {
  const res = await fetch(MINERU_MCP_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${MINERU_CALLER_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: toolName, arguments: toolArgs } }),
  });
  const text = await res.text();
  // SSE 响应可能有多条 data: 行，取包含有效 JSON 的最后一条
  const dataLines = text.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim());
  let json = null;
  for (const candidate of [...dataLines].reverse()) {
    try { json = JSON.parse(candidate); break; } catch { /* 尝试下一条 */ }
  }
  if (!json) {
    try { json = JSON.parse(text); } catch {
      throw new Error(`MinerU MCP 响应解析失败 (HTTP ${res.status}): ${text.slice(0, 300)}`);
    }
  }
  const content = json?.result?.content || [];
  return content.filter(c => c.type === 'text').map(c => c.text).join('\n');
}

function parseTasks(text) {
  // MinerU list_tasks 返回格式：多个 pretty-printed JSON 对象首尾相接（非 NDJSON）。
  // 用花括号深度扫描切出每个顶层对象。
  const tasks = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        tasks.push(JSON.parse(text.slice(start, i + 1)));
        start = -1;
      }
    }
  }
  return tasks;
}

async function apiFetch(token, method, apiPath, body, options = {}) {
  const { timeoutMs = 120000 } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${apiPath}`, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------- 主流程 ----------

async function main() {
  log(`目标平台: ${API_BASE} | 集合: ${COLLECTION_NAME} | 批次: ${BATCH_SIZE} | 上限: ${MAX_TOTAL === Infinity ? '全量' : MAX_TOTAL}${DRY_RUN ? ' | DRY-RUN' : ''}`);

  // 1. 数据库连接（查管理员 + doc_type 修正 + 状态轮询备用）
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  // 2. 生成管理员令牌
  const [admins] = await conn.execute(
    "SELECT id FROM users WHERE username = 'admin' LIMIT 1"
  );
  if (!admins.length) throw new Error('No admin user found');
  const token = jwt.sign(
    { userId: admins[0].id, role: 'admin' },
    process.env.JWT_SECRET,
    { expiresIn: '12h' }
  );

  // 3. 拉取 Erix Test 全部已完成任务
  log('正在从 MinerU 拉取任务清单...');
  const tasksText = await mcpCall('list_tasks', { limit: 1000 });
  const allTasks = parseTasks(tasksText);
  const completed = allTasks.filter(t => t.status === 'completed');
  log(`任务总数: ${allTasks.length}，已完成: ${completed.length}`);
  if (!completed.length) {
    log('没有可导入的任务，退出');
    await conn.end();
    return;
  }

  const queue = completed.slice(0, MAX_TOTAL === Infinity ? completed.length : MAX_TOTAL);
  log(`本次计划导入: ${queue.length} 篇`);

  if (DRY_RUN) {
    for (const t of queue) console.log(`  ${t.task_id}  ${t.filename}`);
    await conn.end();
    return;
  }

  // 4. 预检：平台网关凭证能否看到第一个任务
  const probe = await apiFetch(token, 'GET', `/api/docs/gateway-tasks/${queue[0].task_id}`);
  const probeStatus = probe.json?.data?.status;
  if (probeStatus === 'not_found') {
    log('⛔ 预检失败：平台配置的 MinerU 网关凭证看不到 Erix Test 的任务（not_found）。');
    log('   请先把平台 MinerU 网关凭证切换为 Erix Test 调用方身份（负责人 task2），再运行本脚本。');
    await conn.end();
    process.exit(1);
  }
  log(`预检通过：平台可探测到网关任务（status=${probeStatus}）`);

  // 5. 解析集合创建所需的默认值（embedding_model_id / department_id 为必填）
  const [existingCols] = await conn.execute(
    'SELECT embedding_model_id, department_id FROM document_collections WHERE embedding_model_id IS NOT NULL LIMIT 1'
  );
  let embeddingModelId = existingCols[0]?.embedding_model_id || null;
  let departmentId = existingCols[0]?.department_id || null;
  if (!embeddingModelId) {
    const [emb] = await conn.execute(
      "SELECT id FROM ai_models WHERE model_type = 'embedding' AND is_active = 1 LIMIT 1"
    );
    embeddingModelId = emb[0]?.id || null;
  }
  if (!departmentId) {
    const [dept] = await conn.execute('SELECT id FROM departments LIMIT 1');
    departmentId = dept[0]?.id || null;
  }

  // 6. 创建或获取目标集合
  const colRes = await apiFetch(token, 'GET', '/api/docs/collections?size=200');
  const collections = colRes.json?.data?.items || [];
  let collection = collections.find(c => c.name === COLLECTION_NAME);
  if (!collection) {
    const createRes = await apiFetch(token, 'POST', '/api/docs/collections', {
      name: COLLECTION_NAME,
      visibility: 'public',
      embedding_model_id: embeddingModelId,
      department_id: departmentId,
    });
    if (createRes.status !== 200 && createRes.status !== 201) {
      throw new Error(`创建集合失败: ${JSON.stringify(createRes.json)}`);
    }
    collection = createRes.json?.data;
    log(`已创建集合: ${COLLECTION_NAME} (${collection.id})`);
  } else {
    log(`使用已有集合: ${COLLECTION_NAME} (${collection.id})`);
  }

  // 7. 报告文件
  await fs.mkdir(path.dirname(REPORT_FILE), { recursive: true });
  const report = async (entry) => {
    await fs.appendFile(REPORT_FILE, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
  };

  // 7. 分批导入
  const stats = { imported: 0, skipped: 0, failed_import: 0, ready: 0, error: 0, timeout: 0 };
  const failures = [];

  for (let i = 0; i < queue.length; i += BATCH_SIZE) {
    const batch = queue.slice(i, i + BATCH_SIZE);
    const batchNo = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(queue.length / BATCH_SIZE);
    log(`--- 批次 ${batchNo}/${totalBatches}（${batch.length} 篇）---`);

    // 7a. 提交导入
    const pendingDocs = [];
    for (const task of batch) {
      let res = null;
      let fetchError = null;
      try {
        // 导入接口是同步下载全部产物（含数百张图片），大文档可能数分钟
        res = await apiFetch(token, 'POST', '/api/docs/intakes/import-task', {
          collection_id: collection.id,
          task_id: task.task_id,
        }, { timeoutMs: 15 * 60 * 1000 });
      } catch (err) {
        fetchError = err;
      }

      if (res && res.status === 200 && res.json?.data?.document_id) {
        const docId = res.json.data.document_id;
        pendingDocs.push({ task, documentId: docId });
        stats.imported++;
        await report({ event: 'import_submitted', task_id: task.task_id, filename: task.filename, document_id: docId });
        log(`  提交: ${task.filename} -> ${docId}`);
        continue;
      }

      // 网络层失败（客户端超时/断连）或 409：服务端可能已在导入中或已完成，
      // 通过 metadata 中的 gateway_task_id 反查文档，恢复跟踪
      if (fetchError || res?.status === 409) {
        const [found] = await conn.execute(
          "SELECT id, processing_status FROM documents WHERE metadata LIKE ? ORDER BY created_at DESC LIMIT 1",
          [`%"gateway_task_id":"${task.task_id}"%`]
        );
        if (found.length) {
          const docId = found[0].id;
          const reason = fetchError ? `客户端断连恢复 (${fetchError.message})` : '已导入(409)';
          pendingDocs.push({ task, documentId: docId });
          if (!fetchError) stats.skipped++;
          await report({ event: 'import_recovered', task_id: task.task_id, filename: task.filename, document_id: docId, reason });
          log(`  ${reason}: ${task.filename} -> ${docId}（转入轮询）`);
          continue;
        }
      }

      stats.failed_import++;
      const errMsg = fetchError ? fetchError.message : (res?.json?.message || `HTTP ${res?.status}`);
      failures.push({ task_id: task.task_id, filename: task.filename, stage: 'import', message: errMsg });
      await report({ event: 'import_failed', task_id: task.task_id, filename: task.filename, message: errMsg });
      log(`  ✗ 导入失败: ${task.filename} (${errMsg})`);
    }

    // 7b. doc_type 修正为 standard（官方导入硬编码 knowledge，无 API，直接修库）
    for (const { documentId } of pendingDocs) {
      await conn.execute("UPDATE documents SET doc_type = ? WHERE id = ?", [DOC_TYPE, documentId]);
    }

    // 7c. 轮询批内终态
    if (pendingDocs.length) {
      const deadline = Date.now() + BATCH_TIMEOUT_MS;
      const pending = new Map(pendingDocs.map(d => [d.documentId, d]));

      while (pending.size > 0 && Date.now() < deadline) {
        await sleep(POLL_INTERVAL_MS);
        for (const [docId, { task }] of pending) {
          const [rows] = await conn.execute(
            'SELECT processing_status, processing_error_code FROM documents WHERE id = ?', [docId]
          );
          const status = rows[0]?.processing_status;
          const errorCode = rows[0]?.processing_error_code;
          // 导入中（产物同步下载图片）处于 error/gateway_import_in_progress 状态，非终态
          if (status === 'error' && errorCode === 'gateway_import_in_progress') {
            continue;
          }
          if (status === 'ready') {
            stats.ready++;
            pending.delete(docId);
            await report({ event: 'pipeline_ready', task_id: task.task_id, document_id: docId });
            log(`  ✓ ready: ${task.filename}`);
          } else if (status === 'error') {
            stats.error++;
            pending.delete(docId);
            const [errRows] = await conn.execute(
              'SELECT processing_error_message FROM documents WHERE id = ?', [docId]
            );
            const errMsg = errRows[0]?.processing_error_message || 'unknown';
            failures.push({ task_id: task.task_id, filename: task.filename, stage: 'pipeline', message: errMsg });
            await report({ event: 'pipeline_error', task_id: task.task_id, document_id: docId, message: errMsg });
            log(`  ✗ 流水线失败: ${task.filename} (${errMsg})`);
          }
        }
        if (pending.size > 0) {
          log(`  等待中: 批内剩余 ${pending.size} 篇处理中...`);
        }
      }

      if (pending.size > 0) {
        stats.timeout += pending.size;
        for (const [docId, { task }] of pending) {
          failures.push({ task_id: task.task_id, filename: task.filename, stage: 'timeout', message: 'batch wait timeout', document_id: docId });
          await report({ event: 'pipeline_timeout', task_id: task.task_id, document_id: docId });
        }
        log(`  ⚠ 批次等待超时，${pending.size} 篇仍在处理，继续下一批（这些文档会在后台完成）`);
      }
    }
  }

  // 8. 总结
  log('========== 导入完成 ==========');
  log(`提交导入: ${stats.imported} | 跳过(已存在): ${stats.skipped} | 导入失败: ${stats.failed_import}`);
  log(`流水线 ready: ${stats.ready} | 流水线 error: ${stats.error} | 超时未等待: ${stats.timeout}`);
  if (failures.length) {
    log(`失败明细（${failures.length}）:`);
    for (const f of failures) log(`  [${f.stage}] ${f.filename}: ${f.message}`);
  }
  log(`报告文件: ${REPORT_FILE}`);

  await conn.end();
}

main().catch(err => {
  console.error(`脚本执行失败: ${err.message}`);
  process.exit(1);
});
