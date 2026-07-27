const DEFAULT_MAX_STRING_LENGTH = 300;
const DEFAULT_MAX_ARRAY_ITEMS = 8;
const DEFAULT_MAX_OBJECT_KEYS = 20;
const DEFAULT_MAX_DEPTH = 4;

const SENSITIVE_KEY_PATTERN = /(api[_-]?key|authorization|bearer|cookie|credential|password|secret|token)/i;
const LARGE_BINARY_KEY_PATTERN = /(base64|file_content|file_data|image_data|audio_data|binary|buffer)/i;

function truncateString(value, maxLength = DEFAULT_MAX_STRING_LENGTH) {
  if (typeof value !== 'string') return value;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...[truncated ${value.length - maxLength} chars]`;
}

function looksLikeDataUrl(value) {
  return typeof value === 'string' && /^data:[^;]+;base64,/i.test(value);
}

function looksLikeLargeBase64(value) {
  return typeof value === 'string' && value.length > 1024 && /^[A-Za-z0-9+/=\r\n]+$/.test(value);
}

function summarizeToolLogValue(value, options = {}, depth = 0, seen = new WeakSet()) {
  const maxStringLength = options.maxStringLength || DEFAULT_MAX_STRING_LENGTH;
  const maxArrayItems = options.maxArrayItems || DEFAULT_MAX_ARRAY_ITEMS;
  const maxObjectKeys = options.maxObjectKeys || DEFAULT_MAX_OBJECT_KEYS;
  const maxDepth = options.maxDepth || DEFAULT_MAX_DEPTH;

  if (value == null) return value;

  if (typeof value === 'string') {
    if (looksLikeDataUrl(value)) return `[data-url omitted length=${value.length}]`;
    if (looksLikeLargeBase64(value)) return `[base64 omitted length=${value.length}]`;
    return truncateString(value, maxStringLength);
  }

  if (typeof value !== 'object') return value;

  if (Buffer.isBuffer(value)) {
    return `[buffer length=${value.length}]`;
  }

  if (seen.has(value)) return '[circular]';

  if (depth >= maxDepth) {
    if (Array.isArray(value)) return `[array(${value.length}) truncated]`;
    return '[object truncated]';
  }

  seen.add(value);

  if (Array.isArray(value)) {
    const items = value
      .slice(0, maxArrayItems)
      .map(item => summarizeToolLogValue(item, options, depth + 1, seen));
    if (value.length > maxArrayItems) {
      items.push(`[+${value.length - maxArrayItems} more items]`);
    }
    return items;
  }

  const summary = {};
  const keys = Object.keys(value);
  for (const key of keys.slice(0, maxObjectKeys)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      summary[key] = '[redacted]';
      continue;
    }
    if (LARGE_BINARY_KEY_PATTERN.test(key)) {
      const rawValue = value[key];
      const length = typeof rawValue === 'string' || Array.isArray(rawValue) ? rawValue.length : undefined;
      summary[key] = length == null ? '[omitted]' : `[omitted length=${length}]`;
      continue;
    }
    summary[key] = summarizeToolLogValue(value[key], options, depth + 1, seen);
  }
  if (keys.length > maxObjectKeys) {
    summary.__truncated_keys__ = keys.length - maxObjectKeys;
  }
  return summary;
}

function summarizeToolParamsForLog(params, options = {}) {
  return summarizeToolLogValue(params || {}, options);
}

export {
  summarizeToolLogValue,
  summarizeToolParamsForLog,
};

export default {
  summarizeToolLogValue,
  summarizeToolParamsForLog,
};
