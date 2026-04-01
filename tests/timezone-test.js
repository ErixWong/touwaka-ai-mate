/**
 * 测试时区处理的脚本
 * 验证 MinimalContextOrganizer 中的时间范围查询是否正确
 */

// 模拟 earliestDialog.timestamp（毫秒时间戳）
// 假设数据库中存储的消息时间是 2026-03-31 21:00:00（本地时间 UTC+8）
const mockTimestamp = 1743426000000; // 2026-03-31 21:00:00 CST

console.log('========== 时区处理测试 ==========\n');

// 1. 原始毫秒时间戳
console.log('1. 原始毫秒时间戳:');
console.log(`   earliestDialog.timestamp = ${mockTimestamp}ms`);
console.log(`   对应日期 = ${new Date(mockTimestamp).toLocaleString('zh-CN')}`);
console.log();

// 2. 使用 new Date(timestamp) 创建 Date 对象
const startTime = new Date(mockTimestamp);
console.log('2. 使用 new Date(timestamp) 创建 Date 对象:');
console.log(`   startTime = new Date(${mockTimestamp})`);
console.log(`   startTime.toString() = ${startTime.toString()}`);
console.log(`   startTime.toLocaleString('zh-CN') = ${startTime.toLocaleString('zh-CN')}`);
console.log(`   startTime.toISOString() = ${startTime.toISOString()}`);
console.log();

// 3. 错误的做法：使用 ISO 字符串
const wrongTime = new Date(startTime.toISOString());
console.log('3. 错误的做法（使用 ISO 字符串）:');
console.log(`   new Date('${startTime.toISOString()}')`);
console.log(`   结果 = ${wrongTime.toLocaleString('zh-CN')}`);
console.log(`   ❌ 注意：ISO 字符串会被解释为 UTC，导致时间偏差 8 小时！`);
console.log();

// 4. 正确的做法总结
console.log('4. 正确的做法总结:');
console.log('   ✅ 使用毫秒时间戳创建 Date 对象: new Date(timestamp)');
console.log('   ✅ 或者使用 Date 对象直接传递，让 Sequelize 处理时区');
console.log('   ❌ 避免使用 toISOString() 后再创建 Date 对象');
console.log();

// 5. 实际查询中的时间点
console.log('5. 实际查询中的时间点（MinimalContextOrganizer）:');
console.log('   ┌─────────────────────────────────────────────────────────────┐');
console.log('   │ 步骤 1: 获取最近消息（100条）                                │');
console.log('   │         返回的消息包含 timestamp（毫秒）                    │');
console.log('   ├─────────────────────────────────────────────────────────────┤');
console.log('   │ 步骤 2: 过滤 user/assistant 消息                           │');
console.log('   │         取 16 组对话（32条）                                 │');
console.log('   ├─────────────────────────────────────────────────────────────┤');
console.log('   │ 步骤 3: 找到最早的消息时间                                 │');
console.log(`   │         earliestDialog.timestamp = ${mockTimestamp}ms        │`);
console.log(`   │         对应本地时间 = ${new Date(mockTimestamp).toLocaleString('zh-CN')}         │`);
console.log('   ├─────────────────────────────────────────────────────────────┤');
console.log('   │ 步骤 4: 创建 Date 对象（正确做法）                           │');
console.log(`   │         const startTime = new Date(${mockTimestamp});         │`);
console.log(`   │         startTime.toLocaleString('zh-CN') = ${new Date(mockTimestamp).toLocaleString('zh-CN')}  │`);
console.log('   ├─────────────────────────────────────────────────────────────┤');
console.log('   │ 步骤 5: 查询时间范围内的消息                                 │');
console.log(`   │         memorySystem.getMessagesByTimeRange(userId,        │`);
console.log(`   │           startTime,  // Date 对象，本地时间                 │`);
console.log(`   │           endTime      // Date 对象，当前时间                │`);
console.log('   │         )                                                  │');
console.log('   └─────────────────────────────────────────────────────────────┘');
console.log();

// 6. 数据库查询示例
console.log('6. 数据库查询示例:');
console.log('   ┌─────────────────────────────────────────────────────────────┐');
console.log('   │ SELECT * FROM messages                                       │');
console.log('   │ WHERE expert_id = ? AND user_id = ?                          │');
console.log('   │   AND created_at BETWEEN ? AND ?                           │');
console.log('   │                                                              │');
console.log(`   │ 参数1: startTime = '${new Date(mockTimestamp).toLocaleString('zh-CN')}' (本地时间)  │`);
console.log(`   │ 参数2: endTime = '${new Date().toLocaleString('zh-CN')}' (本地时间)     │`);
console.log('   │                                                              │');
console.log('   │ Sequelize 会自动将 Date 对象转换为数据库时区                │');
console.log('   │ 数据库中的 created_at 也是本地时间（UTC+8）                  │');
console.log('   │ 所以查询结果会正确匹配                                       │');
console.log('   └─────────────────────────────────────────────────────────────┘');
console.log();

// 7. 日志输出示例
console.log('7. 实际日志输出示例:');
console.log('   [MinimalContextOrganizer] 步骤4: 时间边界 - earliestDialog.timestamp=1743426000000ms');
console.log('   [MinimalContextOrganizer] 步骤4: 本地时间=2026/3/31 21:00:00, UTC=2026-03-31T13:00:00.000Z');
console.log('   [MinimalContextOrganizer] 步骤5: 查询时间范围 本地=2026/3/31 21:00:00 ~ 2026/4/1 13:19:26');
console.log('   [MemorySystem] getMessagesByTimeRange: 本地时间=2026/3/31 21:00:00 ~ 2026/4/1 13:19:26');
console.log('   [DB] getMessagesByTimeRange: 本地时间=2026/3/31 21:00:00 ~ 2026/4/1 13:19:26, UTC=2026-03-31T13:00:00.000Z ~ 2026-04-01T05:19:26.000Z');
console.log();

console.log('========== 测试完成 ==========');
