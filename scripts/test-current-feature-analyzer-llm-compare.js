/**
 * CFA 压缩算法 LLM 识别效果端到端对比脚本
 *
 * 验证目标：
 *   对同一批样本文件，分别以不同压缩算法执行完整分析任务
 *   （上传 -> 前端同源压缩 -> analysis/run -> LLM 阶段识别），
 *   对比各算法的 LLM 阶段识别结果与压缩耗时。
 *
 * 运行前置条件：
 *   - 必须先启动后端服务：npm run api 或 node server/index.js
 *     （注意：服务端代码修改后必须重启，否则 stage-recognition 仍为旧逻辑）
 *   - 默认连接地址：http://localhost:3017
 *   - 需要有效的登录账号（默认 admin/password123）
 *   - 数据库中需有可用规则集与 LLM 模型配置
 *   - 样本 CSV 存在（可用参数覆盖路径）
 *
 * 使用方法：
 *   node scripts/test-current-feature-analyzer-llm-compare.js [csv1] [csv2] ...
 *   node scripts/test-current-feature-analyzer-llm-compare.js --algorithms=adaptive_v2,optimal_segmentation_v1
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(path.join(REPO_ROOT, 'frontend', 'package.json'));
const { build } = require('esbuild');

const BASE_URL = 'http://localhost:3017';
const DEFAULT_SAMPLES = [
  'D:\\seafile\\temp_files\\临时文件\\2026\\06\\C518-85-RR_1.csv',
  'D:\\seafile\\temp_files\\临时文件\\2026\\06\\scope_0.1.csv',
];
const DEFAULT_ALGORITHMS = ['adaptive_v2', 'envelope_turning_points_v3', 'optimal_segmentation_v1'];

function parseCli(argv) {
  const options = { samples: [], algorithms: DEFAULT_ALGORITHMS };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--algorithms=')) {
      options.algorithms = arg.slice('--algorithms='.length).split(',').map(s => s.trim()).filter(Boolean);
    } else if (!arg.startsWith('--')) {
      options.samples.push(arg);
    }
  }
  if (options.samples.length === 0) options.samples = DEFAULT_SAMPLES;
  return options;
}

async function login() {
  const resp = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: 'admin', password: 'password123' }),
  });
  const data = await resp.json();
  if (data.code !== 200) throw new Error(`登录失败: ${data.message}`);
  return data.data.access_token;
}

// undici keep-alive 与本服务存在连接复用问题（大 JSON POST 偶发 ECONNRESET），
// analysis/run 一律走 http 核心模块 + Connection: close
function postJson(pathname, payload, token) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const req = http.request(`${BASE_URL}${pathname}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': body.length,
        Authorization: `Bearer ${token}`,
        Connection: 'close',
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
        } catch (err) {
          reject(new Error(`响应解析失败(HTTP ${res.statusCode}): ${err.message}`));
        }
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function uploadFile(fileName, content, token) {
  const boundary = '----cfa' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${fileName}"\r\nContent-Type: text/csv\r\n\r\n`),
    Buffer.from(content, 'utf8'),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const resp = await fetch(`${BASE_URL}/api/apps/current-feature-analyzer/uploads`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, Authorization: `Bearer ${token}` },
    body,
  });
  return resp.json();
}

async function main() {
  const options = parseCli(process.argv);

  // 打包前端压缩代码（与浏览器运行的是同一份源码）
  const outfile = path.join(os.tmpdir(), `cfa-local-analysis-${process.pid}.mjs`);
  await build({
    entryPoints: [path.join(REPO_ROOT, 'apps', 'current-feature-analyzer', 'frontend', 'utils', 'local-analysis.ts')],
    bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'error',
  });
  const { runLocalCurrentFeatureAnalysis } = await import(pathToFileURL(outfile).href);
  const { default: CsvParseService } = await import(pathToFileURL(
    path.join(REPO_ROOT, 'apps', 'current-feature-analyzer', 'server', 'services', 'csv-parse.service.js')
  ).href);

  const token = await login();
  console.log('✅ 登录成功');

  const rsResp = await fetch(`${BASE_URL}/api/apps/current-feature-analyzer/rule-sets`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const rsBody = await rsResp.json();
  const ruleSets = rsBody?.data?.items || [];
  const ruleSet = ruleSets.find(r => r.is_default && r.is_enabled) || ruleSets.find(r => r.is_enabled) || ruleSets[0];
  if (!ruleSet) throw new Error('无可用规则集');
  console.log(`✅ 规则集: ${ruleSet.rule_set_name} (${ruleSet.id})`);

  for (const sample of options.samples) {
    const fileName = path.basename(sample);
    console.log(`\n########## ${fileName} ##########`);
    if (!fs.existsSync(sample)) { console.log('  ⚠️ 样本不存在，跳过'); continue; }
    const content = fs.readFileSync(sample, 'utf8');
    const parsed = new CsvParseService(null).parse(content);
    if (parsed.error) { console.log(`  ⚠️ CSV 解析失败: ${parsed.error}`); continue; }
    const points = parsed.points.map(p => [Number(p[0]), Number(p[1])]);

    for (const algorithm of options.algorithms) {
      const upBody = await uploadFile(fileName, content, token);
      if (upBody.code !== 200) { console.log(`  [${algorithm}] ❌ 上传失败: ${upBody.message}`); continue; }
      const batch = upBody.data;
      const fileId = batch.files[0].file_id;

      const t0 = Date.now();
      const result = runLocalCurrentFeatureAnalysis(points, null, algorithm);
      const compressMs = Date.now() - t0;

      const { body: runBody } = await postJson('/api/apps/current-feature-analyzer/analysis/run', {
        batch_id: batch.batch_id,
        rule_set_id: ruleSet.id,
        file_results: [{ file_id: fileId, analysis_status: 'completed', warning_count: 0, result }],
      }, token);
      if (runBody.code !== 200) { console.log(`  [${algorithm}] ❌ 分析失败: ${runBody.message}`); continue; }

      const file = runBody.data.files[0];
      const llm = file?.result?.llm_result;
      console.log(`\n  ==== ${algorithm} (压缩 ${compressMs}ms, 段数 ${result.segments.length}) 状态=${file.analysis_status}${file.error_message ? ' 错误=' + file.error_message : ''} ====`);
      if (!llm) { console.log('  无 llm_result'); continue; }
      console.log(`  summary: ${llm.summary || '-'}`);
      for (const st of llm.stages || []) {
        console.log(`  ${st.stage_code}(${st.stage_name}): ${st.start_time}s -> ${st.end_time}s  conf=${st.confidence ?? '-'}${st.cycle_index ? ' cycle=' + st.cycle_index : ''}`);
      }
      for (const w of llm.warnings || []) console.log(`  warning: ${w.message || JSON.stringify(w)}`);
    }
  }

  fs.rmSync(outfile, { force: true });
}

main().catch((err) => {
  console.error('测试执行错误:', err);
  process.exit(1);
});
