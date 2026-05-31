import path from 'path';

const ATTACHMENT_BASE_PATH = process.env.ATTACHMENT_BASE_PATH
  || path.join(process.cwd(), 'data', 'attachments');

export function resolveAttachmentPath(attachment) {
  if (!attachment || !attachment.file_path) return null;

  const basePath = path.resolve(path.normalize(ATTACHMENT_BASE_PATH));
  let resolved;

  if (path.isAbsolute(attachment.file_path)) {
    resolved = path.resolve(path.normalize(attachment.file_path));
  } else {
    resolved = path.resolve(basePath, path.normalize(attachment.file_path));
  }

  const rel = path.relative(basePath, resolved);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    return null;
  }

  return resolved;
}

export function getAppConfig(app) {
  let config = app?.config;
  if (typeof config === 'string') {
    try { config = JSON.parse(config); } catch { config = {}; }
  }
  return config || {};
}

export function getStepResource(app, stateName, fallback = {}) {
  const config = getAppConfig(app);
  return config?.step_resources?.[stateName] || fallback;
}

export function parseLlmResponse(response) {
  const resultText = response?.text || response?.parsed || response;
  if (typeof resultText === 'string') {
    let text = resultText.trim();
    if (text.startsWith('```')) {
      text = text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    try { return JSON.parse(jsonMatch[0]); } catch { return null; }
  }
  if (typeof resultText === 'object') return resultText;
  return null;
}
