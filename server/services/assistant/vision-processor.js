/**
 * VisionProcessor - 视觉处理模块
 * 
 * 负责：
 * - 图片输入提取
 * - 多模态消息构建
 * - 视觉模型调用
 */

import fs from 'fs/promises';
import path from 'path';
import logger from '../../../lib/logger.js';
import { callLLMWithRetry } from '../../../lib/simple-llm-client.js';

// 支持的图片格式
const IMAGE_EXTENSIONS = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

/**
 * 从输入参数中提取图片信息
 * @param {object} input - 输入参数
 * @returns {object} { hasImage: boolean, filePaths: string[], imageDataUrls: string[] }
 */
export function extractImageInput(input) {
  if (!input || typeof input !== 'object') {
    return { hasImage: false, filePaths: [], imageDataUrls: [] };
  }

  const filePaths = [];
  const imageDataUrls = [];

  // 图片路径：image_ 开头
  if (Array.isArray(input.image_paths)) {
    filePaths.push(...input.image_paths);
  } else if (input.image_path) {
    filePaths.push(input.image_path);
  }

  // Base64 数据：支持直接传入已转换的 data URL
  if (Array.isArray(input.image_data_urls)) {
    imageDataUrls.push(...input.image_data_urls);
  } else if (Array.isArray(input.image_data)) {
    imageDataUrls.push(...input.image_data);
  } else if (input.image_data_url) {
    imageDataUrls.push(input.image_data_url);
  } else if (input.image_data) {
    // 支持单个 data URL 或 base64 字符串
    const data = input.image_data;
    if (typeof data === 'string') {
      // 如果已经是 data URL 格式，直接使用
      if (data.startsWith('data:image/')) {
        imageDataUrls.push(data);
      } else {
        // 如果是纯 base64，添加前缀（假设为 PNG）
        imageDataUrls.push(`data:image/png;base64,${data}`);
      }
    }
  }

  // 过滤掉空值
  const validPaths = filePaths.filter(p => p && typeof p === 'string');
  const validDataUrls = imageDataUrls.filter(d => d && typeof d === 'string' && d.startsWith('data:image/'));

  return {
    hasImage: validPaths.length > 0 || validDataUrls.length > 0,
    filePaths: validPaths,
    imageDataUrls: validDataUrls,
  };
}

/**
 * 使用输入参数中的图片执行视觉处理
 * @param {object} assistant - 助理配置
 * @param {object} input - 输入参数
 * @param {object} context - 执行上下文
 * @param {object} modelConfig - 模型配置
 * @param {object} imageInput - 图片输入信息 { filePaths, imageDataUrls }
 * @returns {Promise<object>}
 */
export async function executeVisionWithInput(assistant, input, context, modelConfig, imageInput) {
  const { filePaths, imageDataUrls } = imageInput;
  const imageContext = {
    topicId: context.topicId,
    expertId: context.expertId,
    workdir: context.workdir,
  };

  // 收集所有图片的 data URL
  const imageDataList = [];

  // 1. 处理文件路径：读取图片文件
  for (const filePath of filePaths) {
    try {
      const imageAsset = await readImageFile(filePath, imageContext);
      imageDataList.push({
        data_url: imageAsset.data_url,
        file_name: imageAsset.file_name,
        size_bytes: imageAsset.size_bytes,
        source: 'file',
      });
      logger.info(`[VisionProcessor] 图片读取成功: ${imageAsset.file_name}, ${imageAsset.size_bytes} bytes`);
    } catch (readError) {
      logger.error(`[VisionProcessor] 图片读取失败:`, readError.message);
      return {
        success: false,
        error: `图片读取失败: ${readError.message}`,
      };
    }
  }

  // 2. 处理 Base64 数据：直接使用
  for (let i = 0; i < imageDataUrls.length; i++) {
    const dataUrl = imageDataUrls[i];
    // 估算 base64 数据大小
    const base64Data = dataUrl.split(',')[1] || '';
    const sizeBytes = Math.ceil(base64Data.length * 0.75);
    imageDataList.push({
      data_url: dataUrl,
      file_name: `image_${i + 1}.png`,
      size_bytes: sizeBytes,
      source: 'base64',
    });
    logger.info(`[VisionProcessor] 使用 Base64 图片: image_${i + 1}, 约 ${(sizeBytes / 1024).toFixed(1)}KB`);
  }

  // 检查是否有图片
  if (imageDataList.length === 0) {
    return {
      success: false,
      error: '没有有效的图片输入',
    };
  }

  // 构建多模态消息
  const messages = [];

  // 添加系统提示词
  if (assistant.prompt_template) {
    messages.push({
      role: 'system',
      content: assistant.prompt_template,
    });
  }

  // 构建用户消息（包含图片和文本）
  const userContent = [];

  // 添加图片（支持多图）
  for (const imageData of imageDataList) {
    userContent.push({
      type: 'image_url',
      image_url: {
        url: imageData.data_url,
      },
    });
  }

  // 构建文本内容
  let textContent = '';
  if (context.task) {
    textContent += `**任务**: ${context.task}\n\n`;
  }
  if (context.background) {
    textContent += `**背景**: ${context.background}\n\n`;
  }
  // 添加输入数据（排除图片路径和 base64 数据）
  const textInput = { ...input };
  delete textInput.image_path;
  delete textInput.image_paths;
  delete textInput.file_path;
  delete textInput.file_paths;
  delete textInput.path;
  delete textInput.image_data;
  delete textInput.image_data_url;
  delete textInput.image_data_urls;
  if (Object.keys(textInput).length > 0) {
    textContent += `**输入数据**:\n${JSON.stringify(textInput, null, 2)}`;
  }
  if (!textContent) {
    textContent = '请分析这些图片的内容。';
  }

  userContent.push({
    type: 'text',
    text: textContent,
  });

  messages.push({
    role: 'user',
    content: userContent,
  });

  // 调用视觉模型
  const startTime = Date.now();
  const maxTokens = Math.min(
    assistant.max_tokens || modelConfig.max_output_tokens || 32768,
    modelConfig.max_output_tokens || 98304
  );

  try {
    // 使用 SimpleLLMClient 调用视觉模型
    const response = await callLLMWithRetry(modelConfig, messages, {
      temperature: parseFloat(assistant.temperature) || 0.7,
      max_tokens: maxTokens,
      timeout: (assistant.timeout || 120) * 1000,
    });

    const latencyMs = Date.now() - startTime;

    // 返回结果
    return {
      success: true,
      result: response.content,
      tokens_input: response.usage?.prompt_tokens || 0,
      tokens_output: response.usage?.completion_tokens || 0,
      latency_ms: latencyMs,
      model_used: modelConfig.model_name,
      image_count: imageDataList.length,
    };
  } catch (visionError) {
    logger.error(`[VisionProcessor] 视觉模型调用失败:`, visionError.message);
    return {
      success: false,
      error: `视觉模型调用失败: ${visionError.message}`,
    };
  }
}

/**
 * 读取图片文件并转换为 data URL
 * @param {string} filePath - 图片文件路径
 * @param {object} context - 上下文（包含 topicId 等）
 * @returns {Promise<object>} image_asset 对象
 */
export async function readImageFile(filePath, context = {}) {
  // 获取白名单目录
  const allowedPaths = getAllowedImagePaths(context);

  // 验证路径
  const resolvedPath = validateImagePath(filePath, allowedPaths);

  // 检查文件扩展名
  const ext = path.extname(resolvedPath).toLowerCase();
  if (!IMAGE_EXTENSIONS[ext]) {
    throw new Error(`不支持的图片格式: ${ext}。支持: ${Object.keys(IMAGE_EXTENSIONS).join(', ')}`);
  }

  // 读取文件
  let stats;
  try {
    stats = await fs.stat(resolvedPath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`文件不存在: ${filePath}`);
    }
    throw new Error(`无法访问文件: ${err.message}`);
  }

  // 检查文件大小（默认最大 10MB）
  const maxBytes = 10 * 1024 * 1024;
  if (stats.size > maxBytes) {
    throw new Error(`文件大小超过限制: ${(stats.size / 1024 / 1024).toFixed(2)}MB > 10MB`);
  }

  // 读取并转换为 base64
  const buffer = await fs.readFile(resolvedPath);
  const base64 = buffer.toString('base64');
  const mimeType = IMAGE_EXTENSIONS[ext];
  const dataUrl = `data:${mimeType};base64,${base64}`;

  return {
    kind: 'image_asset',
    source: 'local_file',
    file_path: resolvedPath,
    file_name: path.basename(resolvedPath),
    mime_type: mimeType,
    data_url: dataUrl,
    size_bytes: stats.size,
  };
}

/**
 * 获取允许读取图片的白名单目录
 * @param {object} context - 上下文
 * @returns {string[]}
 */
export function getAllowedImagePaths(context) {
  const paths = [];

  // 数据目录（主要路径，优先级最高）
  const dataPath = process.env.DATA_BASE_PATH || './data';
  paths.push(path.resolve(dataPath));

  // work 目录（AI 工作空间）
  paths.push(path.resolve(dataPath, 'work'));

  // 工作区根目录
  if (process.env.WORKSPACE_ROOT) {
    paths.push(path.resolve(process.env.WORKSPACE_ROOT));
  }

  // 上传目录
  if (process.env.UPLOAD_DIR) {
    paths.push(path.resolve(process.env.UPLOAD_DIR));
  }

  // 临时目录
  paths.push(path.resolve('/tmp'));

  // 从 context 获取工作目录
  if (context?.workdir) {
    // workdir 可能是相对路径（work/...），需要加上 data 前缀
    const workdir = context.workdir;
    if (workdir.startsWith('work/')) {
      paths.push(path.resolve(dataPath, workdir));
    } else {
      paths.push(path.resolve(workdir));
    }
  }

  if (context?.topicId) {
    paths.push(path.resolve(dataPath, 'work', context.topicId));
  }

  return paths;
}

/**
 * 验证图片路径是否在白名单内
 * @param {string} filePath - 文件路径
 * @param {string[]} allowedPaths - 白名单目录
 * @returns {string} 解析后的绝对路径
 */
export function validateImagePath(filePath, allowedPaths) {
  const dataPath = process.env.DATA_BASE_PATH || './data';

  // 尝试多种路径解析方式
  const candidatePaths = [
    path.resolve(filePath),                           // 直接解析
    path.resolve(dataPath, filePath),                 // 相对于 data 目录
  ];

  // 如果路径以 work/ 开头，额外尝试
  if (filePath.startsWith('work/')) {
    candidatePaths.push(path.resolve(dataPath, filePath));
  }

  // 找到第一个存在的路径
  for (const resolved of candidatePaths) {
    const isAllowed = allowedPaths.some(allowedPath =>
      resolved.startsWith(allowedPath + path.sep) || resolved === allowedPath
    );

    if (isAllowed) {
      return resolved;
    }
  }

  // 如果都不在白名单内，抛出错误
  throw new Error(`路径不在允许的目录范围内: ${filePath}`);
}

export default {
  extractImageInput,
  executeVisionWithInput,
  readImageFile,
  getAllowedImagePaths,
  validateImagePath,
};