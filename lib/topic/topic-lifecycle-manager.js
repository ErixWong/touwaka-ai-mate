/**
 * Topic Lifecycle Manager - 话题生命周期管理器（Phase 4 WP-3）
 *
 * 统一 topic 行为为事件驱动状态机：
 * - TOPIC_CREATED  — 新话题创建
 * - TOPIC_REUSED   — 继续当前话题
 * - TOPIC_SWITCHED — 话题切换（旧归档+新创建）
 * - TOPIC_ARCHIVED — 话题归档
 */

import logger from '../logger.js';

export const TOPIC_EVENTS = {
  CREATED: 'TOPIC_CREATED',
  REUSED: 'TOPIC_REUSED',
  SWITCHED: 'TOPIC_SWITCHED',
  ARCHIVED: 'TOPIC_ARCHIVED',
};

export class TopicLifecycleManager {
  constructor(db, expertId) {
    this.db = db;
    this.expertId = expertId;
    this.Topic = db.getModel('topic');
  }

  /**
   * 创建新话题
   */
  async createTopic({
    id,
    userId,
    expertId,
    title,
    description,
    category,
    taskId,
    traceId,
    keywords = null,
    status = 'active',
    startTime = null,
    endTime = null,
    messageCount = 0,
  }) {
    const now = new Date();
    const normalizedKeywords = Array.isArray(keywords)
      ? JSON.stringify(keywords)
      : (keywords || null);

    await this.Topic.create({
      id,
      user_id: userId,
      expert_id: expertId || this.expertId,
      task_id: taskId || null,
      title: title || `新对话 ${now.toLocaleString('zh-CN')}`,
      description: description || null,
      category: category || 'general',
      keywords: normalizedKeywords,
      status,
      start_time: startTime || now,
      end_time: endTime || null,
      message_count: messageCount,
    });

    this._audit(TOPIC_EVENTS.CREATED, id, 'none', status, title, traceId);
    return id;
  }

  /**
   * 复用当前话题
   */
  reuseTopic(topicId, reason, traceId) {
    this._audit(TOPIC_EVENTS.REUSED, topicId, 'active', 'active', reason, traceId);
    return topicId;
  }

  /**
   * 话题切换：归档旧话题 + 创建新话题
   */
  async switchTopic({ fromTopicId, toTopicId, reason, suggestedTitle, traceId }) {
    // 归档旧话题
    await this.Topic.update(
      { status: 'archived', end_time: new Date() },
      { where: { id: fromTopicId } }
    );

    this._audit(TOPIC_EVENTS.SWITCHED, toTopicId, 'active', 'active', `${reason} → "${suggestedTitle}"`, traceId);
    return toTopicId;
  }

  /**
   * 归档话题
   */
  async archiveTopic(topicId, reason, traceId) {
    await this.Topic.update(
      { status: 'archived', end_time: new Date() },
      { where: { id: topicId } }
    );

    this._audit(TOPIC_EVENTS.ARCHIVED, topicId, 'active', 'archived', reason, traceId);
  }

  /**
   * 获取当前活跃话题（支持 task 隔离）
   */
  async getActiveTopic(userId, expertId, taskId = null) {
    const where = { user_id: userId, expert_id: expertId || this.expertId, status: 'active' };
    if (taskId) where.task_id = taskId;

    return await this.Topic.findOne({
      where,
      order: [['updated_at', 'DESC']],
      raw: true,
    });
  }

  /**
   * 结构化审计日志
   */
  _audit(event, topicId, fromStatus, toStatus, reason, traceId) {
    logger.info(JSON.stringify({
      event,
      topic_id: topicId,
      from_status: fromStatus,
      to_status: toStatus,
      reason: reason || '',
      trace_id: traceId || '',
      expert_id: this.expertId,
      timestamp: new Date().toISOString(),
    }));
  }
}

export default TopicLifecycleManager;
