/**
 * SimpleLLMClient - 轻量 LLM 客户端
 * 
 * 已重构为统一 messages 级调用层的 re-export
 * 保留此文件以确保向后兼容
 */

import { invoke, invokeWithRetry, invokeStream } from './message-llm-client.js';

export const callLLM = invoke;
export const callLLMWithRetry = invokeWithRetry;
export const callLLMStream = invokeStream;

export default {
  call: callLLM,
  callWithRetry: callLLMWithRetry,
  callStream: callLLMStream,
};
