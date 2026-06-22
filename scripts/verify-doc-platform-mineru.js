import fs from 'fs';
import path from 'path';

import Database from '../lib/db.js';

const DEFAULT_PDF = 'C:/Users/gxz/Desktop/mcp测试/MxMoE.pdf';
const DEFAULT_BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000/api';
const DEFAULT_ACCOUNT = process.env.TEST_ACCOUNT || 'admin';
const DEFAULT_PASSWORD = process.env.TEST_PASSWORD || '123456';
const DEFAULT_TIMEOUT_MS = Number(process.env.TEST_TIMEOUT_MS || 20 * 60 * 1000);
const DEFAULT_POLL_MS = Number(process.env.TEST_POLL_MS || 5000);
const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'touwaka',
  password: process.env.DB_PASSWORD || '123456',
  database: process.env.DB_NAME || 'touwaka_mate',
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseArgs(argv) {
  const options = {
    file: DEFAULT_PDF,
    baseUrl: DEFAULT_BASE_URL.replace(/\/+$/, ''),
    account: DEFAULT_ACCOUNT,
    password: DEFAULT_PASSWORD,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    pollMs: DEFAULT_POLL_MS,
    appId: 'contract-mgr-v2',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--file') options.file = argv[++i];
    else if (arg === '--base-url') options.baseUrl = argv[++i].replace(/\/+$/, '');
    else if (arg === '--account') options.account = argv[++i];
    else if (arg === '--password') options.password = argv[++i];
    else if (arg === '--timeout-ms') options.timeoutMs = Number(argv[++i]);
    else if (arg === '--poll-ms') options.pollMs = Number(argv[++i]);
    else if (arg === '--app-id') options.appId = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }

  options.file = path.resolve(options.file);
  return options;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Failed to parse JSON from ${url}: ${text.slice(0, 300)}`);
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} ${url}: ${JSON.stringify(body)}`);
  }
  return body;
}

function authHeaders(token, contentType = 'application/json') {
  const headers = { Authorization: `Bearer ${token}` };
  if (contentType) headers['Content-Type'] = contentType;
  return headers;
}

async function login(baseUrl, account, password) {
  const result = await requestJson(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: authHeaders('', 'application/json'),
    body: JSON.stringify({ account, password }),
  });
  const accessToken = result?.data?.access_token || result?.access_token;
  const user = result?.data?.user || result?.user;
  assert(accessToken, 'Login response missing access_token');
  assert(user?.id, 'Login response missing user');
  return { accessToken, user };
}

async function getDepartmentTree(baseUrl, token) {
  const result = await requestJson(`${baseUrl}/departments/tree`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return result?.data || result || [];
}

function flattenDepartments(nodes, out = []) {
  for (const node of nodes || []) {
    if (node?.id) out.push(node);
    if (Array.isArray(node?.children)) flattenDepartments(node.children, out);
  }
  return out;
}

async function createDepartment(baseUrl, token) {
  const now = Date.now();
  const result = await requestJson(`${baseUrl}/departments`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      name: `verify-doc-platform-${now}`,
      description: 'Created by MinerU doc-platform verification script',
    }),
  });
  return result?.data || result;
}

async function bindUserDepartment(baseUrl, token, userId, departmentId) {
  await requestJson(`${baseUrl}/users/${userId}/organization`, {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify({ department_id: departmentId }),
  });
}

async function getUserOrganization(baseUrl, token, userId) {
  const result = await requestJson(`${baseUrl}/users/${userId}/organization`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return result?.data || result;
}

async function ensureDepartment(baseUrl, token, user) {
  if (user?.department_id) return user.department_id;
  const tree = await getDepartmentTree(baseUrl, token);
  const dept = flattenDepartments(tree)[0] || await createDepartment(baseUrl, token);
  assert(dept?.id, 'Unable to resolve department_id');
  await bindUserDepartment(baseUrl, token, user.id, dept.id);
  return dept.id;
}

async function pickEmbeddingModel(baseUrl, token) {
  const result = await requestJson(`${baseUrl}/models`, {
    headers: authHeaders(token, null),
  });
  const list = result?.data?.items || result?.items || result?.data || [];
  const model = Array.isArray(list) ? list.find((item) => item?.id) : null;
  assert(model?.id, 'No model available');
  return model.id;
}

async function ensureCollection(baseUrl, token, embeddingModelId) {
  const result = await requestJson(`${baseUrl}/docs/collections`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      name: `MinerU集成测试-${Date.now()}`,
      description: 'Document platform MinerU verification',
      embedding_model_id: embeddingModelId,
    }),
  });
  return result?.data || result;
}

async function uploadAttachment(baseUrl, token, filePath) {
  const form = new FormData();
  const buffer = fs.readFileSync(filePath);
  const blob = new Blob([buffer], { type: 'application/pdf' });
  form.append('file', blob, path.basename(filePath));
  form.append('source_tag', 'mini_app');
  form.append('source_id', 'ocr-tool');

  const response = await fetch(`${baseUrl}/attachments/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} ${baseUrl}/attachments/upload: ${JSON.stringify(body)}`);
  }
  return body?.data || body;
}

async function createIntake(baseUrl, token, appId, collectionId, attachmentId) {
  const result = await requestJson(`${baseUrl}/docs/intakes`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      app_id: appId,
      collection_id: collectionId,
      attachments: [{ id: attachmentId }],
    }),
  });
  return result?.data || result;
}

async function submitOcr(baseUrl, token, documentId, attachmentId) {
  const result = await requestJson(`${baseUrl}/docs/documents/${documentId}/ocr/submit`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      attachment_id: attachmentId,
      lang: 'ch',
      image_analysis: true,
      formula_enable: true,
      table_enable: true,
    }),
  });
  return result?.data || result;
}

async function syncOcr(baseUrl, token, documentId) {
  const result = await requestJson(`${baseUrl}/docs/documents/${documentId}/ocr/sync`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({}),
  });
  return result?.data || result;
}

async function getProcessingStatus(baseUrl, token, documentId) {
  const result = await requestJson(`${baseUrl}/docs/documents/${documentId}/processing`, {
    headers: authHeaders(token, null),
  });
  return result?.data || result;
}

async function getDocumentResult(baseUrl, token, documentId) {
  const result = await requestJson(`${baseUrl}/docs/documents/${documentId}/result`, {
    headers: authHeaders(token, null),
  });
  return result?.data || result;
}

async function waitForCompletion(baseUrl, token, documentId, timeoutMs, pollMs) {
  const startedAt = Date.now();
  let lastStatus = null;

  while (Date.now() - startedAt < timeoutMs) {
    const sync = await syncOcr(baseUrl, token, documentId).catch((error) => ({ error: error.message }));
    const status = await getProcessingStatus(baseUrl, token, documentId);
    lastStatus = { sync, status };

    console.log(`[poll] doc=${documentId} processing=${status.processing_status} ocr=${status.ocr_result?.status || 'n/a'} progress=${status.ocr_result?.progress ?? 'n/a'} task_id=${status.ocr_result?.task_id || 'n/a'} sync_error=${sync?.error || 'none'}`);

    if (status.ocr_result?.status === 'completed' && status.ocr_result?.main_markdown_attachment_id) {
      return lastStatus;
    }
    if (status.processing_status === 'error' || status.ocr_result?.status === 'failed') {
      throw new Error(`OCR failed: ${JSON.stringify(lastStatus)}`);
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  throw new Error(`Timed out waiting for OCR completion. lastStatus=${JSON.stringify(lastStatus)}`);
}

async function waitForReady(baseUrl, token, documentId, timeoutMs, pollMs) {
  const startedAt = Date.now();
  let lastResult = null;

  while (Date.now() - startedAt < timeoutMs) {
    const result = await getDocumentResult(baseUrl, token, documentId);
    lastResult = result;
    const status = result?.processing?.status || result?.document?.processing_status || 'unknown';
    console.log(`[ready-poll] doc=${documentId} status=${status} revision=${result?.revision?.id || 'n/a'}`);

    if (status === 'ready') {
      return lastResult;
    }

    if (status === 'error') {
      throw new Error(`Document did not reach ready state: ${JSON.stringify(lastResult)}`);
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  throw new Error(`Timed out waiting for document ready state. lastResult=${JSON.stringify(lastResult)}`);
}

async function verifyDatabase(documentId) {
  const db = new Database(DB_CONFIG);
  await db.connect();
  try {
    const document = await db.getOne(
      'SELECT id, title, processing_status, processing_error_code, processing_error_message, current_revision_id FROM documents WHERE id = ? LIMIT 1',
      [documentId]
    );
    const ocrResult = await db.getOne(
      'SELECT id, provider, task_id, status, progress, main_markdown_attachment_id, raw_result_attachment_id, deliverables_manifest_attachment_id, image_manifest_attachment_id, image_count, line_count FROM doc_ocr_results WHERE document_id = ? ORDER BY created_at DESC LIMIT 1',
      [documentId]
    );
    const markdownAttachment = ocrResult?.main_markdown_attachment_id
      ? await db.getOne('SELECT id, file_name, mime_type, file_size, file_path FROM attachments WHERE id = ? LIMIT 1', [ocrResult.main_markdown_attachment_id])
      : null;
    const imageCount = ocrResult?.id
      ? await db.getOne('SELECT COUNT(*) AS count FROM doc_ocr_images WHERE ocr_result_id = ?', [ocrResult.id])
      : { count: 0 };

    return {
      document,
      ocrResult,
      markdownAttachment,
      imageCount: imageCount?.count || 0,
    };
  } finally {
    await db.close();
  }
}

function printSummary(summary) {
  console.log('\n[summary]');
  console.log(`  document_id: ${summary.document?.id}`);
  console.log(`  processing_status: ${summary.document?.processing_status}`);
  console.log(`  processing_error_code: ${summary.document?.processing_error_code || 'null'}`);
  console.log(`  ocr_result_id: ${summary.ocrResult?.id || 'null'}`);
  console.log(`  provider: ${summary.ocrResult?.provider || 'null'}`);
  console.log(`  task_id: ${summary.ocrResult?.task_id || 'null'}`);
  console.log(`  ocr_status: ${summary.ocrResult?.status || 'null'}`);
  console.log(`  markdown_attachment_id: ${summary.ocrResult?.main_markdown_attachment_id || 'null'}`);
  console.log(`  markdown_attachment_name: ${summary.markdownAttachment?.file_name || 'null'}`);
  console.log(`  line_count: ${summary.ocrResult?.line_count || 0}`);
  console.log(`  image_count(field): ${summary.ocrResult?.image_count || 0}`);
  console.log(`  image_count(table): ${summary.imageCount}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  assert(fs.existsSync(options.file), `PDF file not found: ${options.file}`);

  let { accessToken, user } = await login(options.baseUrl, options.account, options.password);
  console.log(`[login] user=${user.username || user.id}`);

  const departmentId = await ensureDepartment(options.baseUrl, accessToken, user);
  console.log(`[department] id=${departmentId}`);

  ({ accessToken, user } = await login(options.baseUrl, options.account, options.password));
  const org = await getUserOrganization(options.baseUrl, accessToken, user.id);
  console.log(`[department] confirmed=${org.department_id || 'null'}`);

  const embeddingModelId = await pickEmbeddingModel(options.baseUrl, accessToken);
  console.log(`[model] embedding_model_id=${embeddingModelId}`);

  const collection = await ensureCollection(options.baseUrl, accessToken, embeddingModelId);
  console.log(`[collection] id=${collection.id}`);

  const attachment = await uploadAttachment(options.baseUrl, accessToken, options.file);
  console.log(`[attachment] id=${attachment.id} name=${attachment.file_name}`);

  const intake = await createIntake(options.baseUrl, accessToken, options.appId, collection.id, attachment.id);
  globalThis.__verifyDocumentId = intake.document_id;
  console.log(`[intake] document_id=${intake.document_id} revision_id=${intake.revision_id} processing=${intake.processing_status}`);

  const submit = await submitOcr(options.baseUrl, accessToken, intake.document_id, attachment.id);
  console.log(`[submit] ocr_result_id=${submit.ocr_result_id} task_id=${submit.task_id || 'null'} status=${submit.status} progress=${submit.progress}`);

  const completed = await waitForCompletion(options.baseUrl, accessToken, intake.document_id, options.timeoutMs, options.pollMs);
  console.log(`[completed] processing_status=${completed.status.processing_status} ocr_status=${completed.status.ocr_result?.status}`);

  const readyResult = await waitForReady(options.baseUrl, accessToken, intake.document_id, options.timeoutMs, options.pollMs);
  console.log(`[ready] processing_status=${readyResult.processing?.status} revision=${readyResult.revision?.id || 'n/a'}`);

  const summary = await verifyDatabase(intake.document_id);
  assert(summary.document?.id, 'Document not found in database');
  assert(summary.ocrResult?.id, 'doc_ocr_results record missing');
  assert(summary.ocrResult?.provider === 'mineru', `Unexpected provider: ${summary.ocrResult?.provider}`);
  assert(summary.ocrResult?.status === 'completed', `OCR DB status not completed: ${summary.ocrResult?.status}`);
  assert(summary.ocrResult?.main_markdown_attachment_id, 'main_markdown_attachment_id missing');
  assert(summary.markdownAttachment?.id, 'Markdown attachment missing');
  assert((summary.ocrResult?.line_count || 0) > 0, 'line_count should be > 0');
  assert(summary.document?.processing_status === 'ready', `Document not ready after pipeline: ${summary.document?.processing_status}`);

  printSummary(summary);
  console.log('\nDocument-platform MinerU integration verification passed.');
}

main().catch((error) => {
  const docId = globalThis.__verifyDocumentId;
  if (docId) {
    verifyDatabase(docId)
      .then((summary) => {
        console.error('\n[failure-db-summary]');
        console.error(JSON.stringify(summary, null, 2));
      })
      .catch((dbErr) => {
        console.error(`[failure-db-summary-error] ${dbErr.message}`);
      })
      .finally(() => {
        console.error(`[error] ${error.message}`);
        process.exitCode = 1;
      });
    return;
  }

  console.error(`[error] ${error.message}`);
  process.exitCode = 1;
});
