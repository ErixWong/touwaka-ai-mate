const INITIAL_STATE = 'pending_process';
const CONFIRMED_STATE = 'confirmed';
const PENDING_REVIEW_STATE = 'pending_review';

const FAILED_STATES = ['extract_failed'];
const PROCESSING_STATES = ['pending_vl_extract'];

const STATE_GRAPH = {
  pending_process: { success_next: 'pending_review', failure_next: 'pending_vl_extract' },
  pending_vl_extract: { success_next: 'pending_review', failure_next: 'extract_failed' },
  pending_review: { success_next: null, failure_next: null },
  confirmed: { success_next: null, failure_next: null, is_terminal: true },
  extract_failed: { success_next: null, failure_next: null, is_error: true },
};

export function getInitialState() {
  return INITIAL_STATE;
}

export function getConfirmedState() {
  return CONFIRMED_STATE;
}

export function getStateGraph() {
  return STATE_GRAPH;
}

export function classifyStatus(status) {
  if (status === CONFIRMED_STATE || status === PENDING_REVIEW_STATE) {
    return 'completed';
  }
  if (FAILED_STATES.includes(status) || (status && status.endsWith('_failed'))) {
    return 'failed';
  }
  return 'processing';
}

export function getStatusSummaryCategories(results) {
  let completed = 0;
  let processing = 0;
  let failed = 0;
  const byStatus = {};
  let total = 0;

  for (const row of results) {
    const status = row.status || 'unknown';
    const count = row.count;
    byStatus[status] = count;
    total += count;

    const category = classifyStatus(status);
    if (category === 'completed') completed += count;
    else if (category === 'failed') failed += count;
    else processing += count;
  }

  return { total, by_status: byStatus, completed, processing, failed };
}

export default {
  getInitialState,
  getConfirmedState,
  getStateGraph,
  classifyStatus,
  getStatusSummaryCategories,
};