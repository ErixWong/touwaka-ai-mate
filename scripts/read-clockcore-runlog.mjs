/**
 * read-clockcore-runlog.mjs — 读取 ClockCore JSONL 运行记录
 *
 * 用法:
 *   node scripts/read-clockcore-runlog.mjs              # 最近 20 条
 *   node scripts/read-clockcore-runlog.mjs --last 50    # 最近 50 条
 *   node scripts/read-clockcore-runlog.mjs --errors     # 只看失败记录
 *   node scripts/read-clockcore-runlog.mjs --job doc-pipeline-worker  # 按 job 过滤
 *   node scripts/read-clockcore-runlog.mjs --tail       # 持续输出（类似 tail -f）
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_BASE_PATH = process.env.DATA_BASE_PATH || path.resolve(__dirname, '..', 'data');
const RUNLOG_FILE = path.join(DATA_BASE_PATH, 'work', 'clock-core-runlog.jsonl');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { last: 20, errors: false, job: null, tail: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--last' && args[i + 1]) {
      opts.last = parseInt(args[++i], 10);
    } else if (args[i] === '--errors') {
      opts.errors = true;
    } else if (args[i] === '--job' && args[i + 1]) {
      opts.job = args[++i];
    } else if (args[i] === '--tail') {
      opts.tail = true;
    }
  }
  return opts;
}

function readRecords() {
  if (!fs.existsSync(RUNLOG_FILE)) {
    console.log('(no runlog file yet)');
    return [];
  }
  const content = fs.readFileSync(RUNLOG_FILE, 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function formatRecord(r, i) {
  const statusIcon = r.status === 'success' ? '✓' : '✗';
  const elapsed = r.elapsed_ms != null ? `${r.elapsed_ms}ms` : '?';
  let summary = '';
  if (r.summary) {
    try {
      const s = JSON.parse(r.summary);
      if (s.skipped) {
        summary = ` [skipped: ${s.reason || '?'}]`;
      } else if (s.processed != null) {
        summary = ` [processed=${s.processed}]`;
      }
    } catch { /* ignore */ }
  }
  return `${statusIcon} ${r.job_name} ${r.status} ${elapsed}${summary}  ${r.started_at}`;
}

function formatError(r, i) {
  return `✗ ${r.job_name}  ${r.started_at}\n     error: ${r.error || '(none)'}`;
}

const opts = parseArgs();

if (opts.tail) {
  console.log(`Watching ${RUNLOG_FILE}...\n`);
  // Initial read
  let records = readRecords();
  let lastCount = records.length;
  for (let i = Math.max(0, lastCount - opts.last); i < lastCount; i++) {
    const r = records[i];
    if (opts.job && r.job_name !== opts.job) continue;
    if (opts.errors && r.status !== 'error') continue;
    console.log(formatRecord(r, i));
  }
  // Poll for new records
  setInterval(() => {
    records = readRecords();
    if (records.length > lastCount) {
      for (let i = lastCount; i < records.length; i++) {
        const r = records[i];
        if (opts.job && r.job_name !== opts.job) continue;
        if (opts.errors && r.status !== 'error') continue;
        console.log(formatRecord(r, i));
      }
      lastCount = records.length;
    }
  }, 2000);
} else {
  const records = readRecords();
  let filtered = records;
  if (opts.job) filtered = filtered.filter(r => r.job_name === opts.job);
  if (opts.errors) filtered = filtered.filter(r => r.status === 'error');

  const display = filtered.slice(-opts.last);
  if (display.length === 0) {
    console.log('(no matching records)');
  } else {
    console.log(`Showing ${display.length} of ${filtered.length} records (total: ${records.length}):\n`);
    for (let i = 0; i < display.length; i++) {
      const r = display[i];
      if (opts.errors) {
        console.log(formatError(r, i));
      } else {
        console.log(formatRecord(r, i));
      }
    }

    // Summary
    const total = filtered.length;
    const success = filtered.filter(r => r.status === 'success').length;
    const errors = filtered.filter(r => r.status === 'error').length;
    console.log(`\n--- Summary: ${total} total, ${success} success, ${errors} error ---`);
  }
}
