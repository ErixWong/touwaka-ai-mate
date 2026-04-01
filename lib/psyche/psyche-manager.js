/**
 * Psyche Manager - Psyche 管理器
 * 负责 Psyche 的获取、保存、压缩和转换
 */

import { PsycheModel } from './psyche-model.js';
import logger from '../logger.js';

/**
 * Psyche 管理器类
 * 封装 Psyche 的所有操作，包括存储交互
 */
export class PsycheManager {
  constructor(psycheStore, notesStore, config = {}) {
    this.psycheStore = psycheStore;
    this.notesStore = notesStore;
    this.config = {
      maxTokensRatio: 0.3,      // Psyche 占上下文最大比例
      warningThreshold: 0.8,     // 警告阈值（80%）
      maxNotesRefs: 10,          // 最大笔记引用数
      maxTopicsContext: 3,       // 最大主题上下文数
      ...config
    };
  }

  /**
   * 获取或创建 Psyche
   */
  async getOrCreate(userId, expertId) {
    const data = await this.psycheStore.get(userId, expertId);
    if (data) {
      logger.debug(`[PsycheManager] 获取现有 Psyche: ${userId}:${expertId}`);
      return PsycheModel.fromJSON(data);
    }
    logger.debug(`[PsycheManager] 创建新 Psyche: ${userId}:${expertId}`);
    return PsycheModel.createEmpty();
  }

  /**
   * 保存 Psyche
   */
  async save(userId, expertId, psyche, ttl = 3600) {
    await this.psycheStore.set(userId, expertId, psyche.toJSON(), ttl);
    logger.debug(`[PsycheManager] 保存 Psyche: ${userId}:${expertId}`);
  }

  /**
   * 删除 Psyche
   */
  async delete(userId, expertId) {
    await this.psycheStore.delete(userId, expertId);
    logger.debug(`[PsycheManager] 删除 Psyche: ${userId}:${expertId}`);
  }

  /**
   * 检查 Psyche 是否存在
   */
  async exists(userId, expertId) {
    return await this.psycheStore.exists(userId, expertId);
  }

  /**
   * 压缩 Psyche（当大小超过限制时）
   * 按优先级压缩：
   * 1. working_memory.temp_notes → 转为 Notes
   * 2. conversation_digest → 进一步摘要
   * 3. notes_refs → 删除低相关性引用
   * 4. topics_context → 只保留最相关的
   */
  async compress(psyche, maxTokens, userId, expertId) {
    const currentTokens = psyche.estimateTokens();
    const warningTokens = maxTokens * this.config.warningThreshold;

    if (currentTokens < warningTokens) {
      return psyche; // 不需要压缩
    }

    logger.info(`[PsycheManager] 开始压缩 Psyche: ${currentTokens} tokens`);

    // 1. 将 working_memory.temp_notes 转为 Notes
    if (psyche.working_memory.temp_notes) {
      const noteKey = `wm_${Date.now()}`;
      await this.notesStore.take(userId, expertId, noteKey, {
        content: psyche.working_memory.temp_notes,
        type: 'working_memory',
        relevance: 0.9
      });
      psyche.addNoteRef(noteKey, '工作记忆临时笔记', 0.9);
      psyche.clearTempNotes();
      logger.debug(`[PsycheManager] 临时笔记转为 Notes: ${noteKey}`);
    }

    // 2. 如果还超，删除低相关性 notes_refs
    if (psyche.estimateTokens() > maxTokens) {
      const beforeCount = psyche.notes_refs.length;
      psyche.notes_refs = psyche.notes_refs
        .filter(ref => ref.relevance > 0.5)
        .slice(0, this.config.maxNotesRefs);
      logger.debug(`[PsycheManager] 清理 notes_refs: ${beforeCount} → ${psyche.notes_refs.length}`);
    }

    // 3. 如果还超，限制 topics_context
    if (psyche.estimateTokens() > maxTokens) {
      const beforeCount = psyche.topics_context.length;
      psyche.topics_context = psyche.topics_context.slice(0, this.config.maxTopicsContext);
      logger.debug(`[PsycheManager] 清理 topics_context: ${beforeCount} → ${psyche.topics_context.length}`);
    }

    // 4. 如果还超，简化 conversation_digest
    if (psyche.estimateTokens() > maxTokens) {
      const beforeCount = psyche.conversation_digest.key_exchanges.length;
      // 只保留最近 3 条关键对话
      if (psyche.conversation_digest.key_exchanges.length > 3) {
        psyche.conversation_digest.key_exchanges = 
          psyche.conversation_digest.key_exchanges.slice(-3);
      }
      logger.debug(`[PsycheManager] 简化 conversation_digest: ${beforeCount} → ${psyche.conversation_digest.key_exchanges.length}`);
    }

    const finalTokens = psyche.estimateTokens();
    logger.info(`[PsycheManager] 压缩完成: ${currentTokens} → ${finalTokens} tokens`);

    return psyche;
  }

  /**
   * 将 Psyche 转换为文本格式（用于 System Prompt）
   */
  formatForPrompt(psyche) {
    return psyche.toText();
  }

  /**
   * 将 Psyche 转换为 JSON 格式（用于存储）
   */
  formatForStorage(psyche) {
    return psyche.toJSON();
  }

  /**
   * 更新 Psyche 从反思结果
   */
  updateFromReflection(psyche, reflection) {
    // 更新会话元数据
    if (reflection.session_meta) {
      psyche.updateSessionMeta(reflection.session_meta);
    }

    // 更新方法论
    if (reflection.methodology) {
      psyche.updateMethodology(reflection.methodology);
    }

    // 添加关键对话
    if (reflection.key_exchange) {
      psyche.addKeyExchange(
        reflection.key_exchange.round,
        reflection.key_exchange.summary
      );
    }

    // 添加关键决策
    if (reflection.key_decisions) {
      reflection.key_decisions.forEach(d => psyche.addKeyDecision(d));
    }

    // 添加待确认问题
    if (reflection.pending_questions) {
      reflection.pending_questions.forEach(q => psyche.addPendingQuestion(q));
    }

    // 添加工具调用摘要到工作记忆
    if (reflection.tool_summary && reflection.tool_summary.length > 0) {
      const toolNotes = reflection.tool_summary.map(t =>
        `${t.tool}: ${t.action} - ${t.result}`
      ).join('\n');
      psyche.setTempNotes(toolNotes);
    }

    // 添加笔记引用
    if (reflection.notes_refs) {
      reflection.notes_refs.forEach(ref => {
        psyche.addNoteRef(ref.id, ref.summary, ref.relevance);
      });
    }

    // 添加主题上下文
    if (reflection.topics_context) {
      reflection.topics_context.forEach(t => {
        psyche.addTopicContext(t.topic_id, t.title, t.relevance);
      });
    }

    // 更新工作记忆
    if (reflection.working_memory) {
      if (reflection.working_memory.calculated_values) {
        Object.entries(reflection.working_memory.calculated_values).forEach(([k, v]) => {
          psyche.setWorkingMemoryValue(k, v);
        });
      }
      // 如果有新的临时笔记，追加而不是覆盖
      if (reflection.working_memory.temp_notes) {
        const existingNotes = psyche.working_memory.temp_notes || '';
        const newNotes = existingNotes
          ? `${existingNotes}\n${reflection.working_memory.temp_notes}`
          : reflection.working_memory.temp_notes;
        psyche.setTempNotes(newNotes);
      }
    }

    // 增加对话轮次
    psyche.incrementRound();

    return psyche;
  }

  /**
   * 获取 Psyche 统计信息
   */
  getStats(psyche) {
    return {
      tokens: psyche.estimateTokens(),
      session_round: psyche.session_meta.conversation_round,
      notes_count: psyche.notes_refs.length,
      topics_count: psyche.topics_context.length,
      key_decisions_count: psyche.conversation_digest.key_decisions.length,
      pending_questions_count: psyche.conversation_digest.pending_questions.length,
      has_temp_notes: !!psyche.working_memory.temp_notes,
      calculated_values_count: Object.keys(psyche.working_memory.calculated_values).length
    };
  }
}

export default PsycheManager;  
