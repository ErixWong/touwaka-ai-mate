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