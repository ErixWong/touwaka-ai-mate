/**
 * 基础测试脚本
 * 用于验证数据库连接和配置加载
 */

import path from 'path';
import { fileURLToPath } from 'url';

// 确保加载环境变量
import dotenv from 'dotenv';
dotenv.config();

import Database from '../lib/db.js';
import ConfigLoader from '../lib/config-loader.js';
import LLMClient from '../lib/llm-client.js';
import logger from '../lib/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runTests() {
  logger.info('=== Starting Basic Tests ===\n');

  // 获取专家ID
  const expertId = process.env.EXPERT_ID || 'eric';
  logger.info(`Testing with expert: ${expertId}`);

  let db = null;
  let configLoader = null;
  let llmClient = null;

  try {
    // 测试 1: 数据库连接
    logger.info('\n[Test 1] Database Connection');
    db = new Database();
    const connected = await db.testConnection();
    
    if (connected) {
      logger.success('✓ Database connected successfully');
    } else {
      throw new Error('Database connection test failed');
    }

    // 测试 2: 配置加载
    logger.info('\n[Test 2] Config Loading');
    configLoader = new ConfigLoader(db);
    const config = await configLoader.loadExpertConfig(expertId);
    
    if (config && config.expert) {
      logger.success('✓ Expert config loaded');
      logger.info(`  - Name: ${config.expert.name}`);
      logger.info(`  - Expressive Model: ${config.expert.expressive_model}`);
      logger.info(`  - Reflective Model: ${config.expert.reflective_model}`);
      logger.info(`  - Skills Count: ${config.skills?.length || 0}`);
    } else {
      throw new Error('Failed to load expert config');
    }

    // 测试 3: LLM Client 初始化
    logger.info('\n[Test 3] LLM Client Initialization');
    llmClient = new LLMClient(db, expertId);
    await llmClient.loadConfig();
    logger.success('✓ LLM Client initialized');

    // 测试 4: 技能加载（如果配置了技能）
    if (config.skills && config.skills.length > 0) {
      logger.info('\n[Test 4] Skill Loading');
      const SkillLoader = (await import('../lib/skill-loader.js')).default;
      const skillLoader = new SkillLoader(db);
      const skills = await skillLoader.loadSkillsForExpert(expertId);
      
      logger.success(`✓ Loaded ${skills.length} skills`);
      for (const skill of skills) {
        logger.info(`  - ${skill.name}: ${skill.description}`);
      }
    }

    // 测试 5: 内存系统
    logger.info('\n[Test 5] Memory System');
    const MemorySystem = (await import('../lib/memory-system.js')).default;
    const LLMClientFresh = (await import('../lib/llm-client.js')).default;
    const llm = new LLMClientFresh(db, expertId);
    const memory = new MemorySystem(db, expertId, llm);
    
    const testUserId = 'test_user_001';
    const userProfile = await memory.getOrCreateUserProfile(testUserId);
    logger.success(`✓ User profile created/loaded: ${userProfile.id}`);

    // 测试消息检索（消息由 ChatService 直接插入）
    const messages = await memory.getRecentMessages(testUserId, 5);
    logger.success(`✓ Retrieved ${messages.length} recent messages`);

    logger.info('\n=== All Tests Passed! ===');

  } catch (error) {
    logger.error('\n=== Test Failed ===');
    logger.error(error.message);
    logger.error(error.stack);
    process.exit(1);
  } finally {
    // 清理资源
    if (db) {
      await db.close();
      logger.info('\nDatabase connection closed');
    }
  }
}

// 运行测试
runTests();
