/**
 * Topic Archiver Task - Topic 自动归档后台任务
 *
 * 作为 BackgroundTaskScheduler 的任务处理器
 * 定期扫描所有 active 状态的 Topic，执行归档处理
 *
 * 归档策略：
 * - 每个用户保留最新的 N 个 Topic（默认 2 个）
 * - 其余的 Topic 进行归档处理
 *
 * 归档处理（质量检查）：
 * - 检查 topic name 是否正确
 * - 检查总结是否完整
 * - 检查是否需要拆分成多个 topic
 */

import logger from './logger.js';
import LLMClient from './llm-client.js';
import ConfigLoader from './config-loader.js';

/**
 * 创建 Topic 归档任务处理器
 * @param {Object} options 配置选项
 * @param {number} options.batchSize 每批处理的 Topic 数量（默认 5）
 * @param {number} options.keepActivePerUser 每个用户保留的活跃 Topic 数量（默认 2）
 * @returns {Function} 任务处理函数
 */
export function createTopicArchiverTask(options = {}) {
  const batchSize = options.batchSize || 5;
  const keepActivePerUser = options.keepActivePerUser || 2;

  // 缓存模型引用
  let models = null;
  let llmClient = null;

  /**
   * 确保模型已初始化
   */
  function ensureModels(db) {
    if (!models) {
      models = {
        Topic: db.getModel('topic'),
        Message: db.getModel('message'),
        Expert: db.getModel('expert'),
      };
    }
    return models;
  }

  /**
   * 获取 LLM 客户端（用于归档分析）
   */
  async function getLLMClient(db, expertId) {
    if (!llmClient) {
      const configLoader = new ConfigLoader(db);
      llmClient = new LLMClient(configLoader, expertId);
      await llmClient.loadConfig();
    }
    return llmClient;
  }

  /**
   * 获取 Topic 的消息
   */
  async function getTopicMessages(topicId, limit = 100) {
    const messages = await models.Message.findAll({
      where: { topic_id: topicId },
      attributes: ['id', 'role', 'content', 'created_at'],
      order: [['created_at', 'ASC']],
      limit,
      raw: true,
    });
    return messages;
  }

  /**
   * 分析并优化 Topic（归档前的质量检查）
   * @param {object} topic - Topic 对象
   * @param {array} messages - Topic 的消息列表
   * @param {object} llmClient - LLM 客户端
   * @returns {Promise<object>} 分析结果
   */
  async function analyzeTopic(topic, messages, llmClient) {
    // 如果消息太少，直接返回
    if (messages.length < 3) {
      return {
        needsUpdate: false,
        reason: '消息数量不足，无需优化',
      };
    }

    // 构建对话文本
    const conversationText = messages
      .map((m, i) => `[${i}] ${m.role}: ${m.content}`)
      .join('\n')
      .slice(0, 8000); // 限制长度

    const prompt = `请分析以下对话记录，评估话题总结的质量。

## 当前话题信息
- 标题：${topic.title}
- 描述：${topic.description || '暂无描述'}
- 消息数：${messages.length}

## 对话内容
${conversationText}

## 评估任务

请评估以下方面：

1. **标题准确性**：标题是否准确概括了对话主题？
2. **描述完整性**：描述是否涵盖了主要讨论内容？
3. **是否需要拆分**：对话中是否包含多个独立话题，需要拆分成多个 Topic？

## 返回格式（JSON）
{
  "titleAccuracy": {
    "score": 1-10,
    "reason": "评分理由",
    "suggestedTitle": "建议的新标题（如果需要修改）"
  },
  "descriptionCompleteness": {
    "score": 1-10,
    "reason": "评分理由",
    "suggestedDescription": "建议的新描述（如果需要修改）"
  },
  "splitSuggestion": {
    "needsSplit": true/false,
    "reason": "拆分理由",
    "topics": [
      {
        "title": "拆分后的标题",
        "description": "拆分后的描述",
        "startIndex": 消息起始索引,
        "endIndex": 消息结束索引
      }
    ]
  },
  "overallAssessment": "整体评估和建议"
}`;

    try {
      const response = await llmClient.callReflective([
        { role: 'system', content: '你是一个对话分析助手，负责评估话题总结的质量并提供改进建议。' },
        { role: 'user', content: prompt },
      ], { temperature: 0.3 });

      // 解析 JSON
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      logger.error(`[TopicArchiver] 分析话题失败: ${topic.id}`, error.message);
    }

    return {
      needsUpdate: false,
      reason: '分析失败，保持原状',
    };
  }

  /**
   * 处理单个 Topic 的归档
   */
  async function processTopicArchive(topic, db) {
    logger.info(`[TopicArchiver] 开始归档处理: ${topic.id} "${topic.title}"`);

    try {
      // 1. 获取消息
      const messages = await getTopicMessages(topic.id);
      
      if (messages.length === 0) {
        // 没有消息的 Topic 直接归档
        await models.Topic.update(
          { status: 'archived', updated_at: new Date() },
          { where: { id: topic.id } }
        );
        logger.info(`[TopicArchiver] 空话题已归档: ${topic.id}`);
        return { archived: true, reason: '空话题' };
      }

      // 2. 获取 LLM 客户端
      const client = await getLLMClient(db, topic.expert_id);

      // 3. 分析话题质量
      const analysis = await analyzeTopic(topic, messages, client);

      // 4. 根据分析结果处理
      let updated = false;

      // 4.1 更新标题（如果需要）
      if (analysis.titleAccuracy?.score < 7 && analysis.titleAccuracy?.suggestedTitle) {
        await models.Topic.update(
          { title: analysis.titleAccuracy.suggestedTitle },
          { where: { id: topic.id } }
        );
        logger.info(`[TopicArchiver] 标题已更新: ${topic.id} -> "${analysis.titleAccuracy.suggestedTitle}"`);
        updated = true;
      }

      // 4.2 更新描述（如果需要）
      if (analysis.descriptionCompleteness?.score < 7 && analysis.descriptionCompleteness?.suggestedDescription) {
        await models.Topic.update(
          { description: analysis.descriptionCompleteness.suggestedDescription },
          { where: { id: topic.id } }
        );
        logger.info(`[TopicArchiver] 描述已更新: ${topic.id}`);
        updated = true;
      }

      // 4.3 处理拆分（如果需要）
      if (analysis.splitSuggestion?.needsSplit && analysis.splitSuggestion?.topics?.length > 1) {
        logger.info(`[TopicArchiver] 话题需要拆分为 ${analysis.splitSuggestion.topics.length} 个话题`);
        
        // TODO: 实现拆分逻辑
        // 这需要创建新 Topic 并重新分配消息
        // 暂时记录日志，后续实现
        logger.warn(`[TopicArchiver] 话题拆分功能待实现: ${topic.id}`);
      }

      // 5. 标记为归档状态
      await models.Topic.update(
        { status: 'archived', updated_at: new Date() },
        { where: { id: topic.id } }
      );

      logger.info(`[TopicArchiver] 话题已归档: ${topic.id} "${topic.title}"`);
      return { archived: true, updated, analysis };

    } catch (error) {
      logger.error(`[TopicArchiver] 归档处理失败: ${topic.id}`, error.message);
      return { archived: false, error: error.message };
    }
  }

  return async function topicArchiverTaskHandler(db) {
    ensureModels(db);

    console.log('[TopicArchiver] 🔍 Checking for topics to archive...');
    logger.info('[TopicArchiver] Checking for topics to archive...');

    try {
      // 1. 查询所有 active 状态的 Topic，按 updated_at 降序（最新的在前）
      const activeTopics = await models.Topic.findAll({
        where: {
          status: 'active',
        },
        attributes: ['id', 'expert_id', 'user_id', 'title', 'description', 'message_count', 'updated_at', 'created_at'],
        order: [['updated_at', 'DESC']],
        limit: 200, // 每次最多检查 200 个
        raw: true,
      });

      if (activeTopics.length === 0) {
        console.log('[TopicArchiver] ✅ No active topics found');
        return;
      }

      console.log(`[TopicArchiver] 📝 Found ${activeTopics.length} active topics`);

      // 2. 按 (expert_id, user_id) 分组
      const topicsByUser = new Map();
      for (const topic of activeTopics) {
        const key = `${topic.expert_id}:${topic.user_id}`;
        if (!topicsByUser.has(key)) {
          topicsByUser.set(key, []);
        }
        topicsByUser.get(key).push(topic);
      }

      // 3. 对每个用户的 Topic 进行处理
      let archivedCount = 0;
      let updatedCount = 0;

      for (const [userKey, topics] of topicsByUser) {
        // topics 已按 updated_at 降序排序（最新的在前）
        // 保留最近的 N 个 Topic，其余归档
        const topicsToArchive = topics.slice(keepActivePerUser);

        if (topicsToArchive.length === 0) {
          continue;
        }

        // 处理每个需要归档的 Topic
        for (const topic of topicsToArchive) {
          const result = await processTopicArchive(topic, db);
          
          if (result.archived) {
            archivedCount++;
            if (result.updated) {
              updatedCount++;
            }
          }

          // 控制每次处理的数量
          if (archivedCount >= batchSize) {
            console.log(`[TopicArchiver] ⏸️ Reached batch size limit (${batchSize}), will continue next run`);
            break;
          }
        }

        // 外层也要检查
        if (archivedCount >= batchSize) {
          break;
        }
      }

      if (archivedCount > 0) {
        console.log(`[TopicArchiver] ✅ Archived ${archivedCount} topics, ${updatedCount} were updated`);
        logger.info(`[TopicArchiver] Completed: archived ${archivedCount} topics, ${updatedCount} updated`);
      } else {
        console.log('[TopicArchiver] ✅ No topics needed archiving');
        logger.info('[TopicArchiver] No topics needed archiving');
      }

    } catch (error) {
      console.error('[TopicArchiver] ❌ Error in topic archiver task:', error.message);
      logger.error('[TopicArchiver] Error in topic archiver task:', error);
    }
  };
}

/**
 * 手动归档指定 Topic
 * @param {Database} db - 数据库实例
 * @param {string} topicId - Topic ID
 * @returns {Promise<boolean>} 是否成功归档
 */
export async function archiveTopicById(db, topicId) {
  const Topic = db.getModel('topic');

  const topic = await Topic.findOne({
    where: { id: topicId },
    raw: true,
  });

  if (!topic) {
    logger.warn(`[TopicArchiver] Topic not found: ${topicId}`);
    return false;
  }

  if (topic.status === 'archived') {
    logger.info(`[TopicArchiver] Topic ${topicId} is already archived`);
    return true;
  }

  await Topic.update(
    { status: 'archived', updated_at: new Date() },
    { where: { id: topicId } }
  );

  logger.info(`[TopicArchiver] Manually archived topic ${topicId}: "${topic.title}"`);
  return true;
}

/**
 * 获取归档统计信息
 * @param {Database} db - 数据库实例
 * @returns {Promise<Object>} 统计信息
 */
export async function getTopicArchiveStats(db) {
  const Topic = db.getModel('topic');

  const stats = await Topic.findAll({
    attributes: [
      'status',
      [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'count'],
    ],
    group: ['status'],
    raw: true,
  });

  const result = {
    active: 0,
    archived: 0,
    deleted: 0,
  };

  for (const stat of stats) {
    if (stat.status in result) {
      result[stat.status] = parseInt(stat.count) || 0;
    }
  }

  return result;
}

export default {
  createTopicArchiverTask,
  archiveTopicById,
  getTopicArchiveStats,
};