/**
 * max_tool_rounds 的服务端边界（issue #1166）
 *
 * 一处定义、两处消费，避免「写入侧一个范围 / 运行时另一个范围」的漂移：
 *   - 写入侧（server/controllers/expert.controller.js 的 create / update）用
 *     `isValidMaxToolRounds` 做**硬校验**，越界直接 `ctx.error()` 拒绝，不静默夹取；
 *     范围与 models/expert.js 列注释（"范围 1-50"）、前端
 *     frontend/src/components/settings/ExpertSettingsTab.vue 的 `:min="1" :max="50"`、
 *     以及系统设置 `tool.max_rounds` 的 VALIDATION_RULES 一致。
 *   - 运行时（lib/agent/agent-loop.js 的两个消费点）用 `resolveEffectiveMaxToolRounds`
 *     做**防御夹取**：负数 / 巨大值在本次修复之前是能落库的（写入侧无校验），
 *     夹取 + `logger.warn` 留痕——既不把循环上界交给负数（`round < maxRounds`
 *     直接不成立，工具轮一轮都不跑），也不让巨大值原样变成资源上界
 *     （探针候选集失控，issue #1166 的主症状）。
 *
 * 字段名全程 snake_case，不做任何转换；`null` 的「继承系统默认」语义在两侧都保留。
 */

import logger from '../logger.js';

/** 约定范围下界（与前端 :min、models 列注释、系统设置校验规则一致） */
export const MAX_TOOL_ROUNDS_MIN = 1;
/** 约定范围上界（同上） */
export const MAX_TOOL_ROUNDS_MAX = 50;

/**
 * 写入侧判据：值是否是「可以直接落库」的 max_tool_rounds。
 *
 * 只接受 1–50 的**整数**。`null` / `undefined` 表示「清空 / 本次不改」，由控制器
 * 在调用前单独处理，不进这个判据（否则 null 会被当非法值拒绝，破坏既有继承语义）。
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidMaxToolRounds(value) {
  return Number.isInteger(value)
    && value >= MAX_TOOL_ROUNDS_MIN
    && value <= MAX_TOOL_ROUNDS_MAX;
}

/**
 * 运行时生效值解析（agent-loop 的两个消费点共用，禁止各自复制一份逻辑）。
 *
 * 语义（保持既有 + 新增兜底）：
 *   1. `null` / `undefined` / `''` / `0` → **继承系统默认**，即改造前
 *      `expert?.max_tool_rounds || await getMaxToolRounds()` 的短路语义；
 *      系统默认同样过一遍夹取（防御；正常情况下它已被系统设置校验约束在 1–50）。
 *   2. 1–50 的整数 → 原样采用。
 *   3. 负数 / 越界值 / 巨大值 / 小数 → **夹进 1–50 并 logger.warn**：负数不该静默
 *      变 1（现象是"专家突然不调用工具"，不留痕查不出来）。
 *   4. 非有限数字（'abc' / NaN / Infinity）→ **告警 + 按「继承系统默认」处理**
 *      （改造前 `||` 会把它们原样当上界使，后果比负数还难查）。
 *
 * `resolveSystemDefault` 只在真的要继承时才 await，保持改造前的短路求值：
 * 专家已显式配置时不会多读一次系统设置。
 *
 * @param {object} params
 * @param {unknown} params.configured 专家配置里的 max_tool_rounds 原值
 * @param {() => number|Promise<number>} [params.resolveSystemDefault] 系统默认值来源
 * @param {number} [params.systemDefaultFallback] 取不到系统设置时的兜底（改造前是 20）
 * @param {string} [params.expert_id] 告警上下文
 * @param {string} [params.request_id] 告警上下文
 * @param {string} [params.source] 告警上下文：哪个消费点
 * @returns {Promise<number>} 必定落在 [MAX_TOOL_ROUNDS_MIN, MAX_TOOL_ROUNDS_MAX]
 */
export async function resolveEffectiveMaxToolRounds({
  configured,
  resolveSystemDefault,
  systemDefaultFallback,
  expert_id,
  request_id,
  source = 'unknown',
} = {}) {
  const context = { source, expert_id, request_id };
  const numeric = typeof configured === 'number' ? configured : Number(configured);

  const inheritSystemDefault = async (origin) => {
    let systemDefault = systemDefaultFallback;
    if (typeof resolveSystemDefault === 'function') {
      try {
        systemDefault = await resolveSystemDefault();
      } catch (error) {
        logger.warn(
          `[MaxToolRounds] 读取系统默认 tool.max_rounds 失败，改用兜底值 `
          + `${String(systemDefaultFallback)}（source=${source}, expert_id=${String(expert_id)}, `
          + `request_id=${String(request_id)}）: ${error?.message ?? error}`,
        );
      }
    }
    return clampMaxToolRounds(systemDefault, { ...context, origin });
  };

  // 既有语义：null / undefined / 空串 / 0 → 继承系统默认（不是脏数据，不告警）
  if (configured === null || configured === undefined || configured === '' || configured === 0) {
    return inheritSystemDefault('系统默认 tool.max_rounds（专家未配置 / 已清空）');
  }

  // 非数字脏值（'abc' / Infinity / NaN / 对象）：`||` 时代会把它们原样当上界使，
  // 结果比负数更隐式（round < 'abc' 永不成立）。按「继承系统默认」处理并告警，
  // 不静默归 1。
  if (!Number.isFinite(numeric)) {
    logger.warn(
      `[MaxToolRounds] max_tool_rounds 不是有限数字，改按「继承系统默认」处理：`
      + `${String(configured)}（source=${source}, expert_id=${String(expert_id)}, `
      + `request_id=${String(request_id)}）`,
    );
    return inheritSystemDefault('系统默认 tool.max_rounds（专家值非数字）');
  }

  return clampMaxToolRounds(configured, {
    ...context,
    origin: '专家配置 expert.max_tool_rounds（遗留脏数据兜底；写入侧现已硬校验，'
      + '新脏数据只能来自历史行或直接写库）',
  });
}

/**
 * 把任意值夹进 [MAX_TOOL_ROUNDS_MIN, MAX_TOOL_ROUNDS_MAX]；真的动了才告警。
 *
 * @param {unknown} value
 * @param {object} context 告警上下文（source / expert_id / request_id / origin）
 * @returns {number}
 */
function clampMaxToolRounds(value, context = {}) {
  const numeric = typeof value === 'number' ? value : Number(value);
  let effective;
  if (!Number.isFinite(numeric)) {
    // 兜底的兜底：连兜底值都不是数字（配置缺失 / 驱动异常）→ 取约定下界，
    // 保证循环上界永远可用，同时告警，绝不静默。
    effective = MAX_TOOL_ROUNDS_MIN;
  } else {
    effective = Math.min(Math.max(Math.trunc(numeric), MAX_TOOL_ROUNDS_MIN), MAX_TOOL_ROUNDS_MAX);
  }

  if (effective !== numeric) {
    logger.warn(
      `[MaxToolRounds] max_tool_rounds 已夹取：${String(value)} -> ${effective} `
      + `（允许范围 ${MAX_TOOL_ROUNDS_MIN}-${MAX_TOOL_ROUNDS_MAX}；`
      + `来源：${context.origin ?? 'unknown'}；source=${context.source ?? 'unknown'}, `
      + `expert_id=${String(context.expert_id)}, request_id=${String(context.request_id)}）`,
    );
  }
  return effective;
}
