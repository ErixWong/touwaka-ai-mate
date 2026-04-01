/**
 * 测试 MinimalContextOrganizer 的消息获取逻辑（简化版）
 * 验证新的时间边界获取方法
 */

import Database from '../lib/db.js';
import MemorySystem from '../lib/memory-system.js';

// 测试参数
const userId = 'mn3l9nz0g3axvxwc12fp';
const expertId = 'mn42wffgyjo4pukj897t';

// 数据库配置
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'touwaka',
  password: process.env.DB_PASSWORD || 'touwaka',
  database: process.env.DB_NAME || 'touwaka_mate',
};

async function testMessageRetrieval() {
  console.log('========== MinimalContextOrganizer 消息获取测试（简化版） ==========\n');
  console.log(`用户ID: ${userId}`);
  console.log(`专家ID: ${expertId}`);
  console.log();

  // 初始化数据库
  const db = new Database(dbConfig);
  await db.connect();

  // 创建 MemorySystem 实例
  const memorySystem = new MemorySystem(db, expertId, null);

  try {
    // 步骤 1: 直接获取时间边界（32条 user/assistant 消息）
    console.log('步骤 1: 获取时间边界（32条 user/assistant 消息）');
    const boundary = await memorySystem.getRecentDialogTimeBoundary(userId, 32);
    
    if (!boundary) {
      console.log('❌ 没有对话消息，测试结束');
      return;
    }
    
    console.log(`  获取到 ${boundary.messageCount} 条对话消息`);
    console.log(`  时间边界: ${boundary.startTime.toLocaleString('zh-CN')} ~ ${boundary.endTime.toLocaleString('zh-CN')}`);
    console.log();

    // 步骤 2: 查询时间范围内的所有消息（包括 tool）
    console.log('步骤 2: 查询时间范围内的所有消息（包括 tool）');
    const messagesInTimeRange = await memorySystem.getMessagesByTimeRange(
      userId,
      boundary.startTime,
      boundary.endTime
    );
    
    console.log(`  查询结果: ${messagesInTimeRange.length} 条消息`);
    console.log();

    // 步骤 3: 分析消息角色分布
    console.log('步骤 3: 分析消息角色分布');
    const roleDistribution = {};
    messagesInTimeRange.forEach(m => {
      roleDistribution[m.role] = (roleDistribution[m.role] || 0) + 1;
    });
    console.log(`  角色分布: ${JSON.stringify(roleDistribution, null, 2)}`);
    
    // 计算实际对话轮数
    const actualRounds = Math.min(
      roleDistribution['user'] || 0,
      roleDistribution['assistant'] || 0
    );
    console.log(`  实际对话轮数: ${actualRounds}`);
    console.log();

    // 步骤 4: 显示前 5 条消息详情
    console.log('步骤 4: 消息详情（前 5 条）');
    messagesInTimeRange.slice(0, 5).forEach((m, i) => {
      console.log(`  [${i + 1}] ID: ${m.id}`);
      console.log(`      Role: ${m.role}`);
      console.log(`      本地时间: ${new Date(m.timestamp).toLocaleString('zh-CN')}`);
      console.log(`      内容: ${m.content?.substring(0, 50)}...`);
      console.log();
    });

    // 总结
    console.log('========== 测试结果总结 ==========');
    console.log(`对话消息数（user+assistant）: ${boundary.messageCount} 条`);
    console.log(`时间范围查询结果: ${messagesInTimeRange.length} 条`);
    console.log(`用于反思分析的消息数: ${messagesInTimeRange.length} 条`);
    console.log(`实际对话轮数: ${actualRounds} 轮`);
    console.log();
    
    if (messagesInTimeRange.length > 0) {
      const firstMsg = messagesInTimeRange[0];
      const lastMsg = messagesInTimeRange[messagesInTimeRange.length - 1];
      console.log(`时间范围:`);
      console.log(`  最早: ${new Date(firstMsg.timestamp).toLocaleString('zh-CN')}`);
      console.log(`  最晚: ${new Date(lastMsg.timestamp).toLocaleString('zh-CN')}`);
    }

  } catch (error) {
    console.error('测试失败:', error.message);
    console.error(error.stack);
  } finally {
    await db.close();
  }
}

// 运行测试
testMessageRetrieval().then(() => {
  console.log('\n测试完成');
  process.exit(0);
}).catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});
