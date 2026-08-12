/**
 * ELS wildcard 路由映射验证脚本
 * 复制 app-wildcard-router.js 的核心匹配逻辑，验证所有 ELS URL 正确落到 handler
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
  ['GET', '/libraries', 'libraries.js'],
  ['POST', '/libraries/select', 'libraries.js'],
  ['GET', '/libraries/LIB123/materials', 'libraries/materials.js'],
  ['POST', '/materials', 'materials.js'],
  ['GET', '/materials/recommended', 'materials.js'],
  ['GET', '/materials/MAT123', 'materials.js'],
  ['PUT', '/materials/MAT123', 'materials.js'],
  ['GET', '/notebooks', 'notebooks.js'],
  ['POST', '/notebooks/select', 'notebooks.js'],
  ['POST', '/words', 'words.js'],
  ['GET', '/words/WORD123', 'words.js'],
  ['GET', '/materials/MAT123/quiz', 'materials/quiz.js'],
  ['POST', '/materials/MAT123/quiz/submit', 'materials/quiz/submit.js'],
  ['GET', '/reviews', 'reviews.js'],
  ['POST', '/reviews/submit', 'reviews.js'],
  ['GET', '/checkin', 'checkin.js'],
];

let pass = 0;
let fail = 0;

for (const [method, url, expected] of cases) {
  const appInternalPath = url.startsWith('/') ? url : '/' + url;
  const result = resolveHandlerPath(appInternalPath, 'els');
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
