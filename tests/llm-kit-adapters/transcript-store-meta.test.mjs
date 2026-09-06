import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// logs/ 目录当前是 root 属主，避免 logger 写文件的权限错误掩盖数据库测试结果。
import logger from "../../lib/logger.js";
for (const method of ["info", "warn", "error", "debug"]) {
  if (typeof logger[method] === "function") logger[method] = () => {};
}

import Database from "../../lib/db.js";
import { createTouwakaTranscriptStore } from "../../lib/llm-kit-adapters/transcript-store.js";

const CREDS_PATH = join(homedir(), ".config/mcp/creds/touwaka-test-db.json");
const TABLE_NAME = "llm_kit_transcripts_meta_test";
const MODEL_NAME = `llm_kit_transcript_${TABLE_NAME}`;

function loadCreds() {
  try {
    return JSON.parse(readFileSync(CREDS_PATH, "utf8"));
  } catch {
    return null;
  }
}

const creds = loadCreds();
let db = null;
let Transcript = null;

if (creds) {
  db = new Database({
    database: creds.database,
    user: creds.user,
    password: creds.password,
    host: creds.host,
    port: creds.port,
  });

  await db.connect();
  await db.sequelize.query(`
    CREATE TABLE IF NOT EXISTS llm_kit_run_state (
      run_id VARCHAR(128) NOT NULL,
      state VARCHAR(32) NULL,
      checkpoint JSON NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (run_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  const setupStore = createTouwakaTranscriptStore({ db, tableName: TABLE_NAME });
  Transcript = db.sequelize.models[MODEL_NAME];
  await setupStore.sync({ force: true });
}

after(async () => {
  if (!db) return;

  await Transcript.drop();
  if (typeof db.close === "function") {
    await db.close();
  } else if (db.sequelize) {
    await db.sequelize.close();
  }
});

if (!creds) {
  test("touwaka TranscriptStore v2 元数据（真实 MariaDB）", {
    skip: `缺少凭据 ${CREDS_PATH}`,
  }, () => {});
} else {
  beforeEach(async () => {
    await Transcript.destroy({ truncate: true });
  });

  test("appendRound 写入并由 loadWithMeta 读回元数据", async () => {
    const store = createTouwakaTranscriptStore({ db, tableName: TABLE_NAME });
    const meta = {
      topicId: "topic-meta",
      userId: "user-meta",
      expertId: "expert-meta",
      modelName: "model-meta",
      providerName: "provider-meta",
      usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.1 },
      latencyMs: 123,
      errorInfo: { retryable: true },
      isDeleted: false,
    };

    await store.appendRound("run-meta", {
      round: 1,
      ts: "2026-08-29T10:00:00.000Z",
      messages: [{ role: "assistant", content: [{ type: "text", text: "ok" }] }],
    }, meta);

    const loaded = await store.loadWithMeta("run-meta");
    assert.deepEqual(loaded[0].meta, meta);
  });

  test("appendRound 持久化并还原 judge record 快照", async () => {
    const store = createTouwakaTranscriptStore({ db, tableName: TABLE_NAME });
    const record = {
      round: 2,
      ts: "2026-08-29T10:00:01.000Z",
      folded: true,
      messages: [{ role: "assistant", content: [{ type: "text", text: "done" }] }],
      foldedPayload: [{ role: "user", content: "folded" }],
      judge: {
        done: true,
        confidence: 0.98,
        reason: "完成目标",
        evidence: ["工具返回成功", "结果已确认"],
        direction: "wrapup",
        directionReason: "无需继续调用工具",
      },
      summary: "已完成任务",
      l0facts: ["用户要求已满足"],
      wrapup: { status: "completed", reason: "judge_done" },
      response: "任务已完成",
      textPreview: "任务已完成",
      toolUses: [{ name: "finish", success: true }],
      roundKey: "round-2",
      dedupKey: "dedup-round-2",
    };

    await store.appendRound("run-judge", record);

    const [loaded] = await store.load("run-judge");
    const [loadedWithMeta] = await store.loadWithMeta("run-judge");
    for (const value of [loaded, loadedWithMeta]) {
      assert.deepEqual(value.judge, record.judge);
      assert.deepEqual(value.summary, record.summary);
      assert.deepEqual(value.l0facts, record.l0facts);
      assert.deepEqual(value.wrapup, record.wrapup);
      assert.deepEqual(value.response, record.response);
      assert.deepEqual(value.textPreview, record.textPreview);
      assert.deepEqual(value.toolUses, record.toolUses);
      assert.equal(value.roundKey, record.roundKey);
      assert.equal(value.dedupKey, record.dedupKey);
    }
    assert.deepEqual(loaded.messages, record.messages);
    assert.deepEqual(loaded.foldedPayload, record.foldedPayload);
    assert.deepEqual(loadedWithMeta.messages, record.messages);
    assert.deepEqual(loadedWithMeta.foldedPayload, record.foldedPayload);
  });

  test("load 保持纯净，不返回 meta", async () => {
    const store = createTouwakaTranscriptStore({ db, tableName: TABLE_NAME });
    await store.appendRound("run-clean", {
      round: 1,
      ts: "2026-08-29T10:01:00.000Z",
      messages: [{ role: "user", content: [{ type: "text", text: "clean" }] }],
    }, {
      topicId: "topic-clean",
      userId: "user-clean",
      isDeleted: true,
    });

    const [loaded] = await store.load("run-clean");
    assert.deepEqual(loaded, {
      round: 1,
      ts: "2026-08-29T10:01:00.000Z",
      folded: false,
      messages: [{ role: "user", content: [{ type: "text", text: "clean" }] }],
    });
    assert.equal(Object.hasOwn(loaded, "meta"), false);
  });

  test("findByTopic 过滤、按 run_id/round 排序并支持 limit", async () => {
    const store = createTouwakaTranscriptStore({ db, tableName: TABLE_NAME });
    const record = (round, text) => ({
      round,
      ts: `2026-08-29T10:0${round}:00.000Z`,
      messages: [{ role: "assistant", content: [{ type: "text", text }] }],
    });

    await store.appendRound("run-b", record(1, "b"), {
      topicId: "topic-target",
      userId: "user-target",
    });
    await store.appendRound("run-a", record(3, "a3"), {
      topicId: "topic-target",
      userId: "user-target",
    });
    await store.appendRound("run-a", record(1, "a1"), {
      topicId: "topic-target",
      userId: "user-target",
    });
    await store.appendRound("run-z", record(1, "other"), {
      topicId: "topic-other",
      userId: "user-other",
    });

    const found = await store.findByTopic("topic-target");
    assert.deepEqual(found.map((item) => item.messages[0].content[0].text), ["a1", "a3", "b"]);
    assert.deepEqual(found.map((item) => item.meta.topicId), [
      "topic-target",
      "topic-target",
      "topic-target",
    ]);

    const limited = await store.findByTopic("topic-target", { limit: 2 });
    assert.deepEqual(limited.map((item) => item.messages[0].content[0].text), ["a1", "a3"]);
  });

  test("checkpoint 保存、追加覆盖并可读回，run state 写入不抛错", async () => {
    const store = createTouwakaTranscriptStore({ db, tableName: TABLE_NAME });
    const runId = `run-checkpoint-${randomUUID()}`;
    const checkpoint = {
      round: 2,
      messages: [{ role: "assistant", content: "first" }],
    };
    const replacement = {
      round: 3,
      messages: [{ role: "assistant", content: "replacement" }],
    };

    assert.equal(await store.loadLatestCheckpoint(runId), undefined);
    await store.markRunState(runId, "running");
    await store.saveCheckpoint(runId, checkpoint);
    assert.deepEqual(await store.loadLatestCheckpoint(runId), checkpoint);

    await store.appendCheckpoint(runId, replacement);
    assert.deepEqual(await store.loadLatestCheckpoint(runId), replacement);
    assert.equal(await store.loadLatestCheckpoint(`run-missing-${randomUUID()}`), undefined);
  });
}
