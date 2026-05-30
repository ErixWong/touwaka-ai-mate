/**
 * LLM Client (Expert Layer)
 * 支持二分心智架构（Expressive Mind + Reflective Mind）
 * 底层调用 BaseLLM 进行 HTTP 通信
 */

import logger from './logger.js';
import { call as baseCall, callWithRetry as baseCallWithRetry, callStream as baseCallStream } from './chat/base-llm.js';
import { estimateTokens, estimateMessagesTokens, truncateMessages } from './token-utils.js';

class LLMClient {
  /**
   * @param {ConfigLoader} configLoader - 配置加载器
   * @param {string} expertId - 专家ID
   */
  constructor(configLoader, expertId) {
    this.configLoader = configLoader;
    this.expertId = expertId;
    this.config = null;
    
    // 追踪活跃请求，用于中止
    // key: requestId (user_id:expert_id:timestamp), value: http.IncomingMessage
    this.activeRequests = new Map();
  }

  /**
   * 生成请求ID
   * @param {string} userId - 用户ID
   * @returns {string} 请求ID
   */
  _generateRequestId(userId) {
    return `${userId}:${this.expertId}:${Date.now()}`;
  }

  /**
   * 注册活跃请求
   * @param {string} requestId - 请求ID
   * @param {http.ClientRequest} req - 请求对象
   */
  _registerRequest(requestId, req) {
    this.activeRequests.set(requestId, req);
    logger.debug(`[LLMClient] Registered request: ${requestId}, active: ${this.activeRequests.size}`);
  }

  /**
   * 注销活跃请求
   * @param {string} requestId - 请求ID
   */
  _unregisterRequest(requestId) {
    this.activeRequests.delete(requestId);
    logger.debug(`[LLMClient] Unregistered request: ${requestId}, active: ${this.activeRequests.size}`);
  }

  /**
   * 中止指定用户的请求
   * @param {string} userId - 用户ID
   * @returns {boolean} 是否成功中止
   */
  abortUserRequest(userId) {
    const prefix = `${userId}:${this.expertId}:`;
    let aborted = false;
    
    for (const [requestId, req] of this.activeRequests.entries()) {
      if (requestId.startsWith(prefix)) {
        logger.info(`[LLMClient] Aborting request: ${requestId}`);
        req.destroy(new Error('Request aborted by user'));
        this.activeRequests.delete(requestId);
        aborted = true;
      }
    }
    
    return aborted;
  }

  /**
   * 获取当前活跃请求数
   * @returns {number}
   */
  getActiveRequestCount() {
    return this.activeRequests.size;
  }

  /**
   * 从数据库加载配置
   */
  async loadConfig() {
    this.config = await this.configLoader.loadExpertConfig(this.expertId);
    logger.info(`LLM Client config loaded for expert: ${this.expertId}`);
  }

  /**
   * 获取指定心智的模型配置
   * @param {'expressive'|'reflective'} mindType - 心智类型
   * @returns {Object} 模型配置
   */
  getModelForMind(mindType) {
    if (!this.config) {
      throw new Error('Config not loaded. Call loadConfig() first.');
    }

    const model = mindType === 'expressive'
      ? this.config.expressiveModel
      : this.config.reflectiveModel;

    if (!model) {
      throw new Error(`Model config not found for ${mindType} mind`);
    }

    return model;
  }

  /**
   * 获取专家的 LLM 参数（确保是数字类型）
   * @returns {Object} LLM 参数
   */
  getExpertLLMParams() {
    const expert = this.config?.expert;
    if (!expert) {
      return {
        temperature: 0.7,
        reflective_temperature: 0.3,
        top_p: 1.0,
        frequency_penalty: 0.0,
        presence_penalty: 0.0,
      };
    }
    
    // 数据库 DECIMAL 类型可能返回字符串，需要转换为数字
    return {
      temperature: parseFloat(expert.temperature) || 0.7,
      reflective_temperature: parseFloat(expert.reflective_temperature) || 0.3,
      top_p: parseFloat(expert.top_p) || 1.0,
      frequency_penalty: parseFloat(expert.frequency_penalty) || 0.0,
      presence_penalty: parseFloat(expert.presence_penalty) || 0.0,
    };
  }

  /**
   * 调用 Expressive Mind（生成对话回复）
   * @param {Array} messages - 消息数组
   * @param {Object} options - 可选参数
   * @returns {Promise<Object>} LLM 响应
   */
  async callExpressive(messages, options = {}) {
    const model = this.getModelForMind('expressive');
    // 使用专家配置的参数，如果未配置则使用默认值
    const params = this.getExpertLLMParams();
    return this.callWithRetry(model, messages, {
      temperature: params.temperature,
      top_p: params.top_p,
      frequency_penalty: params.frequency_penalty,
      presence_penalty: params.presence_penalty,
      ...options,
    });
  }

  /**
   * 调用 Reflective Mind（生成内心独白）
   * @param {Array} messages - 消息数组
   * @param {Object} options - 可选参数
   * @returns {Promise<Object>} LLM 响应
   */
  async callReflective(messages, options = {}) {
    const model = this.getModelForMind('reflective');
    const params = this.getExpertLLMParams();
    logger.info('[LLMClient] 准备调用 Reflective Mind:', {
      model_name: model.model_name,
      base_url: model.base_url,
      has_api_key: !!model.api_key,
      messages_count: messages.length,
      model_timeout: model.timeout,
      temperature: params.reflective_temperature,
    });
    return this.callWithRetry(model, messages, {
      ...options,
      temperature: params.reflective_temperature,
      top_p: params.top_p,
      frequency_penalty: params.frequency_penalty,
      presence_penalty: params.presence_penalty,
      // 反思阶段需要更长的超时时间，因为需要生成结构化的 JSON 输出
      // 如果模型配置的 timeout 小于 90 秒，则使用 90 秒
      timeout: Math.max(model.timeout || 60000, 90000),
      _reflective: true, // 标记为反思请求，用于日志区分
    });
  }

  /**
   * 通用 LLM 调用方法
   * @param {Object} model - 模型配置
   * @param {Array} messages - 消息数组（支持多模态格式）
   * @param {Object} options - 可选参数
   * @param {Object} options.thinking - DeepSeek 思考模式参数 { type: 'enabled' | 'disabled' }
   * @param {Object} options.reasoning - OpenAI 推理模式参数 { effort: 'low' | 'medium' | 'high' }
   * @returns {Promise<Object>} 包含 content、reasoning_content 和 usage 的响应
   */
  async call(model, messages, options = {}) {
    const userId = options.user_id || 'anonymous';
    const requestId = this._generateRequestId(userId);
    const processedMessages = this.processMultimodalMessages(messages, model);

    const callType = options._reflective ? '反思' : '非流式';
    logger.info(`[LLMClient] 开始${callType}调用:`, {
      model_name: model.model_name,
      messages_count: messages.length,
      temperature: options.temperature ?? 0.7,
    });

    return baseCall(model, processedMessages, {
      ...options,
      onRequest: (req) => {
        this._registerRequest(requestId, req);
        req.on('close', () => this._unregisterRequest(requestId));
      },
    });
  }

  /**
   * 带重试机制的 LLM 调用（使用公共重试模块）
   * @param {Object} model - 模型配置
   * @param {Array} messages - 消息数组
   * @param {Object} options - 可选参数
   * @returns {Promise<Object>} LLM 响应
   */
  async callWithRetry(model, messages, options = {}) {
    const userId = options.user_id || 'anonymous';
    const requestId = this._generateRequestId(userId);
    const processedMessages = this.processMultimodalMessages(messages, model);
    return baseCallWithRetry(model, processedMessages, {
      ...options,
      onRequest: (req) => {
        this._registerRequest(requestId, req);
        req.on('close', () => this._unregisterRequest(requestId));
      },
    });
  }

  /**
   * 调用支持工具函数的 Expressive Mind
   * @param {Array} messages - 消息数组
   * @param {Array} tools - 工具定义
   * @param {Object} options - 可选参数
   * @returns {Promise<Object>} 包含 content 或 toolCalls 的响应
   */
  async callExpressiveWithTools(messages, tools, options = {}) {
    const model = this.getModelForMind('expressive');
    const params = this.getExpertLLMParams();
    return this.callWithRetry(model, messages, {
      temperature: params.temperature,
      top_p: params.top_p,
      frequency_penalty: params.frequency_penalty,
      presence_penalty: params.presence_penalty,
      ...options,
      tools,
      tool_choice: options.tool_choice || 'auto',
    });
  }

  /**
   * 处理多模态消息格式
   * 将数据库存储的消息格式转换为 OpenAI API 所需的多模态格式
   * @param {Array} messages - 消息数组
   * @param {Object} model - 模型配置（可选），用于判断是否支持多模态
   * @returns {Array} 处理后的消息数组
   */
  processMultimodalMessages(messages, model = null) {
    // 判断模型是否支持多模态
    const isMultimodalModel = model?.model_type === 'multimodal';
    
    if (isMultimodalModel) {
      logger.info('[LLMClient] 模型支持多模态，将转换图片为多模态格式:', model.model_name);
    } else if (model) {
      logger.info('[LLMClient] 模型不支持多模态，将移除图片标记:', model?.model_name || 'unknown');
    }

    const processedMessages = messages.map(msg => {
      // 如果 content 已经是数组格式（多模态），根据模型类型处理
      if (Array.isArray(msg.content)) {
        // 如果模型不支持多模态，将数组转换为纯文本
        if (!isMultimodalModel) {
          const textParts = msg.content
            .filter(item => item.type === 'text')
            .map(item => item.text);
          const imageUrlParts = msg.content
            .filter(item => item.type === 'image_url')
            .map(item => item.image_url?.url)
            .filter(url => url);
          
          // 图片 URL 作为文本保留，让 LLM 知道有图片存在
          const allText = [...textParts, ...imageUrlParts].join('\n');
          return { ...msg, content: allText || msg.content };
        }
        return msg;
      }

      // 如果 content 是字符串，检查是否包含图片标记
      if (typeof msg.content === 'string') {
        // 检查是否是 JSON 格式的多模态内容
        try {
          const parsed = JSON.parse(msg.content);
          if (Array.isArray(parsed)) {
            // 已经是多模态数组格式
            // 如果模型不支持多模态，转换为纯文本
            if (!isMultimodalModel) {
              const textParts = parsed
                .filter(item => item.type === 'text')
                .map(item => item.text);
              const imageUrlParts = parsed
                .filter(item => item.type === 'image_url')
                .map(item => item.image_url?.url)
                .filter(url => url);
              const allText = [...textParts, ...imageUrlParts].join('\n');
              return { ...msg, content: allText || msg.content };
            }
            logger.info('[LLMClient] 检测到多模态数组格式消息');
            return { ...msg, content: parsed };
          }
          if (parsed.type === 'multimodal' && Array.isArray(parsed.content)) {
            // { type: 'multimodal', content: [...] } 格式
            // 如果模型不支持多模态，转换为纯文本
            if (!isMultimodalModel) {
              const textParts = parsed.content
                .filter(item => item.type === 'text')
                .map(item => item.text);
              const imageUrlParts = parsed.content
                .filter(item => item.type === 'image_url')
                .map(item => item.image_url?.url)
                .filter(url => url);
              const allText = [...textParts, ...imageUrlParts].join('\n');
              return { ...msg, content: allText || msg.content };
            }
            logger.info('[LLMClient] 检测到多模态包装格式消息，包含内容项:', parsed.content.length);
            return { ...msg, content: parsed.content };
          }
        } catch (e) {
          // 不是 JSON，作为普通文本处理
        }

        // 检查是否包含 markdown 图片标记 ![alt](url)
        const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
        const images = [];
        let match;
        let textContent = msg.content;

        while ((match = imageRegex.exec(msg.content)) !== null) {
          images.push({
            url: match[2],
            alt: match[1],
          });
          // 移除图片标记，保留文本
          textContent = textContent.replace(match[0], '').trim();
        }

        // 如果有图片，根据模型类型处理
        if (images.length > 0) {
          if (isMultimodalModel) {
            // 多模态模型：转换为多模态格式
            logger.info('[LLMClient] 检测到 Markdown 图片标记，转换为多模态格式，图片数量:', images.length);
            const content = [];
            if (textContent) {
              content.push({ type: 'text', text: textContent });
            }
            content.push(...images.map(img => ({
              type: 'image_url',
              image_url: { url: img.url }
            })));
            return { ...msg, content };
          } else {
            // 非多模态模型：移除图片标记，保留 URL 作为文本
            logger.info('[LLMClient] 检测到 Markdown 图片标记，模型不支持多模态，保留 URL 作为文本，图片数量:', images.length);
            const urlList = images.map(img => img.url).join('\n');
            const newContent = textContent ? `${textContent}\n${urlList}` : urlList;
            return { ...msg, content: newContent };
          }
        }
      }

      return msg;
    });

    return processedMessages;
  }

  /**
   * 分析消息构成
   * @param {Array} messages - 消息数组
   * @returns {Object} 消息分析结果
   */
  analyzeMessages(messages) {
    const result = {
      system: { count: 0, chars: 0, tokens: 0 },
      history: { count: 0, chars: 0, tokens: 0 },
      toolResults: { count: 0, chars: 0, tokens: 0 },
    };

    // 计算多模态内容字符数的辅助函数
    const getContentChars = (content) => {
      if (!content) return 0;
      if (Array.isArray(content)) {
        let total = 0;
        for (const item of content) {
          if (item.type === 'text' && item.text) {
            total += item.text.length;
          }
        }
        return total;
      }
      return content.length;
    };

    for (const msg of messages) {
      const content = msg.content || '';
      const chars = getContentChars(content);
      const tokens = estimateTokens(content) + 4;

      if (msg.role === 'system') {
        result.system.count++;
        result.system.chars += chars;
        result.system.tokens += tokens;
      } else if (msg.role === 'tool') {
        result.toolResults.count++;
        result.toolResults.chars += chars;
        result.toolResults.tokens += tokens;
      } else {
        // user, assistant, 等其他角色算作历史对话
        result.history.count++;
        result.history.chars += chars;
        result.history.tokens += tokens;
      }

      // 工具调用也计入
      if (msg.tool_calls) {
        const toolCallsContent = JSON.stringify(msg.tool_calls);
        result.toolResults.chars += toolCallsContent.length;
        result.toolResults.tokens += estimateTokens(toolCallsContent);
      }
    }

    return result;
  }

  /**
   * 流式调用 LLM
   * @param {Object} model - 模型配置
   * @param {Array} messages - 消息数组
   * @param {Object} options - 可选参数
   * @param {Array} options.tools - 工具定义
   * @param {Function} options.onDelta - 收到增量内容的回调
   * @param {Function} options.onReasoningDelta - 收到思考内容增量的回调（DeepSeek）
   * @param {Function} options.onToolCall - 收到工具调用的回调
   * @param {Function} options.onUsage - 收到 usage 信息的回调（流式结束时调用）
   * @param {Object} options.thinking - DeepSeek 思考模式参数 { type: 'enabled' | 'disabled' }
   * @param {Object} options.reasoning - OpenAI 推理模式参数 { effort: 'low' | 'medium' | 'high' }
   * @returns {Promise<void>}
   */
  async callStream(model, messages, options = {}) {
    const userId = options.user_id || 'anonymous';
    const requestId = this._generateRequestId(userId);
    const processedMessages = this.processMultimodalMessages(messages, model);
    const { tools } = options;

    logger.info('[LLMClient] 开始流式调用:', {
      model_name: model.model_name,
      messages_count: processedMessages.length,
      has_tools: !!(tools && tools.length > 0),
      has_thinking: !!options.thinking,
      has_reasoning: !!options.reasoning,
    });

    return baseCallStream(model, processedMessages, {
      ...options,
      onRequest: (req) => {
        this._registerRequest(requestId, req);
        req.on('close', () => this._unregisterRequest(requestId));
      },
    });
  }

  /**
   * 从消息数组中提取图片并注入合成 user 消息
   * 用于工具返回图片后，在多模态模型中让 LLM 能"看到"图片
   *
   * 原理: OpenAI API 的 role="tool" 只接受 string content，
   * image_url 必须在 role="user" 的 content 数组里才能被 VLM 识别。
   *
   * @param {Array} messages - 当前消息数组（会被原地修改）
   * @param {Object} model - 模型配置（用于判断是否多模态）
   * @param {Array} toolResults - 工具执行结果数组
   */
  static injectImageUserMessages(messages, model, toolResults) {
    if (model?.model_type !== 'multimodal') return
    if (!toolResults || !toolResults.length) return

    const DATA_URL_RE = /data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/
    const images = []

    for (const result of toolResults) {
      const dataUrl = result?.data?.dataUrl || result?.dataUrl
      if (!dataUrl || typeof dataUrl !== 'string') continue
      const match = dataUrl.match(DATA_URL_RE)
      if (!match) continue

      // 判定文件名
      let filename = result.toolName || 'image'
      if (result.data?.filename) filename = result.data.filename
      else if (result.data?.path) {
        const parts = result.data.path.replace(/\\/g, '/').split('/')
        filename = parts[parts.length - 1] || filename
      }

      images.push({ url: match[0], filename, toolName: result.toolName })
    }

    if (images.length === 0) return

    // 注入合成 user 消息（参考 kilocode SYNTHETIC_ATTACHMENT_PROMPT）
    const content = [
      { type: 'text', text: `工具返回了 ${images.length} 张图片，请分析：` },
      ...images.map(img => ({
        type: 'image_url',
        image_url: { url: img.url }
      }))
    ]
    messages.push({ role: 'user', content, _synthetic: true })
    logger.info(`[LLMClient] 注入合成 user 消息，图片: ${images.length}，来源: ${images.map(i => i.toolName).join(', ')}`)
  }

  /**
   * 清除历史消息中的 base64 图片，替换为文本占位符
   * 在 compaction 后调用，防止旧图片撑爆上下文
   *
   * @param {Array} messages - 消息数组
   * @returns {Array} 处理后的消息副本
   */
  static stripHistoricalImages(messages) {
    const lastRealUser = messages.reduce((found, msg, idx) => {
      if (msg.role === 'user' && !msg._synthetic) return idx
      return found
    }, -1)

    if (lastRealUser < 0) return messages

    return messages.map((msg, idx) => {
      if (idx >= lastRealUser) return msg

      // 处理 image_url 数组
      if (Array.isArray(msg.content)) {
        return {
          ...msg,
          content: msg.content.map(part => {
            if (part.type !== 'image_url') return part
            const url = part.image_url?.url || ''
            const mime = url.match(/data:(image\/[^;]+);/)?.[1] || 'image'
            return { type: 'text', text: `[图片: ${mime} — 已在上文识别]` }
          })
        }
      }

      // 处理字符串中的 Markdown base64 图片
      if (typeof msg.content === 'string') {
        const DATA_URL_IMG = /!\[([^\]]*)\]\((data:image\/[^;]+;base64,[A-Za-z0-9+/=]+)\)/g
        return {
          ...msg,
          content: msg.content.replace(DATA_URL_IMG, '[图片: 已在上文识别]')
        }
      }

      return msg
    })
  }
}

export default LLMClient;
