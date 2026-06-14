/**
 * ASRClient — Automatic Speech Recognition 能力接口骨架
 *
 * 本轮定位：首版接口定义 + 设计文档，不要求实现实时 WebSocket ASR。
 * 首版可接受的交付物：接口骨架 + 最小可用的非实时 HTTP ASR 实现。
 *
 * 使用方式（目标）：
 *   const client = new ASRClient(modelConfig);
 *   const result = await client.transcribe(audioBuffer, { language: 'zh' });
 */

import logger from './logger.js';

class ASRClient {
  /**
   * @param {Object} modelConfig - 完整模型配置（含 base_url, api_key, model_name）
   */
  constructor(modelConfig) {
    if (!modelConfig || !modelConfig.base_url) {
      throw new Error('ASRClient requires a model config with base_url');
    }
    this.modelConfig = modelConfig;
  }

  /**
   * 非实时语音转文字（HTTP 方式）
   *
   * @param {Buffer|string} audio - 音频数据或文件路径
   * @param {Object} [options]
   * @param {string} [options.language] - 语言代码，如 'zh', 'en'
   * @param {string} [options.format] - 音频格式，如 'wav', 'mp3'
   * @returns {Promise<{ text: string, segments?: Array }>}
   *
   * 本方法为骨架定义，当前抛出 NotImplemented 错误。
   * 实现时需要：
   *   1. 通过 normalizeBaseUrl() 归一化 base_url
   *   2. 构造 POST /audio/transcriptions 请求
   *   3. 处理 multipart/form-data 音频上传
   */
  async transcribe(audio, options = {}) {
    logger.warn('[ASRClient] transcribe() not implemented — interface skeleton only');
    throw new Error('ASRClient.transcribe() not yet implemented. Use as interface definition reference.');
  }

  /**
   * 流式语音转文字（WebSocket 方式）
   * 本轮不要求实现，仅作为接口预留。
   */
  async transcribeStream(audioStream, options = {}) {
    logger.warn('[ASRClient] transcribeStream() not implemented — reserved for future use');
    throw new Error('ASRClient.transcribeStream() not yet implemented. Reserved for future streaming ASR.');
  }
}

export default ASRClient;
