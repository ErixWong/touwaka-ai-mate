const SKILL_TOOL_FUNCTION_SEPARATOR = '__';

/**
 * Build the OpenAI function name used for a skill tool.
 *
 * Keep this intentionally behavior-preserving: current production names are
 * `${skill.mark || skill.id}__${tool.name}`. Validation/sanitization should be
 * added as a separate migration so existing tool names do not silently drift.
 */
function buildSkillToolFunctionName(skillMarkOrId, toolName) {
  return `${skillMarkOrId}${SKILL_TOOL_FUNCTION_SEPARATOR}${toolName}`;
}

export {
  SKILL_TOOL_FUNCTION_SEPARATOR,
  buildSkillToolFunctionName,
};

export default {
  SKILL_TOOL_FUNCTION_SEPARATOR,
  buildSkillToolFunctionName,
};
