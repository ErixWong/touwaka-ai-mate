/**
 * Psyche Model - Psyche 数据模型
 * 定义 Psyche 的 6 大模块结构和相关操作
 */

/**
 * Psyche 数据模型类
 * 包含 6 大模块：
 * 1. session_meta - 会话元数据
 * 2. methodology - 方法论
 * 3. conversation_digest - 对话摘要
 * 4. notes_refs - 笔记引用
 * 5. topics_context - 主题上下文
 * 6. working_memory - 工作记忆
 */
export class PsycheModel {
  constructor(data = {}) {
    this.session_meta = data.session_meta || this._createEmptySessionMeta();
    this.methodology = data.methodology || this._createEmptyMethodology();
    this.conversation_digest = data.conversation_digest || this._createEmptyConversationDigest();
    this.notes_refs = data.notes_refs || [];
    this.topics_context = data.topics_context || [];
    this.working_memory = data.working_memory || this._createEmptyWorkingMemory();
  }

  _createEmptySessionMeta() {
    return {
      current_topic: null,
      user_intent: null,
      conversation_round: 0,
      last_updated: new Date().toISOString()
    };
  }

  _createEmptyMethodology() {
    return {
      approach: null,
      current_phase: 'init',
      next_action: null
    };
  }

  _createEmptyConversationDigest() {
    return {
      key_exchanges: [],
      key_decisions: [],
      pending_questions: []
    };
  }

  _createEmptyWorkingMemory() {
    return {
      calculated_values: {},
      temp_notes: null
    };
  }

  /**
   * 更新会话元数据
   */
  updateSessionMeta(updates) {
    this.session_meta = {
      ...this.session_meta,
      ...updates,
      last_updated: new Date().toISOString()
    };
  }

  /**
   * 更新方法论
   */
  updateMethodology(updates) {
    this.methodology = { ...this.methodology, ...updates };
  }

  /**
   * 添加关键对话记录
   */
  addKeyExchange(round, summary) {
    this.conversation_digest.key_exchanges.push({ round, summary });
    // 只保留最近 10 条
    if (this.conversation_digest.key_exchanges.length > 10) {
      this.conversation_digest.key_exchanges.shift();
    }
  }

  /**
   * 添加关键决策
   */
  addKeyDecision(decision) {
    if (!this.conversation_digest.key_decisions.includes(decision)) {
      this.conversation_digest.key_decisions.push(decision);
    }
  }

  /**
   * 添加待确认问题
   */
  addPendingQuestion(question) {
    if (!this.conversation_digest.pending_questions.includes(question)) {
      this.conversation_digest.pending_questions.push(question);
    }
  }

  /**
   * 移除已确认的待确认问题
   */
  removePendingQuestion(question) {
    this.conversation_digest.pending_questions = 
      this.conversation_digest.pending_questions.filter(q => q !== question);
  }

  /**
   * 添加笔记引用
   */
  addNoteRef(id, summary, relevance = 0.5) {
    const existingIndex = this.notes_refs.findIndex(ref => ref.id === id);
    if (existingIndex >= 0) {
      this.notes_refs[existingIndex] = { id, summary, relevance };
    } else {
      this.notes_refs.push({ id, summary, relevance });
    }
    // 按相关性排序
    this.notes_refs.sort((a, b) => b.relevance - a.relevance);
  }

  /**
   * 移除笔记引用
   */
  removeNoteRef(id) {
    this.notes_refs = this.notes_refs.filter(ref => ref.id !== id);
  }

  /**
   * 添加主题上下文
   */
  addTopicContext(topicId, title, relevance = 0.5) {
    const existingIndex = this.topics_context.findIndex(t => t.topic_id === topicId);
    if (existingIndex >= 0) {
      this.topics_context[existingIndex] = { topic_id: topicId, title, relevance };
    } else {
      this.topics_context.push({ topic_id: topicId, title, relevance });
    }
    // 按相关性排序，只保留前 5 个
    this.topics_context.sort((a, b) => b.relevance - a.relevance);
    if (this.topics_context.length > 5) {
      this.topics_context = this.topics_context.slice(0, 5);
    }
  }

  /**
   * 设置工作记忆值
   */
  setWorkingMemoryValue(key, value) {
    this.working_memory.calculated_values[key] = value;
  }

  /**
   * 设置临时笔记
   */
  setTempNotes(notes) {
    this.working_memory.temp_notes = notes;
  }

  /**
   * 清除临时笔记
   */
  clearTempNotes() {
    this.working_memory.temp_notes = null;
  }

  /**
   * 增加对话轮次
   */
  incrementRound() {
    this.session_meta.conversation_round++;
    this.session_meta.last_updated = new Date().toISOString();
  }

  /**
   * 转换为 JSON 格式（用于存储）
   */
  toJSON() {
    return {
      session_meta: this.session_meta,
      methodology: this.methodology,
      conversation_digest: this.conversation_digest,
      notes_refs: this.notes_refs,
      topics_context: this.topics_context,
      working_memory: this.working_memory
    };
  }

  /**
   * 转换为文本格式（用于注入 System Prompt）
   */
  toText() {
    const parts = ['【心神】'];

    // 当前主题
    if (this.session_meta.current_topic) {
      parts.push(`当前主题：${this.session_meta.current_topic}`);
    }

    // 工作阶段
    if (this.methodology.current_phase) {
      const phaseMap = {
        'init': '初始化阶段',
        'clarification': '需求澄清阶段',
        'execution': '执行阶段',
        'review': '审查阶段',
        'complete': '完成阶段'
      };
      parts.push(`工作阶段：${phaseMap[this.methodology.current_phase] || this.methodology.current_phase}`);
    }

    // 关键决策
    if (this.conversation_digest.key_decisions.length > 0) {
      parts.push('\n关键决策：');
      this.conversation_digest.key_decisions.forEach(d => {
        parts.push(`- ${d}`);
      });
    }

    // 待确认问题
    if (this.conversation_digest.pending_questions.length > 0) {
      parts.push('\n待确认问题：');
      this.conversation_digest.pending_questions.forEach(q => {
        parts.push(`- ${q}`);
      });
    }

    // 可用笔记
    if (this.notes_refs.length > 0) {
      parts.push('\n可用笔记（通过 notes.read 获取）：');
      this.notes_refs.forEach(ref => {
        parts.push(`- notes:${ref.id} → ${ref.summary}`);
      });
    }

    // 工作记忆
    if (this.working_memory.temp_notes) {
      parts.push(`\n临时笔记：${this.working_memory.temp_notes}`);
    }

    if (Object.keys(this.working_memory.calculated_values).length > 0) {
      parts.push('\n计算值：');
      Object.entries(this.working_memory.calculated_values).forEach(([k, v]) => {
        parts.push(`- ${k}: ${v}`);
      });
    }

    return parts.join('\n');
  }

  /**
   * 估算 token 数量（粗略估计）
   */
  estimateTokens() {
    const text = this.toText();
    // 粗略估计：1 token ≈ 4 个字符（中文）或 1 个单词（英文）
    return Math.ceil(text.length / 4);
  }

  /**
   * 从 JSON 数据创建实例
   */
  static fromJSON(data) {
    return new PsycheModel(data);
  }

  /**
   * 创建空 Psyche
   */
  static createEmpty() {
    return new PsycheModel();
  }
}

export default PsycheModel;  
