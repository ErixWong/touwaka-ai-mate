/**
 * Child run scheduler.
 *
 * In-memory async scheduler for delegated child Agent runs. It owns run state
 * and cancellation flags, while actual child execution remains injected.
 */

const TERMINAL_STATUSES = Object.freeze([
  'completed',
  'failed',
  'cancelled',
]);

function assertFunction(value, name) {
  if (typeof value !== 'function') {
    throw new Error(`${name} is required`);
  }
}

function assertDelegation(delegation) {
  if (!delegation || typeof delegation !== 'object') {
    throw new Error('delegation is required');
  }
  if (!delegation.child_invocation?.run_id) {
    throw new Error('delegation.child_invocation.run_id is required');
  }
}

function defaultIsCancelledError(error) {
  return error?.message === 'Request aborted by user' || error?.name === 'AbortError';
}

function nowIso() {
  return new Date().toISOString();
}

function buildRunSnapshot(record) {
  return Object.freeze({
    child_run_id: record.child_run_id,
    parent_run_id: record.parent_run_id,
    principal_user_id: record.principal_user_id,
    caller_agent_id: record.caller_agent_id,
    callee_agent_id: record.callee_agent_id,
    status: record.status,
    cancel_requested: record.cancel_requested,
    queued_at: record.queued_at,
    started_at: record.started_at,
    completed_at: record.completed_at,
    failed_at: record.failed_at,
    cancelled_at: record.cancelled_at,
    error: record.error,
    has_result: record.result !== null,
    event_count: record.events.length,
  });
}

function buildResultSnapshot(record) {
  return Object.freeze({
    ...buildRunSnapshot(record),
    result: record.result,
    events: Object.freeze(record.events.map(event => Object.freeze({ ...event }))),
  });
}

export class InMemoryChildRunScheduler {
  constructor({
    create_child_executor,
    is_cancelled_error = defaultIsCancelledError,
  } = {}) {
    assertFunction(create_child_executor, 'create_child_executor');
    assertFunction(is_cancelled_error, 'is_cancelled_error');

    this.create_child_executor = create_child_executor;
    this.is_cancelled_error = is_cancelled_error;
    this.runs = new Map();
  }

  start(delegation, options = {}) {
    assertDelegation(delegation);
    const invocation = delegation.child_invocation;
    const child_run_id = invocation.run_id;

    if (this.runs.has(child_run_id)) {
      throw new Error(`child run already scheduled: ${child_run_id}`);
    }

    const record = {
      child_run_id,
      parent_run_id: invocation.parent_run_id || null,
      principal_user_id: invocation.principal_user_id,
      caller_agent_id: invocation.caller_agent_id,
      callee_agent_id: invocation.callee_agent_id,
      status: 'queued',
      cancel_requested: false,
      queued_at: nowIso(),
      started_at: null,
      completed_at: null,
      failed_at: null,
      cancelled_at: null,
      error: null,
      result: null,
      events: [],
      completion_promise: null,
    };

    this.runs.set(child_run_id, record);
    record.completion_promise = this.runRecord(record, delegation, options);

    return buildRunSnapshot(record);
  }

  getStatus(child_run_id) {
    const record = this.getRecord(child_run_id);
    return buildRunSnapshot(record);
  }

  getResult(child_run_id) {
    const record = this.getRecord(child_run_id);
    if (record.status !== 'completed') {
      throw new Error(`child run is not completed: ${record.status}`);
    }

    return buildResultSnapshot(record);
  }

  getEvents(child_run_id) {
    const record = this.getRecord(child_run_id);
    return Object.freeze(record.events.map(event => Object.freeze({ ...event })));
  }

  cancel(child_run_id) {
    const record = this.getRecord(child_run_id);
    if (TERMINAL_STATUSES.includes(record.status)) {
      return buildRunSnapshot(record);
    }

    record.cancel_requested = true;
    if (record.status === 'queued') {
      record.status = 'cancelled';
      record.cancelled_at = nowIso();
      record.error = 'Request aborted by user';
    }

    return buildRunSnapshot(record);
  }

  async waitForCompletion(child_run_id) {
    const record = this.getRecord(child_run_id);
    await record.completion_promise;
    return buildRunSnapshot(record);
  }

  getRecord(child_run_id) {
    const record = this.runs.get(child_run_id);
    if (!record) {
      throw new Error(`child run not found: ${child_run_id}`);
    }
    return record;
  }

  async runRecord(record, delegation, options) {
    await Promise.resolve();
    if (record.status === 'cancelled') {
      return;
    }

    record.status = 'running';
    record.started_at = nowIso();

    const runtimeState = {};
    const onDelta = event => {
      record.events.push(event);
      options.onDelta?.(event);
    };
    const shouldStop = () => record.cancel_requested || Boolean(options.shouldStop?.());

    try {
      const childExecutor = this.create_child_executor({
        session: options.session ?? null,
        onDelta,
        shouldStop,
        runtimeState,
      });
      if (!childExecutor || typeof childExecutor.execute !== 'function') {
        throw new Error('create_child_executor must return child_executor.execute');
      }

      const result = await childExecutor.execute(delegation);
      if (record.cancel_requested) {
        record.status = 'cancelled';
        record.cancelled_at = nowIso();
        record.error = 'Request aborted by user';
        return;
      }

      record.status = 'completed';
      record.completed_at = nowIso();
      record.result = result;
    } catch (error) {
      if (record.cancel_requested || this.is_cancelled_error(error)) {
        record.status = 'cancelled';
        record.cancelled_at = nowIso();
      } else {
        record.status = 'failed';
        record.failed_at = nowIso();
      }
      record.error = error?.message || String(error);
    }
  }
}

export default {
  InMemoryChildRunScheduler,
};
