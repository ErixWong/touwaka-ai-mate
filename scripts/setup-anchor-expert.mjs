/**
 * P0-2: 创建引用清洗专家并绑定 standard-anchor 技能
 *
 * 用于 task-20260803-anchor-agent-e2e-verify 的端到端验证。
 * 该专家以根模式运行，直接加载 12 个 standard-anchor 工具。
 *
 * Usage:
 *   $env:API_BASE='http://localhost:3017'
 *   node scripts/setup-anchor-expert.mjs
 *
 * 环境变量（可选）：
 *   TEST_ACCOUNT / TEST_PASSWORD — 登录凭据（默认 admin / password123）
 *   EXPERT_PROMPT_FILE — 自定义 prompt_template 文件路径（默认使用内置 prompt）
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
const EXPRESSIVE_MODEL_ID = process.env.EXPRESSIVE_MODEL_ID || null;
const REFLECTIVE_MODEL_ID = process.env.REFLECTIVE_MODEL_ID || null;

// ---- prompt_template（从 PLAN §3 行为契约提炼）----
const DEFAULT_PROMPT = `你是标准文档引用清洗专家。你的任务是通读一份标准文档全文，识别其中对其他标准的引用，并定位到目标文档的对应章节，最后写入引用记录。

## 工作流程

### 阶段 1：获取结构
1. 首先调用 list_revision_sections 获取文档的章节大纲
2. 识别章节结构，特别标记"规范性引用文件""参考文献"等纯书目章节——这些章节只读作候选来源，不在此类章节内落锚点

### 阶段 2：逐节通读
3. 按章节顺序逐节调用 read_section_context 读取章节内容
4. 在自然阅读中判断引用意图：
   - 显式引用：如"见 GB/T xxxx""按第 x 章""应符合……的规定"
   - 隐式提及：上下文暗示某标准要求
5. 对于长章节可用 read_revision_content 获取完整内容

### 阶段 3：定位目标
6. 对每个识别到的引用，调用定位工具链：
   a. find_documents_by_standard_code 或 find_documents_by_standard_name — 按编号/名称查找目标文档
   b. get_document_revisions — 获取目标文档的版本列表
   c. select_revision_candidate — 选择最匹配的版本
   d. find_section_candidates — 查找目标章节
7. 收敛规则：
   - 定位到唯一高置信目标 → 落 valid
   - 多个候选无法确定 → 落 suspected
   - 找不到任何目标 → 落 gap

### 阶段 4：写入结果
8. 每确定一条引用即调用 write_anchor_result
   - source_revision_id: 当前文档的 revision_id
   - source_outline_id: 引用出现的章节 outline_id
   - occurrence_index: 该章节内出现的序号（从 0 开始递增）
   - 携带 source_text 和 context_text
   - ref_type: explicit 或 implicit
   - 幂等：同一 (source_revision_id, source_outline_id, occurrence_index) 重复调用不会产生重复记录

## 纪律

1. 禁止臆造 document_id / revision_id / outline_id —— 必须来自工具返回值
2. 工具返回空就落 gap，不得猜测补充
3. 严禁在"规范性引用文件""参考文献"等纯书目章节内落锚点
4. 顺序推进，不跳节，不回溯
5. 禁止编造事实、补充文档中不存在的信息
6. 每条 write_anchor_result 必须携带 occurrence_index 保证幂等
7. 完成全部章节后报告完成摘要：总引用数、valid/suspected/gap 分布`;

const promptFile = process.env.EXPERT_PROMPT_FILE;
const PROMPT_TEMPLATE = promptFile
  ? fs.readFileSync(promptFile, 'utf-8')
  : DEFAULT_PROMPT;

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
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('timeout', () => req.destroy(new Error(`Request timed out: ${method} ${path}`)));
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

async function createExpert(token, expressiveModelId, reflectiveModelId) {
  const body = {
    name: '标准引用清洗专家',
    introduction: '通读标准文档全文，识别对其他标准的引用并定位到目标章节，写入引用记录。',
    prompt_template: PROMPT_TEMPLATE,
    is_active: true,
    max_tool_rounds: 50,
  };
  if (expressiveModelId) body.expressive_model_id = expressiveModelId;
  if (reflectiveModelId) body.reflective_model_id = reflectiveModelId;

  const response = await requestJson('/api/experts', {
    method: 'POST',
    token,
    body,
  });

  if (response.status !== 200 || response.data?.code !== 200) {
    throw new Error(`Create expert failed: ${JSON.stringify(response.data)}`);
  }
  return response.data.data;
}

async function bindSkill(token, expertId, skillId) {
  const response = await requestJson(`/api/experts/${expertId}/skills`, {
    method: 'POST',
    token,
    body: {
      skills: [{ skill_id: skillId, is_enabled: true }],
    },
  });

  if (response.status !== 200 || response.data?.code !== 200) {
    throw new Error(`Bind skill failed: ${JSON.stringify(response.data)}`);
  }
  return response.data.data;
}

async function verifyBinding(token, expertId) {
  const response = await requestJson(`/api/experts/${expertId}/skills`, { token });
  if (response.status !== 200 || response.data?.code !== 200) {
    throw new Error(`Verify skills failed: ${JSON.stringify(response.data)}`);
  }
  return response.data.data.skills;
}

// ---- 自动检测可用模型（从已有专家获取）----
async function detectModels(token) {
  // 如果环境变量已指定，直接使用
  if (EXPRESSIVE_MODEL_ID) {
    console.log('  从环境变量 EXPRESSIVE_MODEL_ID 获取模型配置');
    return { expressive: EXPRESSIVE_MODEL_ID, reflective: REFLECTIVE_MODEL_ID || EXPRESSIVE_MODEL_ID };
  }

  // 从已有活跃专家中获取模型配置
  try {
    const response = await requestJson('/api/experts', { token });
    if (response.status === 200 && response.data?.code === 200) {
      const experts = Array.isArray(response.data.data) ? response.data.data : [];
      const configured = experts.find(e => e.expressive_model_id && e.is_active);
      if (configured) {
        console.log(`  自动检测模型: expressive=${configured.expressive_model_id}, reflective=${configured.reflective_model_id}`);
        return { expressive: configured.expressive_model_id, reflective: configured.reflective_model_id || configured.expressive_model_id };
      }
    }
  } catch {}

  console.warn('  ⚠️ 无法自动检测模型，专家创建可能失败（缺少 expressive_model_id）');
  return { expressive: null, reflective: null };
}

async function main() {
  console.log('=== P0-2: 创建引用清洗专家 ===\n');

  // 1. Login
  console.log('[1/4] 登录...');
  const token = await login();
  console.log('  ✅ 登录成功\n');

  // 1.5 检测可用模型
  const models = await detectModels(token);

  // 2. Create expert
  console.log('[2/4] 创建专家...');
  let expert;
  try {
    expert = await createExpert(token, models.expressive, models.reflective);
    console.log(`  ✅ 专家已创建: id=${expert.id}, name=${expert.name}\n`);
  } catch (err) {
    if (err.message.includes('already exists') || err.message.includes('duplicate')) {
      console.log('  ⚠️ 专家可能已存在，请手动检查\n');
      throw err;
    }
    throw err;
  }

  // 3. Bind skill
  console.log('[3/4] 绑定技能 standard-anchor...');
  const skillId = 'skill-standard-anchor';
  await bindSkill(token, expert.id, skillId);
  console.log(`  ✅ skill-standard-anchor 已绑定\n`);

  // 4. Verify
  console.log('[4/4] 验证绑定...');
  const skills = await verifyBinding(token, expert.id);
  const anchorSkill = skills.find(s => s.id === skillId || s.skill_id === skillId);
  if (anchorSkill && anchorSkill.is_enabled) {
    console.log(`  ✅ 验证通过: standard-anchor 已启用\n`);
  } else {
    console.log(`  ⚠️ 验证异常: 未找到已启用的 standard-anchor\n`);
  }

  console.log('=== 完成 ===');
  console.log(`专家 ID: ${expert.id}`);
  console.log(`技能 ID: ${skillId}`);
  console.log(`max_tool_rounds: 50`);
  console.log('\n下一步: node scripts/run-anchor-cleaning.mjs');
}

main().catch(err => {
  console.error('❌ 失败:', err.message);
  process.exit(1);
});
