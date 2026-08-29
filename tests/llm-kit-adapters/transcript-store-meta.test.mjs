import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
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
}
