const RETIRED_SKILL_NAMES = new Set([
  'kb editor',
]);

const RETIRED_SKILL_SOURCE_PATHS = new Set([
  'skills/kb-editor',
]);

function normalizeSourcePath(value) {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .toLowerCase();
}

/**
 * Central retirement guard for skills that must not be re-exposed from stale
 * database rows or old seed exports.
 */
export function isRetiredSkill(skill = {}) {
  const name = typeof skill === 'string' ? skill : skill.name;
  const sourcePath = typeof skill === 'string' ? '' : skill.source_path || skill.sourcePath;

  return RETIRED_SKILL_NAMES.has(String(name || '').trim().toLowerCase())
    || RETIRED_SKILL_SOURCE_PATHS.has(normalizeSourcePath(sourcePath));
}

export const retiredSkillNames = Object.freeze([...RETIRED_SKILL_NAMES]);
export const retiredSkillSourcePaths = Object.freeze([...RETIRED_SKILL_SOURCE_PATHS]);

