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
 *   - 其他值 → 按 ai_model.id 精确查找；找不到/未激活 → **抛错并列出可用槽位**
 *
 * 槽位形态裁决（erix-agent 0.29 契约，上游 issue #518）：
 *   0.23 的契约套件里有一条「resolve(不存在的槽) 回落 default」，0.29 把它换成了
 *   **必填的第三参 `unknownSlot`**，并按形态二分：槽位图（`{mode:"throws"}`）必须抛，
 *   单配置（`{mode:"single-config"}`）才允许任意槽名返回同一份配置。
 *   touwaka 的槽位是真实的 `ai_model.id` 图（default 槽是「图里的默认项」），不是单配置
 *   形态 ⇒ 未知槽名必须抛：写错槽位就静默跑另一个模型，正是上游 #518 点名要消除的
 *   「配了等于没配」。
 *   影响面：本适配器目前只被契约测试构造（生产路径走 createModelConfigResolver 的静态
 *   resolver），所以这条语义收窄不改任何线上行为。
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

  /** 槽位图：活跃模型 id 列表（未知槽名的报错里要点名它们，上游 #518 契约要求）。 */
  async function availableSlots() {
    const AiModel = db.getModel("ai_model");
    const rows = await AiModel.findAll({
      where: { is_active: true },
      attributes: ["id"],
      raw: true,
    });
    return rows.map((row) => row.id);
  }

  return {
    async resolve(slot) {
      if (!slot || slot === DEFAULT_SLOT) return resolveDefault();
      const config = toModelConfig(await db.getModelConfig(slot));
      if (config) return config;
      // 槽位图形态：未知槽名必须抛（erix-agent 0.29 契约 / 上游 #518），不许静默回落 default。
      const available = await availableSlots();
      throw new Error(
        `[llm-kit-adapters] 未知模型槽位 ${JSON.stringify(String(slot))}`
        + `（可用槽位：${available.length > 0 ? available.join(", ") : "无"}）`,
      );
    },
  };
}
