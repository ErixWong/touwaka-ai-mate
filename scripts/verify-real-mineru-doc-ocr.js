import fs from 'fs';
import path from 'path';

import Database from '../lib/db.js';

const DEFAULT_PDF = 'C:/Users/gxz/Desktop/mcp测试/MxMoE.pdf';
const DEFAULT_BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000/api';
const DEFAULT_ACCOUNT = process.env.TEST_ACCOUNT || 'admin';
const DEFAULT_PASSWORD = process.env.TEST_PASSWORD || '123456';
const DEFAULT_TIMEOUT_MS = Number(process.env.TEST_TIMEOUT_MS || 15 * 60 * 1000);
const DEFAULT_POLL_MS = Number(process.env.TEST_POLL_MS || 5000);
const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

function parseArgs(argv) {
  const options = {
    file: DEFAULT_PDF,
    baseUrl: DEFAULT_BASE_URL.replace(/\/+$/, ''),
    account: DEFAULT_ACCOUNT,
    password: DEFAULT_PASSWORD,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    pollMs: DEFAULT_POLL_MS,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--file') {
      options.file = argv[++i];
    } else if (arg === '--base-url') {
      options.baseUrl = argv[++i].replace(/\/+$/, '');
    } else if (arg === '--account') {
      options.account = argv[++i];
    } else if (arg === '--password') {
      options.password = argv[++i];
    } else if (arg === '--timeout-ms') {
      options.timeoutMs = Number(argv[++i]);
    } else if (arg === '--poll-ms') {
      options.pollMs = Number(argv[++i]);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  options.file = path.resolve(options.file);
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/verify-real-mineru-doc-ocr.js [options]

Options:
  --file <path>         PDF file path, default: ${DEFAULT_PDF}
  --base-url <url>      Backend API base URL, default: ${DEFAULT_BASE_URL}
  --account <account>   Login account, default: ${DEFAULT_ACCOUNT}
  --password <pwd>      Login password, default from env or 123456
  --timeout-ms <ms>     Max wait time, default: ${DEFAULT_TIMEOUT_MS}
  --poll-ms <ms>        Poll interval, default: ${DEFAULT_POLL_MS}
`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (error) {
    throw new Error(`Failed to parse JSON from ${url}: ${text.slice(0, 300)}`);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} ${url}: ${JSON.stringify(body)}`);
  }

  return body;
}

async function login(baseUrl, account, password) {
  const result = await requestJson(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, password }),
  });

  const accessToken = result?.data?.access_token || result?.access_token;
  const user = result?.data?.user || result?.user;
  assert(accessToken, 'Login response missing access_token');
  assert(user?.id, 'Login response missing user');
  return { accessToken, user };
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function pickEmbeddingModel(baseUrl, token) {
  const result = await requestJson(`${baseUrl}/models`, {
    headers: authHeaders(token),
  });
  const list = result?.data?.items || result?.items || result?.data || [];
  const model = Array.isArray(list) ? list.find((item) => item?.id) : null;
  assert(model?.id, 'No embedding/AI model available for collection creation');
  return model.id;
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
    if (Array.isArray(node?.children) && node.children.length > 0) {
      flattenDepartments(node.children, out);
    }
  }
  return out;
}

async function createDepartment(baseUrl, token) {
  const now = Date.now();
  const result = await requestJson(`${baseUrl}/departments`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      name: `verify-mineru-dept-${now}`,
      description: 'Created by OCR integration verification script',
    }),
  });
  return result?.data || result;
}

async function bindUserDepartment(baseUrl, token, userId, departmentId) {
  const result = await requestJson(`${baseUrl}/users/${userId}/organization`, {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify({ department_id: departmentId }),
  });
  return result?.data || result;
}

async function ensureDepartment(baseUrl, token, user) {
  if (user?.department_id) return user.department_id;

  const tree = await getDepartmentTree(baseUrl, token);
  const existing = flattenDepartments(tree).find((item) => item?.id);
  const departmentId = existing?.id || (await createDepartment(baseUrl, token))?.id;
  assert(departmentId, 'Unable to resolve department_id for current user');

  await bindUserDepartment(baseUrl, token, user.id, departmentId);
  return departmentId;
}

async function getUserOrganization(baseUrl, token, userId) {
  const result = await requestJson(`${baseUrl}/users/${userId}/organization`, {
    headers: { Authorization: `Bearer ${token}` },
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

async function createOcrToolTask(baseUrl, token, attachmentId) {
  const result = await requestJson(`${baseUrl}/ocr/analyze`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      attachment_id: attachmentId,
      prompt: '请抽取文档内容',
      use_document_platform: true,
    }),
  });
  return result?.data || result;
}

async function getOcrToolTask(baseUrl, token, taskId) {
  const result = await requestJson(`${baseUrl}/ocr/status/${taskId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return result?.data || result;
}

async function getProcessingStatus(baseUrl, token, documentId) {
  const result = await requestJson(`${baseUrl}/docs/documents/${documentId}/processing`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return result?.data || result;
}

async function waitForOcr(baseUrl, token, taskId, documentId, timeoutMs, pollMs) {
  const startedAt = Date.now();
  let lastStatus = null;

  while (Date.now() - startedAt < timeoutMs) {
    const task = await getOcrToolTask(baseUrl, token, taskId).catch(() => null);
    const status = await getProcessingStatus(baseUrl, token, documentId);
    lastStatus = { task, status };
    console.log(`[poll] task=${taskId} task_status=${task?.status || 'n/a'} doc=${documentId} processing=${status.processing_status} ocr=${status.ocr_result?.status || 'n/a'} progress=${status.ocr_result?.progress ?? 'n/a'}`);

    if (status.ocr_result?.status === 'completed' && status.ocr_result?.main_markdown_attachment_id) {
      return { task, status };
    }
    if (task?.status === 'failed' || status.processing_status === 'error' || status.ocr_result?.status === 'failed') {
      throw new Error(`OCR failed: ${JSON.stringify({ task, status })}`);
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  throw new Error(`Timed out waiting for OCR completion. lastStatus=${JSON.stringify(lastStatus)}`);
}

async function verifyDatabase(documentId) {
  const db = new Database(DB_CONFIG);
  await db.connect();
  try {
    const doc = await db.getOne('SELECT id, title, processing_status, current_revision_id FROM documents WHERE id = ? LIMIT 1', [documentId]);
    const ocr = await db.getOne('SELECT id, task_id, status, main_markdown_attachment_id, raw_result_attachment_id, deliverables_manifest_attachment_id, image_manifest_attachment_id, image_count, line_count FROM doc_ocr_results WHERE document_id = ? ORDER BY created_at DESC LIMIT 1', [documentId]);
    const images = await db.getOne('SELECT COUNT(*) AS count FROM doc_ocr_images WHERE ocr_result_id = ?', [ocr?.id || '']);
    const markdownAttachment = ocr?.main_markdown_attachment_id
      ? await db.getOne('SELECT id, file_name, mime_type, file_size FROM attachments WHERE id = ? LIMIT 1', [ocr.main_markdown_attachment_id])
      : null;

    return {
      document: doc,
      ocrResult: ocr,
      imageCount: images?.count || 0,
      markdownAttachment,
    };
  } finally {
    await db.close();
  }
}

function printSummary(summary) {
  console.log('\n[summary]');
  console.log(`  document_id: ${summary.document?.id}`);
  console.log(`  processing_status: ${summary.document?.processing_status}`);
  console.log(`  ocr_result_id: ${summary.ocrResult?.id}`);
  console.log(`  task_id: ${summary.ocrResult?.task_id}`);
  console.log(`  ocr_status: ${summary.ocrResult?.status}`);
  console.log(`  markdown_attachment_id: ${summary.ocrResult?.main_markdown_attachment_id}`);
  console.log(`  markdown_attachment_name: ${summary.markdownAttachment?.file_name}`);
  console.log(`  line_count: ${summary.ocrResult?.line_count}`);
  console.log(`  image_count(field): ${summary.ocrResult?.image_count}`);
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

  const attachment = await uploadAttachment(options.baseUrl, accessToken, options.file);
  console.log(`[attachment] id=${attachment.id} name=${attachment.file_name}`);

  const task = await createOcrToolTask(options.baseUrl, accessToken, attachment.id);
  globalThis.__verifyDocumentId = task.document_id;
  console.log(`[submit] task_id=${task.task_id} status=${task.status} document_id=${task.document_id} record_id=${task.record_id}`);

  const completed = await waitForOcr(options.baseUrl, accessToken, task.task_id, task.document_id, options.timeoutMs, options.pollMs);
  console.log(`[completed] processing_status=${completed.status.processing_status} ocr_status=${completed.status.ocr_result?.status}`);

  const dbSummary = await verifyDatabase(task.document_id);

  assert(dbSummary.document?.id, 'Document not found in database');
  assert(dbSummary.ocrResult?.id, 'doc_ocr_results record missing');
  assert(dbSummary.ocrResult?.status === 'completed', `OCR DB status not completed: ${dbSummary.ocrResult?.status}`);
  assert(dbSummary.ocrResult?.main_markdown_attachment_id, 'main_markdown_attachment_id missing');
  assert(dbSummary.markdownAttachment?.id, 'Markdown attachment missing');
  assert((dbSummary.ocrResult?.line_count || 0) > 0, 'line_count should be > 0');

  printSummary(dbSummary);
  console.log('\nReal MinerU integration verification passed.');
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
