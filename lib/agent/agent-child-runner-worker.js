/**
 * Resident child Agent runner worker.
 *
 * Owns child run records inside a resident process. The actual child execution
 * is injected so the worker protocol stays independent from process bootstrapping.
 */

const TERMINAL_STATUSES = Object.freeze(['completed', 'failed', 'cancelled']);

function assertFunction(value, name) {
  if (typeof value !== 'function') {
    throw new Error(`${name} is required`);
  }
}

function assertChildRunId(child_run_id) {
  if (typeof child_run_id !== 'string' || child_run_id.trim() === '') {
    throw new Error('child_run_id is required');
  }
}

function assertDelegation(delegation) {
  if (!delegation?.child_invocation?.run_id) {
    throw new Error('delegation.child_invocation.run_id is required');
  }
}

function defaultIsCancelledError(error) {
  return error?.message === 'Request aborted by user' || error?.name === 'AbortError';
}

function nowIso() {
  return new Date().toISOString();
}

function freezeEvents(events) {
  return Object.freeze(events.map(event => Object.freeze({ ...event })));
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
    events: freezeEvents(record.events),
  });
}

export class AgentChildRunnerWorker {
  constructor({
    execute_child_run,
    is_cancelled_error = defaultIsCancelledError,
  } = {}) {
    assertFunction(execute_child_run, 'execute_child_run');
    assertFunction(is_cancelled_error, 'is_cancelled_error');

    this.execute_child_run = execute_child_run;
    this.is_cancelled_error = is_cancelled_error;
    this.runs = new Map();
  }

  handleAction(params = {}) {
    switch (params.action) {
      case 'start':
        return this.start(params.delegation, params.options || {});
      case 'status':
        return this.getStatus(params.child_run_id);
      case 'result':
        return this.getResult(params.child_run_id);
      case 'events':
        return this.getEvents(params.child_run_id);
      case 'cancel':
        return this.cancel(params.child_run_id);
      default:
        throw new Error(`Unknown child runner action: ${params.action}`);
    }
  }

  start(delegation, options = {}) {
    assertDelegation(delegation);

    const invocation = delegation.child_invocation;
    const child_run_id = invocation.run_id;
    if (this.runs.has(child_run_id)) {
      throw new Error(`child run already exists: ${child_run_id}`);
    }

    const record = {
      child_run_id,
      parent_run_id: invocation.parent_run_id || null,
      principal_user_id: invocation.principal_user_id || null,
      caller_agent_id: invocation.caller_agent_id || null,
      callee_agent_id: invocation.callee_agent_id || null,
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
    return buildRunSnapshot(this.getRecord(child_run_id));
  }

  getResult(child_run_id) {
    const record = this.getRecord(child_run_id);
    if (record.status !== 'completed') {
      throw new Error(`child run is not completed: ${record.status}`);
    }

    return buildResultSnapshot(record);
  }

  getEvents(child_run_id) {
    return freezeEvents(this.getRecord(child_run_id).events);
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

  getRecord(child_run_id) {
    assertChildRunId(child_run_id);
    const record = this.runs.get(child_run_id);
    if (!record) {
      throw new Error(`child run not found: ${child_run_id}`);
    }
    return record;
  }

  async waitForCompletion(child_run_id) {
    const record = this.getRecord(child_run_id);
    await record.completion_promise;
    return buildRunSnapshot(record);
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
    };
    const shouldStop = () => record.cancel_requested;

    try {
      const result = await this.execute_child_run({
        delegation,
        session: options.session ?? null,
        onDelta,
        shouldStop,
        runtimeState,
      });

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
  AgentChildRunnerWorker,
};
