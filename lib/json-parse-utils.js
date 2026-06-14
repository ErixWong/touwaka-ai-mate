import logger from './logger.js';

export function parseJsonLikeContent(content, options = {}) {
  const { returnRawOnFail = true, logPrefix = '[JSONParse]' } = options;

  if (!content || typeof content !== 'string') {
    return returnRawOnFail ? { _parse_failed: true, _raw: content || '' } : null;
  }

  let cleaned = content.trim();

  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    const objectMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]);
      } catch (e2) {
        if (!returnRawOnFail) {
          logger.warn(`${logPrefix} Object extraction failed:`, e2.message);
        }
      }
    }

    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        return JSON.parse(arrayMatch[0]);
      } catch (e3) {
        if (!returnRawOnFail) {
          logger.warn(`${logPrefix} Array extraction failed:`, e3.message);
        }
      }
    }

    if (!returnRawOnFail) {
      logger.warn(`${logPrefix} Failed, content length: ${cleaned.length}`);
    }

    return returnRawOnFail ? { _parse_failed: true, _raw: cleaned } : null;
  }
}