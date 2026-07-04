/**
 * 测试 InternalLLMService 对 Qwen thinking 开关的控制效果
 *
 * 用法：
 *   node tests/test-internal-llm-qwen-thinking.js
 *   node tests/test-internal-llm-qwen-thinking.js --model-name "qwen3.6:35b"
 *
 * 说明：
 * - InternalLLMService 当前默认走“关闭思考”路径，本脚本会复用它的内部配置逻辑发真实请求
 * - 同时对比“显式 chat_template_kwargs.enable_thinking=true”的直接调用，便于观察 reasoning_content 是否出现
 */

import dotenv from 'dotenv';
import Database from '../lib/db.js';
import InternalLLMService from '../lib/internal-llm-service.js';
import { invokeWithRetry } from '../lib/message-llm-client.js';
import { resolveThinkingRequestConfig } from '../lib/llm-thinking-config.js';

dotenv.config();

const cliArgs = process.argv.slice(2);

function getArgValue(flag, fallback = null) {
  const index = cliArgs.indexOf(flag);
  if (index >= 0 && cliArgs[index + 1]) {
    return cliArgs[index + 1];
  }
  return fallback;
}

const model_name = getArgValue('--model-name', 'qwen3.6:35b');

function buildDbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectionLimit: 5,
  };
}

function printSection(title) {
  console.log(`\n${'='.repeat(20)} ${title} ${'='.repeat(20)}`);
}

function buildPreview(text, length = 200) {
  if (typeof text !== 'string' || !text.trim()) return '(empty)';
  return text.length > length ? `${text.slice(0, length)}...` : text;
}

async function resolveModelConfig(db, targetModelName) {
  const ai_model = db.getModel('ai_model');
  const row = await ai_model.findOne({
    where: { model_name: targetModelName, is_active: true },
    raw: true,
  });

  if (!row?.id) {
    throw new Error(`未找到激活模型: ${targetModelName}`);
  }

  const modelConfig = await db.getModelConfig(row.id);
  if (!modelConfig) {
    throw new Error(`无法加载模型完整配置: ${targetModelName}`);
  }

  return modelConfig;
}

async function testInternalDisabled(db, modelConfig) {
  const internalLLM = new InternalLLMService(db);
  const thinkingConfig = resolveThinkingRequestConfig(modelConfig, {
    enable_reasoning: false,
    logger_prefix: '[InternalLLMService]',
  });
  const systemPrompt = '你是一个简洁的测试助手。请直接回答，不要输出无关信息。';

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: '请回答：strawberry 里有几个字母 r？只回答一个数字。' },
  ];

  const response = await invokeWithRetry(modelConfig, messages, {
    temperature: 0.3,
    max_tokens: 128,
    thinking_policy: 'disable',
    logger_prefix: '[InternalLLMService]',
    chat_template_kwargs: thinkingConfig.chat_template_kwargs,
    timeout: await internalLLM._resolveTimeoutMs(),
    maxRetries: internalLLM.maxRetries,
  });

  return {
    path: 'InternalLLMService 当前关闭思考路径',
    thinkingConfig,
    response,
  };
}

async function testDirectEnabled(modelConfig) {
  const messages = [
    { role: 'system', content: '你是一个简洁的测试助手。请直接回答，不要输出无关信息。' },
    { role: 'user', content: '请回答：strawberry 里有几个字母 r？只回答一个数字。' },
  ];

  const response = await invokeWithRetry(modelConfig, messages, {
    temperature: 0.3,
    max_tokens: 128,
    thinking_policy: 'enable',
    logger_prefix: '[QwenThinkingTest]',
    chat_template_kwargs: { enable_thinking: true },
    timeout: modelConfig.timeout || 120000,
    maxRetries: 1,
  });

  return {
    path: '直接调用 baseCallWithRetry 开启 chat_template_kwargs thinking',
    thinkingConfig: { chat_template_kwargs: { enable_thinking: true } },
    response,
  };
}

async function main() {
  const db = new Database(buildDbConfig());
  try {
    await db.connect();
    const modelConfig = await resolveModelConfig(db, model_name);

    printSection('模型配置');
    console.log(JSON.stringify({
      id: modelConfig.id,
      model_name: modelConfig.model_name,
      provider_name: modelConfig.provider_name,
      base_url: modelConfig.base_url,
      supports_reasoning: modelConfig.supports_reasoning,
      thinking_format: modelConfig.thinking_format,
    }, null, 2));

    const internalDisabled = await testInternalDisabled(db, modelConfig);
    printSection(internalDisabled.path);
    console.log('请求控制参数:', JSON.stringify(internalDisabled.thinkingConfig, null, 2));
    console.log('content 预览:', buildPreview(internalDisabled.response.content));
    console.log('reasoningContent 长度:', internalDisabled.response.reasoningContent?.length || 0);
    console.log('reasoningContent 预览:', buildPreview(internalDisabled.response.reasoningContent));

    const directEnabled = await testDirectEnabled(modelConfig);
    printSection(directEnabled.path);
    console.log('请求控制参数:', JSON.stringify(directEnabled.thinkingConfig, null, 2));
    console.log('content 预览:', buildPreview(directEnabled.response.content));
    console.log('reasoningContent 长度:', directEnabled.response.reasoningContent?.length || 0);
    console.log('reasoningContent 预览:', buildPreview(directEnabled.response.reasoningContent));

    printSection('结论建议');
    const internalHasReasoning = (internalDisabled.response.reasoningContent?.length || 0) > 0;
    const enabledHasReasoning = (directEnabled.response.reasoningContent?.length || 0) > 0;
    console.log(JSON.stringify({
      internal_disable_path_has_reasoning: internalHasReasoning,
      direct_enable_path_has_reasoning: enabledHasReasoning,
      qwen_thinking_control_effective: internalHasReasoning !== enabledHasReasoning,
    }, null, 2));
  } catch (error) {
    console.error('\n测试失败:', error);
    process.exitCode = 1;
  } finally {
    await db.close().catch(() => {});
  }
}

main();
