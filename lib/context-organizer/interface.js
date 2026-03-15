/**
 * Context Organizer Interface - 上下文组织接口
 * 定义上下文组织的标准接口，支持多种组织策略
 *
 * 架构设计：
 * - IContextOrganizer: 接口定义
 * - 具体实现：FullContextOrganizer（完整上下文）、SimpleContextOrganizer（简单上下文）
 */

/**
 * 上下文组织接口
 * 所有上下文组织策略必须实现此接口
 */
export class IContextOrganizer {
  /**
   * 组织上下文
   * @param {MemorySystem} memorySystem - 记忆系统实例
   * @param {string} userId - 用户ID
   * @param {object} options - 组织选项
   * @returns {Promise<ContextResult>} 组织后的上下文结果
   */
  async organize(memorySystem, userId, options = {}) {
    throw new Error('必须实现 organize 方法');
  }

  /**
   * 获取策略名称
   * @returns {string} 策略名称
   */
  getName() {
    throw new Error('必须实现 getName 方法');
  }

  /**
   * 获取策略描述
   * @returns {string} 策略描述
   */
  getDescription() {
    throw new Error('必须实现 getDescription 方法');
  }
}

/**
 * 上下文结果结构
 */
export class ContextResult {
  constructor({
    messages = [],
    systemPrompt = '',
    hiddenContext = {},
    metadata = {},
  }) {
    // LLM 输入消息数组
    this.messages = messages;
    // 系统提示词
    this.systemPrompt = systemPrompt;
    // 隐藏上下文（用于调试和后续处理）
    this.hiddenContext = hiddenContext;
    // 元数据
    this.metadata = metadata;
  }

  /**
   * 估算 token 数量
   */
  estimateTokens() {
    let total = 0;

    // 系统提示
    if (this.systemPrompt) {
      total += Math.ceil(this.systemPrompt.length / 4);
    }

    // 消息
    for (const msg of this.messages || []) {
      const contentLength = typeof msg.content === 'string'
        ? msg.content.length
        : JSON.stringify(msg.content).length;
      total += Math.ceil(contentLength / 4) + 4;
    }

    return total;
  }

  /**
   * 格式化为可读文本（用于调试）
   */
  format() {
    const lines = [];

    lines.push('=== System Prompt ===');
    lines.push(this.systemPrompt?.substring(0, 1000) + '...');

    if (this.hiddenContext?.soul) {
      lines.push('\n=== Soul (隐藏) ===');
      const soul = this.hiddenContext.soul;
      lines.push(`核心价值观: ${soul.coreValues?.substring(0, 100) || ''}`);
      lines.push(`情感基调: ${soul.emotionalTone || ''}`);
    }

    if (this.hiddenContext?.innerVoices?.length > 0) {
      lines.push('\n=== Inner Voices (隐藏) ===');
      for (const iv of this.hiddenContext.innerVoices) {
        if (iv.selfEvaluation) {
          lines.push(`评分: ${iv.selfEvaluation.score}/10`);
        }
      }
    }

    if (this.hiddenContext?.topicSummaries) {
      lines.push('\n=== Topic Summaries ===');
      lines.push(this.hiddenContext.topicSummaries.substring(0, 500) + '...');
    }

    lines.push('\n=== Messages ===');
    for (const msg of this.messages || []) {
      const preview = typeof msg.content === 'string'
        ? msg.content.substring(0, 80)
        : JSON.stringify(msg.content).substring(0, 80);
      lines.push(`${msg.role}: ${preview}...`);
    }

    lines.push(`\n=== Metadata ===`);
    lines.push(`Token 估算: ${this.estimateTokens()}`);
    lines.push(`消息数: ${this.messages.length}`);

    return lines.join('\n');
  }
}

/**
 * 上下文组织器工厂
 * 用于创建和管理不同的上下文组织策略
 */
export class ContextOrganizerFactory {
  constructor() {
    this.organizers = new Map();
  }

  /**
   * 注册上下文组织器
   * @param {string} name - 组织器名称
   * @param {IContextOrganizer} organizer - 组织器实例
   */
  register(name, organizer) {
    this.organizers.set(name, organizer);
  }

  /**
   * 获取上下文组织器
   * @param {string} name - 组织器名称
   * @returns {IContextOrganizer|null}
   */
  get(name) {
    return this.organizers.get(name) || null;
  }

  /**
   * 获取所有可用的组织器
   * @returns {Array<{name: string, description: string}>}
   */
  list() {
    return Array.from(this.organizers.entries()).map(([name, organizer]) => ({
      name,
      description: organizer.getDescription(),
    }));
  }

  /**
   * 检查组织器是否存在
   * @param {string} name - 组织器名称
   * @returns {boolean}
   */
  has(name) {
    return this.organizers.has(name);
  }
}

// 导出单例工厂实例
export const organizerFactory = new ContextOrganizerFactory();
