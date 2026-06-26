/**
 * StreamController sendMessage 标准化与调用次数回归测试
 *
 * 审计 Round 08 要求：
 * - 验证 sendMessage() 只触发一次 processMessageAsync()
 * - 验证控制器内部统一使用 normalizedTaskDbId，不并行透传原始 task_id
 * - 覆盖 task_db_id 和旧 task_id 兼容场景
 *
 * 测试重点：边界层标准化与"只调度一次"
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock 依赖模块
vi.mock('../../lib/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
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

// 导入被测模块（在 mock 之后）
import StreamController from '../server/controllers/stream.controller.js';

/**
 * 创建 Mock Database
 */
function createMockDb() {
  const mockChatRequest = {
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue([1]),
    findOne: vi.fn().mockResolvedValue(null),
  };

  const mockTopic = {
    findOne: vi.fn().mockResolvedValue({ id: 'topic_mock_001' }),
    create: vi.fn().mockResolvedValue({}),
  };

  const mockExpert = {
    findOne: vi.fn().mockResolvedValue({ id: 'expert001', is_active: true }),
  };

  return {
    getModel: vi.fn((modelName) => {
      if (modelName === 'chat_request') return mockChatRequest;
      if (modelName === 'topic') return mockTopic;
      if (modelName === 'expert') return mockExpert;
      return {};
    }),
    Op: { lte: Symbol('lte') },
    query: vi.fn(),
    sequelize: {
      transaction: vi.fn().mockResolvedValue({
        commit: vi.fn(),
        rollback: vi.fn(),
      }),
    },
    _mockChatRequest: mockChatRequest,
    _mockTopic: mockTopic,
    _mockExpert: mockExpert,
  };
}

/**
 * 创建 Mock ChatService
 */
function createMockChatService() {
  return {
    streamChat: vi.fn().mockResolvedValue({}),
    abortRequest: vi.fn().mockResolvedValue(true),
  };
}

/**
 * 创建模拟 Koa ctx
 */
function createMockCtx(body = {}) {
  return {
    request: { body },
    state: {
      session: { id: 'user001' },
    },
    success: vi.fn(),
    error: vi.fn(),
    status: 200,
    set: vi.fn(),
  };
}

describe('StreamController sendMessage 标准化回归测试', () => {

  let mockDb;
  let mockChatService;
  let controller;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    mockChatService = createMockChatService();
    controller = new StreamController(mockDb, mockChatService);

    // 设置 SSE 连接，让 sendMessage 不在连接检查处退出
    controller.expertConnections.set('expert001', new Set([
      { user_id: 'user001', res: { writableEnded: false } },
    ]));

    // Spy processMessageAsync - 不让它真正执行异步处理
    vi.spyOn(controller, 'processMessageAsync').mockImplementation(() => Promise.resolve());

    // Spy _createRequestRecord
    vi.spyOn(controller, '_createRequestRecord').mockImplementation(() => Promise.resolve({}));

    // Spy getOrCreateActiveTopic
    vi.spyOn(controller, 'getOrCreateActiveTopic').mockImplementation(() => Promise.resolve('topic_mock_001'));

    // Spy _ensureRequestMaintenanceReady
    vi.spyOn(controller, '_ensureRequestMaintenanceReady').mockImplementation(() => Promise.resolve());

    // Spy checkExpertAccess
    vi.spyOn(controller, 'checkExpertAccess').mockImplementation(() => Promise.resolve({ allowed: true, reason: null }));
  });

  describe('processMessageAsync 调用次数回归测试', () => {

    it('body 仅有 task_db_id 时应只触发一次 processMessageAsync', async () => {
      const ctx = createMockCtx({
        content: 'hello',
        expert_id: 'expert001',
        task_db_id: 'db20charprimarykey12345',
      });

      await controller.sendMessage(ctx);

      // 核心断言：processMessageAsync 只被调用一次
      expect(controller.processMessageAsync).toHaveBeenCalledTimes(1);

      // 断言传入的 task_id 是标准化后的主键
      const callArgs = controller.processMessageAsync.mock.calls[0][0];
      expect(callArgs.task_id).toBe('db20charprimarykey12345');
    });

    it('body 仅有旧 task_id 时应只触发一次 processMessageAsync', async () => {
      const ctx = createMockCtx({
        content: 'hello',
        expert_id: 'expert001',
        task_id: 'legacy_task_id_20char',
      });

      await controller.sendMessage(ctx);

      // 核心断言：processMessageAsync 只被调用一次
      expect(controller.processMessageAsync).toHaveBeenCalledTimes(1);

      // 断言传入的 task_id 是从旧字段兼容标准化后的值
      const callArgs = controller.processMessageAsync.mock.calls[0][0];
      expect(callArgs.task_id).toBe('legacy_task_id_20char');
    });

    it('body 同时有 task_db_id 和 task_id 时应优先使用 task_db_id', async () => {
      const ctx = createMockCtx({
        content: 'hello',
        expert_id: 'expert001',
        task_db_id: 'new_primary_key_20ch',
        task_id: 'old_compat_key_20cha',
      });

      await controller.sendMessage(ctx);

      expect(controller.processMessageAsync).toHaveBeenCalledTimes(1);

      const callArgs = controller.processMessageAsync.mock.calls[0][0];
      // 应使用 task_db_id（优先级更高）
      expect(callArgs.task_id).toBe('new_primary_key_20ch');
    });

    it('body 无 task 相关字段时 task_id 应为 null', async () => {
      const ctx = createMockCtx({
        content: 'hello',
        expert_id: 'expert001',
      });

      await controller.sendMessage(ctx);

      expect(controller.processMessageAsync).toHaveBeenCalledTimes(1);

      const callArgs = controller.processMessageAsync.mock.calls[0][0];
      expect(callArgs.task_id).toBeNull();
    });

  });

  describe('_createRequestRecord 与 getOrCreateActiveTopic 主键一致性测试', () => {

    it('_createRequestRecord 与 getOrCreateActiveTopic 应使用相同的标准化主键', async () => {
      const ctx = createMockCtx({
        content: 'hello',
        expert_id: 'expert001',
        task_db_id: 'shared_primary_key_20',
      });

      await controller.sendMessage(ctx);

      // 验证 getOrCreateActiveTopic 接收到标准化主键
      expect(controller.getOrCreateActiveTopic).toHaveBeenCalledWith(
        'user001',
        'expert001',
        'shared_primary_key_20',
      );

      // 验证 _createRequestRecord 的 task_id 也是标准化主键
      expect(controller._createRequestRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          task_id: 'shared_primary_key_20',
        }),
      );
    });

    it('使用旧 task_id 兼容时，_createRequestRecord 与 getOrCreateActiveTopic 仍应使用相同值', async () => {
      const ctx = createMockCtx({
        content: 'hello',
        expert_id: 'expert001',
        task_id: 'legacy_compat_key_20',
      });

      await controller.sendMessage(ctx);

      expect(controller.getOrCreateActiveTopic).toHaveBeenCalledWith(
        'user001',
        'expert001',
        'legacy_compat_key_20',
      );

      expect(controller._createRequestRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          task_id: 'legacy_compat_key_20',
        }),
      );
    });

  });

  describe('边界条件测试', () => {

    it('缺少 content 时不应调用 processMessageAsync', async () => {
      const ctx = createMockCtx({
        expert_id: 'expert001',
        task_db_id: 'some_key_20chars_xx',
      });

      await controller.sendMessage(ctx);

      expect(controller.processMessageAsync).not.toHaveBeenCalled();
    });

    it('缺少 expert_id 时不应调用 processMessageAsync', async () => {
      const ctx = createMockCtx({
        content: 'hello',
        task_db_id: 'some_key_20chars_xx',
      });

      await controller.sendMessage(ctx);

      expect(controller.processMessageAsync).not.toHaveBeenCalled();
    });

    it('无 SSE 连接时不应调用 processMessageAsync', async () => {
      // 清空 SSE 连接
      controller.expertConnections.delete('expert001');

      const ctx = createMockCtx({
        content: 'hello',
        expert_id: 'expert001',
        task_db_id: 'some_key_20chars_xx',
      });

      await controller.sendMessage(ctx);

      expect(controller.processMessageAsync).not.toHaveBeenCalled();
    });

    it('无权限时不应调用 processMessageAsync', async () => {
      controller.checkExpertAccess.mockImplementation(() =>
        Promise.resolve({ allowed: false, reason: 'NO_ACCESS' }),
      );

      const ctx = createMockCtx({
        content: 'hello',
        expert_id: 'expert001',
        task_db_id: 'some_key_20chars_xx',
      });

      await controller.sendMessage(ctx);

      expect(controller.processMessageAsync).not.toHaveBeenCalled();
    });

  });

});
