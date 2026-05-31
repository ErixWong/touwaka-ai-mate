import Utils from './utils.js';

const tasks = new Map();
const queue = [];

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

export function createTask({ userId, imageDataUrl, prompt }) {
  const id = Utils.newID(20);
  const task = {
    id,
    user_id: userId,
    status: 'pending',
    prompt: prompt || '',
    image_data_url: imageDataUrl,
    result: '',
    error: '',
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  tasks.set(id, task);
  queue.push(id);
  return task;
}

export function getTask(taskId) {
  return tasks.get(taskId) || null;
}

export function getProcessingCount() {
  let count = 0;
  for (const task of tasks.values()) {
    if (task.status === 'processing') count += 1;
  }
  return count;
}

export function getNextPendingTaskIds(limit) {
  const ids = [];
  while (queue.length > 0 && ids.length < limit) {
    const id = queue.shift();
    const task = tasks.get(id);
    if (!task) continue;
    if (task.status !== 'pending') continue;
    ids.push(id);
  }
  return ids;
}

export function markProcessing(taskId) {
  const task = tasks.get(taskId);
  if (!task) return null;
  task.status = 'processing';
  task.updated_at = nowIso();
  return task;
}

export function completeTask(taskId, result) {
  const task = tasks.get(taskId);
  if (!task) return null;
  task.status = 'done';
  task.result = result || '';
  task.error = '';
  task.image_data_url = '';
  task.updated_at = nowIso();
  return task;
}

export function failTask(taskId, error) {
  const task = tasks.get(taskId);
  if (!task) return null;
  task.status = 'error';
  task.error = error || 'unknown_error';
  task.image_data_url = '';
  task.updated_at = nowIso();
  return task;
}

export function pruneTasks(ttlMs = DEFAULT_TTL_MS) {
  const cutoff = Date.now() - ttlMs;
  for (const [id, task] of tasks.entries()) {
    const updated = Date.parse(task.updated_at || task.created_at || '');
    if (!Number.isNaN(updated) && updated < cutoff) {
      tasks.delete(id);
    }
  }
}
