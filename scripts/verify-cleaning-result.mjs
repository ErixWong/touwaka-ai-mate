/**
 * P1-2: 引用清洗结果验收脚本
 *
 * 对一次清洗运行的结果进行 6 项指标验收。
 *
 * Usage:
 *   $env:API_BASE='http://localhost:3017'
 *   $env:STANDARD_ID='<standard_id>'
 *   node scripts/verify-cleaning-result.mjs
 *
 * 环境变量：
 *   API_BASE        — 服务地址（默认 http://localhost:3017）
 *   TEST_ACCOUNT    — 登录账号（默认 admin）
 *   TEST_PASSWORD   — 登录密码（默认 password123）
 *   STANDARD_ID     — app_standard.id（必填）
 */

import http from 'node:http';
import https from 'node:https';

const API_BASE = process.env.API_BASE || 'http://localhost:3017';
const TEST_ACCOUNT = process.env.TEST_ACCOUNT || 'admin';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'password123';
const STANDARD_ID = process.env.STANDARD_ID || '';

if (!STANDARD_ID) {
  console.error('❌ STANDARD_ID is required');
  process.exit(1);
}

function requestJson(p, { method = 'GET', token = null, body = null, timeout_ms = 30000 } = {}) {
  const url = new URL(p, API_BASE);
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
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('timeout', () => req.destroy(new Error(`Request timed out: ${method} ${p}`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

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

async function main() {
  console.log('=== P1-2: 引用清洗结果验收 ===\n');

  const token = await login();
  console.log('✅ 登录成功\n');

  // ---- 1. Get standard info ----
  const stdResp = await requestJson(`/api/apps/standard-mgr/standards/${STANDARD_ID}`, { token });
  if (stdResp.status !== 200 || stdResp.data?.code !== 200) {
    console.error('❌ 获取标准信息失败:', JSON.stringify(stdResp.data, null, 2));
    process.exit(1);
  }
  const standard = stdResp.data.data;
  console.log(`标准: ${standard.standard_code} ${standard.standard_name}`);
  console.log(`anchor_build_status: ${standard.anchor_build_status}`);
  console.log(`revision_id: ${standard.current_revision_id}\n`);

  // ---- 2. Get ref anchors ----
  const anchorsResp = await requestJson(
    `/api/apps/standard-mgr/anchors?standard_id=${STANDARD_ID}&limit=1000`,
    { token }
  );
  if (anchorsResp.status !== 200 || anchorsResp.data?.code !== 200) {
    console.error('❌ 获取引用记录失败:', JSON.stringify(anchorsResp.data));
    process.exit(1);
  }
  const anchors = Array.isArray(anchorsResp.data.data) ? anchorsResp.data.data : [];
  console.log(`=== 指标 1: 引用记录总数与状态分布 ===`);
  console.log(`总记录数: ${anchors.length}`);

  const byStatus = {};
  for (const a of anchors) {
    byStatus[a.status] = (byStatus[a.status] || 0) + 1;
  }
  console.log('状态分布:');
  for (const [s, c] of Object.entries(byStatus)) {
    console.log(`  ${s}: ${c}`);
  }

  // ---- 3. Anchored sections ----
  // Get via doc API since there's no direct endpoint for anchored_sections
  const sectionsResp = await requestJson(
    `/api/docs/revisions/${standard.current_revision_id}/outlines`,
    { token }
  );
  let outlineCount = 0;
  if (sectionsResp.status === 200 && sectionsResp.data?.code === 200) {
    outlineCount = Array.isArray(sectionsResp.data.data) ? sectionsResp.data.data.length : 0;
  }

  console.log(`\n=== 指标 2: 带锚点副本 ===`);
  // Note: anchored_sections are in app_standard_anchored_section table
  // We can infer count from distinct source_outline_id in anchors
  const distinctOutlines = new Set(anchors.map(a => a.source_outline_id).filter(Boolean));
  console.log(`含引用的 outline 数: ${distinctOutlines.size} / ${outlineCount}`);

  // ---- 4. Summary consistency ----
  console.log(`\n=== 指标 3: 汇总一致性 ===`);
  const expected = {
    reference_count: anchors.length,
    valid_reference_count: byStatus.valid || 0,
    suspected_reference_count: byStatus.suspected || 0,
    gap_reference_count: byStatus.gap || 0,
    invalid_reference_count: byStatus.invalid || 0,
  };
  const actual = {
    reference_count: standard.reference_count,
    valid_reference_count: standard.valid_reference_count,
    suspected_reference_count: standard.suspected_reference_count,
    gap_reference_count: standard.gap_reference_count,
    invalid_reference_count: standard.invalid_reference_count,
  };

  let summaryConsistent = true;
  for (const [key, exp] of Object.entries(expected)) {
    const act = actual[key];
    const match = exp === act;
    if (!match) summaryConsistent = false;
    console.log(`  ${key}: 期望=${exp}, 实际=${act} ${match ? '✅' : '❌'}`);
  }

  // ---- 5. Idempotency check (manual note) ----
  console.log(`\n=== 指标 4: 幂等性 ===`);
  console.log('⚠️ 幂等检查需重跑清洗后人工对比。当前仅记录首次运行记录数作基线。');
  console.log(`基线记录数: ${anchors.length}`);

  // ---- 6. Position strategy ----
  console.log(`\n=== 指标 5: 位置策略 ===`);
  // Check if any anchors are in "2 引用标准" section
  // We need to check the outline titles
  const sections = sectionsResp.status === 200 && sectionsResp.data?.code === 200
    ? (Array.isArray(sectionsResp.data.data) ? sectionsResp.data.data : [])
    : [];

  const biblioSectionIds = [];
  const biblioKeywords = ['引用标准', '规范性引用', '参考文献', '参考标准', '引用文件'];
  for (const s of sections) {
    const title = (s.title || s.heading || '').toLowerCase();
    for (const kw of biblioKeywords) {
      if (title.includes(kw.toLowerCase())) {
        biblioSectionIds.push(s.id);
        break;
      }
    }
  }

  if (biblioSectionIds.length > 0) {
    console.log(`检测到书目章节: ${biblioSectionIds.join(', ')}`);
    const anchorsInBiblio = anchors.filter(a => biblioSectionIds.includes(a.source_outline_id));
    if (anchorsInBiblio.length > 0) {
      console.log(`❌ 发现 ${anchorsInBiblio.length} 条引用落在书目章节内！`);
      for (const a of anchorsInBiblio) {
        console.log(`  - ${a.source_text?.slice(0, 80)} (outline ${a.source_outline_id})`);
      }
    } else {
      console.log('✅ 书目章节内无锚点');
    }
  } else {
    console.log('⚠️ 未检测到明显的书目章节（可能标题不匹配关键词）');
  }

  // ---- 7. Valid record sanity check ----
  console.log(`\n=== 指标 6: valid 记录抽样 ===`);
  const validAnchors = anchors.filter(a => a.status === 'valid');
  console.log(`valid 记录数: ${validAnchors.length}`);
  for (const a of validAnchors.slice(0, 5)) {
    console.log(`  [${a.ref_type}] ${a.source_text?.slice(0, 100)}`);
    if (a.target_document_id) console.log(`    → target: ${a.target_document_id} outline=${a.target_outline_id}`);
    if (a.status_reason) console.log(`    reason: ${a.status_reason}`);
  }

  const suspectedAnchors = anchors.filter(a => a.status === 'suspected');
  const gapAnchors = anchors.filter(a => a.status === 'gap');
  console.log(`\nsuspected: ${suspectedAnchors.length}, gap: ${gapAnchors.length}`);

  // ---- 8. Gap record sanity check ----
  if (gapAnchors.length > 0) {
    console.log('\n--- gap 记录抽样 ---');
    for (const g of gapAnchors.slice(0, 5)) {
      console.log(`  [${g.ref_type}] ${g.source_text?.slice(0, 100)}`);
      if (g.status_reason) console.log(`    reason: ${g.status_reason}`);
    }
  }

  // ---- Summary ----
  console.log('\n=== 验收总结 ===');
  const allPassed = summaryConsistent
    && anchors.length > 0
    && anchorsInBiblio?.length === 0;
  console.log(`汇总一致性: ${summaryConsistent ? '✅' : '❌'}`);
  console.log(`位置策略: ${(!biblioSectionIds.length || (anchorsInBiblio?.length || 0) === 0) ? '✅' : '❌'}`);
  console.log(`总记录数: ${anchors.length > 0 ? '✅' : '⚠️ 无记录'}`);
  console.log(`\n整体: ${allPassed ? '✅ 通过' : '❌ 未通过'}`);
}

main().catch(err => {
  console.error('❌ 验收失败:', err.message);
  process.exit(1);
});
