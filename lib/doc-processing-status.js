export const DOC_PROCESSING_SEQUENCE = [
  'pending_ocr',
  'ocr_processing',
  'pending_clean',
  'pending_outline',
  'pending_chunk',
  'pending_embedding',
  'ready',
  'error',
];

export const DOC_PROCESSING_TERMINAL_STATUS = new Set(['ready', 'error']);

export function isTerminalStatus(status) {
  return DOC_PROCESSING_TERMINAL_STATUS.has(status);
}

export function normalizeLegacyStatus(status) {
  if (status === 'pending_metadata') return 'pending_outline';
  if (status === 'pending_relocate') return 'ready';
  return status;
}

export function isValidStatus(status) {
  return DOC_PROCESSING_SEQUENCE.includes(status);
}

export function getNextStatus(currentStatus) {
  if (currentStatus === 'ready' || currentStatus === 'error') {
    return null;
  }
  const idx = DOC_PROCESSING_SEQUENCE.indexOf(currentStatus);
  if (idx === -1 || idx >= DOC_PROCESSING_SEQUENCE.length - 1) {
    return null;
  }
  return DOC_PROCESSING_SEQUENCE[idx + 1];
}

export default {
  DOC_PROCESSING_SEQUENCE,
  DOC_PROCESSING_TERMINAL_STATUS,
  isTerminalStatus,
  normalizeLegacyStatus,
  isValidStatus,
  getNextStatus,
};
