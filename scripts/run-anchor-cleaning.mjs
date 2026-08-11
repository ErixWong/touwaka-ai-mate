/**
 * P0-3: 引用清洗触发脚本（R17-2 退役改造）
 *
 * 原实现自建聊天驱动（createFreshTopic + openSse + POST /api/chat），
 * 与服务端 /clean 端点形成"双驾驶路径"并长期漂移（副本未重建事故的根因之一）。
 *
 * R17-2：退役为"端点调用方"——只做：
 *   1. 登录
 *   2. 获取文档信息
 *   3. （可选）纳管标准
 *   4. 触发 POST /api/apps/standard-mgr/standards/:standardId/clean
 *      （清洗生命周期全部在 service.runCleaningPipeline 内完成）
 *   5. 轮询 GET /standards/:standardId 的 anchor_build_status 直到 done/error
 *   6. 落盘运行记录到 runs/ 目录
 *
 * Usage:
 *   $env:API_BASE='http://localhost:3017'
 *   $env:DOCUMENT_ID='mscmltrt3ejy03obd9f5'
 *   node scripts/run-anchor-cleaning.mjs
 *
 * 环境变量：
 *   API_BASE          — 服务地址（默认 http://localhost:3017）
 *   TEST_ACCOUNT      — 登录账号（默认 admin）
 *   TEST_PASSWORD     — 登录密码（默认 password123）
 *   DOCUMENT_ID       — 待清洗文档 ID（必填）
 *   STANDARD_CODE     — 标准编号（纳管用，默认 auto-extract）
 *   STANDARD_NAME     — 标准名称（纳管用，默认 auto-extract）
 *   STANDARD_TYPE     — 标准类型（默认 national）
 *   SKIP_ONBOARD      — 跳过纳管步骤（默认 false，设 1 跳过）
 *   POLL_TIMEOUT_MS   — 轮询超时（默认 1800000，30 分钟，与服务端 CLEAN_TIMEOUT_MS 一致）
 *   POLL_INTERVAL_MS  — 轮询间隔（默认 5000，5 秒）
 */

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_BASE = process.env.API_BASE || 'http://localhost:3017';
const TEST_ACCOUNT = process.env.TEST_ACCOUNT || 'admin';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'password123';
const DOCUMENT_ID = process.env.DOCUMENT_ID || '';
const STANDARD_CODE = process.env.STANDARD_CODE || '';
const STANDARD_NAME = process.env.STANDARD_NAME || '';
const STANDARD_TYPE = process.env.STANDARD_TYPE || 'national';
const SKIP_ONBOARD = process.env.SKIP_ONBOARD === '1';
const POLL_TIMEOUT_MS = Number(process.env.POLL_TIMEOUT_MS || 1800000);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 5000);

if (!DOCUMENT_ID) {
  console.error('❌ DOCUMENT_ID is required');
  process.exit(1);
}

// ---- 输出目录 ----
const RUNS_DIR = path.join(__dirname, '..', 'docs', 'tasks', 'active', 'task-20260803-anchor-agent-e2e-verify', 'runs');
const RUN_ID = `run-${Date.now()}`;
const RUN_DIR = path.join(RUNS_DIR, RUN_ID);
fs.mkdirSync(RUN_DIR, { recursive: true });

// ---- HTTP helpers ----

function requestJson(path, { method = 'GET', token = null, body = null, timeout_ms = 30000 } = {}) {
  const url = new URL(path, API_BASE);
  const transport = url.protocol === 'https:' ? https : http;
  const payload = body ? JSON.stringify(body) : null;

  return new Promise((resolve, reject) => {
    const req = transport.request(url, {
      method,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      timeout: timeout_ms,
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => {
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = text; }
        resolve({ status: res.statusCode, data, headers: res.headers });
      });
    });
    req.on('timeout', () => req.destroy(new Error(`Request timed out: ${method} ${path}`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ---- Main ----

async function login() {
  const response = await requestJson('/api/auth/login', {
    method: 'POST',
    body: { account: TEST_ACCOUNT, password: TEST_PASSWORD },
  });
  if (response.status !== 200 || response.data?.code !== 200) {
    throw new Error(`Login failed: ${JSON.stringify(response.data)}`);
  }
  return response.data.data.accessToken || response.data.data.access_token;
}

async function getDocumentInfo(token, documentId) {
  const response = await requestJson(`/api/docs/documents/${documentId}`, { token });
  if (response.status !== 200 || response.data?.code !== 200) {
    throw new Error(`Get document failed: ${JSON.stringify(response.data)}`);
  }
  return response.data.data;
}

async function onboardStandard(token, documentId, standardType, standardCode, standardName) {
  const response = await requestJson('/api/apps/standard-mgr/standards', {
    method: 'POST',
    token,
    body: {
      document_id: documentId,
      standard_type: standardType,
      standard_code: standardCode,
      standard_name: standardName,
    },
  });

  if (response.status === 200 && response.data?.code === 200) {
    return response.data.data;
  }

  // 409 = already onboarded, that's OK
  if (response.status === 200 && response.data?.code === 409) {
    console.log('  ⚠️ 标准已纳管，跳过');
    return null;
  }

  // Check if the error message indicates already onboarded
  const msg = response.data?.message || '';
  if (msg.includes('already onboarded') || msg.includes('Already onboarded')) {
    console.log('  ⚠️ 标准已纳管，跳过');
    return null;
  }

  throw new Error(`Onboard failed: ${JSON.stringify(response.data)}`);
}

async function triggerClean(token, standardId) {
  const response = await requestJson(`/api/apps/standard-mgr/standards/${standardId}/clean`, {
    method: 'POST',
    token,
  });

  if (response.status === 200 && response.data?.code === 200) {
    return { accepted: true, data: response.data.data };
  }
  if (response.status === 200 && response.data?.code === 409) {
    return { accepted: false, reason: response.data.message };
  }
  throw new Error(`Trigger clean failed: ${JSON.stringify(response.data)}`);
}

async function getStandard(token, standardId) {
  const response = await requestJson(`/api/apps/standard-mgr/standards/${standardId}`, { token });
  if (response.status !== 200 || response.data?.code !== 200) {
    throw new Error(`Get standard failed: ${JSON.stringify(response.data)}`);
  }
  return response.data.data;
}

async function main() {
  console.log('=== P0-3: 引用清洗触发脚本（端点调用方）===\n');
  const runLog = { runId: RUN_ID, startedAt: new Date().toISOString(), steps: [], events: [], toolCalls: [], errors: [] };

  let token;
  let standardId = null;
  let finalStatus = null;
  let triggerResult = { accepted: true };

  try {
    // ---- Step 1: Login ----
    console.log('[1/5] 登录...');
    token = await login();
    console.log('  ✅ 登录成功\n');
    runLog.steps.push({ step: 'login', status: 'ok' });

    // ---- Step 2: Get document info ----
    console.log('[2/5] 获取文档信息...');
    const doc = await getDocumentInfo(token, DOCUMENT_ID);
    console.log(`  title: ${doc.title}`);
    console.log(`  processing_status: ${doc.processing_status}`);
    console.log(`  current_revision_id: ${doc.current_revision_id}`);
    if (doc.processing_status !== 'ready') {
      console.error(`  ❌ 文档状态不是 ready（当前: ${doc.processing_status}），无法清洗`);
      process.exit(1);
    }
    runLog.steps.push({ step: 'get_document', status: 'ok', document: { id: doc.id, title: doc.title, status: doc.processing_status, revision_id: doc.current_revision_id } });

    // ---- Step 3: Onboard standard ----
    if (!SKIP_ONBOARD) {
      console.log('[3/5] 纳管标准...');
      // standard_code 优先取环境变量 → 从标题提取编号部分 → 回退用标题
      const code = STANDARD_CODE || doc.title?.match(/^[\w/\s-]+/)?.[0]?.trim() || doc.title;
      const name = STANDARD_NAME || doc.title;
      if (!STANDARD_NAME) {
        console.log('  ⚠️  STANDARD_NAME 未设置，使用文档标题作为标准名称（可能不准确）');
        console.log(`     提示：设置 $env:STANDARD_NAME='完整的标准名称' 以传入正确名称`);
      }
      try {
        const std = await onboardStandard(token, DOCUMENT_ID, STANDARD_TYPE, code, name);
        if (std) {
          standardId = std.id;
          console.log(`  ✅ 纳管成功: standard_id=${standardId}\n`);
        }
      } catch (err) {
        console.log(`  ⚠️ 纳管失败: ${err.message}（将继续尝试）\n`);
        runLog.errors.push({ step: 'onboard', error: err.message });
      }
      runLog.steps.push({ step: 'onboard', status: standardId ? 'ok' : 'skipped', standard_id: standardId });
    } else {
      console.log('[3/5] 跳过纳管（SKIP_ONBOARD=1）\n');
      runLog.steps.push({ step: 'onboard', status: 'skipped' });
    }

    // 纳管未返回 standardId 时，通过文档 ID 查询已有标准
    if (!standardId) {
      try {
        const lookupResp = await requestJson(`/api/apps/standard-mgr/standards?document_id=${DOCUMENT_ID}`, { token });
        if (lookupResp.status === 200 && lookupResp.data?.code === 200) {
          const list = Array.isArray(lookupResp.data.data) ? lookupResp.data.data : (lookupResp.data.data?.list || []);
          const found = list.find(s => s.document_id === DOCUMENT_ID);
          if (found) {
            standardId = found.id;
            console.log(`  📍 查询到已有标准: standard_id=${standardId}\n`);
          }
        }
      } catch (err) {
        console.log(`  ⚠️ 查询已有标准失败: ${err.message}\n`);
      }
    }

    if (!standardId) {
      throw new Error(`无法确定 standard_id（纳管失败且未查询到已有标准），document_id=${DOCUMENT_ID}`);
    }

    // ---- Step 4: Trigger cleaning via endpoint (R17-2) ----
    console.log('[4/5] 触发服务端清洗（POST /standards/:id/clean）...');
    triggerResult = await triggerClean(token, standardId);
    if (!triggerResult.accepted) {
      console.log(`  ⚠️ 服务端拒绝触发: ${triggerResult.reason}（可能是已有清洗在进行中）\n`);
      runLog.errors.push({ type: 'trigger_rejected', reason: triggerResult.reason });
    } else {
      console.log('  ✅ 已受理，服务端异步执行清洗\n');
    }
    runLog.steps.push({ step: 'trigger_clean', status: triggerResult.accepted ? 'ok' : 'rejected', standard_id: standardId, reason: triggerResult.reason });

    // ---- Step 5: Poll status until done/error/timeout ----
    console.log('[5/5] 轮询清洗状态...');
    const startedAt = Date.now();
    let finished = false;

    while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
      const std = await getStandard(token, standardId);
      finalStatus = std.anchor_build_status;
      const errorMsg = std.last_anchor_build_error || null;

      console.log(`  ⏳ anchor_build_status=${finalStatus}${errorMsg ? ` error=${errorMsg.slice(0, 120)}` : ''}`);

      if (finalStatus === 'done' || finalStatus === 'error') {
        finished = true;
        if (errorMsg) {
          runLog.errors.push({ type: 'clean_error', message: errorMsg });
        }
        break;
      }

      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    if (!finished) {
      console.log('  ⚠️ 轮询超时\n');
      runLog.errors.push({ type: 'timeout', timeout_ms: POLL_TIMEOUT_MS, last_status: finalStatus });
    } else {
      console.log(`  ✅ 清洗${finalStatus === 'done' ? '完成' : '失败'}（anchor_build_status=${finalStatus}）\n`);
    }
    runLog.steps.push({ step: 'poll_status', status: finished ? finalStatus : 'timeout', standard_id: standardId });

    // ---- Save results ----
    console.log('保存运行记录...');
    runLog.finishedAt = new Date().toISOString();
    runLog.completed = finalStatus === 'done';
    runLog.standard_id = standardId;

    const trajectoryFile = path.join(RUN_DIR, 'trajectory.json');
    fs.writeFileSync(trajectoryFile, JSON.stringify(runLog, null, 2));

    // Summary
    const summary = {
      run_id: RUN_ID,
      document_id: DOCUMENT_ID,
      standard_id: standardId,
      started_at: runLog.startedAt,
      finished_at: runLog.finishedAt,
      completed: runLog.completed,
      anchor_build_status: finalStatus,
      trigger_accepted: triggerResult.accepted,
      errors: runLog.errors.length,
    };
    const summaryFile = path.join(RUN_DIR, 'summary.json');
    fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));

    console.log(`  📁 轨迹文件: ${trajectoryFile}\n`);
    console.log('=== 运行摘要 ===');
    console.log(`标准: ${standardId}`);
    console.log(`触发受理: ${triggerResult.accepted}`);
    console.log(`最终状态: ${finalStatus}`);
    console.log(`完成: ${summary.completed}`);
    console.log(`错误: ${summary.errors} 次`);

    // 非零退出码表示清洗失败
    if (!summary.completed) {
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(`❌ 失败: ${err.message}`);
    runLog.errors.push({ type: 'fatal', error: err.message, stack: err.stack });
    runLog.finishedAt = new Date().toISOString();
    const trajectoryFile = path.join(RUN_DIR, 'trajectory.json');
    fs.writeFileSync(trajectoryFile, JSON.stringify(runLog, null, 2));
    process.exit(1);
  }
}

main();
