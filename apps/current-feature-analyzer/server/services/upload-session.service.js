import Utils from '../../../../lib/utils.js';
import logger from '../../../../lib/logger.js';

const sessions = new Map();

const SESSION_TTL = 2 * 60 * 60 * 1000;

function now() {
  return Date.now();
}

function pruneExpiredSessions() {
  const cutoff = now() - SESSION_TTL;
  for (const [batchId, session] of sessions) {
    if (session._created_at && session._created_at < cutoff) {
      sessions.delete(batchId);
      logger.info(`[cfa session] pruned expired batch: ${batchId}`);
    }
  }
}

class UploadSessionService {
  constructor(db) {
    this.db = db;
  }

  createBatch(fileNames = []) {
    pruneExpiredSessions();
    const batchId = `cfa_${Utils.newID(16)}`;
    const session = {
      batch_id: batchId,
      _created_at: now(),
      batch_status: 'ready',
      selected_rule_set_id: null,
      files: fileNames.map((name, i) => ({
        file_id: `file_${batchId}_${i}`,
        file_name: name,
        file_size: 0,
        row_count: null,
        time_column: null,
        current_column: null,
        rule_set_id: null,
        analysis_status: 'pending',
        warning_count: 0,
        error_message: null,
        raw_data: null,
        result: null,
      })),
      summary: null,
    };
    sessions.set(batchId, session);
    return session;
  }

  getBatch(batchId) {
    return sessions.get(batchId) || null;
  }

  setFileRawData(batchId, fileId, rawData, parsed) {
    const session = sessions.get(batchId);
    if (!session) return null;
    const file = session.files.find(f => f.file_id === fileId);
    if (!file) return null;
    file.raw_data = rawData;
    file.row_count = parsed.row_count;
    file.time_column = parsed.time_column;
    file.current_column = parsed.current_column;
    file.file_size = parsed.file_size;
    file.analysis_status = 'ready';
    return file;
  }

  setFileResult(batchId, fileId, result) {
    const session = sessions.get(batchId);
    if (!session) return null;
    const file = session.files.find(f => f.file_id === fileId);
    if (!file) return null;
    file.result = result;
    const hasError = !!result.llm_result?._error;
    file.analysis_status = hasError ? 'failed' : 'completed';
    file.warning_count = (result.llm_result?.warnings || []).length;
    if (hasError && !file.error_message) {
      file.error_message = result.llm_result._error;
    }
    return file;
  }

  setFileError(batchId, fileId, errorMessage) {
    const session = sessions.get(batchId);
    if (!session) return null;
    const file = session.files.find(f => f.file_id === fileId);
    if (!file) return null;
    file.analysis_status = 'failed';
    file.error_message = errorMessage;
    return file;
  }

  setBatchStatus(batchId, status) {
    const session = sessions.get(batchId);
    if (!session) return;
    session.batch_status = status;
  }

  setSelectedRuleSet(batchId, ruleSetId) {
    const session = sessions.get(batchId);
    if (!session) return;
    session.selected_rule_set_id = ruleSetId;
  }

  buildSummary(batchId) {
    const session = sessions.get(batchId);
    if (!session) return null;
    const successCount = session.files.filter(f => f.analysis_status === 'completed').length;
    const failedCount = session.files.filter(f => f.analysis_status === 'failed').length;
    const summary = {
      file_total: session.files.length,
      success_count: successCount,
      failed_count: failedCount,
      stage_distribution: [],
    };
    session.summary = summary;
    if (failedCount === session.files.length) {
      session.batch_status = 'failed';
    } else if (failedCount > 0) {
      session.batch_status = 'partial_failed';
    } else {
      session.batch_status = 'completed';
    }
    return summary;
  }

  getBatchSummary(batchId) {
    return sessions.get(batchId) || null;
  }
}

export default UploadSessionService;
