/**
 * erix-llm-kit ModelConfigProvider 适配器 —— touwaka MariaDB 实现（项目侧"驱动"）
 *
 * 把 touwaka 的 ai_models + providers 两表（经 lib/db.js 的 getModelConfig join 查询）
 * 映射为 erix-llm-kit 的 ModelConfigProvider 接口：
 *
 *   resolve(slot?) → ModelConfig { protocol, endpoint, model, apiKey,
 *                                  contextWindowTokens, maxOutputTokens }
 *
 * slot 语义（touwaka 没有槽位概念，映射规则如下）：
 *   - 缺省 / "default" → 默认文本模型（is_active + model_type='text'，created_at 最新，
 *     与 lib/model-registry.js getDefaultTextModelConfig 同规则）
 *   - 其他值 → 按 ai_model.id 精确查找；找不到/未激活 → 回落 default（ADR-001 回落语义）
 *
 * 注意：
 *   - protocol 固定 "openai"（touwaka providers 均为 OpenAI 兼容端点；将来接 Anthropic
 *     原生协议时需在 providers 表加 protocol 列——DB 字段变更属红线，届时先确认）
 *   - apiKey 来自 providers.api_key（DB 即物化，等价 ADR-001 的间接引用物化）
 *   - 不做缓存（ModelRegistry 已有缓存层；本适配器保持薄，每次 resolve 走 DB）
 */

const DEFAULT_SLOT = "default";

function toModelConfig(row) {
  if (!row) return null;
  return {
    protocol: "openai",
    endpoint: row.base_url,
    model: row.model_name,
    apiKey: row.api_key ?? undefined,
    contextWindowTokens: row.max_tokens ?? undefined,
    maxOutputTokens: row.max_output_tokens ?? undefined,
  };
}

export function createTouwakaModelConfigProvider({ db }) {
  if (!db) throw new Error("[llm-kit-adapters] db 实例必填");

  async function resolveDefault() {
    const AiModel = db.getModel("ai_model");
    const row = await AiModel.findOne({
      where: { is_active: true, model_type: "text" },
      order: [["created_at", "DESC"]],
      raw: true,
    });
    if (!row) throw new Error("[llm-kit-adapters] 无可用默认文本模型（ai_models 表为空或全未激活）");
    return toModelConfig(await db.getModelConfig(row.id));
  }

  return {
    async resolve(slot) {
      if (!slot || slot === DEFAULT_SLOT) return resolveDefault();
      const config = toModelConfig(await db.getModelConfig(slot));
      return config ?? resolveDefault();
    },
  };
}
