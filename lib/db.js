/**
 * Database Access Layer
 * 基于 Sequelize ORM 的数据库访问层
 * 
 * 设计策略：渐进式迁移
 * - 保留原有的 query/execute/getOne 等基础方法（使用 Sequelize 的 raw query）
 * - 新增 Sequelize 模型访问入口
 * - 业务方法逐步迁移到使用 Sequelize 模型
 */

import { Sequelize, Op } from 'sequelize';
import logger from './logger.js';
import Utils from './utils.js';
import initModels from '../models/init-models.js';

class Database {
  constructor(config) {
    this.config = config;
    this.sequelize = null;
    this.models = null;
    this.Op = Op;  // 暴露 Op 给外部使用
  }

  /**
   * 初始化数据库连接（Sequelize）
   */
  async connect() {
    try {
      this.sequelize = new Sequelize(
        this.config.database,
        this.config.user,
        this.config.password,
        {
          host: this.config.host,
          port: this.config.port || 3306,
          dialect: 'mysql',
          logging: (msg) => logger.debug('[SQL]', msg),
          pool: {
            max: this.config.connectionLimit || 10,
            min: 0,
            acquire: 30000,
            idle: 10000,
          },
          define: {
            timestamps: true,
            underscored: true,
            createdAt: 'created_at',
            updatedAt: 'updated_at',
            freezeTableName: true,
          },
        }
      );

      // 测试连接
      await this.sequelize.authenticate();
      logger.info('Database connected successfully (Sequelize)');

      // 初始化模型
      this.models = initModels(this.sequelize);
      logger.info('Sequelize models initialized');

      return true;
    } catch (error) {
      logger.error('Database connection failed:', error.message);
      throw error;
    }
  }

  /**
   * 获取 Sequelize 模型
   * @param {string} modelName - 模型名称（如 'user', 'expert', 'message'）
   */
  getModel(modelName) {
    if (!this.models) {
      throw new Error('Database not connected. Call connect() first.');
    }
    return this.models[modelName];
  }

  // ============================================
  // 基础查询方法（使用 Sequelize raw query，保持向后兼容）
  // ============================================

  /**
   * 执行 SQL 查询
   * @param {string} sql - SQL 语句
   * @param {Array} params - 查询参数
   * @returns {Array} 查询结果
   */
  async query(sql, params = []) {
    try {
      // 当指定 QueryTypes.SELECT 时，Sequelize 直接返回结果数组
      const rows = await this.sequelize.query(sql, {
        replacements: params,
        type: Sequelize.QueryTypes.SELECT,
      });
      return rows;
    } catch (error) {
      logger.error('Query failed:', error.message, { sql: sql.substring(0, 200) });
      throw error;
    }
  }

  /**
   * 执行 INSERT 并返回插入的 ID
   */
  async insert(sql, params = []) {
    try {
      const [result] = await this.sequelize.query(sql, {
        replacements: params,
        type: Sequelize.QueryTypes.INSERT,
      });
      return result;
    } catch (error) {
      logger.error('Insert failed:', error.message);
      throw error;
    }
  }

  /**
   * 执行 UPDATE/DELETE 并返回影响的行数
   */
  async execute(sql, params = []) {
    try {
      const result = await this.sequelize.query(sql, {
        replacements: params,
        type: Sequelize.QueryTypes.UPDATE,
      });
      // Sequelize UPDATE 返回 [affectedCount]
      const affectedRows = Array.isArray(result) ? result[1] : result;
      return {
        affectedRows: affectedRows || 0,
        changedRows: affectedRows || 0,
      };
    } catch (error) {
      logger.error('Execute failed:', error.message);
      throw error;
    }
  }

  /**
   * 获取单个记录
   */
  async getOne(sql, params = []) {
    const rows = await this.query(sql, params);
    return rows[0] || null;
  }

  /**
   * 关闭连接
   */
  async close() {
    if (this.sequelize) {
      await this.sequelize.close();
      logger.info('Database connection closed');
    }
  }

  // ============================================
  // 专家相关操作（使用 Sequelize 模型）
  // ============================================

  /**
   * 获取专家配置
   */
  async getExpert(expertId) {
    return await this.models.expert.findOne({
      where: {
        id: expertId,
        is_active: true,
      },
      raw: true,
    });
  }

  /**
   * 获取专家完整配置（包含模型、技能）
   */
  async getExpertFullConfig(expertId) {
    // 1. 获取专家基本信息
    const expert = await this.getExpert(expertId);
    if (!expert) {
      throw new Error(`Expert not found: ${expertId}`);
    }

    // 2. 获取表达心智模型配置
    const expressiveModel = await this.getModelConfig(expert.expressive_model_id);

    // 3. 获取反思心智模型配置
    const reflectiveModel = await this.getModelConfig(expert.reflective_model_id);

    // 4. 获取专家技能（使用扁平化方法）
    const skills = await this.getExpertSkills(expertId);

    return {
      expert,
      expressiveModel,
      reflectiveModel,
      skills,
    };
  }

  // ============================================
  // 模型相关操作（使用 Sequelize 模型）
  // ============================================

  /**
   * 获取模型配置（包含 Provider 信息）
   * 返回扁平化结构，将 provider 的字段提取到顶层
   */
  async getModelConfig(modelId) {
    if (!modelId) return null;

    const model = await this.models.ai_model.findOne({
      where: {
        id: modelId,
        is_active: true,
      },
      include: [{
        model: this.models.provider,
        as: 'provider',
        where: { is_active: true },
        required: true,
        attributes: ['id', 'base_url', 'api_key', 'timeout', 'name'],
      }],
      raw: true,
      nest: true,
    });

    if (!model) return null;

    // 扁平化：将 provider 的字段提取到顶层
    return {
      ...model,
      base_url: model.provider?.base_url,
      api_key: model.provider?.api_key,
      timeout: model.provider?.timeout,
      provider_name: model.provider?.name,
    };
  }

  // ============================================
  // 用户相关操作（使用 Sequelize 模型）
  // ============================================

  /**
   * 根据 ID 获取用户
   */
  async getUserById(userId) {
    return await this.models.user.findOne({
      where: { id: userId },
      raw: true,
    });
  }

  /**
   * 创建用户
   */
  async createUser(userId, email = null, nickname = null) {
    await this.models.user.create({
      id: userId,
      email,
      nickname,
    });
    return await this.getUserById(userId);
  }

  /**
   * 获取或创建用户
   */
  async getOrCreateUser(userId, email = null, realName = null) {
    let user = await this.getUserById(userId);

    if (!user) {
      user = await this.createUser(userId, email, realName);
    }

    return user;
  }

  // ============================================
  // 用户档案相关操作（专家对用户的印象）
  // ============================================

  /**
   * 获取用户在特定专家面前的档案
   * 返回扁平化结构，将 user 的字段提取到顶层
   */
  async getUserProfile(expertId, userId) {
    const profile = await this.models.user_profile.findOne({
      where: {
        expert_id: expertId,
        user_id: userId,
      },
      include: [{
        model: this.models.user,
        as: 'user',
        attributes: ['email', 'nickname', 'gender', 'birthday', 'occupation', 'location'],
      }],
      raw: true,
      nest: true,
    });

    if (!profile) return null;

    // 扁平化：将 user 的字段提取到顶层
    return {
      ...profile,
      email: profile.user?.email,
      nickname: profile.user?.nickname,
      gender: profile.user?.gender,
      birthday: profile.user?.birthday,
      occupation: profile.user?.occupation,
      location: profile.user?.location,
    };
  }

  /**
   * 创建用户档案
   */
  async createUserProfile(expertId, userId, preferredName = null, introduction = null) {
    const now = new Date();
    const id = Utils.newID(20);
    await this.models.user_profile.create({
      id,
      expert_id: expertId,
      user_id: userId,
      preferred_name: preferredName,
      introduction,
      first_met: now,
      last_active: now,
    });
    return await this.getUserProfile(expertId, userId);
  }

  /**
   * 获取或创建用户档案
   */
  async getOrCreateUserProfile(expertId, userId, preferredName = null, introduction = null) {
    let profile = await this.getUserProfile(expertId, userId);

    if (!profile) {
      // 确保用户存在
      await this.getOrCreateUser(userId);
      profile = await this.createUserProfile(expertId, userId, preferredName, introduction);
    }

    return profile;
  }

  /**
   * 更新用户档案背景画像
   */
  async updateUserProfileBackground(expertId, userId, background) {
    return await this.models.user_profile.update(
      { background, updated_at: new Date() },
      {
        where: {
          expert_id: expertId,
          user_id: userId,
        },
      }
    );
  }

  /**
   * 更新用户档案笔记
   */
  async updateUserProfileNotes(expertId, userId, notes) {
    return await this.models.user_profile.update(
      { notes, updated_at: new Date() },
      {
        where: {
          expert_id: expertId,
          user_id: userId,
        },
      }
    );
  }

  /**
   * 更新用户档案最后活跃时间
   */
  async updateUserProfileLastActive(expertId, userId) {
    return await this.models.user_profile.update(
      { last_active: new Date() },
      {
        where: {
          expert_id: expertId,
          user_id: userId,
        },
      }
    );
  }

  /**
   * 更新用户档案中的称呼偏好
   */
  async updateUserProfilePreferredName(expertId, userId, preferredName) {
    return await this.models.user_profile.update(
      { preferred_name: preferredName, updated_at: new Date() },
      {
        where: {
          expert_id: expertId,
          user_id: userId,
        },
      }
    );
  }

  /**
   * 更新用户性别
   */
  async updateUserGender(userId, gender) {
    return await this.models.user.update(
      { gender, updated_at: new Date() },
      { where: { id: userId } }
    );
  }

  /**
   * 更新用户生日
   */
  async updateUserBirthday(userId, birthday) {
    return await this.models.user.update(
      { birthday, updated_at: new Date() },
      { where: { id: userId } }
    );
  }

  /**
   * 更新用户职业
   */
  async updateUserOccupation(userId, occupation) {
    return await this.models.user.update(
      { occupation, updated_at: new Date() },
      { where: { id: userId } }
    );
  }

  /**
   * 更新用户所在地
   */
  async updateUserLocation(userId, location) {
    return await this.models.user.update(
      { location, updated_at: new Date() },
      { where: { id: userId } }
    );
  }

  // ============================================
  // 消息相关操作（使用 Sequelize 模型）
  // ============================================

  /**
   * 获取未归档消息（topic_id IS NULL）
   * 用于上下文压缩前加载待压缩的消息
   * @param {string} expertId - 专家ID
   * @param {string} userId - 用户ID
   * @param {number|null} limit - 数量限制（null 表示不限制）
   * @returns {Promise<Array>} 未归档消息列表（按时间正序）
   */
  async getUnarchivedMessages(expertId, userId, limit = null) {
    const queryOptions = {
      where: {
        expert_id: expertId,
        user_id: userId,
        topic_id: null,  // 未归档
      },
      attributes: ['id', 'role', 'content', 'inner_voice', 'tool_calls', 'created_at'],
      order: [['created_at', 'ASC']],  // 正序，便于压缩处理
      raw: true,
    };
    
    // 只有指定了 limit 才添加限制
    if (limit !== null) {
      queryOptions.limit = limit;
    }
    
    return await this.models.message.findAll(queryOptions);
  }

  /**
   * 获取最近消息
   */
  async getRecentMessages(expertId, userId, limit = 20) {
    return await this.models.message.findAll({
      where: {
        expert_id: expertId,
        user_id: userId,
      },
      attributes: ['id', 'role', 'content', 'inner_voice', 'tool_calls', 'topic_id', 'created_at'],
      order: [['created_at', 'DESC']],
      limit,
      raw: true,
    });
  }

  /**
   * 获取时间范围内的消息
   */
  async getMessagesByTimeRange(expertId, userId, startTime, endTime) {
    return await this.models.message.findAll({
      where: {
        expert_id: expertId,
        user_id: userId,
        created_at: {
          [Op.between]: [startTime, endTime],
        },
      },
      attributes: ['id', 'role', 'content', 'inner_voice', 'tool_calls', 'topic_id', 'created_at'],
      order: [['created_at', 'ASC']],
      raw: true,
    });
  }

  /**
   * 获取消息数量
   */
  async getMessageCount(expertId, userId) {
    const count = await this.models.message.count({
      where: {
        expert_id: expertId,
        user_id: userId,
      },
    });
    return count;
  }

  /**
   * 获取带有 Inner Voice 的助手消息（用于反思心智）
   */
  async getMessagesWithInnerVoice(expertId, userId, limit = 3) {
    return await this.models.message.findAll({
      where: {
        expert_id: expertId,
        user_id: userId,
        role: 'assistant',
        inner_voice: { [Op.ne]: null },
      },
      attributes: ['id', 'content', 'inner_voice', 'created_at'],
      order: [['created_at', 'DESC']],
      limit,
      raw: true,
    });
  }

  /**
   * 更新消息的 topic_id
   */
  async updateMessageTopicId(messageIds, topicId) {
    if (!Array.isArray(messageIds) || messageIds.length === 0) return;

    return await this.models.message.update(
      { topic_id: topicId },
      {
        where: {
          id: { [Op.in]: messageIds },
        },
      }
    );
  }

  // ============================================
  // Topic 相关操作（使用 Sequelize 模型）
  // ============================================

  /**
   * 创建 Topic（对象参数版本）
   * @param {object} topicData - Topic 数据对象
   */
  async createTopic(topicData) {
    const {
      id, expertId, userId, name, description,
      category, startTime, endTime
    } = topicData;

    return await this.models.topic.create({
      id,
      expert_id: expertId,
      user_id: userId,
      title: name,
      description,
      category,
    });
  }

  /**
   * 获取用户的 Topics（支持不同签名）
   */
  async getTopicsByExpertAndUser(expertId, userId, limit = 10) {
    return await this.models.topic.findAll({
      where: {
        expert_id: expertId,
        user_id: userId,
      },
      attributes: ['id', 'expert_id', 'user_id', 'title', 'description', 'category', 'status', 'message_count', 'created_at', 'updated_at'],
      order: [['updated_at', 'DESC']],
      limit,
      raw: true,
    });
  }

  /**
   * 获取用户的 Topics（兼容旧签名）
   */
  async getTopics(expertId, userId, limit = 5) {
    return await this.getTopicsByExpertAndUser(expertId, userId, limit);
  }

  /**
   * 将时间范围内的消息关联到 Topic
   */
  async assignMessagesToTopic(expertId, userId, topicId, startTime, endTime) {
    return await this.models.message.update(
      { topic_id: topicId },
      {
        where: {
          expert_id: expertId,
          user_id: userId,
          created_at: { [Op.between]: [startTime, endTime] },
        },
      }
    );
  }

  /**
   * 更新 Topic 的消息数量
   */
  async updateTopicMessageCount(topicId) {
    const count = await this.models.message.count({
      where: { topic_id: topicId },
    });
    return await this.models.topic.update(
      { message_count: count },
      { where: { id: topicId } }
    );
  }

  /**
   * 更新 Topic 信息（标题、描述等）
   * @param {string} topicId - Topic ID
   * @param {object} data - 更新数据 { title, description, status, ... }
   */
  async updateTopic(topicId, data) {
    return await this.models.topic.update(
      { ...data, updated_at: new Date() },
      { where: { id: topicId } }
    );
  }

  // ============================================
  // 技能相关操作（使用 Sequelize 模型）
  // ============================================

  /**
   * 获取技能详情
   */
  async getSkill(skillId) {
    return await this.models.skill.findOne({
      where: {
        id: skillId,
        is_active: true,
      },
      raw: true,
    });
  }

  /**
   * 获取专家启用的所有技能
   * 返回扁平化结构，将 skill 的字段提取到顶层
   */
  async getExpertSkills(expertId) {
    const skills = await this.models.expert_skill.findAll({
      where: {
        expert_id: expertId,
        is_enabled: true,
      },
      include: [{
        model: this.models.skill,
        as: 'skill',
        where: { is_active: true },
        required: true,
      }],
      raw: true,
      nest: true,
    });

    // 扁平化：将 skill 的字段提取到顶层
    return skills.map(skill => ({
      ...skill,
      // skill 表的字段
      id: skill.skill?.id || skill.skill_id,
      name: skill.skill?.name,
      description: skill.skill?.description,
      source_type: skill.skill?.source_type,
      source_path: skill.skill?.source_path,
      skill_md: skill.skill?.skill_md,
      updated_at: skill.skill?.updated_at,  // 添加 updated_at 用于缓存键
    }));
  }

  /**
   * 启用/禁用专家技能
   */
  async toggleExpertSkill(expertId, skillId, enabled) {
    return await this.models.expert_skill.update(
      { is_enabled: enabled },
      {
        where: {
          expert_id: expertId,
          skill_id: skillId,
        },
      }
    );
  }

  /**
   * 获取所有技能（包含与专家的关联状态）
   * 用于专家技能配置界面
   */
  async getAllSkillsWithExpertStatus(expertId) {
    const { Op } = this.db || this;

    // 1. 获取所有可用技能
    const allSkills = await this.models.skill.findAll({
      where: { is_active: true },
      attributes: ['id', 'name', 'description', 'source_type', 'source_path', 'created_at'],
      order: [['created_at', 'DESC']],
      raw: true,
    });

    // 2. 获取该专家已启用的技能 ID 列表
    const expertSkills = await this.models.expert_skill.findAll({
      where: {
        expert_id: expertId,
        is_enabled: true,
      },
      attributes: ['skill_id', 'config'],
      raw: true,
    });

    const enabledSkillIds = new Set(expertSkills.map(es => es.skill_id));
    const skillConfigMap = new Map(expertSkills.map(es => [es.skill_id, es.config]));

    // 3. 合并数据，标记内置技能
    return allSkills.map(skill => {
      const isBuiltin = skill.source_type === 'builtin' ||
        (skill.source_path && skill.source_path.includes('builtin'));

      return {
        ...skill,
        is_builtin: isBuiltin,
        is_enabled: enabledSkillIds.has(skill.id),
        expert_config: skillConfigMap.get(skill.id) || null,
      };
    });
  }

  /**
   * 批量更新专家技能关联
   * skillConfigs: [{ skill_id, is_enabled, config? }]
   */
  async batchUpdateExpertSkills(expertId, skillConfigs) {
    const results = [];

    for (const config of skillConfigs) {
      const { skill_id, is_enabled, config: skillConfig } = config;

      // 检查关联是否存在
      const existing = await this.models.expert_skill.findOne({
        where: {
          expert_id: expertId,
          skill_id,
        },
        raw: true,
      });

      if (existing) {
        // 更新现有关联
        await this.models.expert_skill.update(
          {
            is_enabled,
            config: skillConfig !== undefined ? skillConfig : existing.config,
          },
          {
            where: { id: existing.id },
          }
        );
      } else if (is_enabled) {
        // 创建新关联（只在启用时创建）
        const id = Utils.newID(20);
        await this.models.expert_skill.create({
          id,
          expert_id: expertId,
          skill_id,
          is_enabled: true,
          config: skillConfig || null,
        });
      }

      results.push({ skill_id, is_enabled });
    }

    return results;
  }
}

export default Database;
