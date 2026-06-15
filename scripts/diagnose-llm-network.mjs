#!/usr/bin/env node
/**
 * Diagnose LLM upstream connectivity issues for ECONNRESET / socket hang up.
 *
 * Usage:
 *   node scripts/diagnose-llm-network.mjs --url https://api.ai.erix.vip/v1 --api-key sk-xxx --model ali-glm-5
 * Optional:
 *   --attempts 20 --timeout 120000 --path /chat/completions --agent keepalive|close
 */

import dns from 'dns/promises';
import net from 'net';
import tls from 'tls';
import https from 'https';
import { URL } from 'url';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i++;
  }
  return args;
}

function normalizeBaseUrl(input) {
  if (!input) throw new Error('Missing --url');
  const trimmed = String(input).trim();
  if (!trimmed) throw new Error('Empty --url');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed.replace(/\/+$/, '');
  return `https://${trimmed.replace(/\/+$/, '')}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}

async function dnsCheck(hostname, rounds = 8) {
  const records = [];
  for (let i = 0; i < rounds; i++) {
    const started = Date.now();
    try {
      const [a, aaaa] = await Promise.allSettled([
        dns.resolve4(hostname),
        dns.resolve6(hostname),
      ]);
      records.push({
        ok: true,
        duration_ms: Date.now() - started,
        a: a.status === 'fulfilled' ? a.value : [],
        aaaa: aaaa.status === 'fulfilled' ? aaaa.value : [],
      });
    } catch (error) {
      records.push({
        ok: false,
        duration_ms: Date.now() - started,
        error: error.message,
      });
    }
    await sleep(120);
  }
  return records;
}

function tcpCheck(host, port, timeoutMs) {
  return new Promise(resolve => {
    const started = Date.now();
    const socket = net.createConnection({ host, port });
    let done = false;

    const finish = (result) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ duration_ms: Date.now() - started, ...result });
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish({ ok: true }));
    socket.once('timeout', () => finish({ ok: false, error_code: 'TCP_TIMEOUT', error: 'TCP connect timeout' }));
    socket.once('error', (err) => finish({ ok: false, error_code: err.code || 'TCP_ERROR', error: err.message }));
  });
}

function tlsCheck(host, port, timeoutMs) {
  return new Promise(resolve => {
    const started = Date.now();
    const socket = tls.connect({
      host,
      port,
      servername: host,
      rejectUnauthorized: true,
    });

    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ duration_ms: Date.now() - started, ...result });
    };

    socket.setTimeout(timeoutMs);
    socket.once('secureConnect', () => {
      finish({
        ok: true,
        protocol: socket.getProtocol(),
        authorized: socket.authorized,
        authorization_error: socket.authorizationError || null,
        alpn: socket.alpnProtocol || null,
      });
    });
    socket.once('timeout', () => finish({ ok: false, error_code: 'TLS_TIMEOUT', error: 'TLS handshake timeout' }));
    socket.once('error', (err) => finish({ ok: false, error_code: err.code || 'TLS_ERROR', error: err.message }));
  });
}

function httpChatCheck({ host, port, path, apiKey, model, timeoutMs, keepAlive }) {
  return new Promise(resolve => {
    const started = Date.now();
    const requestBody = JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You are a connectivity probe. Return only OK.' },
        { role: 'user', content: 'ping' },
      ],
      temperature: 0,
      max_tokens: 8,
    });

    const agent = new https.Agent({
      keepAlive,
      timeout: timeoutMs,
      maxSockets: 1,
      maxFreeSockets: 1,
      keepAliveMsecs: 20000,
    });

    const options = {
      host,
      port,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(requestBody),
        'Connection': keepAlive ? 'keep-alive' : 'close',
        'User-Agent': 'llm-network-diagnose/1.0',
      },
      timeout: timeoutMs,
      agent,
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        const duration = Date.now() - started;
        const bodyHead = body.slice(0, 300);
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          duration_ms: duration,
          status_code: res.statusCode,
          reused_socket: req.reusedSocket === true,
          socket_timeout: req.socket?.timeout ?? null,
          body_head: bodyHead,
        });
        agent.destroy();
      });
    });

    req.setTimeout(timeoutMs);
    req.on('timeout', () => {
      req.destroy(new Error('REQUEST_TIMEOUT'));
    });

    req.on('error', (err) => {
      resolve({
        ok: false,
        duration_ms: Date.now() - started,
        status_code: null,
        error_code: err.code || 'REQUEST_ERROR',
        error_name: err.name,
        error: err.message,
        reused_socket: req.reusedSocket === true,
        socket_timeout: req.socket?.timeout ?? null,
      });
      agent.destroy();
    });

    req.write(requestBody);
    req.end();
  });
}

function summarize(items, key = 'ok') {
  const total = items.length;
  const success = items.filter(x => x[key]).length;
  const fail = total - success;
  const avg = total ? Math.round(items.reduce((s, x) => s + (x.duration_ms || 0), 0) / total) : 0;
  return { total, success, fail, success_rate: total ? `${((success / total) * 100).toFixed(1)}%` : '0%', avg_duration_ms: avg };
}

function countBy(items, field) {
  const map = {};
  for (const it of items) {
    const k = it[field] || 'UNKNOWN';
    map[k] = (map[k] || 0) + 1;
  }
  return map;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = normalizeBaseUrl(args.url || process.env.DIAG_LLM_URL);
  const apiKey = args['api-key'] || process.env.DIAG_LLM_API_KEY;
  const model = args.model || process.env.DIAG_LLM_MODEL || 'ali-glm-5';
  const attempts = Number(args.attempts || process.env.DIAG_ATTEMPTS || 20);
  const timeoutMs = Number(args.timeout || process.env.DIAG_TIMEOUT_MS || 120000);
  const endpointPath = args.path || '/chat/completions';
  const agentMode = String(args.agent || 'keepalive').toLowerCase();
  const keepAlive = agentMode !== 'close';

  if (!apiKey) {
    throw new Error('Missing API key. Use --api-key or DIAG_LLM_API_KEY');
  }

  const parsed = new URL(baseUrl);
  if (parsed.protocol !== 'https:') {
    throw new Error(`This diagnostic script currently requires https URL. Got: ${parsed.protocol}`);
  }

  const host = parsed.hostname;
  const port = Number(parsed.port || 443);
  const path = `${parsed.pathname.replace(/\/+$/, '')}${endpointPath}`;

  console.log(`[${nowIso()}] LLM network diagnose start`);
  console.log(JSON.stringify({ base_url: baseUrl, host, port, path, model, attempts, timeout_ms: timeoutMs, keep_alive: keepAlive }, null, 2));

  const dnsResults = await dnsCheck(host, Math.min(10, Math.max(4, Math.floor(attempts / 2))));
  const tcpResults = [];
  const tlsResults = [];
  const httpResults = [];

  for (let i = 0; i < attempts; i++) {
    tcpResults.push(await tcpCheck(host, port, Math.min(timeoutMs, 10000)));
    tlsResults.push(await tlsCheck(host, port, Math.min(timeoutMs, 15000)));
    httpResults.push(await httpChatCheck({
      host,
      port,
      path,
      apiKey,
      model,
      timeoutMs,
      keepAlive,
    }));
    await sleep(200);
  }

  const report = {
    started_at: nowIso(),
    target: { base_url: baseUrl, host, port, path, model },
    config: { attempts, timeout_ms: timeoutMs, keep_alive: keepAlive },
    summary: {
      dns: summarize(dnsResults),
      tcp: summarize(tcpResults),
      tls: summarize(tlsResults),
      http: summarize(httpResults),
      http_error_codes: countBy(httpResults.filter(x => !x.ok), 'error_code'),
      http_status_codes: countBy(httpResults.filter(x => x.status_code), 'status_code'),
    },
    samples: {
      dns_first3: dnsResults.slice(0, 3),
      tcp_first3: tcpResults.slice(0, 3),
      tls_first3: tlsResults.slice(0, 3),
      http_first5: httpResults.slice(0, 5),
      http_last5: httpResults.slice(-5),
    },
  };

  console.log('\n=== DIAGNOSE REPORT ===');
  console.log(JSON.stringify(report, null, 2));

  const httpFailRate = report.summary.http.total
    ? report.summary.http.fail / report.summary.http.total
    : 1;

  console.log('\n=== CONCLUSION HINT ===');
  if (report.summary.tls.fail > 0) {
    console.log('- TLS handshake has failures -> likely network / proxy / upstream gateway instability.');
  }
  if (httpFailRate <= 0.1) {
    console.log('- HTTP success rate is high (>90%). Production failures may be occasional jitter; increase retries/fallback.');
  } else if (httpFailRate <= 0.3) {
    console.log('- HTTP has moderate failures (10%-30%). Add stronger retry + fallback and inspect intermediary network devices.');
  } else {
    console.log('- HTTP failure rate is high (>30%). Treat as upstream/network issue first, not business logic bug.');
  }
  if ((report.summary.http_error_codes.ECONNRESET || 0) > 0) {
    console.log('- ECONNRESET observed -> matches your server logs; async pipeline is not root cause.');
  }
}

main().catch((err) => {
  console.error('\n[diagnose-llm-network] failed:', err.message);
  process.exit(1);
});
