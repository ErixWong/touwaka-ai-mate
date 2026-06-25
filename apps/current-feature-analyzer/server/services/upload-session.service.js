import Utils from '../../../../lib/utils.js';
import logger from '../../../../lib/logger.js';
import {
  BATCH_STATUS,
  FILE_ANALYSIS_STATUS,
  SESSION_TTL_MS,
} from '../../states.js';

const sessions = new Map();

function now() {
  return Date.now();
}

function pruneExpiredSessions() {
  const cutoff = now() - SESSION_TTL_MS;
  for (const [batchId, session] of sessions) {
    if (session._created_at && session._created_at < cutoff) {
      sessions.delete(batchId);
      logger.info(`[cfa session] pruned expired batch: ${batchId}`);
    }
  }
}

/**
 * 会话 DTO 工厂：创建标准批次对象
 */
function createBatchSession(batchId, ownerUserId, fileNames) {
  return {
    batch_id: batchId,
    _created_at: now(),
    owner_user_id: ownerUserId,
    batch_status: BATCH_STATUS.READY,
    selected_rule_set_id: null,
    files: fileNames.map((name, i) => createSessionFile(batchId, i, name)),
    summary: null,
  };
}

/**
 * 文件 DTO 工厂：创建标准文件对象
 */
function createSessionFile(batchId, index, fileName) {
  return {
    file_id: `file_${batchId}_${index}`,
    file_name: fileName,
    file_size: 0,
    row_count: null,
    time_column: null,
    current_column: null,
    rule_set_id: null,
    analysis_status: FILE_ANALYSIS_STATUS.PENDING,
    warning_count: 0,
    error_message: null,
    raw_data: null,
    result: null,
  };
}

/**
 * 批次终态归约 —— 唯一决策点
 * 根据所有文件状态推导出唯一、可预期的批次终态
 */
function finalizeBatchStatus(batch) {
  const successCount = batch.files.filter(f => f.analysis_status === FILE_ANALYSIS_STATUS.COMPLETED).length;
  const failedCount = batch.files.filter(f => f.analysis_status === FILE_ANALYSIS_STATUS.FAILED).length;

  if (failedCount === batch.files.length) {
    batch.batch_status = BATCH_STATUS.FAILED;
  } else if (failedCount > 0) {
    batch.batch_status = BATCH_STATUS.PARTIAL_FAILED;
  } else {
    batch.batch_status = BATCH_STATUS.COMPLETED;
  }
  return batch.batch_status;
}

/**
 * 后端批次状态迁移表
 *
 * 说明：IDLE / UPLOADING 为前端视觉状态，不经过后端迁移表。
 * 后端仅管理 READY -> ANALYZING -> terminal 这一段。
 * 终态不可再迁移，防止异常路径覆盖已完成的分析结果。
 */
const BATCH_TRANSITIONS = {
  [BATCH_STATUS.READY]: [BATCH_STATUS.ANALYZING],
  [BATCH_STATUS.ANALYZING]: [BATCH_STATUS.COMPLETED, BATCH_STATUS.PARTIAL_FAILED, BATCH_STATUS.FAILED],
};

/**
 * 文件分析状态迁移表
 *
 * 说明：PARSING 为预留状态（当前未启用），保留迁移定义以备未来细化上传解析阶段。
 */
const FILE_TRANSITIONS = {
  [FILE_ANALYSIS_STATUS.PENDING]: [FILE_ANALYSIS_STATUS.READY, FILE_ANALYSIS_STATUS.FAILED],
  [FILE_ANALYSIS_STATUS.READY]: [FILE_ANALYSIS_STATUS.ANALYZING, FILE_ANALYSIS_STATUS.FAILED],
  [FILE_ANALYSIS_STATUS.ANALYZING]: [FILE_ANALYSIS_STATUS.COMPLETED, FILE_ANALYSIS_STATUS.FAILED],
};

function transitionBatchStatus(batch, targetStatus) {
  const current = batch.batch_status;
  const allowed = BATCH_TRANSITIONS[current];
  if (!allowed || !allowed.includes(targetStatus)) {
    logger.warn(`[cfa session] invalid batch transition: ${current} -> ${targetStatus}`);
    return false;
  }
  batch.batch_status = targetStatus;
  return true;
}

function transitionFileStatus(file, targetStatus) {
  const current = file.analysis_status;
  const allowed = FILE_TRANSITIONS[current];
  if (!allowed || !allowed.includes(targetStatus)) {
    logger.warn(`[cfa session] invalid file transition: ${current} -> ${targetStatus} (file: ${file.file_id})`);
    return false;
  }
  file.analysis_status = targetStatus;
  return true;
}

class UploadSessionService {
  constructor(db) {
    this.db = db;
  }

  createBatch(fileNames = [], ownerUserId = null) {
    pruneExpiredSessions();
    const batchId = `cfa_${Utils.newID(16)}`;
    const session = createBatchSession(batchId, ownerUserId, fileNames);
    sessions.set(batchId, session);
    return session;
  }

  getBatch(batchId) {
    return sessions.get(batchId) || null;
  }

  /**
   * 校验批次归属：非拥有者不可访问
   */
  isBatchOwner(batchId, userId) {
    const session = sessions.get(batchId);
    if (!session) return false;
    if (!session.owner_user_id) return true; // 兼容旧批次（无 owner_user_id）
    return session.owner_user_id === userId;
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
    transitionFileStatus(file, FILE_ANALYSIS_STATUS.READY);
    return file;
  }

  setFileResult(batchId, fileId, result) {
    const session = sessions.get(batchId);
    if (!session) return null;
    const file = session.files.find(f => f.file_id === fileId);
    if (!file) return null;
    file.result = result;
    const hasError = !!result.llm_result?._error;
    if (hasError) {
      transitionFileStatus(file, FILE_ANALYSIS_STATUS.FAILED);
      if (!file.error_message) {
        file.error_message = result.llm_result._error;
      }
    }
    // 注：成功状态由 setFileStatus 显式设置，此处不隐式修改
    file.warning_count = (result.llm_result?.warnings || []).length;
    return file;
  }

  setFileStatus(batchId, fileId, status) {
    const session = sessions.get(batchId);
    if (!session) return;
    const file = session.files.find(f => f.file_id === fileId);
    if (file) transitionFileStatus(file, status);
  }

  setFileError(batchId, fileId, errorMessage) {
    const session = sessions.get(batchId);
    if (!session) return null;
    const file = session.files.find(f => f.file_id === fileId);
    if (!file) return null;
    transitionFileStatus(file, FILE_ANALYSIS_STATUS.FAILED);
    file.error_message = errorMessage;
    return file;
  }

  setBatchStatus(batchId, status) {
    const session = sessions.get(batchId);
    if (!session) return;
    transitionBatchStatus(session, status);
  }

  setSelectedRuleSet(batchId, ruleSetId) {
    const session = sessions.get(batchId);
    if (!session) return;
    session.selected_rule_set_id = ruleSetId;
  }

  /**
   * 构建批次汇总 —— 同时触发批次终态归约
   * 这是批次终态的唯一决策点
   */
  buildSummary(batchId) {
    const session = sessions.get(batchId);
    if (!session) return null;
    const successCount = session.files.filter(f => f.analysis_status === FILE_ANALYSIS_STATUS.COMPLETED).length;
    const failedCount = session.files.filter(f => f.analysis_status === FILE_ANALYSIS_STATUS.FAILED).length;
    const summary = {
      file_total: session.files.length,
      success_count: successCount,
      failed_count: failedCount,
      stage_distribution: [],
    };
    session.summary = summary;
    // 唯一决策点：批次终态归约
    finalizeBatchStatus(session);
    return summary;
  }

  getBatchSummary(batchId) {
    return sessions.get(batchId) || null;
  }
}

export default UploadSessionService;
