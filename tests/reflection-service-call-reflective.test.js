/**
 * ReflectionService reflective client routing test.
 *
 * Run:
 *   node tests/reflection-service-call-reflective.test.js
 */

import { ReflectionService } from '../lib/psyche/reflection-service.js';

let passed = 0;
let failed = 0;

function assert(condition, name, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.error(`  ❌ ${name} ${detail}`);
  }
}

console.log('\n场景 1：ReflectionService 走 llmClient.callReflective');

let callReflectiveArgs = null;
const llmClient = {
  async call() {
    throw new Error('ReflectionService must not call raw llmClient.call');
  },
  async callReflective(messages, options) {
    callReflectiveArgs = { messages, options };
    return {
      content: JSON.stringify({
        session_meta: { current_topic: '测试话题' },
        methodology: { current_phase: 'observe' },
        key_exchange: [],
      }),
    };
  },
};

const service = new ReflectionService(llmClient, {
  maxTokens: 1234,
  reflectionContextSize: 4096,
  inputTokenRatio: 0.5,
});

const reflection = await service.reflect(
  { persona: 'tester' },
  [
    { role: 'user', content: '你好' },
    { role: 'assistant', content: '你好，我在。' },
  ],
  [],
  { userId: 'user-1', expertId: 'expert-1' }
);

assert(!!callReflectiveArgs, '调用 callReflective');
assert(callReflectiveArgs.messages[0].role === 'user', '以 messages 格式发送 prompt');
assert(callReflectiveArgs.options.max_output_tokens === 1234, '传递 max_output_tokens');
assert(callReflectiveArgs.options.response_format?.type === 'json_object', '要求 JSON object 响应');
assert(reflection.session_meta?.current_topic === '测试话题', '解析 reflective 响应 JSON');

console.log('\n场景 2：lookbackRounds 按最近 user turn 裁剪反思窗口');

callReflectiveArgs = null;
const lookbackService = new ReflectionService(llmClient, {
  lookbackRounds: 2,
  maxTokens: 2000,
  reflectionContextSize: 8192,
  inputTokenRatio: 0.8,
});

await lookbackService.reflect(
  { persona: 'tester' },
  [
    { role: 'user', content: '第一轮用户内容-应被裁剪' },
    { role: 'assistant', content: '第一轮助手内容-应被裁剪' },
    { role: 'user', content: '第二轮用户内容-应保留' },
    { role: 'tool', content: '第二轮工具内容-应保留' },
    { role: 'assistant', content: '第二轮助手内容-应保留' },
    { role: 'user', content: '第三轮用户内容-应保留' },
    { role: 'assistant', content: '第三轮助手内容-应保留' },
  ],
  [],
  { userId: 'user-1', expertId: 'expert-1' }
);

const prompt = callReflectiveArgs.messages[0].content;
assert(!prompt.includes('第一轮用户内容-应被裁剪'), '裁剪掉 lookback 之外的旧 user turn');
assert(!prompt.includes('第一轮助手内容-应被裁剪'), '裁剪掉 lookback 之外的旧 assistant');
assert(prompt.includes('第二轮用户内容-应保留'), '保留倒数第二个 user turn');
assert(prompt.includes('第二轮工具内容-应保留'), '保留 lookback 范围内 tool 链');
assert(prompt.includes('第三轮助手内容-应保留'), '保留最近 assistant');

console.log(`\n完成：${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
