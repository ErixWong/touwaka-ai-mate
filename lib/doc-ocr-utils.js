/**
 * Doc OCR 工具函数 - 文档预览语义统一层
 * 
 * ## 语义模型设计（第一性原理）
 * 
 * 系统内有两种 markdown 内容：
 * 1. raw_markdown_attachment（原始 OCR 稿）- 直接从 OCR 服务获取的原始输出
 * 2. preview_markdown_attachment（预览稿）- 经过清洗后的内容，供后续阶段使用
 * 
 * ## 字段到语义的映射表
 * 
 * | 数据库字段 | 存储位置 | 语义定义 | 消费者 |
 * |-----------|---------|---------|--------|
 * | main_markdown_attachment_id | doc_ocr_result 正式字段 | raw_markdown_attachment（原始稿） | 系统内部流转、外部系统同步 |
 * | metadata.cleaned_markdown_attachment_id | doc_ocr_result.metadata JSON | preview_markdown_attachment（预览稿） | outline/chunk/前端预览 |
 * 
* ## 事实源优先级（运行时推导规则）
 *
 * preview_markdown_attachment 的读取优先级：
 *   1. metadata.cleaned_markdown_attachment_id（清洗后预览稿 - 推荐）
 *   2. main_markdown_attachment_id（原始稿 - 降级兼容）
 * 
 * 这意味着：
 * - 如果存在清洗稿，系统以清洗稿为正式预览稿
 * - 如果没有清洗稿（历史数据或清洗失败），降级使用原始稿
 * - 消费者无需理解这套兼容逻辑，统一调用 getPreviewAttachmentId() 即可
 * 
 * ## 删除/清理语义
 * 
 * 一个 OCR 结果关联的所有附件包括：
 * - main_markdown_attachment_id（主 markdown）
 * - raw_result_attachment_id（OCR 原始 JSON）
 * - deliverables_manifest_attachment_id
 * - image_manifest_attachment_id
 * - metadata.cleaned_markdown_attachment_id（清洗稿）
 * 
 * 使用 collectOcrAttachmentIds(result, { includeAll: true }) 可获取完整清单
 * 
 * ## 为什么不直接把预览稿存入正式字段
 * 
 * 当前任务的设计约束是"默认不直接改数据库字段"。因此：
 * - 语义层收敛通过 helper 函数实现（运行时推导）
 * - 字段层收敛需要在获得明确授权后单独执行
 * 
 * 这套设计的最终目标：即使未来字段层统一了，消费层代码也不需要改动
 */

import logger from './logger.js';

export function parseOcrMetadata(value, context = {}) {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      logger.warn('[Doc OCR Metadata] Invalid metadata JSON', {
        error: 'JSON parse failed',
        metadata_length: value.length,
        ...context,
      });
      return {};
    }
  }
  return typeof value === 'object' ? value : {};
}

export function getPreviewAttachmentId(ocrResult, context = {}) {
  if (!ocrResult) return null;
  const metadata = parseOcrMetadata(ocrResult.metadata, context);
  return metadata.cleaned_markdown_attachment_id || ocrResult.main_markdown_attachment_id || null;
}

export function hasPreviewResult(ocrResult, context = {}) {
  return !!getPreviewAttachmentId(ocrResult, context);
}

/**
 * 获取原始 OCR 稿的附件 ID（未清洗的原始输出）
 * @param {Object} ocrResult - OCR 结果对象
 * @returns {string|null}
 */
export function getRawAttachmentId(ocrResult) {
  if (!ocrResult) return null;
  return ocrResult.main_markdown_attachment_id || null;
}

/**
 * 统一构造 OCR 响应语义对象
 * 将内部复杂的字段映射转换为统一、稳定的新语义：
 * - preview_markdown_attachment: 当前唯一有效预览稿（支持 fallback：cleaned > main）
 * - raw_markdown_attachment: OCR 原始稿
 * 
 * 同时保留旧字段作为兼容过渡（@deprecated）
 * 注意：兼容字段 cleaned_markdown_attachment 只在存在清洗稿时返回非空，不允许 fallback
 *
 * @param {Object} ocrResult - OCR 结果数据库记录
 * @param {Map<string, Object>} attachmentsMap - attachment ID -> attachment 对象的映射
 * @returns {Object} 语义统一的响应对象
 */
export function buildOcrSemanticObject(ocrResult, attachmentsMap = new Map()) {
  if (!ocrResult) {
    return {
      preview_markdown_attachment: null,
      raw_markdown_attachment: null,
      // 兼容字段（@deprecated）
      cleaned_markdown_attachment: null,
      main_markdown_attachment: null,
    };
  }
  
  const metadata = parseOcrMetadata(ocrResult.metadata);
  
  // 原始稿 ID（main_markdown_attachment_id）
  const rawId = ocrResult.main_markdown_attachment_id || null;
  // 清洗稿 ID（仅从 metadata 中读取，不做 fallback）
  const cleanedId = metadata?.cleaned_markdown_attachment_id || null;
  // 预览稿 ID（优先级：cleaned > main）
  const previewId = cleanedId || rawId;
  
  // 获取对应的 attachment 对象
  const rawAttachment = rawId ? attachmentsMap.get(rawId) : null;
  const cleanedAttachment = cleanedId ? attachmentsMap.get(cleanedId) : null;
  const previewAttachment = previewId ? attachmentsMap.get(previewId) : null;
  
  return {
    // 新语义（推荐使用）
    preview_markdown_attachment: previewAttachment,
    raw_markdown_attachment: rawAttachment,
    
    // 兼容字段（@deprecated）
    // cleaned_markdown_attachment：仅当存在清洗稿时返回，非空时不 fallback
    cleaned_markdown_attachment: cleanedAttachment,
    // main_markdown_attachment：始终只代表原始 OCR 稿
    main_markdown_attachment: rawAttachment,
  };
}
  
/**
 * 收集 OCR 结果关联的所有附件 ID
 * 
 * 用于：预加载附件、删除文档、清理任务等场景
 * 
 * @param {Object} ocrResult - OCR 结果数据库记录（需包含 metadata 字段）
 * @param {Object} options - 配置选项
 * @param {boolean} options.includeAll - 是否包含所有中间产物（deliverables_manifest, image_manifest 等），默认 false
 * @returns {string[]} 附件 ID 数组（去重）
 */
export function collectOcrAttachmentIds(ocrResult, options = {}) {
  const { includeAll = false } = options;
  if (!ocrResult) return [];

  const idSet = new Set();

  // 基础字段（始终包含）
  if (ocrResult.main_markdown_attachment_id) {
    idSet.add(ocrResult.main_markdown_attachment_id);
  }
  if (ocrResult.raw_result_attachment_id) {
    idSet.add(ocrResult.raw_result_attachment_id);
  }

  // 清洗后的预览稿（从 metadata 中提取）
  const metadata = parseOcrMetadata(ocrResult.metadata);
  if (metadata?.cleaned_markdown_attachment_id) {
    idSet.add(metadata.cleaned_markdown_attachment_id);
  }

  // 可选：包含所有清单和中间产物
  if (includeAll) {
    const allFields = [
      'deliverables_manifest_attachment_id',
      'image_manifest_attachment_id',
      'middle_json_attachment_id',
      'content_list_attachment_id',
      'content_list_v2_attachment_id',
      'model_json_attachment_id',
    ];
    for (const field of allFields) {
      if (ocrResult[field]) {
        idSet.add(ocrResult[field]);
      }
    }
  }

  return Array.from(idSet);
}