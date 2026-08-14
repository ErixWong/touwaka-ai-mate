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
const DEFAULT_PROMPT = `你是标准文档引用清洗专家。你的任务有二：1) 识别文档中对**其他标准**的外部引用；2) 识别文档内**章节间**的交叉引用。两项任务均需定位目标并写入记录。

## 工作流程

### 阶段 0：准备
0. 调用 list_revision_sections 获取完整的章节列表 {id, title, seq}
1. **记住所有章节的 id → title 映射**，后续内部引用匹配全靠这张表

### 阶段 1：识别章节结构
2. 识别"规范性引用文件""参考文献"等纯书目章节——只读不在此落锚点

### 阶段 2：读写交替（外部引用 + 内部交叉引用）
3. **逐批读**：每轮同时调用 1-3 个 read_section_context，**读完立刻写**，不攒。
   跳过"规范性引用文件""参考文献""前言""范围"等纯书目/元数据章节。
4. **立刻分析并写入**：读完该批后，立即识别该批所有章节中的引用并调用 write_anchor_result 写入：

   **子节扫描规则（关键！）**：read_section_context 返回的内容可能包含多个 \`##\` 标记的子节。
   必须逐子节扫描，以每个 \`## {编号} {标题}\` 为分界。
   - 每个 \`##\` 子节是一个独立的引用作用域
   - 同一 outline 内，子节 A 和子节 B 引用同一条标准 → 两条独立引用，各自写入，occurrence_index 分别递增
   - 同一子节内同一标准出现多次 → 只写一条（子节内去重）

   **外部引用**（对其他标准）：
   - 显式："见 GB/T xxxx""按第 x 章""应符合……的规定"
   - 隐式：上下文暗示某标准要求
   - 外部引用先标记 ref_type/explicit 和 source_text 后立即写入，**无需在写入前逐个定位目标文档**（定位在阶段 3 单独处理）

   **内部交叉引用**（对本文档其他章节）：
   - 典型模式："应符合 3.2.2 条""按 3.2.4 条规定""见 4.3""参照 5.5.2 节""性能应符合 3.2.2 及 3.2.4 条规定"
   - 匹配规则：从阶段 0 获取的章节列表中，查找 title 以引用节号最左前缀开头的 outline
   - "3.2.2" → 匹配 title 以 "3.2" 开头的 outline（子节归属到父节）
   - "4.3" → 匹配 title 以 "4.3" 开头的 outline
   - 内部交叉引用匹配到后直接写入 valid，无需走文档定位工具链

5. **写入前查重**：对每个要写的 section，先调 list_section_references 快速看一眼已有记录，从 max(existing_index)+1 开始编号。已有记录中同 source_text / 同 target 的不重复写。
6. 写入该批后**立刻进入下一批读**（回到步骤 3），不攒、不等、不留到"最后统一写"。
7. 重复直到所有章节处理完毕。
   效率目标：每批处理 1-3 章节，~30 轮内覆盖全部 51 章节

### 阶段 2.5：长章节必须翻页读完（关键！）
- read_section_context 返回 page_has_more=true 时，**必须**用 page_next_offset 作为 page 继续调用，直到 page_has_more=false 为止
- **禁止**只读第一页就跳过剩余内容；禁止用 read_revision_content 一次性读大节（全文 >5000 字符会被工具结果摘要化，你只能看到摘要看不到正文）
- 返回 overlap_lines>0 表示本页与上一页有行重叠（embedding 上下文连续性设计），写锚点时按 from_line 去重，**不要把重叠处的引用写两遍**
- 读完每页**立即**写该页发现的引用，再翻下一页（与读写交替一致，防止翻页过程中遗忘）
- 同一章节翻页各页共用一个 outline_id，occurrence_index 按页累计递增，不要跨页重复从 0 编号

8. 对于超长章节（整节超过 3 页仍未读完），可改用 read_revision_content 分页读取（max_chars=4000 逐页翻）

### 阶段 3：补定位 + 追加写入（仅外部引用）
8. 对阶段 2 中已写入的全部外部 gap 引用，逐条尝试定位目标文档/章节：
   a. find_documents_by_standard_code 或 find_documents_by_standard_name
   b. get_document_revisions
   c. select_revision_candidate
   d. find_section_candidates
9. 定位后调用 write_anchor_result 同幂等键回写 status/定位信息：
   - 定位到唯一高置信目标 → status: "valid"，填入 target_* 字段
   - 多个候选无法确定 → status: "suspected"
   - 找不到任何目标 → 保持 "gap"（阶段 2 已写入）
   - **内部交叉引用不经过此阶段，阶段 2 已直接落 valid**

### 阶段 3.5：完成前 gap 检查（阶段 2 全部完成后执行一次，必须执行）
10. **阶段 2 全部章节处理完毕后**，调用一次 list_reference_gaps(standard_id) 检查剩余 gap：
  - **刚完成清洗时 gap 列表为空属正常**（阶段 2 尚未对任何 gap 做过定位尝试），不要因为"gap 为空"就反复调用或打转，直接进入阶段 3 补定位
  - 如果还有 **尚未尝试处理** 的 gap，**禁止**输出“完成/处理完毕/最终报告”，必须继续做阶段 3
  - 如果这些 gap 已经逐条尝试定位，但因为系统里缺少对应标准、没有合适版本、没有足够线索等原因仍无法回填，则**允许保留 gap 并收尾**
  - 收尾时必须明确说明：哪些 gap 已尝试处理但仍无法定位，以及无法定位的原因
11. gap 定位必须优先组合使用以下工具：
  - find_documents_by_standard_code
  - find_documents_by_standard_name
  - get_document_revisions
  - select_revision_candidate
  - find_section_candidates
12. **禁止跳过阶段 3**：阶段 2 把外部引用先落成 gap 只是中间态，不是任务完成态

### 版本选择规则（重要，阶段 3 定位时必须遵守）
13. **引用注明了具体版本年份**（如"GB/T xxxx-2016"）：
    - 用 select_revision_candidate 传 hints.year（如 "2016"）精确匹配该年份版本
14. **引用只说"最新版"/未注明年份**（如"采用最新版本"）：
    - 调用 select_revision_candidate 时**不带 year/label**，并在 hints.source_publish_date 传入**当前被清洗标准（源文档）的发布日期**
    - 工具会优先按 publish_date 选择 ≤ 源文档发布日期的最新版本（"最新版只采用比档期文档发布时间更旧的文档"）
    - 若版本都没有 publish_date，工具回退 revision_no 降序返回第一个
    - **禁止**仅凭直觉选 revision_no 最大的版本而不考虑发布时序
15. 若目标版本列表中存在多个候选且无法唯一确定，落 suspected 而非猜测

   **write_anchor_result 参数**：
   - source_revision_id / source_outline_id / occurrence_index（幂等键，需与阶段 2 写入时一致）
   - source_text（逐字复制）/ context_text
   - ref_type: explicit 或 implicit
   - status: valid / suspected / gap
   - target_document_id / target_revision_id / target_outline_id（定位工具返回）
   - **内部交叉引用**：source_outline_id 为引用出现的章节，target_outline_id 为被引用章节，status_reason: "internal_cross_ref"
   - 幂等：同一 (source_revision_id, source_outline_id, occurrence_index) 重复调用不会产生重复记录，后调用会更新已有记录

## 纪律

1. 禁止臆造 document_id / revision_id / outline_id —— 必须来自工具返回值
2. 工具返回空就落 gap，不得猜测补充
3. 严禁在"规范性引用文件""参考文献"等纯书目章节内落锚点
4. 顺序推进，不跳节，不回溯
5. **禁止重复读取（关键！）**：一旦某 outline 的正文已被 read_section_context 完整读过（page_has_more=false），**不得再次读取同一 outline**，除非是翻页续读。每轮 list_revision_sections 返回的章节列表在记忆中已存在，**不要反复调用它刷新列表**——只有第一次进入阶段 2 或需要确认章节 ID 时才调用。重复读取会把相同内容反复累积进上下文，导致请求超出模型窗口而失败（已发生：GB 11552 因前 5 轮重复读同一章节撑爆 128k 窗口）。
6. 禁止编造事实、补充文档中不存在的信息
6. 每条 write_anchor_result 必须携带 occurrence_index 保证幂等
7. 内部交叉引用也必须逐条写入，不允许"等内部引用不写了"这种省略
8. 内部引用的节号匹配用最长前缀：如 "3.2.2 条" 匹配 title 以 "3.2" 开头的 outline（不是 "3.2.2"）
9. 完成全部章节后报告完成摘要：总引用数、valid/suspected/gap 分布（内部交叉引用计入 valid）
10. **章节错位容错**：OCR 可能导致 outline 边界不准。read_section_context 返回的内容可能包含邻近章节的正文：
    - 正文以 \`## {编号} {标题}\` 为界。若当前 outline 标题是"3.16"但正文中包含 \`## 3.15.1 涂镀层和化学处理层\`，则 3.15.1 的内容**必须当作独立子节**逐段扫描
    - 对于被错放到其他 outline 中的子节内容，引用仍以**当前 outline 的 outline_id** 写入（因内容在这里），但 occurrence_index 按实际出现的子节递增
    - 不要因为"这个 outline 标题和子节编号对不上"就跳过正文中的引用
11. **逐子节扫描**：read_section_context 返回的原文可能包含多个 \`##\` 标记的子节。每个 \`##\` 子节是独立作用域，必须逐个扫描：
    - 同一标准在不同子节各出现一次 → 各写一条，分别递增 occurrence_index
    - 同一子节内同一标准出现多次 → 只写一条（子节内去重）
    - 不要因为"前面子节已经写过这个标准了"就跳过后面子节中的同标准引用
12. **跨 outline 独立（关键！）**：每个 outline 是独立的引用作用域，**禁止跨 outline 去重**：
    - 同一标准（如 QC/T 625）出现在 outline A（如 3.16）和 outline B（如 4.15）→ 各写一条，互不替代
    - 内部交叉引用同理：outline A 引用 3.2.2 条 → 写；outline B 也引用 3.2.2 条 → 也必须写
    - **严禁**因为"另一个 outline 已经写过这个标准了"就跳过当前 outline 中的同标准引用
    - 第 3 章（技术要求）和第 4 章（试验方法）引用同一标准是完全正常且独立的两条锚点
  13. **收尾门槛**：只有在你已经执行过 list_reference_gaps，并对剩余 gap 逐条尝试过定位后，才允许输出“阶段3完成”“清洗完成”“最终报告”等结束语；允许存在“已尝试但暂时无法回填”的 gap`;

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
    max_tool_rounds: 60,
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
  console.log(`max_tool_rounds: 60`);
  console.log('\n下一步: node scripts/run-anchor-cleaning.mjs');
  console.log('  （脚本自动调用服务端 /standards/:id/clean 端点，无需再传 EXPERT_ID）');
}

// 作为主模块运行时才执行（被其他脚本 import 时仅导出 DEFAULT_PROMPT）
const isMainModule =
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;

if (isMainModule) {
  main().catch(err => {
    console.error('❌ 失败:', err.message);
    process.exit(1);
  });
}

export { DEFAULT_PROMPT };
