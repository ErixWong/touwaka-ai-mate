/**
 * TTSClient — Text-to-Speech 能力接口骨架
 *
 * 本轮定位：首版接口定义 + 设计文档，不要求实现流式 TTS。
 * 首版可接受的交付物：接口骨架 + 最小可用的非流式 TTS 实现。
 *
 * 使用方式（目标）：
 *   const client = new TTSClient(modelConfig);
 *   const audioBuffer = await client.synthesize('你好，世界', { voice: 'default' });
 */

import logger from './logger.js';

class TTSClient {
  /**
   * @param {Object} modelConfig - 完整模型配置（含 base_url, api_key, model_name）
   */
  constructor(modelConfig) {
    if (!modelConfig || !modelConfig.base_url) {
      throw new Error('TTSClient requires a model config with base_url');
    }
    this.modelConfig = modelConfig;
  }

  /**
   * 非流式文本转语音（HTTP 方式）
   *
   * @param {string} text - 待合成的文本
   * @param {Object} [options]
   * @param {string} [options.voice] - 发音人
   * @param {string} [options.format] - 输出格式，如 'mp3', 'wav'
   * @param {number} [options.speed] - 语速倍率，默认 1.0
   * @returns {Promise<{ audio: Buffer, format: string }>}
   *
   * 本方法为骨架定义，当前抛出 NotImplemented 错误。
   * 实现时需要：
   *   1. 通过 normalizeBaseUrl() 归一化 base_url
   *   2. 构造 POST /audio/speech 请求
   *   3. 返回音频 Buffer
   */
  async synthesize(text, options = {}) {
    logger.warn('[TTSClient] synthesize() not implemented — interface skeleton only');
    throw new Error('TTSClient.synthesize() not yet implemented. Use as interface definition reference.');
  }

  /**
   * 流式文本转语音（WebSocket / SSE 方式）
   * 本轮不要求实现，仅作为接口预留。
   */
  async synthesizeStream(textStream, options = {}) {
    logger.warn('[TTSClient] synthesizeStream() not implemented — reserved for future use');
    throw new Error('TTSClient.synthesizeStream() not yet implemented. Reserved for future streaming TTS.');
  }
}

export default TTSClient;
