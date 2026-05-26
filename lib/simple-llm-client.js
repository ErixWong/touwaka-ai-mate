/**
 * SimpleLLMClient - 轻量 LLM 客户端
 * 
 * 已重构为 BaseLLM 的 re-export
 * 保留此文件以确保向后兼容
 */

import { call, callWithRetry, callStream } from './chat/base-llm.js';

export const callLLM = call;
export const callLLMWithRetry = callWithRetry;
export const callLLMStream = callStream;

export default {
  call: callLLM,
  callWithRetry: callLLMWithRetry,
  callStream: callLLMStream,
};
