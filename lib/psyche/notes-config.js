function parsePsycheConfig(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

/**
 * Check whether the expert's Notes capability is enabled.
 *
 * @param {object|null|undefined} expertConfig - Full expert service config.
 * @returns {boolean} False only when psyche_config.enable_notes is boolean false.
 */
export function isNotesEnabled(expertConfig) {
  const psycheConfig = parsePsycheConfig(expertConfig?.expert?.psyche_config);
  return psycheConfig.enable_notes !== false;
}
