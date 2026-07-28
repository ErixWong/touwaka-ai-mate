/**
 * Round state snapshot helpers.
 *
 * Streaming recovery needs to roll back only a small set of per-round state.
 * Keep that snapshot/restore shape outside ChatService so the orchestration
 * loop can stay focused on control flow.
 */

import { snapshotTokenUsage } from '../token-usage-accumulator.js';

export function cloneRoundStateValue(value, structuredCloneFn = globalThis.structuredClone) {
  if (typeof structuredCloneFn === 'function') {
    return structuredCloneFn(value);
  }

  return JSON.parse(JSON.stringify(value));
}

export function createRoundStateSnapshot(state, options = {}) {
  const {
    round,
    messages = [],
    fullContent = '',
    fullReasoningContent = '',
    tokenUsage = null,
  } = state || {};

  return {
    round,
    messages: cloneRoundStateValue(messages, options.structuredClone),
    fullContent,
    fullReasoningContent,
    tokenUsage: snapshotTokenUsage(tokenUsage),
  };
}

export function restoreRoundStateSnapshot(snapshot, options = {}) {
  return {
    round: snapshot?.round,
    messages: cloneRoundStateValue(snapshot?.messages || [], options.structuredClone),
    fullContent: snapshot?.fullContent || '',
    fullReasoningContent: snapshot?.fullReasoningContent || '',
    tokenUsage: snapshotTokenUsage(snapshot?.tokenUsage),
  };
}
