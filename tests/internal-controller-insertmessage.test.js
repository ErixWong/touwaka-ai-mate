/**
 * InternalController insertMessage 标准化回归测试
 *
 * 审计 Round 10 要求：
 * - 验证 insertMessage() 的 task_db_id / task_id 标准化行为
 * - 覆盖 4 种场景：仅传 task_db_id、仅传 task_id、同时传两者、都不传
 * - 断言 getOrCreateActiveTopic() 和 triggerExpertResponse() 接收标准化后的同一值
 *
 * 测试重点：边界层标准化与下游消费一致性
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

// 导入被测模块（在 mock 之后）
import InternalController from '../server/controllers/internal.controller.js';

/**
 * 创建 Mock Database
 */
function createMockDb() {
  const mockMessage = {
    create: vi.fn().mockResolvedValue({}),
  };

  const mockTopic = {
    findOne: vi.fn().mockResolvedValue({ id: 'topic_mock_001' }),
    create: vi.fn().mockResolvedValue({}),
  };

  const mockAiModel = {
    findOne: vi.fn().mockResolvedValue(null),
  };

  const mockProvider = {
    findOne: vi.fn().mockResolvedValue(null),
  };

  return {
    getModel: vi.fn((modelName) => {
      if (modelName === 'message') return mockMessage;
      if (modelName === 'topic') return mockTopic;
      if (modelName === 'ai_model') return mockAiModel;
      if (modelName === 'provider') return mockProvider;
      return {};
    }),
    _mockMessage: mockMessage,
    _mockTopic: mockTopic,
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
    ip: '127.0.0.1',
    success: vi.fn(),
    error: vi.fn(),
    status: 200,
  };
}

describe('InternalController insertMessage 标准化回归测试', () => {

  let mockDb;
  let mockChatService;
  let controller;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    mockChatService = {};
    controller = new InternalController(mockDb, {
      expertConnections: new Map(),
      chatService: null,  // 不触发真实专家响应
    });

    // Spy getOrCreateActiveTopic
    vi.spyOn(controller, 'getOrCreateActiveTopic').mockImplementation(() =>
      Promise.resolve('topic_mock_001')
    );

    // Spy pushSSENotification
    vi.spyOn(controller, 'pushSSENotification').mockReturnValue(false);

    // Spy triggerExpertResponse
    vi.spyOn(controller, 'triggerExpertResponse').mockImplementation(() =>
      Promise.resolve()
    );
  });

  describe('task_db_id / task_id 标准化行为', () => {

    it('仅传 task_db_id 时，getOrCreateActiveTopic 应接收 task_db_id 值', async () => {
      const ctx = createMockCtx({
        user_id: 'user001',
        expert_id: 'expert001',
        content: '测试消息',
        task_db_id: 'db20charprimarykey12345',
      });

      await controller.insertMessage(ctx);

      // 验证 getOrCreateActiveTopic 接收标准化后的主键
      expect(controller.getOrCreateActiveTopic).toHaveBeenCalledWith(
        'user001',
        'expert001',
        'db20charprimarykey12345',
      );

      // 验证成功返回
      expect(ctx.success).toHaveBeenCalledWith(
        expect.objectContaining({
          topic_id: 'topic_mock_001',
        }),
      );
    });

    it('仅传旧 task_id 时，getOrCreateActiveTopic 应接收兼容后的 task_id 值', async () => {
      const ctx = createMockCtx({
        user_id: 'user001',
        expert_id: 'expert001',
        content: '测试消息',
        task_id: 'legacy_task_id_20char',
      });

      await controller.insertMessage(ctx);

      expect(controller.getOrCreateActiveTopic).toHaveBeenCalledWith(
        'user001',
        'expert001',
        'legacy_task_id_20char',
      );

      expect(ctx.success).toHaveBeenCalledWith(
        expect.objectContaining({
          topic_id: 'topic_mock_001',
        }),
      );
    });

    it('同时传 task_db_id 和 task_id 时，应优先使用 task_db_id', async () => {
      const ctx = createMockCtx({
        user_id: 'user001',
        expert_id: 'expert001',
        content: '测试消息',
        task_db_id: 'new_primary_key_20ch',
        task_id: 'old_compat_key_20cha',
      });

      await controller.insertMessage(ctx);

      expect(controller.getOrCreateActiveTopic).toHaveBeenCalledWith(
        'user001',
        'expert001',
        'new_primary_key_20ch',  // 优先使用 task_db_id
      );
    });

    it('两者都不传时，getOrCreateActiveTopic 应接收 null', async () => {
      const ctx = createMockCtx({
        user_id: 'user001',
        expert_id: 'expert001',
        content: '测试消息',
      });

      await controller.insertMessage(ctx);

      expect(controller.getOrCreateActiveTopic).toHaveBeenCalledWith(
        'user001',
        'expert001',
        null,
      );
    });

  });

  describe('trigger_expert 路径的标准化一致性', () => {

    beforeEach(() => {
      // 重新设置 controller，注入 chatService 以启用 trigger_expert 路径
      controller = new InternalController(mockDb, {
        expertConnections: new Map(),
        chatService: {
          getExpertService: vi.fn(),
          saveAssistantMessage: vi.fn().mockResolvedValue({}),
        },
      });

      // 重新 Spy
      vi.spyOn(controller, 'getOrCreateActiveTopic').mockImplementation(() =>
        Promise.resolve('topic_mock_001')
      );
      vi.spyOn(controller, 'pushSSENotification').mockReturnValue(false);
      vi.spyOn(controller, 'triggerExpertResponse').mockImplementation(() =>
        Promise.resolve()
      );
    });

    it('trigger_expert 路径应使用与 getOrCreateActiveTopic 相同的 topic_id', async () => {
      const ctx = createMockCtx({
        user_id: 'user001',
        expert_id: 'expert001',
        content: '助理执行结果',
        task_db_id: 'shared_primary_key_20',
        trigger_expert: true,
      });

      await controller.insertMessage(ctx);

      expect(controller.getOrCreateActiveTopic).toHaveBeenCalledWith(
        'user001',
        'expert001',
        'shared_primary_key_20',
      );

      expect(controller.triggerExpertResponse).toHaveBeenCalledWith(
        'user001',
        'expert001',
        '助理执行结果',
        'topic_mock_001',
      );
    });

    it('trigger_expert 路径用旧 task_id 兼容时，topic 仍应一致', async () => {
      const ctx = createMockCtx({
        user_id: 'user001',
        expert_id: 'expert001',
        content: '助理执行结果',
        task_id: 'legacy_compat_key_20',
        trigger_expert: true,
      });

      await controller.insertMessage(ctx);

      expect(controller.getOrCreateActiveTopic).toHaveBeenCalledWith(
        'user001',
        'expert001',
        'legacy_compat_key_20',
      );

      expect(controller.triggerExpertResponse).toHaveBeenCalledWith(
        'user001',
        'expert001',
        '助理执行结果',
        'topic_mock_001',
      );
    });

  });

  describe('边界条件测试', () => {

    it('缺少 user_id 时不应调用 getOrCreateActiveTopic', async () => {
      const ctx = createMockCtx({
        expert_id: 'expert001',
        content: '测试消息',
        task_db_id: 'some_key_20chars_xx',
      });

      await controller.insertMessage(ctx);

      expect(controller.getOrCreateActiveTopic).not.toHaveBeenCalled();
      expect(ctx.error).toHaveBeenCalled();
    });

    it('缺少 expert_id 时不应调用 getOrCreateActiveTopic', async () => {
      const ctx = createMockCtx({
        user_id: 'user001',
        content: '测试消息',
        task_db_id: 'some_key_20chars_xx',
      });

      await controller.insertMessage(ctx);

      expect(controller.getOrCreateActiveTopic).not.toHaveBeenCalled();
      expect(ctx.error).toHaveBeenCalled();
    });

    it('缺少 content 时不应调用 getOrCreateActiveTopic', async () => {
      const ctx = createMockCtx({
        user_id: 'user001',
        expert_id: 'expert001',
        task_db_id: 'some_key_20chars_xx',
      });

      await controller.insertMessage(ctx);

      expect(controller.getOrCreateActiveTopic).not.toHaveBeenCalled();
      expect(ctx.error).toHaveBeenCalled();
    });

    it('无认证 session 时应返回 403', async () => {
      const ctx = createMockCtx({
        user_id: 'user001',
        expert_id: 'expert001',
        content: '测试消息',
      });
      ctx.state.session = {};  // 无 session.id

      await controller.insertMessage(ctx);

      expect(ctx.status).toBe(403);
      expect(controller.getOrCreateActiveTopic).not.toHaveBeenCalled();
    });

  });

  describe('消息插入行为验证', () => {

    it('普通场景应正常插入消息', async () => {
      const ctx = createMockCtx({
        user_id: 'user001',
        expert_id: 'expert001',
        content: '测试消息内容',
        task_db_id: 'db20charprimarykey12345',
      });

      await controller.insertMessage(ctx);

      // 验证消息被插入
      expect(mockDb._mockMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'user001',
          expert_id: 'expert001',
          role: 'assistant',
          content: '测试消息内容',
        }),
      );

      expect(ctx.success).toHaveBeenCalledWith(
        expect.objectContaining({
          message: '消息已插入',
          trigger_expert: false,
        }),
      );
    });

    it('trigger_expert 场景按普通消息插入并触发专家', async () => {
      // 重新设置 controller 以启用 chatService
      controller = new InternalController(mockDb, {
        expertConnections: new Map(),
        chatService: {},
      });
      vi.spyOn(controller, 'getOrCreateActiveTopic').mockImplementation(() =>
        Promise.resolve('topic_mock_001')
      );
      vi.spyOn(controller, 'pushSSENotification').mockReturnValue(false);
      vi.spyOn(controller, 'triggerExpertResponse').mockImplementation(() =>
        Promise.resolve()
      );

      const ctx = createMockCtx({
        user_id: 'user001',
        expert_id: 'expert001',
        content: '助理执行结果',
        task_db_id: 'db20charprimarykey12345',
        trigger_expert: true,
      });

      await controller.insertMessage(ctx);

      expect(mockDb._mockMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'user001',
          expert_id: 'expert001',
          content: '助理执行结果',
        }),
      );
      expect(controller.triggerExpertResponse).toHaveBeenCalledWith(
        'user001',
        'expert001',
        '助理执行结果',
        'topic_mock_001',
      );
    });

  });

});
