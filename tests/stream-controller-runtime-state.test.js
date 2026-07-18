/**
 * StreamController request runtime state machine 回归测试
 *
 * 覆盖 round01 审计要求：
 * - 结构化 runtime state（phase / stop_requested / round / recovery_attempt 等）
 * - 显式相位转移与终态 / stopping 保护区
 * - stopRequest 重定义为 request 级取消（不依赖活跃 transport）
 * - onComplete / onError 的 stopped 守卫
 * - recovering / recovered 事件驱动 running <-> recovering 转移
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../lib/utils.js', () => ({
  default: {
    newID: vi.fn(() => 'mockid1234567890'),
  },
}));

vi.mock('../services/system-setting.service.js', () => ({
  getSystemSettingService: vi.fn(() => ({
    getConnectionLimits: vi.fn().mockResolvedValue({
      max_per_user: 100,
      max_per_expert: 500,
    }),
  })),
}));

vi.mock('../services/permission.service.js', () => ({
  getPermissionService: vi.fn(() => ({
    canAccessExpert: vi.fn().mockResolvedValue(true),
  })),
}));

import StreamController from '../server/controllers/stream.controller.js';

function createMockDb({ chatRequestRecord = null } = {}) {
  const mockChatRequest = {
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue([1]),
    findOne: vi.fn().mockResolvedValue(chatRequestRecord),
  };

  const mockTopic = {
    findOne: vi.fn().mockResolvedValue({ id: 'topic_mock_001' }),
    create: vi.fn().mockResolvedValue({}),
  };

  const mockMessage = {
    findAll: vi.fn().mockResolvedValue([]),
    findOne: vi.fn().mockResolvedValue(null),
  };

  const mockExpert = {
    findOne: vi.fn().mockResolvedValue({ id: 'expert001', is_active: true }),
  };

  return {
    getModel: vi.fn((modelName) => {
      if (modelName === 'chat_request') return mockChatRequest;
      if (modelName === 'topic') return mockTopic;
      if (modelName === 'message') return mockMessage;
      if (modelName === 'expert') return mockExpert;
      return {};
    }),
    Op: { lte: Symbol('lte') },
    mockChatRequest,
  };
}

function createController({ chatRequestRecord, abortImpl } = {}) {
  const db = createMockDb({ chatRequestRecord });
  const chatService = {
    streamChat: vi.fn(),
    abortRequest: abortImpl || vi.fn().mockResolvedValue(true),
  };
  const controller = new StreamController(db, chatService);
  return { controller, db, chatService };
}

function seedConnection(controller, expertId, userId) {
  const res = { writableEnded: false, write: vi.fn() };
  controller.expertConnections.set(expertId, new Set([{ user_id: userId, res }]));
  return res;
}

const flushMicrotasks = async () => {
  for (let i = 0; i < 10; i++) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
};

describe('request runtime state machine', () => {
  let controller;
  let db;
  let chatService;

  beforeEach(() => {
    ({ controller, db, chatService } = createController());
  });

  it('创建 runtime state：初始相位 accepted，字段完整', () => {
    const state = controller._createRuntimeState('req_1', { expert_id: 'e1', user_id: 'u1' });

    expect(state).toMatchObject({
      request_id: 'req_1',
      expert_id: 'e1',
      user_id: 'u1',
      phase: 'accepted',
      stop_requested: false,
      round: 0,
      recovery_attempt: 0,
      has_active_transport: false,
      round_snapshot_ref: null,
    });
  });

  it('支持 accepted -> running -> recovering -> running -> completed 主链路转移', () => {
    controller._createRuntimeState('req_1', { expert_id: 'e1', user_id: 'u1' });

    controller._transitionRuntimeState('req_1', 'running');
    expect(controller._getRuntimeState('req_1').phase).toBe('running');

    controller._transitionRuntimeState('req_1', 'recovering', { round: 2, recovery_attempt: 1 });
    let state = controller._getRuntimeState('req_1');
    expect(state.phase).toBe('recovering');
    expect(state.round).toBe(2);
    expect(state.recovery_attempt).toBe(1);

    controller._transitionRuntimeState('req_1', 'running');
    expect(controller._getRuntimeState('req_1').phase).toBe('running');

    controller._transitionRuntimeState('req_1', 'completed');
    state = controller._getRuntimeState('req_1');
    expect(state.phase).toBe('completed');
    expect(state.has_active_transport).toBe(false);
  });

  it('终态保护区：completed / stopped 之后不再迁出', () => {
    controller._createRuntimeState('req_1', { expert_id: 'e1', user_id: 'u1' });
    controller._transitionRuntimeState('req_1', 'running');
    controller._transitionRuntimeState('req_1', 'completed');

    controller._transitionRuntimeState('req_1', 'recovering');
    expect(controller._getRuntimeState('req_1').phase).toBe('completed');

    controller._transitionRuntimeState('req_1', 'failed');
    expect(controller._getRuntimeState('req_1').phase).toBe('completed');
  });

  it('stopping 保护区：只允许进入 stopped，拒绝 recovering / running', () => {
    controller._createRuntimeState('req_1', { expert_id: 'e1', user_id: 'u1' });
    controller._transitionRuntimeState('req_1', 'running');
    controller._transitionRuntimeState('req_1', 'stopping', { stop_requested: true });

    controller._transitionRuntimeState('req_1', 'recovering');
    expect(controller._getRuntimeState('req_1').phase).toBe('stopping');

    controller._transitionRuntimeState('req_1', 'running');
    expect(controller._getRuntimeState('req_1').phase).toBe('stopping');

    controller._transitionRuntimeState('req_1', 'stopped');
    expect(controller._getRuntimeState('req_1').phase).toBe('stopped');
  });

  it('_isStopRequested 只读取 stop_requested 字段', () => {
    controller._createRuntimeState('req_1', { expert_id: 'e1', user_id: 'u1' });
    expect(controller._isStopRequested('req_1')).toBe(false);

    controller._transitionRuntimeState('req_1', 'running');
    expect(controller._isStopRequested('req_1')).toBe(false);

    controller._transitionRuntimeState('req_1', 'stopping', { stop_requested: true });
    expect(controller._isStopRequested('req_1')).toBe(true);

    expect(controller._isStopRequested('req_missing')).toBe(false);
  });
});

describe('stopRequest: request 级取消', () => {
  it('有内存态时：先 stopping 再 stopped，abort 仅为实现动作', async () => {
    const { controller, db, chatService } = createController({
      chatRequestRecord: {
        request_id: 'req_1',
        user_id: 'u1',
        expert_id: 'e1',
        status: 'running',
      },
    });
    const res = seedConnection(controller, 'e1', 'u1');

    controller._createRuntimeState('req_1', { expert_id: 'e1', user_id: 'u1' });
    controller._transitionRuntimeState('req_1', 'running');

    const result = await controller.stopRequest('req_1', 'u1');

    expect(result.success).toBe(true);
    expect(result.aborted).toBe(true);
    expect(chatService.abortRequest).toHaveBeenCalledWith('e1', 'req_1');

    const state = controller._getRuntimeState('req_1');
    expect(state.phase).toBe('stopped');
    expect(state.stop_requested).toBe(true);
    expect(state.has_active_transport).toBe(false);

    const stoppedWrite = res.write.mock.calls.map(([payload]) => payload).find(p => p.includes('event: stopped'));
    expect(stoppedWrite).toBeTruthy();

    const dbStoppedUpdate = db.mockChatRequest.update.mock.calls
      .map(([payload]) => payload)
      .find(p => p.status === 'stopped');
    expect(dbStoppedUpdate).toBeTruthy();
  });

  it('recovering backoff 中无活跃 transport 时：abort 返回 false 仍停止成功', async () => {
    const { controller, chatService } = createController({
      abortImpl: vi.fn().mockResolvedValue(false),
    });
    seedConnection(controller, 'e1', 'u1');

    controller._createRuntimeState('req_1', { expert_id: 'e1', user_id: 'u1' });
    controller._transitionRuntimeState('req_1', 'running');
    controller._transitionRuntimeState('req_1', 'recovering', { round: 2, recovery_attempt: 1 });

    const result = await controller.stopRequest('req_1', 'u1');

    expect(result.success).toBe(true);
    expect(result.aborted).toBe(false);
    expect(controller._getRuntimeState('req_1').phase).toBe('stopped');
    expect(controller._isStopRequested('req_1')).toBe(true);
  });

  it('abort transport 抛错不影响停止语义', async () => {
    const { controller } = createController({
      abortImpl: vi.fn().mockRejectedValue(new Error('transport boom')),
    });
    seedConnection(controller, 'e1', 'u1');

    controller._createRuntimeState('req_1', { expert_id: 'e1', user_id: 'u1' });
    controller._transitionRuntimeState('req_1', 'running');

    const result = await controller.stopRequest('req_1', 'u1');

    expect(result.success).toBe(true);
    expect(result.aborted).toBe(false);
    expect(controller._getRuntimeState('req_1').phase).toBe('stopped');
  });

  it('重复停止幂等：第二次返回 already_stopping 且不重复广播', async () => {
    const { controller } = createController();
    const res = seedConnection(controller, 'e1', 'u1');

    controller._createRuntimeState('req_1', { expert_id: 'e1', user_id: 'u1' });
    controller._transitionRuntimeState('req_1', 'running');

    await controller.stopRequest('req_1', 'u1');
    const writesAfterFirst = res.write.mock.calls.length;

    const second = await controller.stopRequest('req_1', 'u1');
    expect(second.success).toBe(true);
    expect(second.already_stopping).toBe(true);
    expect(res.write.mock.calls.length).toBe(writesAfterFirst);
  });

  it('内存态缺失且 DB 为 running：回退 DB 收口为 stopped', async () => {
    const { controller, db } = createController({
      chatRequestRecord: {
        request_id: 'req_db',
        user_id: 'u1',
        expert_id: 'e1',
        status: 'running',
      },
    });
    const res = seedConnection(controller, 'e1', 'u1');

    const result = await controller.stopRequest('req_db', 'u1');

    expect(result.success).toBe(true);
    expect(result.aborted).toBe(false);

    const dbStoppedUpdate = db.mockChatRequest.update.mock.calls
      .map(([payload]) => payload)
      .find(p => p.status === 'stopped');
    expect(dbStoppedUpdate).toBeTruthy();

    const stoppedWrite = res.write.mock.calls.map(([payload]) => payload).find(p => p.includes('event: stopped'));
    expect(stoppedWrite).toBeTruthy();
  });

  it('内存态缺失且 DB 已为终态：停止失败，交由前端 reconcile', async () => {
    const { controller } = createController({
      chatRequestRecord: {
        request_id: 'req_done',
        user_id: 'u1',
        expert_id: 'e1',
        status: 'completed',
      },
    });

    const result = await controller.stopRequest('req_done', 'u1');
    expect(result.success).toBe(false);
    expect(result.expert_id).toBe('e1');
  });

  it('用户不匹配：拒绝停止', async () => {
    const { controller } = createController();
    controller._createRuntimeState('req_1', { expert_id: 'e1', user_id: 'u1' });

    const result = await controller.stopRequest('req_1', 'other_user');
    expect(result.success).toBe(false);
    expect(controller._getRuntimeState('req_1').phase).toBe('accepted');
  });
});

describe('processMessageAsync 执行管线集成', () => {
  const baseParams = {
    request_id: 'req_pipe',
    topic_id: 'topic_1',
    user_id: 'u1',
    expert_id: 'e1',
    content: 'hello',
    model_id: null,
    task_id: null,
    working_path: null,
    session: { id: 'u1' },
  };

  function setupPipeline({ chatRequestRecord } = {}) {
    const record = chatRequestRecord || {
      request_id: 'req_pipe',
      user_id: 'u1',
      expert_id: 'e1',
      status: 'accepted',
    };
    const { controller, db, chatService } = createController({ chatRequestRecord: record });
    const res = seedConnection(controller, 'e1', 'u1');

    let captured = null;
    chatService.streamChat.mockImplementation((params, onDelta, onComplete, onError) => {
      captured = { params, onDelta, onComplete, onError };
      return new Promise(() => {});
    });

    const pending = controller.processMessageAsync({ ...baseParams });
    pending.catch(() => {});

    return { controller, db, chatService, res, getCaptured: () => captured };
  }

  it('执行管线注册 runtime state，并向 chatService 传递 shouldStop / runtimeState', async () => {
    const { controller, getCaptured } = setupPipeline();
    await flushMicrotasks();

    const captured = getCaptured();
    expect(captured).toBeTruthy();
    expect(typeof captured.params.shouldStop).toBe('function');
    expect(captured.params.shouldStop()).toBe(false);
    expect(captured.params.runtimeState).toBe(controller._getRuntimeState('req_pipe'));
    expect(captured.params.runtimeState.phase).toBe('running');
  });

  it('recovering / recovered delta 驱动 running <-> recovering 相位转移并广播', async () => {
    const { controller, res, getCaptured } = setupPipeline();
    await flushMicrotasks();
    const captured = getCaptured();

    captured.onDelta({ type: 'recovering', round: 2, attempt: 1, max_attempts: 2, content: '', reasoning_content: '' });
    let state = controller._getRuntimeState('req_pipe');
    expect(state.phase).toBe('recovering');
    expect(state.round).toBe(2);
    expect(state.recovery_attempt).toBe(1);

    const recoveringWrite = res.write.mock.calls.map(([p]) => p).find(p => p.includes('event: recovering'));
    expect(recoveringWrite).toBeTruthy();

    captured.onDelta({ type: 'recovered', round: 2, attempt: 1 });
    state = controller._getRuntimeState('req_pipe');
    expect(state.phase).toBe('running');

    const recoveredWrite = res.write.mock.calls.map(([p]) => p).find(p => p.includes('event: recovered'));
    expect(recoveredWrite).toBeTruthy();
  });

  it('stop 之后 onComplete 不得覆盖 stopped（不广播 complete，不写 completed）', async () => {
    const { controller, db, res, getCaptured } = setupPipeline();
    await flushMicrotasks();
    const captured = getCaptured();

    await controller.stopRequest('req_pipe', 'u1');
    expect(captured.params.shouldStop()).toBe(true);

    captured.onComplete({ message: { id: 'msg_1', topic_id: 'topic_1' }, user_message_id: 'u_msg_1' });
    await flushMicrotasks();

    const completeWrite = res.write.mock.calls.map(([p]) => p).find(p => p.includes('event: complete'));
    expect(completeWrite).toBeUndefined();

    const completedUpdate = db.mockChatRequest.update.mock.calls
      .map(([payload]) => payload)
      .find(p => p.status === 'completed');
    expect(completedUpdate).toBeUndefined();

    expect(controller._getRuntimeState('req_pipe')).toBeNull();
  });

  it('stop 之后 onError 收口为 stopped，不再广播 error', async () => {
    const { controller, db, res, getCaptured } = setupPipeline();
    await flushMicrotasks();
    const captured = getCaptured();

    await controller.stopRequest('req_pipe', 'u1');
    captured.onError(new Error('Request aborted by user'));
    await flushMicrotasks();

    const errorWrite = res.write.mock.calls.map(([p]) => p).find(p => p.includes('event: error'));
    expect(errorWrite).toBeUndefined();

    const stoppedUpdates = db.mockChatRequest.update.mock.calls
      .map(([payload]) => payload)
      .filter(p => p.status === 'stopped');
    expect(stoppedUpdates.length).toBeGreaterThanOrEqual(1);

    expect(controller._getRuntimeState('req_pipe')).toBeNull();
  });

  it('恢复耗尽失败：onError 非停止错误进入 failed 并广播 error', async () => {
    const { controller, db, res, getCaptured } = setupPipeline();
    await flushMicrotasks();
    const captured = getCaptured();

    captured.onDelta({ type: 'recovering', round: 2, attempt: 2, max_attempts: 2, content: '', reasoning_content: '' });
    expect(controller._getRuntimeState('req_pipe').phase).toBe('recovering');

    captured.onError(new Error('socket hang up'));
    await flushMicrotasks();

    const failedUpdate = db.mockChatRequest.update.mock.calls
      .map(([payload]) => payload)
      .find(p => p.status === 'failed');
    expect(failedUpdate).toBeTruthy();

    const errorWrite = res.write.mock.calls.map(([p]) => p).find(p => p.includes('event: error'));
    expect(errorWrite).toBeTruthy();

    expect(controller._getRuntimeState('req_pipe')).toBeNull();
  });
});
