/**
 * Resident child run scheduler adapter.
 *
 * Bridges the ChildRunScheduler contract to a resident worker. The worker is
 * expected to implement a single invoke-style tool that accepts an action.
 */

const DEFAULT_SKILL_ID = 'agent-child-runner';
const DEFAULT_TOOL_NAME = 'invoke';
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_WAIT_TIMEOUT_MS = 10 * 60 * 1000;
const TERMINAL_STATUSES = Object.freeze(['completed', 'failed', 'cancelled']);

function assertResidentSkillManager(value) {
  if (!value || typeof value.invokeByName !== 'function') {
    throw new Error('resident_skill_manager.invokeByName is required');
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

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class ResidentChildRunScheduler {
  constructor({
    resident_skill_manager,
    skill_id = DEFAULT_SKILL_ID,
    tool_name = DEFAULT_TOOL_NAME,
    timeout_ms = DEFAULT_TIMEOUT_MS,
    poll_interval_ms = DEFAULT_POLL_INTERVAL_MS,
    wait_timeout_ms = DEFAULT_WAIT_TIMEOUT_MS,
  } = {}) {
    assertResidentSkillManager(resident_skill_manager);

    this.resident_skill_manager = resident_skill_manager;
    this.skill_id = skill_id;
    this.tool_name = tool_name;
    this.timeout_ms = timeout_ms;
    this.poll_interval_ms = poll_interval_ms;
    this.wait_timeout_ms = wait_timeout_ms;
  }

  async start(delegation, options = {}) {
    assertDelegation(delegation);
    return await this.invoke('start', {
      delegation,
      options: {
        session: options.session ?? null,
      },
    }, options);
  }

  async getStatus(child_run_id) {
    assertChildRunId(child_run_id);
    return await this.invoke('status', { child_run_id });
  }

  async getResult(child_run_id) {
    assertChildRunId(child_run_id);
    return await this.invoke('result', { child_run_id });
  }

  async getEvents(child_run_id) {
    assertChildRunId(child_run_id);
    return await this.invoke('events', { child_run_id });
  }

  async cancel(child_run_id) {
    assertChildRunId(child_run_id);
    return await this.invoke('cancel', { child_run_id });
  }

  async waitForCompletion(child_run_id, options = {}) {
    assertChildRunId(child_run_id);

    const timeoutMs = options.timeout_ms ?? this.wait_timeout_ms;
    const pollIntervalMs = options.poll_interval_ms ?? this.poll_interval_ms;
    const startedAt = Date.now();

    while (true) {
      const status = await this.getStatus(child_run_id);
      if (TERMINAL_STATUSES.includes(status.status)) {
        return status;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(`Timed out waiting for child run: ${child_run_id}`);
      }

      await delay(pollIntervalMs);
    }
  }

  async invoke(action, payload = {}, options = {}) {
    return await this.resident_skill_manager.invokeByName(
      this.skill_id,
      this.tool_name,
      {
        action,
        ...payload,
      },
      {
        session: options.session ?? null,
      },
      options.timeout_ms ?? this.timeout_ms,
    );
  }
}

export default {
  ResidentChildRunScheduler,
};
