#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_FILE = path.resolve(__dirname, '小鹏质量协议双签_2-3.pdf');
const DEFAULT_BASE_URL = process.env.MINERU_TEST_BASE_URL || 'http://localhost:8002/api';
const DEFAULT_MCP_URL = process.env.MINERU_TEST_MCP_URL || 'http://localhost:8002/mcp';
const DEFAULT_BACKEND = process.env.MINERU_TEST_BACKEND || process.env.MINERU_DEFAULT_BACKEND || '';
const DEFAULT_LANG = process.env.MINERU_TEST_LANG || 'ch';
const DEFAULT_TRANSPORT = process.env.MINERU_TEST_TRANSPORT || 'rest';
const DEFAULT_TIMEOUT_MS = Number(process.env.MINERU_TEST_TIMEOUT_MS || 10 * 60 * 1000);
const DEFAULT_POLL_MS = Number(process.env.MINERU_TEST_POLL_MS || 3000);
const DEFAULT_TOKEN = process.env.MINERU_TEST_TOKEN || process.env.MCP_HTTP_AUTH_TOKEN || '';
const REQUEST_TIMEOUT_MS = Number(process.env.MINERU_TEST_REQUEST_TIMEOUT_MS || 60 * 1000);

function detectMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

function parseArgs(argv) {
  const options = {
    file: DEFAULT_FILE,
    baseUrl: DEFAULT_BASE_URL,
    mcpUrl: DEFAULT_MCP_URL,
    backend: DEFAULT_BACKEND,
    lang: DEFAULT_LANG,
    transport: DEFAULT_TRANSPORT,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    pollMs: DEFAULT_POLL_MS,
    token: DEFAULT_TOKEN,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
    testCancel: false,
    testMcp: false,
    testUpload: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--file') {
      options.file = path.resolve(argv[++i]);
    } else if (arg === '--base-url') {
      options.baseUrl = argv[++i].replace(/\/+$/, '');
    } else if (arg === '--mcp-url') {
      options.mcpUrl = argv[++i].replace(/\/+$/, '');
    } else if (arg === '--backend') {
      options.backend = argv[++i];
    } else if (arg === '--lang') {
      options.lang = argv[++i];
    } else if (arg === '--transport') {
      options.transport = argv[++i];
    } else if (arg === '--timeout-ms') {
      options.timeoutMs = Number(argv[++i]);
    } else if (arg === '--poll-ms') {
      options.pollMs = Number(argv[++i]);
    } else if (arg === '--request-timeout-ms') {
      options.requestTimeoutMs = Number(argv[++i]);
    } else if (arg === '--token') {
      options.token = argv[++i];
    } else if (arg === '--test-cancel') {
      options.testCancel = true;
    } else if (arg === '--test-mcp') {
      options.testMcp = true;
      options.transport = 'mcp';
    } else if (arg === '--test-upload') {
      options.testUpload = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node tests/test_async_service.js [options]

Options:
  --file <path>         PDF/image sample path
  --base-url <url>      REST API base URL, default: ${DEFAULT_BASE_URL}
  --mcp-url <url>       MCP endpoint URL, default: ${DEFAULT_MCP_URL}
  --backend <name>      Backend name, default: service-side default
  --lang <lang>         OCR language, default: ${DEFAULT_LANG}
  --transport <name>    Transport: rest or mcp, default: ${DEFAULT_TRANSPORT}
  --timeout-ms <ms>     Max wait time for completion, default: ${DEFAULT_TIMEOUT_MS}
  --poll-ms <ms>        Poll interval, default: ${DEFAULT_POLL_MS}
  --request-timeout-ms  Per-request timeout, default: ${REQUEST_TIMEOUT_MS}
  --token <token>       Bearer token, default from env
  --test-cancel         Also run a cancellation scenario
  --test-mcp            Alias for --transport mcp
  --test-upload         Also run upload_id scenario after direct file submission
                        In MCP mode this is a hybrid flow: REST /uploads + MCP create_task_from_upload
  -h, --help            Show help

Environment variables:
  MINERU_TEST_BASE_URL
  MINERU_TEST_MCP_URL
  MINERU_TEST_BACKEND
  MINERU_TEST_LANG
  MINERU_TEST_TRANSPORT
  MINERU_TEST_TIMEOUT_MS
  MINERU_TEST_POLL_MS
  MINERU_TEST_REQUEST_TIMEOUT_MS
  MINERU_TEST_TOKEN
  MCP_HTTP_AUTH_TOKEN
`);
}

function buildHeaders(token) {
  const headers = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function buildMcpHeaders(token, method) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'Mcp-Method': method,
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

function withTimeout(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
  return { controller, timer };
}

async function requestJson(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const { controller, timer } = withTimeout(timeoutMs);
  const response = await fetch(url, {
    ...options,
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));
  const text = await response.text();
  let body;

  try {
    body = text ? JSON.parse(text) : null;
  } catch (error) {
    throw new Error(`Failed to parse JSON from ${url} (length=${text.length}): ${previewPayload(text, 500)}`);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}: ${JSON.stringify(body)}`);
  }

  return body;
}

async function requestJsonExpectError(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const { controller, timer } = withTimeout(timeoutMs);
  const response = await fetch(url, {
    ...options,
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));
  const text = await response.text();
  let body;

  try {
    body = text ? JSON.parse(text) : null;
  } catch (error) {
    throw new Error(`Failed to parse JSON error response from ${url} (length=${text.length}): ${previewPayload(text, 500)}`);
  }

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    body,
  };
}

function readSampleContent(options) {
  return fs.readFileSync(options.file);
}

function buildUploadForm(options, content = readSampleContent(options)) {
  const form = new FormData();
  const blob = new Blob([content], { type: detectMimeType(options.file) });
  form.set('file', blob, path.basename(options.file));
  return form;
}

async function healthCheck(baseUrl, token, requestTimeoutMs) {
  const health = await requestJson(`${baseUrl}/health`, {
    headers: buildHeaders(token),
  }, requestTimeoutMs);
  console.log(`[health] status=${health.status} scheduler_running=${health.scheduler_running}`);
  return health;
}

async function submitTask(baseUrl, options) {
  const content = readSampleContent(options);
  const form = buildUploadForm(options, content);
  if (options.backend) {
    form.set('backend', options.backend);
  }
  form.set('lang', options.lang);
  form.set('formula_enable', 'true');
  form.set('table_enable', 'true');
  form.set('image_analysis', 'true');

  const result = await requestJson(`${baseUrl}/tasks`, {
    method: 'POST',
    headers: buildHeaders(options.token),
    body: form,
  }, options.requestTimeoutMs);

  console.log(`[submit] task_id=${result.task_id} created_at=${result.created_at}`);
  return result;
}

async function createUpload(baseUrl, options) {
  const form = buildUploadForm(options);
  const result = await requestJson(`${baseUrl}/uploads`, {
    method: 'POST',
    headers: buildHeaders(options.token),
    body: form,
  }, options.requestTimeoutMs);

  console.log(`[upload] upload_id=${result.upload_id} status=${result.status} size=${result.size_bytes}`);
  return result;
}

async function submitTaskFromUpload(baseUrl, options, uploadId) {
  const payload = {
    upload_id: uploadId,
    lang: options.lang,
    formula_enable: true,
    table_enable: true,
    image_analysis: true,
  };

  if (options.backend) {
    payload.backend = options.backend;
  }

  const result = await requestJson(`${baseUrl}/tasks/from-upload`, {
    method: 'POST',
    headers: {
      ...buildHeaders(options.token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  }, options.requestTimeoutMs);

  console.log(`[submit-upload] task_id=${result.task_id} created_at=${result.created_at}`);
  return result;
}

async function getTaskStatus(baseUrl, taskId, token, returnMd = true) {
  const url = new URL(`${baseUrl}/tasks/${taskId}`);
  url.searchParams.set('return_md', String(returnMd));
  return requestJson(url.toString(), {
    headers: buildHeaders(token),
  });
}

async function waitForCompletion(baseUrl, taskId, token, timeoutMs, pollMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const status = await getTaskStatus(baseUrl, taskId, token, false);
    console.log(`[poll] task_id=${taskId} status=${status.status} progress=${status.progress} message=${status.message}`);

    const terminal = getTerminalStateDetails(status);
    if (terminal.done && terminal.success) {
      return status;
    }

    if (terminal.done && !terminal.success) {
      throw new Error(`Task ended in ${terminal.normalized}: ${status.error || status.message || JSON.stringify(status)}`);
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  throw new Error(`Timed out waiting for task ${taskId} after ${timeoutMs}ms`);
}

async function getTaskResult(baseUrl, taskId, token) {
  return requestJson(`${baseUrl}/tasks/${taskId}/result`, {
    headers: buildHeaders(token),
  });
}

async function assertTaskResultNotCompleted(baseUrl, taskId, token, requestTimeoutMs) {
  const response = await requestJsonExpectError(`${baseUrl}/tasks/${taskId}/result`, {
    headers: buildHeaders(token),
  }, requestTimeoutMs);

  assert(response.ok === false, 'Expected /result request to fail before completion');
  assert(response.status === 400, `Expected /result pre-completion status 400, got ${response.status}`);
  const payload = response.body && typeof response.body === 'object' && response.body.detail ? response.body.detail : response.body;
  assert(payload && payload.error === 'TASK_NOT_COMPLETED', `Expected TASK_NOT_COMPLETED, got ${JSON.stringify(response.body)}`);
  console.log(`[result-negative] status=${response.status} error=${payload.error} message=${payload.message}`);
  return payload;
}

async function getTaskImages(baseUrl, taskId, token) {
  return requestJson(`${baseUrl}/tasks/${taskId}/images`, {
    headers: buildHeaders(token),
  });
}

async function listDeliverables(baseUrl, taskId, token) {
  return requestJson(`${baseUrl}/tasks/${taskId}/deliverables`, {
    headers: buildHeaders(token),
  });
}

async function cancelTask(baseUrl, taskId, token) {
  return requestJson(`${baseUrl}/tasks/${taskId}`, {
    method: 'DELETE',
    headers: buildHeaders(token),
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function fail(message, details) {
  if (details) {
    throw new Error(`${message}: ${details}`);
  }
  throw new Error(message);
}

function assertRuntimeSupport() {
  assert(typeof fetch === 'function', 'Global fetch is unavailable. Use Node.js 18+ or newer.');
  assert(typeof FormData === 'function', 'Global FormData is unavailable. Use Node.js 18+ or newer.');
  assert(typeof Blob === 'function', 'Global Blob is unavailable. Use Node.js 18+ or newer.');
}

function logSummary(summary) {
  console.log('[summary]');
  for (const [key, value] of Object.entries(summary)) {
    console.log(`  - ${key}: ${value}`);
  }
}

function flattenDeliverables(items, prefix = '') {
  const flat = [];
  for (const item of items || []) {
    const current = prefix ? `${prefix}/${item.name}` : item.name;
    flat.push({
      path: current,
      kind: item.kind,
      role: item.role,
      filename: item.filename,
      download_key: item.download_key,
      available: item.available,
      downloadable: item.downloadable,
    });
    if (Array.isArray(item.children) && item.children.length > 0) {
      flat.push(...flattenDeliverables(item.children, current));
    }
  }
  return flat;
}

function logDeliverables(label, payload) {
  const flat = flattenDeliverables(payload?.artifacts || []);
  console.log(`[deliverables:${label}] count=${flat.length}`);
  for (const item of flat) {
    const filename = item.filename || 'n/a';
    const downloadKey = item.download_key || 'n/a';
    console.log(
      `[deliverables:${label}] ${item.path} kind=${item.kind} role=${item.role} filename=${filename} download_key=${downloadKey} available=${item.available} downloadable=${item.downloadable}`,
    );
  }
  return flat;
}

function previewText(text, maxLength = 100) {
  if (typeof text !== 'string') {
    return '';
  }
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
}

function previewPayload(text, maxLength = 500) {
  if (typeof text !== 'string' || text.length === 0) {
    return '';
  }

  if (text.length <= maxLength) {
    return text;
  }

  const headLength = Math.max(1, Math.floor(maxLength / 2));
  const tailLength = Math.max(1, maxLength - headLength);
  return `${text.slice(0, headLength)} ... ${text.slice(-tailLength)}`;
}

function bufferToBase64(filePath) {
  return fs.readFileSync(filePath).toString('base64');
}

function textFromMcpContent(result) {
  if (!result || !Array.isArray(result.content)) {
    return '';
  }

  return result.content
    .filter((item) => item && item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n');
}

function structuredFromToolResult(result) {
  if (!result || typeof result !== 'object') {
    return null;
  }

  if (result.structuredContent && typeof result.structuredContent === 'object') {
    return result.structuredContent;
  }

  const text = textFromMcpContent(result);
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    return {
      _rawText: text,
      _parseError: error.message,
    };
  }
}

function describeMcpPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return 'missing payload';
  }

  if (typeof payload.error === 'string' && payload.error) {
    return payload.error;
  }

  if (typeof payload.message === 'string' && payload.message) {
    return payload.message;
  }

  if (typeof payload._rawText === 'string' && payload._rawText) {
    return previewText(payload._rawText, 160);
  }

  return JSON.stringify(payload);
}

function getTerminalStateDetails(status) {
  const normalized = typeof status?.status === 'string' ? status.status.toLowerCase() : '';
  if (normalized === 'completed') {
    return { done: true, success: true, normalized };
  }

  if (['failed', 'cancelled', 'canceled', 'error', 'timeout'].includes(normalized)) {
    return { done: true, success: false, normalized };
  }

  if (['pending', 'processing', 'queued', 'running', 'submitted', 'created'].includes(normalized)) {
    return { done: false, success: false, normalized };
  }

  return { done: true, success: false, normalized: normalized || 'unknown' };
}

function assertMarkdownNotEmpty(label, markdown) {
  assert(typeof markdown === 'string', `${label} response missing markdown`);
  assert(markdown.trim().length > 0, `${label} markdown is empty`);
}

function assertMarkdownDeliverablePresent(deliverables, label) {
  const markdownArtifact = firstAvailableMarkdownDeliverable(deliverables);
  assert(markdownArtifact, `${label} markdown deliverable is not available`);
  return markdownArtifact;
}

function firstAvailableMarkdownDeliverable(payload) {
  const queue = Array.isArray(payload?.artifacts) ? [...payload.artifacts] : [];

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item || typeof item !== 'object') {
      continue;
    }

    if (
      item.kind === 'file'
      && item.name === 'markdown'
      && item.available === true
      && item.downloadable === true
      && typeof item.download_key === 'string'
      && item.download_key
    ) {
      return item;
    }

    if (Array.isArray(item.children) && item.children.length > 0) {
      queue.push(...item.children);
    }
  }

  return null;
}

async function mcpRpc(url, token, method, params, requestTimeoutMs, id = null) {
  const payload = {
    jsonrpc: '2.0',
    method,
  };

  if (id !== null) {
    payload.id = id;
  }

  if (params !== undefined) {
    payload.params = params;
  }

  const { controller, timer } = withTimeout(requestTimeoutMs);
  const response = await fetch(url, {
    method: 'POST',
    headers: buildMcpHeaders(token, method),
    body: JSON.stringify(payload),
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));

  const text = await response.text();
  let body;

  try {
    body = text ? JSON.parse(text) : null;
  } catch (error) {
    throw new Error(`Failed to parse MCP JSON for ${method} (length=${text.length}): ${previewPayload(text, 500)}`);
  }

  if (!response.ok) {
    throw new Error(`MCP HTTP ${response.status} ${response.statusText} for ${method}: ${JSON.stringify(body)}`);
  }

  if (body && body.error) {
    throw new Error(`MCP JSON-RPC error for ${method}: ${JSON.stringify(body.error)}`);
  }

  return body;
}

async function initializeMcp(options) {
  const initializeResponse = await mcpRpc(
    options.mcpUrl,
    options.token,
    'initialize',
    {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: {
        name: 'mineru-rest-mcp-test',
        version: '1.0.0',
      },
    },
    options.requestTimeoutMs,
    1,
  );

  await mcpRpc(
    options.mcpUrl,
    options.token,
    'notifications/initialized',
    undefined,
    options.requestTimeoutMs,
    null,
  );

  console.log(`[mcp-init] server=${initializeResponse?.result?.serverInfo?.name || 'unknown'}`);
  return initializeResponse;
}

async function mcpListTools(options) {
  const response = await mcpRpc(
    options.mcpUrl,
    options.token,
    'tools/list',
    {},
    options.requestTimeoutMs,
    2,
  );
  const tools = response?.result?.tools || [];
  console.log(`[mcp-tools] ${tools.map((tool) => tool.name).join(', ')}`);
  return tools;
}

async function mcpCallTool(options, toolName, args, id) {
  const response = await mcpRpc(
    options.mcpUrl,
    options.token,
    'tools/call',
    {
      name: toolName,
      arguments: args,
    },
    options.requestTimeoutMs,
    id,
  );

  return response?.result || null;
}

async function mcpWaitForCompletion(options, taskId) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < options.timeoutMs) {
    const result = await mcpCallTool(options, 'get_task_status', { task_id: taskId }, 10);
    const body = structuredFromToolResult(result) || {};
    console.log(`[mcp-poll] task_id=${taskId} status=${body.status} progress=${body.progress ?? 'n/a'} message=${body.message || ''}`);

    const terminal = getTerminalStateDetails(body);
    if (terminal.done && terminal.success) {
      return body;
    }

    if (terminal.done && !terminal.success) {
      throw new Error(`MCP task ended in ${terminal.normalized}: ${body.error || body.message || describeMcpPayload(body)}`);
    }

    await new Promise((resolve) => setTimeout(resolve, options.pollMs));
  }

  throw new Error(`Timed out waiting for MCP task ${taskId} after ${options.timeoutMs}ms`);
}

function logMarkdownResult(label, markdown) {
  console.log(`[${label}] markdown length=${markdown.length}`);
  console.log(`[${label}] markdown preview=${previewText(markdown, 100)}`);
}

function getFlowLabels(adapter) {
  if (adapter.name === 'mcp') {
    return {
      compatibility: 'mcp-status',
      result: 'mcp-result',
      images: 'mcp-images',
      deliverables: 'mcp-main',
      uploadResult: 'mcp-result-upload',
      uploadDeliverables: 'mcp-upload',
    };
  }

  return {
    compatibility: 'status',
    result: 'result',
    images: 'images',
    deliverables: 'main',
    uploadResult: 'result-upload',
    uploadDeliverables: 'upload',
  };
}

function logAdapterCapabilities(adapter) {
  const capabilities = Object.entries(adapter.capabilities || {})
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
  console.log(`[adapter] transport=${adapter.name} ${capabilities}`.trim());
}

function createRestAdapter() {
  return {
    name: 'rest',
    capabilities: {
      nativeUpload: true,
      nativeDeliverables: true,
      nativeCancel: true,
    },
    async initialize(options) {
      console.log(`[config] transport=rest baseUrl=${options.baseUrl}`);
      console.log(`[config] file=${options.file}`);
      console.log(`[config] backend=${options.backend || '(service default)'}`);
      console.log(`[config] requestTimeoutMs=${options.requestTimeoutMs}`);
      await healthCheck(options.baseUrl, options.token, options.requestTimeoutMs);
    },
    async submitFile(options) {
      const result = await submitTask(options.baseUrl, options);
      assert(result.task_id, 'submit response missing task_id');
      return result;
    },
    async assertNotCompleted(options, taskId) {
      await assertTaskResultNotCompleted(options.baseUrl, taskId, options.token, options.requestTimeoutMs);
    },
    async waitForCompletion(options, taskId) {
      return waitForCompletion(options.baseUrl, taskId, options.token, options.timeoutMs, options.pollMs);
    },
    async getCompatibilityStatus(options, taskId) {
      return getTaskStatus(options.baseUrl, taskId, options.token, true);
    },
    async getResult(options, taskId) {
      return getTaskResult(options.baseUrl, taskId, options.token);
    },
    async getImages(options, taskId) {
      return getTaskImages(options.baseUrl, taskId, options.token);
    },
    async listDeliverables(options, taskId) {
      return listDeliverables(options.baseUrl, taskId, options.token);
    },
    async createUpload(options) {
      return createUpload(options.baseUrl, options);
    },
    async submitUpload(options, uploadId) {
      const result = await submitTaskFromUpload(options.baseUrl, options, uploadId);
      assert(result.task_id, 'submit from upload response missing task_id');
      return result;
    },
    async cancel(options, taskId) {
      return cancelTask(options.baseUrl, taskId, options.token);
    },
    async getTaskStatus(options, taskId) {
      return getTaskStatus(options.baseUrl, taskId, options.token, false);
    },
  };
}

function createMcpAdapter() {
  return {
    name: 'mcp',
    capabilities: {
      nativeUpload: false,
      nativeDeliverables: false,
      nativeCancel: true,
    },
    async initialize(options) {
      console.log(`[config] transport=mcp mcpUrl=${options.mcpUrl}`);
      console.log(`[config] file=${options.file}`);
      console.log(`[config] backend=${options.backend || '(service default)'}`);
      console.log(`[config] requestTimeoutMs=${options.requestTimeoutMs}`);
      await initializeMcp(options);
      const tools = await mcpListTools(options);
      const requiredTools = [
        'create_task_from_file',
        'create_task_from_upload',
        'get_task_status',
        'get_default_deliverable',
        'list_deliverables',
        'download_deliverable',
        'get_task_images',
        'cancel_task',
      ];
      for (const name of requiredTools) {
        assert(tools.some((tool) => tool.name === name), `Required MCP tool missing: ${name}`);
      }
    },
    async submitFile(options) {
      const args = {
        file_base64: bufferToBase64(options.file),
        file_name: path.basename(options.file),
        lang: options.lang,
        formula_enable: true,
        table_enable: true,
        image_analysis: true,
      };

      if (options.backend) {
        args.backend = options.backend;
      }

      const submitResult = await mcpCallTool(
        options,
        'create_task_from_file',
        args,
        3,
      );
      const submitted = structuredFromToolResult(submitResult) || {};
      assert(submitted.task_id, 'MCP create_task_from_file result missing task_id');
      console.log(`[mcp-submit] task_id=${submitted.task_id} status=${submitted.status}`);
      return submitted;
    },
    async waitForCompletion(options, taskId) {
      return mcpWaitForCompletion(options, taskId);
    },
    async getResult(options, taskId) {
      const resultOutput = await mcpCallTool(options, 'get_default_deliverable', { task_id: taskId, format: 'markdown' }, 11);
      const taskResult = structuredFromToolResult(resultOutput) || {};
      if (typeof taskResult.result === 'string' && taskResult.result.trim().length > 0) {
        return { markdown: taskResult.result, raw: taskResult };
      }

      if (taskResult._parseError) {
        fail('MCP get_default_deliverable returned non-JSON content', describeMcpPayload(taskResult));
      }

      const deliverables = await this.listDeliverables(options, taskId);
      const markdownArtifact = assertMarkdownDeliverablePresent(deliverables, 'MCP');

      const downloadResult = await mcpCallTool(options, 'download_deliverable', {
        task_id: taskId,
        download_key: markdownArtifact.download_key,
      }, 14);
      const downloaded = structuredFromToolResult(downloadResult) || {};
      assert(typeof downloaded.content === 'string', 'MCP download_deliverable missing markdown content');
      assert(downloaded.content.trim().length > 0, 'MCP downloaded markdown is empty');
      return { markdown: downloaded.content, raw: taskResult, downloaded };
    },
    async getImages(options, taskId) {
      const imagesResult = await mcpCallTool(options, 'get_task_images', { task_id: taskId }, 12);
      const images = structuredFromToolResult(imagesResult) || {};
      assert(typeof images.count === 'number', 'MCP get_task_images result missing count');
      return images;
    },
    async listDeliverables(options, taskId) {
      return (structuredFromToolResult(await mcpCallTool(options, 'list_deliverables', { task_id: taskId }, 15)) || {});
    },
    async createUpload(options) {
      console.log('[mcp] upload uses REST helper to obtain upload_id for MCP create_task_from_upload');
      return createUpload(options.baseUrl, options);
    },
    async submitUpload(options, uploadId) {
      const args = {
        upload_id: uploadId,
        lang: options.lang,
        formula_enable: true,
        table_enable: true,
        image_analysis: true,
      };

      if (options.backend) {
        args.backend = options.backend;
      }

      const uploadSubmitResult = await mcpCallTool(
        options,
        'create_task_from_upload',
        args,
        13,
      );
      const uploadSubmitted = structuredFromToolResult(uploadSubmitResult) || {};
      assert(uploadSubmitted.task_id, 'MCP create_task_from_upload result missing task_id');
      console.log(`[mcp-submit-upload] task_id=${uploadSubmitted.task_id} status=${uploadSubmitted.status}`);
      return uploadSubmitted;
    },
    async cancel(options, taskId) {
      const cancelResult = await mcpCallTool(options, 'cancel_task', { task_id: taskId }, 16);
      const cancelBody = structuredFromToolResult(cancelResult);
      const cancelled = typeof cancelBody === 'boolean' ? cancelBody : cancelBody?.cancelled ?? cancelBody?.text;
      return { cancelled, raw: cancelBody, message: cancelBody?.message };
    },
    async getTaskStatus(options, taskId) {
      return (structuredFromToolResult(await mcpCallTool(options, 'get_task_status', { task_id: taskId }, 10)) || {});
    },
  };
}

async function runFileScenario(adapter, options, labels) {
  const submitted = await adapter.submitFile(options);
  if (adapter.assertNotCompleted) {
    await adapter.assertNotCompleted(options, submitted.task_id);
  }

  const completed = await adapter.waitForCompletion(options, submitted.task_id);
  assert(completed.status === 'completed', `Expected completed status, got: ${completed.status}`);

  let compatibilityMarkdownLength = null;
  if (adapter.getCompatibilityStatus) {
    const compatibilityStatus = await adapter.getCompatibilityStatus(options, submitted.task_id);
    assertMarkdownNotEmpty(`${labels.compatibility} compatibility`, compatibilityStatus.markdown);
    compatibilityMarkdownLength = compatibilityStatus.markdown.length;
    console.log(`[${labels.compatibility}] compatibility markdown length=${compatibilityMarkdownLength}`);
  }

  const result = await adapter.getResult(options, submitted.task_id);
  assertMarkdownNotEmpty(labels.result, result.markdown);
  logMarkdownResult(labels.result, result.markdown);

  const images = await adapter.getImages(options, submitted.task_id);
  assert(typeof images.count === 'number', 'images response missing count');
  console.log(`[${labels.images}] count=${images.count}`);

  const deliverables = await adapter.listDeliverables(options, submitted.task_id);
  assertMarkdownDeliverablePresent(deliverables, labels.deliverables);
  const deliverableList = logDeliverables(labels.deliverables, deliverables);

  return {
    taskId: submitted.task_id,
    completed,
    markdownLength: result.markdown.length,
    compatibilityMarkdownLength,
    imageCount: images.count,
    deliverableCount: deliverableList.length,
  };
}

async function runUploadScenario(adapter, options, labels) {
  const upload = await adapter.createUpload(options);
  assert(upload.upload_id, 'upload response missing upload_id');

  const submitted = await adapter.submitUpload(options, upload.upload_id);
  const completed = await adapter.waitForCompletion(options, submitted.task_id);
  assert(completed.status === 'completed', `Expected uploaded task completed status, got: ${completed.status}`);

  const result = await adapter.getResult(options, submitted.task_id);
  assertMarkdownNotEmpty(labels.uploadResult, result.markdown);
  logMarkdownResult(labels.uploadResult, result.markdown);

  const deliverables = await adapter.listDeliverables(options, submitted.task_id);
  assertMarkdownDeliverablePresent(deliverables, labels.uploadDeliverables);
  const deliverableList = logDeliverables(labels.uploadDeliverables, deliverables);

  return {
    uploadId: upload.upload_id,
    taskId: submitted.task_id,
    completed,
    markdownLength: result.markdown.length,
    deliverableCount: deliverableList.length,
  };
}

async function runFlow(adapter, options) {
  const startedAt = Date.now();

  assertRuntimeSupport();
  assert(fs.existsSync(options.file), `Sample file not found: ${options.file}`);
  logAdapterCapabilities(adapter);
  await adapter.initialize(options);

  const labels = getFlowLabels(adapter);

  const main = await runFileScenario(adapter, options, labels);
  const upload = options.testUpload ? await runUploadScenario(adapter, options, labels) : null;
  const totalElapsedMs = Date.now() - startedAt;

  const summary = {
    transport: adapter.name,
    taskId: main.taskId,
    compatibilityMarkdownLength: main.compatibilityMarkdownLength ?? 'n/a',
    resultMarkdownLength: main.markdownLength,
    imageCount: main.imageCount,
    deliverableCount: main.deliverableCount,
    completedAt: main.completed.completed_at || 'n/a',
    totalElapsedMs,
  };

  if (upload) {
    summary.uploadId = upload.uploadId;
    summary.uploadTaskId = upload.taskId;
    summary.uploadResultMarkdownLength = upload.markdownLength;
    summary.uploadDeliverableCount = upload.deliverableCount;
  }

  logSummary(summary);

  console.log(`[${adapter.name}-flow] PASS`);
}

async function runCancelFlow(adapter, options) {
  const submitted = await adapter.submitFile(options);
  const taskId = submitted.task_id;
  const cancelled = await adapter.cancel(options, taskId);
  console.log(`[cancel:${adapter.name}] task_id=${taskId} cancelled=${cancelled.cancelled} message=${cancelled.message || ''}`);

  assert(cancelled.cancelled === true || cancelled.cancelled === 'true', `Cancel request was not accepted for task ${taskId}`);

  const startedAt = Date.now();
  while (Date.now() - startedAt < options.timeoutMs) {
    const finalStatus = await adapter.getTaskStatus(options, taskId);
    console.log(`[cancel-status:${adapter.name}] status=${finalStatus.status} error=${finalStatus.error || ''} message=${finalStatus.message || ''}`);
    const terminal = getTerminalStateDetails(finalStatus);
    if (terminal.done) {
      assert(terminal.normalized === 'cancelled' || terminal.normalized === 'canceled', `Expected cancelled terminal state, got ${terminal.normalized}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, options.pollMs));
  }

  throw new Error(`Timed out waiting for cancelled state for task ${taskId}`);
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    assert(['rest', 'mcp'].includes(options.transport), `--transport must be one of: rest, mcp. Got: ${options.transport}`);
    assert(options.timeoutMs > 0, '--timeout-ms must be greater than 0');
    assert(options.pollMs > 0, '--poll-ms must be greater than 0');
    assert(options.requestTimeoutMs > 0, '--request-timeout-ms must be greater than 0');
    const adapter = options.transport === 'mcp' ? createMcpAdapter() : createRestAdapter();
    await runFlow(adapter, options);

    if (options.testCancel) {
      await runCancelFlow(adapter, options);
    }

    console.log('All requested checks completed.');
  } catch (error) {
    console.error(`[error] ${error.message}`);
    process.exitCode = 1;
  }
}

main();
