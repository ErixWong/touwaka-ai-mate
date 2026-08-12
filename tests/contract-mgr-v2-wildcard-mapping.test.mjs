/**
 * Contract-Mgr-V2 wildcard 路由映射验证脚本
 * 复制 app-wildcard-router.js 的核心匹配逻辑，验证所有 Contract-Mgr-V2 URL 正确落到 handler
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APPS_DIR = path.join(__dirname, '..', 'apps');
const HANDLERS_DIR = 'server/handlers';

function _collectCandidates(remainingSegs, handlerPrefix, collectedParams, appId, candidates) {
  if (remainingSegs.length === 0) return;

  for (let len = remainingSegs.length; len >= 1; len--) {
    const trySegments = remainingSegs.slice(0, len);
    const relPath = [...handlerPrefix, ...trySegments].join('/');
    const handlerFile = path.join(HANDLERS_DIR, relPath) + '.js';
    const fullPath = path.join(APPS_DIR, appId, handlerFile);

    if (fs.existsSync(fullPath)) {
      const rest = remainingSegs.slice(len);
      const allParams = [...collectedParams, ...rest];
      const params = {};
      for (let j = 0; j < allParams.length; j++) params[`p${j}`] = allParams[j];
      candidates.push({ handlerPath: handlerFile, params, depth: handlerPrefix.length + len });
    }
  }

  for (let prefixLen = 1; prefixLen <= remainingSegs.length - 1; prefixLen++) {
    const dirSegments = remainingSegs.slice(0, prefixLen);
    const dirPath = path.join(APPS_DIR, appId, HANDLERS_DIR, ...dirSegments);
    if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
      const paramValue = remainingSegs[prefixLen];
      const nextRemaining = remainingSegs.slice(prefixLen + 1);
      _collectCandidates(nextRemaining, [...handlerPrefix, ...dirSegments], [...collectedParams, paramValue], appId, candidates);
    }
  }
}

function resolveHandlerPath(appInternalPath, appId) {
  const segments = appInternalPath.split('/').filter(Boolean);
  if (segments.length === 0) return null;
  const candidates = [];
  _collectCandidates(segments, [], [], appId, candidates);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.depth - a.depth);
  return candidates[0];
}

const cases = [
  ['GET', '/dashboard', 'dashboard.js'],
  ['GET', '/compare-runs', 'compare-runs.js'],
  ['GET', '/compare-runs/RUN123', 'compare-runs.js'],
  ['GET', '/contracts', 'contracts.js'],
  ['GET', '/contracts/C123', 'contracts.js'],
  ['GET', '/contracts/C123/versions', 'contracts/versions.js'],
  ['POST', '/contracts/C123/versions/from-attachment', 'contracts/versions/from-attachment.js'],
  ['GET', '/org-nodes', 'org-nodes.js'],
  ['GET', '/org-nodes/tree', 'org-nodes.js'],
  ['GET', '/org-nodes/N123/stats', 'org-nodes/stats.js'],
  ['PUT', '/org-nodes/N123', 'org-nodes.js'],
  ['GET', '/versions', 'versions.js'],
  ['PUT', '/versions/V123', 'versions.js'],
  ['PUT', '/versions/V123/approve', 'versions/approve.js'],
  ['PUT', '/versions/V123/current', 'versions/current.js'],
  ['GET', '/versions/V123/metadata', 'versions/metadata.js'],
  ['GET', '/versions/V123/processing-status', 'versions/processing-status.js'],
  ['POST', '/versions/V123/extract-metadata', 'versions/extract-metadata.js'],
  ['GET', '/versions/V123/content', 'versions/content.js'],
];

let pass = 0;
let fail = 0;

for (const [method, url, expected] of cases) {
  const appInternalPath = url.startsWith('/') ? url : '/' + url;
  const result = resolveHandlerPath(appInternalPath, 'contract-mgr-v2');
  const got = result ? result.handlerPath.replace(/^server\/handlers\//, '') : null;
  if (got === expected) {
    pass++;
    console.log(`✅ ${method} ${url.padEnd(38)} → ${got}`);
  } else {
    fail++;
    console.log(`❌ ${method} ${url.padEnd(38)} → 期望 ${expected}，实际 ${got} (params=${JSON.stringify(result?.params)})`);
  }
}

console.log(`\n结果: ${pass}/${cases.length} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
