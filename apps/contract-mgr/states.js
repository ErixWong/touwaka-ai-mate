const INITIAL_STATE = 'pending_ocr';
const CONFIRMED_STATE = 'confirmed';
const PENDING_REVIEW_STATE = 'pending_review';

const FAILED_STATES = ['ocr_failed', 'clean_failed', 'extract_failed', 'section_failed'];
const PROCESSING_STATES = ['ocr_processing', 'cleaning', 'extract_processing', 'section_processing'];
const PENDING_STATES = ['pending_ocr', 'pending_clean', 'pending_extract', 'pending_section'];

const STATE_GRAPH = {
  pending_ocr: { success_next: 'ocr_processing', failure_next: 'ocr_failed' },
  ocr_processing: { success_next: 'pending_clean', failure_next: 'ocr_failed', is_processing: true },
  pending_clean: { success_next: 'cleaning', failure_next: 'clean_failed' },
  cleaning: { success_next: 'pending_extract', failure_next: 'clean_failed', is_processing: true },
  pending_extract: { success_next: 'extract_processing', failure_next: 'extract_failed' },
  extract_processing: { success_next: 'pending_section', failure_next: 'extract_failed', is_processing: true },
  pending_section: { success_next: 'section_processing', failure_next: 'section_failed' },
  section_processing: { success_next: 'pending_review', failure_next: 'section_failed', is_processing: true },
  pending_review: { success_next: null, failure_next: null },
  confirmed: { success_next: null, failure_next: null, is_terminal: true },
  ocr_failed: { success_next: null, failure_next: null, is_error: true },
  clean_failed: { success_next: null, failure_next: null, is_error: true },
  extract_failed: { success_next: null, failure_next: null, is_error: true },
  section_failed: { success_next: null, failure_next: null, is_error: true },
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