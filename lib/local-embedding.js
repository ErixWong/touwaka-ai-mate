/**
 * Local Embedding Service
 *
 * 使用 @xenova/transformers 在本地运行 all-MiniLM-L6-v2 模型
 * 无需外部 API，完全离线运行
 *
 * 注意：此模块是可选的，如果加载失败会返回 null
 */

import logger from './logger.js';

// 模型配置
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const DIMENSION = 384; // all-MiniLM-L6-v2 输出维度

// 单例模式：模型只加载一次
let embeddingPipeline = null;
let isLoading = false;
let loadPromise = null;
let loadError = null;

// 检查模块是否可用
let transformersAvailable = false;

try {
  // 尝试导入 transformers
  const transformers = await import('@xenova/transformers');
  if (transformers?.pipeline) {
    transformersAvailable = true;
  }
} catch (e) {
  logger.warn('[LocalEmbedding] @xenova/transformers not available:', e.message);
}

/**
 * 加载模型（首次调用时会下载模型，约 90MB）
 */
async function loadModel() {
  if (!transformersAvailable) {
    throw new Error('@xenova/transformers module not available');
  }

  if (embeddingPipeline) {
    return embeddingPipeline;
  }

  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = (async () => {
    if (isLoading) {
      throw new Error('Model is loading');
    }

    isLoading = true;
    try {
      const transformers = await import('@xenova/transformers');
      const { pipeline, env } = transformers;

      // 配置使用镜像（国内加速）
      env.allowRemoteModels = true;
      env.allowLocalModels = false;
      if (!process.env.HF_ENDPOINT) {
        env.remoteHost = 'https://hf-mirror.com';
      }

      logger.info('[LocalEmbedding] Loading model, this may take a while on first run...');
      embeddingPipeline = await pipeline('feature-extraction', MODEL_NAME, {
        quantized: true, // 使用量化模型，更小更快
      });
      logger.info('[LocalEmbedding] Model loaded successfully');
      loadError = null;
      return embeddingPipeline;
    } catch (error) {
      loadError = error;
      logger.error('[LocalEmbedding] Failed to load model:', error.message);
      throw error;
    } finally {
      isLoading = false;
    }
  })();

  return loadPromise;
}

/**
 * 生成文本向量
 * @param {string|string[]} texts - 单个文本或文本数组
 * @returns {Promise<number[][]|null>} - 向量数组，如果失败返回 null
 */
export async function generateEmbedding(texts) {
  try {
    const pipe = await loadModel();

    // 确保输入是数组
    const textArray = Array.isArray(texts) ? texts : [texts];

    const results = [];
    for (const text of textArray) {
      const output = await pipe(text, { pooling: 'mean', normalize: true });
      results.push(Array.from(output.data));
    }

    return results;
  } catch (error) {
    logger.error('[LocalEmbedding] Error generating embedding:', error.message);
    return null;
  }
}

/**
 * 检查本地模型是否可用
 */
export function isLocalModelAvailable() {
  return transformersAvailable && loadError === null;
}

/**
 * 检查本地模型是否正在加载
 */
export function isLocalModelLoading() {
  return isLoading;
}

/**
 * 获取模型信息
 */
export function getModelInfo() {
  return {
    name: MODEL_NAME,
    dimension: DIMENSION,
    type: 'local',
    available: transformersAvailable,
    loaded: embeddingPipeline !== null,
    loading: isLoading,
    error: loadError?.message || null,
  };
}

export default {
  generateEmbedding,
  isLocalModelAvailable,
  isLocalModelLoading,
  getModelInfo,
};
