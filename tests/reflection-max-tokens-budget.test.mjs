/**
 * issue #1224：反思输出预算 —— 「键名」与「值」双守卫
 *
 * 背景（工单实测）：`ReflectionService` 曾把预算传成 `max_output_tokens`，
 * 而发请求处 `lib/chat/base-llm.js:100` 读的是 `options.max_tokens`
 * ⇒ 那个旋钮**从来没生效过**，线上实发的是 `model.max_output_tokens`（128000）。
 *
 * 本文件钉死四件事：
 *   ① 键名：`reflect()` 交给 `callReflective` 的选项里是 `max_tokens`，
 *      **且不再出现 `max_output_tokens` 这个死键**；
 *   ② 值：默认预算 = `REFLECTION_OUTPUT_TOKEN_BUDGET`，且该常量本身满足工单的定值约束
 *      （≥ 4000、> 实测 max 3907、禁止 2000、≤ 128k × 15% 的输出预留）；
 *   ③ 端到端：`reflect()` 的选项经 `base-llm` 装配后的**真实请求体** `max_tokens` 就是该预算
 *      （而不是模型行的 128000）——用本机回环 HTTP 抓请求体，不联网、不依赖 DB；
 *   ④ 死键反向钉：只传 `max_output_tokens` 时 `base-llm` 的请求体**读不到它**（回落到模型行），
 *      把这个坑本身钉住，防止以后又写错键。
 *
 * Run:
 *   node --test tests/reflection-max-tokens-budget.test.mjs
 *   （已登记进 package.json 的 `npm run test:llm-kit` 显式文件清单，不登记等于没跑）
 */

import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import logger from "../lib/logger.js";
import {
  ReflectionService,
  REFLECTION_OUTPUT_TOKEN_BUDGET,
} from "../lib/psyche/reflection-service.js";
import { MinimalContextOrganizer } from "../lib/context-organizer/minimal-organizer.js";
import { call as baseLlmCall } from "../lib/chat/base-llm.js";

// ─────────────────────────────────────────────────────────────────────────────
// 脚手架
// ─────────────────────────────────────────────────────────────────────────────

/** #1217 对线上 `llm_call` 实测的反思 completion_tokens 分位数（思考开） */
const MEASURED = { p50: 1573, p95: 2707, max: 3907 };
/** `reflectionContextSize` 默认 128k，滑动窗口预留 15% 给输出（inputTokenRatio = 0.85） */
const OUTPUT_RESERVATION_AT_128K = 128000 * 0.15;

/** 静音 logger（reflection-service / minimal-organizer / base-llm 共用同一个单例） */
async function quiet(run) {
  const levels = ["debug", "info", "warn", "error"];
  const saved = levels.map((level) => [level, Object.getOwnPropertyDescriptor(logger, level)]);
  for (const level of levels) logger[level] = () => {};
  try {
    return await run();
  } finally {
    for (const [level, descriptor] of saved) {
      if (descriptor) Object.defineProperty(logger, level, descriptor);
      else delete logger[level];
    }
  }
}

/**
 * 起一个本机回环 HTTP 服务器冒充 OpenAI 兼容端点，把请求体原样抓下来。
 * 只监听 127.0.0.1 的临时端口 ⇒ 离线、无外网、无 DB。
 */
async function withCaptureServer(run) {
  const captured = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      captured.push(JSON.parse(raw));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: '{"session_meta":{"current_topic":"抓包"}}' } }],
          usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
        })
      );
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    return await run({ port, captured, baseUrl: `http://127.0.0.1:${port}/v1` });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

/** 线上反思模型那一行的形状：`ai_models.max_output_tokens = 128000`（deepseek-flash） */
function reflectiveModelRow(baseUrl) {
  return {
    model_name: "deepseek-flash",
    base_url: baseUrl,
    api_key: "test-key-not-a-real-secret",
    max_output_tokens: 128000,
    timeout: 5000,
  };
}

const RECENT_MESSAGES = [
  { role: "user", content: "退款流程要改，先确认口径" },
  { role: "assistant", content: "好的，先确认退款是否只走原路退回" },
];

/** 只记录选项的假 llmClient（单元层守卫用） */
function createRecordingClient() {
  const calls = [];
  return {
    calls,
    async callReflective(messages, options) {
      calls.push({ messages, options });
      return { content: '{"session_meta":{"current_topic":"ok"}}' };
    },
    async call() {
      throw new Error("ReflectionService 不该走 llmClient.call");
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ① 预算常量本身的定值约束（工单任务 2：禁止 2000）
// ─────────────────────────────────────────────────────────────────────────────

test("默认预算常量满足 #1224 定值约束：≥4000、覆盖实测 max、禁止 2000、不越 15% 输出预留", () => {
  assert.equal(typeof REFLECTION_OUTPUT_TOKEN_BUDGET, "number");
  assert.notEqual(REFLECTION_OUTPUT_TOKEN_BUDGET, 2000, "禁止保持 2000（会截掉 22% 的反思输出）");
  assert.ok(
    REFLECTION_OUTPUT_TOKEN_BUDGET >= 4000,
    `预算必须 ≥ 4000（工单下限），实际 ${REFLECTION_OUTPUT_TOKEN_BUDGET}`
  );
  assert.ok(
    REFLECTION_OUTPUT_TOKEN_BUDGET > MEASURED.max,
    `预算必须覆盖实测峰值 ${MEASURED.max}，实际 ${REFLECTION_OUTPUT_TOKEN_BUDGET}`
  );
  assert.ok(
    REFLECTION_OUTPUT_TOKEN_BUDGET <= OUTPUT_RESERVATION_AT_128K,
    `预算不得越过 128k 上下文的 15% 输出预留（${OUTPUT_RESERVATION_AT_128K}），实际 ${REFLECTION_OUTPUT_TOKEN_BUDGET}`
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// ② 键名 + 值（单元层：reflect() 交给 callReflective 的选项）
// ─────────────────────────────────────────────────────────────────────────────

test("reflect() 传的键名是 max_tokens（不是 max_output_tokens），值 = 默认预算", async () => {
  await quiet(async () => {
    const llm = createRecordingClient();
    const service = new ReflectionService(llm, { reflectionContextSize: 128000 });
    await service.reflect({}, RECENT_MESSAGES, [], { userId: "u1", expertId: "e1" });

    assert.equal(llm.calls.length, 1);
    const options = llm.calls[0].options;
    assert.equal(
      options.max_tokens,
      REFLECTION_OUTPUT_TOKEN_BUDGET,
      "max_tokens 必须是预算常量（base-llm 只读这个键）"
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(options, "max_output_tokens"),
      false,
      "不得再出现死键 max_output_tokens"
    );
    assert.deepEqual(options.response_format, { type: "json_object" }, "红线：response_format 语义未动");
  });
});

test("显式 config.maxTokens 仍然生效（预算可配，不被默认值盖掉）", async () => {
  await quiet(async () => {
    const llm = createRecordingClient();
    const service = new ReflectionService(llm, { maxTokens: 5000, reflectionContextSize: 128000 });
    await service.reflect({}, RECENT_MESSAGES, [], { userId: "u1", expertId: "e1" });
    assert.equal(llm.calls[0].options.max_tokens, 5000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ③ 组织器不再硬编码 2000（工单任务 1：config.maxTokens 要真的能配到线上）
// ─────────────────────────────────────────────────────────────────────────────

test("MinimalContextOrganizer 不再硬编码 2000：默认走预算常量，psyche_config.reflection_max_tokens 可覆盖", async () => {
  await quiet(async () => {
    const defaultOrganizer = new MinimalContextOrganizer(
      { expert: { id: "expert_1", psyche_config: {} }, reflectiveModel: { model_name: "reflective-test" } },
      { enableNotes: false }
    );
    assert.equal(defaultOrganizer.config.reflectionMaxTokens, REFLECTION_OUTPUT_TOKEN_BUDGET);
    assert.notEqual(defaultOrganizer.config.reflectionMaxTokens, 2000, "硬编码 2000 必须消失");

    const configuredOrganizer = new MinimalContextOrganizer(
      {
        expert: { id: "expert_1", psyche_config: { reflection_max_tokens: 6000 } },
        reflectiveModel: { model_name: "reflective-test" },
      },
      { enableNotes: false }
    );
    assert.equal(configuredOrganizer.config.reflectionMaxTokens, 6000, "psyche_config 的配置要能落到线上");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ④ 端到端：reflect() → base-llm 装配出的真实请求体
// ─────────────────────────────────────────────────────────────────────────────

test("端到端：reflect() 经 base-llm 装配后，请求体 max_tokens = 默认预算（不是模型行 128000）", async () => {
  await quiet(async () => {
    await withCaptureServer(async ({ captured, baseUrl }) => {
      const model = reflectiveModelRow(baseUrl);
      // 用真实 base-llm 冒充 llmClient 的传输层：reflect() 传什么，装配后就是什么
      const llmClient = {
        async callReflective(messages, options) {
          return baseLlmCall(model, messages, options);
        },
      };
      const service = new ReflectionService(llmClient, { reflectionContextSize: 128000 });
      const result = await service.reflect({}, RECENT_MESSAGES, [], { userId: "u1", expertId: "e1" });

      assert.equal(captured.length, 1, "应当正好发出一次请求");
      const body = captured[0];
      assert.equal(body.max_tokens, REFLECTION_OUTPUT_TOKEN_BUDGET, "请求体 max_tokens 必须是预算");
      assert.notEqual(body.max_tokens, model.max_output_tokens, "不得再回落到模型行的 128000");
      assert.deepEqual(body.response_format, { type: "json_object" });
      assert.equal(
        Object.prototype.hasOwnProperty.call(body, "max_output_tokens"),
        false,
        "请求体里不该有 max_output_tokens 这个字段"
      );
      assert.equal(result.session_meta.current_topic, "抓包");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⑤ 死键反向钉：传 max_output_tokens，base-llm 不会读它
// ─────────────────────────────────────────────────────────────────────────────

test("死键守卫：只传 max_output_tokens 时，base-llm 装配的请求体读不到它（回落 model.max_output_tokens）", async () => {
  await quiet(async () => {
    await withCaptureServer(async ({ captured, baseUrl }) => {
      const model = reflectiveModelRow(baseUrl);
      await baseLlmCall(model, [{ role: "user", content: "hi" }], {
        max_output_tokens: 999, // 旧代码就是这么传的（死键）
        response_format: { type: "json_object" },
      });

      assert.equal(captured.length, 1);
      const body = captured[0];
      assert.equal(
        body.max_tokens,
        model.max_output_tokens,
        "max_output_tokens 不被读 ⇒ 请求体回落到模型行配置（这就是 2000 从未生效的机制）"
      );
      assert.notEqual(body.max_tokens, 999, "999 绝不能出现在请求体里");
      assert.equal(Object.prototype.hasOwnProperty.call(body, "max_output_tokens"), false);
    });
  });
});

test("对照：同一路径传 max_tokens 时，请求体就是该值（证明差别只在键名）", async () => {
  await quiet(async () => {
    await withCaptureServer(async ({ captured, baseUrl }) => {
      const model = reflectiveModelRow(baseUrl);
      await baseLlmCall(model, [{ role: "user", content: "hi" }], { max_tokens: 999 });
      assert.equal(captured[0].max_tokens, 999);
    });
  });
});
