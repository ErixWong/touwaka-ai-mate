export const RECALL_USAGE_GUIDANCE = `如果需要更多历史话题详情，可以使用 \`recall\` 工具：
- recall({ mode: 'topic', action: 'messages', topic_id: 'xxx' }) 获取某话题的消息清单
- recall({ mode: 'messages', action: 'detail', message_id: 'xxx' }) 获取单条消息完整内容`;

export function buildRecallUsageGuidance({ topicCount = 10, messageCount = 15 } = {}) {
  return `以下是最新的 ${topicCount} 个话题摘要，以及最近 ${messageCount} 条对话消息。这只是部分历史，${RECALL_USAGE_GUIDANCE}`;
}
