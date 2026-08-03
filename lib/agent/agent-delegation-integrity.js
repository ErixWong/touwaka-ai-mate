/**
 * Ephemeral integrity seal for accepted Agent delegation envelopes.
 *
 * The resident child runner should execute only delegations produced by the
 * current main process. A per-process HMAC is enough here because resident
 * child runs are not durable across server restarts.
 */

import crypto from 'crypto';

const ALGORITHM = 'hmac-sha256-ephemeral-v1';
const SECRET = crypto.randomBytes(32);

function isJsonOmittedValue(value) {
  return value === undefined || typeof value === 'function' || typeof value === 'symbol';
}

function normalizeJsonValue(value) {
  if (isJsonOmittedValue(value)) {
    return undefined;
  }
  if (typeof value === 'bigint') {
    throw new Error('delegation contains non-JSON bigint value');
  }
  if (value === null || typeof value !== 'object') {
    return Number.isFinite(value) || typeof value !== 'number' ? value : null;
  }
  if (typeof value.toJSON === 'function') {
    return normalizeJsonValue(value.toJSON());
  }
  if (Array.isArray(value)) {
    return value.map(item => {
      const normalized = normalizeJsonValue(item);
      return normalized === undefined ? null : normalized;
    });
  }

  const normalized = {};
  for (const key of Object.keys(value).sort()) {
    if (key === 'integrity') {
      continue;
    }
    const item = normalizeJsonValue(value[key]);
    if (item !== undefined) {
      normalized[key] = item;
    }
  }
  return normalized;
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(',')}]`;
  }

  const keys = Object.keys(value).filter(key => key !== 'integrity').sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function computeSignature(delegation) {
  const normalized = normalizeJsonValue(delegation);
  return crypto
    .createHmac('sha256', SECRET)
    .update(stableStringify(normalized))
    .digest('hex');
}

export function sealAgentDelegation(delegation) {
  if (!delegation || typeof delegation !== 'object') {
    throw new Error('delegation is required');
  }

  return Object.freeze({
    ...delegation,
    integrity: Object.freeze({
      algorithm: ALGORITHM,
      signature: computeSignature(delegation),
    }),
  });
}

export function verifyAgentDelegationIntegrity(delegation) {
  const expected = delegation?.integrity?.signature;
  if (delegation?.integrity?.algorithm !== ALGORITHM || typeof expected !== 'string') {
    return false;
  }

  const actual = computeSignature(delegation);
  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(actual, 'hex');
  return expectedBuffer.length === actualBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

export default {
  sealAgentDelegation,
  verifyAgentDelegationIntegrity,
};
