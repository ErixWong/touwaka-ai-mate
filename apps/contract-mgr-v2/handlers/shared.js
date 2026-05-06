import logger from '../../../lib/logger.js';

export function splitIntoChunks(text, maxChars) {
  if (!text || text.length <= maxChars) return text ? [text] : [];

  const chunks = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    
    if (end < text.length) {
      const lastNewline = text.lastIndexOf('\n', end);
      if (lastNewline > start) {
        end = lastNewline + 1;
      }
    }

    chunks.push(text.slice(start, end));
    start = end;
  }

  return chunks;
}

export function parseLlmResponse(response) {
  const resultText = response.text || response.parsed || response;
  if (typeof resultText === 'string') {
    let text = resultText.trim();
    if (text.startsWith('```')) {
      text = text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  }
  if (typeof resultText === 'object') return resultText;
  return null;
}

export function extractKeyParts(text) {
  const lines = text.split('\n');
  const totalLines = lines.length;

  const headEnd = Math.min(Math.floor(totalLines * 0.15), 200);
  const head = lines.slice(0, headEnd).join('\n');

  const tailStart = Math.max(totalLines - Math.min(Math.floor(totalLines * 0.1), 100), headEnd);
  const tail = lines.slice(tailStart).join('\n');

  const amountKeywords = ['金额', '总额', '合同金额', '价格', '价款', '人民币', 'RMB', '¥', '元'];
  const amountLines = [];
  for (let i = 0; i < totalLines; i++) {
    if (amountKeywords.some(k => lines[i].includes(k))) {
      const start = Math.max(0, i - 2);
      const end = Math.min(totalLines, i + 3);
      amountLines.push(...lines.slice(start, end));
    }
  }
  const amountPart = [...new Set(amountLines)].join('\n');

  return { head, tail, amountPart };
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

export function getPrompt(app, promptKey, fallback = null) {
  const config = getAppConfig(app);
  return config?.prompts?.[promptKey] || fallback;
}

export function buildLlmParams(stepConfig) {
  const params = {
    model_id: stepConfig.model_id || null,
    temperature: stepConfig.temperature ?? 0.3,
  };
  if (stepConfig.enable_thinking) {
    params.enable_thinking = true;
    if (stepConfig.thinking_budget) {
      params.thinking_budget = stepConfig.thinking_budget;
    }
  }
  return params;
}
