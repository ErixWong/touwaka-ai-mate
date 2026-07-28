/**
 * Token usage accumulator helpers.
 *
 * Keeps streaming LLM usage accounting out of orchestration code. The helper
 * preserves the existing contract: usage stays null until a usage event exists.
 */

export function createEmptyTokenUsage() {
  return {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };
}

export function normalizeTokenUsage(usage) {
  if (!usage) {
    return null;
  }

  return {
    prompt_tokens: Number(usage.prompt_tokens) || 0,
    completion_tokens: Number(usage.completion_tokens) || 0,
    total_tokens: Number(usage.total_tokens) || 0,
  };
}

export function snapshotTokenUsage(usage) {
  return normalizeTokenUsage(usage);
}

export function addTokenUsage(currentUsage, usage) {
  if (!usage) {
    return snapshotTokenUsage(currentUsage);
  }

  const current = snapshotTokenUsage(currentUsage) || createEmptyTokenUsage();
  const incoming = normalizeTokenUsage(usage) || createEmptyTokenUsage();

  return {
    prompt_tokens: current.prompt_tokens + incoming.prompt_tokens,
    completion_tokens: current.completion_tokens + incoming.completion_tokens,
    total_tokens: current.total_tokens + incoming.total_tokens,
  };
}
