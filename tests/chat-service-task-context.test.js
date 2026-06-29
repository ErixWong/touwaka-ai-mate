/**
 * ChatService taskContext 构造测试
 * 
 * 测试 ChatService._prepareTaskContext() 和 getTaskContext() 的真实返回结构。
 * 这是为了确保 taskContext 结构变化能被真实测试捕获。
 * 
 * 重要：此测试真实调用 ChatService 生产入口，而非复制实现逻辑。
 */

import { describe, it, expect, vi } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 真实导入 ChatService 和 paths 模块
import ChatService from '../lib/chat-service.js';
import {
  getWorkspaceRoot,
  getSkillsPath,
  getDefaultWorkspaceAbsolutePath,
  toLogicalWorkspacePath
} from '../lib/paths.js';

// 创建 Mock Database
function createMockDb() {
  const mockTask = {
    findOne: vi.fn(),
  };
  
  return {
    getModel: vi.fn((modelName) => {
      if (modelName === 'task') return mockTask;
      return {};
    }),
    query: vi.fn(),
    sequelize: {
      transaction: vi.fn().mockResolvedValue({
        commit: vi.fn(),
        rollback: vi.fn(),
      }),
    },
    _mockTask: mockTask,  // 暴露以便在测试中配置
  };
}

// 创建 Mock Session
function createMockSession(isAdmin = false, roles = []) {
  return {
    isAdmin,
    roles,
  };
}

describe('ChatService taskContext 真实入口测试', () => {
  
  describe('技能模式 (_prepareTaskContext with working_path)', () => {
    
    it('应正确构造 skills/ 前缀路径的 taskContext', async () => {
      const mockDb = createMockDb();
      const chatService = new ChatService(mockDb);
      
      const session = createMockSession(false, []);
      const result = await chatService._prepareTaskContext({
        user_id: 'user1',
        working_path: 'my-skill',
        session,
      });
      
      // 验证关键字段存在
      expect(result).toBeDefined();
      expect(result.workspace_mode).toBe('skill');
      expect(result.absolute_workspace_path).toBeDefined();
      expect(result.logical_workspace_path).toBeDefined();
      expect(result.user_id).toBe('user1');
      expect(result.is_admin).toBe(false);
      expect(result.is_skill_creator).toBe(false);
      
      // 验证路径格式
      expect(path.isAbsolute(result.absolute_workspace_path)).toBe(true);
      expect(result.logical_workspace_path).toBe('skills/my-skill');
    });

    it('应正确构造带 skills/ 前缀的路径的 taskContext', async () => {
      const mockDb = createMockDb();
      const chatService = new ChatService(mockDb);
      
      const session = createMockSession(false, []);
      const result = await chatService._prepareTaskContext({
        user_id: 'user1',
        working_path: 'skills/context-refactor',
        session,
      });
      
      expect(result).toBeDefined();
      expect(result.workspace_mode).toBe('skill');
      expect(path.isAbsolute(result.absolute_workspace_path)).toBe(true);
      expect(result.logical_workspace_path).toBe('skills/context-refactor');
    });

    it('应正确识别管理员权限', async () => {
      const mockDb = createMockDb();
      const chatService = new ChatService(mockDb);
      
      const session = createMockSession(true, []);
      const result = await chatService._prepareTaskContext({
        user_id: 'admin-user',
        working_path: 'admin-skill',
        session,
      });
      
      expect(result.is_admin).toBe(true);
      expect(result.is_skill_creator).toBe(false);
    });

    it('应正确识别技能创作者权限', async () => {
      const mockDb = createMockDb();
      const chatService = new ChatService(mockDb);
      
      const session = createMockSession(false, ['creator']);
      const result = await chatService._prepareTaskContext({
        user_id: 'creator-user',
        working_path: 'my-creation',
        session,
      });
      
      expect(result.is_admin).toBe(false);
      expect(result.is_skill_creator).toBe(true);
    });

  });

  describe('聊天模式 (_prepareTaskContext without task_id and working_path)', () => {
    
    it('应 fallback 到用户 temp 目录', async () => {
      const mockDb = createMockDb();
      const chatService = new ChatService(mockDb);
      
      const session = createMockSession(false, []);
      const result = await chatService._prepareTaskContext({
        user_id: 'test-user',
        session,
      });
      
      // 验证关键字段存在
      expect(result).toBeDefined();
      expect(result.workspace_mode).toBe('chat');
      expect(result.absolute_workspace_path).toBeDefined();
      expect(result.logical_workspace_path).toBeDefined();
      expect(result.user_id).toBe('test-user');
      
      // 验证路径格式
      expect(path.isAbsolute(result.absolute_workspace_path)).toBe(true);
      expect(result.logical_workspace_path.replace(/\\/g, '/')).toBe('test-user/temp');
    });

  });

  describe('任务模式 (_prepareTaskContext with task_id)', () => {
    
    it('应从数据库加载任务上下文', async () => {
      const mockDb = createMockDb();
      const mockTask = {
        task_id: 'task123',
        title: 'Test Task',
        description: 'A test task',
        workspace_path: 'user1/task123',
        status: 'active',
      };
      mockDb._mockTask.findOne.mockResolvedValue(mockTask);
      
      const chatService = new ChatService(mockDb);
      
      const session = createMockSession(false, []);
      const result = await chatService._prepareTaskContext({
        task_id: 'task123',
        user_id: 'user1',
        session,
      });
      
      // 验证关键字段存在
      expect(result).toBeDefined();
      expect(result.workspace_mode).toBe('task');
      expect(result.absolute_workspace_path).toBeDefined();
      expect(result.logical_workspace_path).toBeDefined();
      expect(result.id).toBe('task123');
      expect(result.title).toBe('Test Task');
      expect(result.user_id).toBe('user1');
      
      // 验证路径格式
      expect(path.isAbsolute(result.absolute_workspace_path)).toBe(true);
      expect(result.logical_workspace_path).toBe('user1/task123');
    });

    it('任务不存在时返回 null', async () => {
      const mockDb = createMockDb();
      mockDb._mockTask.findOne.mockResolvedValue(null);
      
      const chatService = new ChatService(mockDb);
      
      const session = createMockSession(false, []);
      const result = await chatService._prepareTaskContext({
        task_id: 'nonexistent',
        user_id: 'user1',
        session,
      });
      
      expect(result).toBeNull();
    });

  });

  describe('路径协议一致性验证 (真实入口)', () => {
    
    it('taskContext 应同时包含 absolute_workspace_path 和 logical_workspace_path (task模式)', async () => {
      const mockDb = createMockDb();
      const mockTask = {
        task_id: 'task456',
        title: 'Protocol Test Task',
        description: 'Testing path protocol',
        workspace_path: 'user1/task456',
        status: 'active',
      };
      mockDb._mockTask.findOne.mockResolvedValue(mockTask);
      
      const chatService = new ChatService(mockDb);
      const session = createMockSession(false, []);
      
      const result = await chatService._prepareTaskContext({
        task_id: 'task456',
        user_id: 'user1',
        session,
      });
      
      // 验证双字段存在
      expect(result.absolute_workspace_path).toBeDefined();
      expect(result.logical_workspace_path).toBeDefined();
      
      // 验证类型和格式
      expect(path.isAbsolute(result.absolute_workspace_path)).toBe(true);
      expect(result.logical_workspace_path.replace(/\\/g, '/')).toBe('user1/task456');
    });

    it('taskContext 应同时包含 absolute_workspace_path 和 logical_workspace_path (skill模式)', async () => {
      const mockDb = createMockDb();
      const chatService = new ChatService(mockDb);
      const session = createMockSession(false, []);
      
      const result = await chatService._prepareTaskContext({
        user_id: 'user1',
        working_path: 'my-skill',
        session,
      });
      
      // 验证双字段存在
      expect(result.absolute_workspace_path).toBeDefined();
      expect(result.logical_workspace_path).toBeDefined();
      
      // 验证类型和格式
      expect(path.isAbsolute(result.absolute_workspace_path)).toBe(true);
      expect(result.logical_workspace_path.startsWith('skills/')).toBe(true);
    });

    it('taskContext 应同时包含 absolute_workspace_path 和 logical_workspace_path (chat模式)', async () => {
      const mockDb = createMockDb();
      const chatService = new ChatService(mockDb);
      const session = createMockSession(false, []);
      
      const result = await chatService._prepareTaskContext({
        user_id: 'user1',
        session,
      });
      
      // 验证双字段存在
      expect(result.absolute_workspace_path).toBeDefined();
      expect(result.logical_workspace_path).toBeDefined();
      
      // 验证类型和格式
      expect(path.isAbsolute(result.absolute_workspace_path)).toBe(true);
      expect(result.logical_workspace_path.replace(/\\/g, '/')).toBe('user1/temp');
    });

  });

describe('绝对路径 vs 逻辑路径格式验证 (真实入口)', () => {
    
    it('absolute_workspace_path 必须是绝对路径 (task模式)', async () => {
      const mockDb = createMockDb();
      const mockTask = {
        task_id: 'task789',
        title: 'Absolute Path Test',
        description: 'Test absolute path',
        workspace_path: 'user1/task789',
        status: 'active',
      };
      mockDb._mockTask.findOne.mockResolvedValue(mockTask);
      
      const chatService = new ChatService(mockDb);
      const session = createMockSession(false, []);
      
      const result = await chatService._prepareTaskContext({
        task_id: 'task789',
        user_id: 'user1',
        session,
      });

      expect(path.isAbsolute(result.absolute_workspace_path)).toBe(true);
    });

    it('logical_workspace_path 不应是绝对路径 (task模式)', async () => {
      const mockDb = createMockDb();
      const mockTask = {
        task_id: 'task101',
        title: 'Logical Path Test',
        description: 'Test logical path',
        workspace_path: 'user1/task101',
        status: 'active',
      };
      mockDb._mockTask.findOne.mockResolvedValue(mockTask);
      
      const chatService = new ChatService(mockDb);
      const session = createMockSession(false, []);
      
      const result = await chatService._prepareTaskContext({
        task_id: 'task101',
        user_id: 'user1',
        session,
      });

      expect(path.isAbsolute(result.logical_workspace_path)).toBe(false);
      expect(result.logical_workspace_path.replace(/\\/g, '/')).toBe('user1/task101');
    });

    it('skills 模式的 logical_workspace_path 应以 skills/ 开头', async () => {
      const mockDb = createMockDb();
      const chatService = new ChatService(mockDb);
      const session = createMockSession(false, []);
      
      const result = await chatService._prepareTaskContext({
        user_id: 'user1',
        working_path: 'my-skill',
        session,
      });

      expect(result.logical_workspace_path.startsWith('skills/')).toBe(true);
      expect(result.logical_workspace_path).toBe('skills/my-skill');
      expect(path.isAbsolute(result.absolute_workspace_path)).toBe(true);
    });

  });

  /**
   * 双 ID 防误用测试
   * 
   * 重要：验证系统能正确区分数据库主键(id) 和业务ID(task_id)
   * - id: 数据库主键（20字符，UUID风格）
   * - task_id: 业务ID（12字符，用户可见）
   * 
   * getTaskContext() 接收的是数据库主键，而非业务ID
   */
  describe('双 ID 防误用测试', () => {
    
    /**
     * 成功场景：传入数据库主键 (20字符) 应成功返回任务上下文
     */
    it('传入 20 位数据库主键时应成功返回任务上下文', async () => {
      const mockDb = createMockDb();
      // 数据库主键 20 字符，业务ID 12 字符
      const dbPrimaryKey = 'db20charprimarykey12345';
      const businessTaskId = 'biz12charid1';  // 12字符
      
      const mockTask = {
        id: dbPrimaryKey,
        task_id: businessTaskId,
        title: 'Dual ID Test Task',
        description: 'Testing dual ID',
        workspace_path: 'user1/task1',
        status: 'active',
      };
      mockDb._mockTask.findOne.mockResolvedValue(mockTask);
      
      const chatService = new ChatService(mockDb);
      const session = createMockSession(false, []);
      
      // 使用 taskDbId 参数（20字符主键）
      const result = await chatService.getTaskContext(dbPrimaryKey, 'user1', '', session);
      
      // 验证成功获取任务上下文
      expect(result).not.toBeNull();
      expect(result.id).toBe(businessTaskId);  // 返回的是业务ID（task_id）
      expect(result.title).toBe('Dual ID Test Task');
      
      // 验证查询使用的是主键
      expect(mockDb._mockTask.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: dbPrimaryKey  // 使用主键查询
          })
        })
      );
    });

    /**
     * 失败场景：误传 12 位业务 ID 应返回 null 或提示错误
     * 
     * 注意：这是当前实现的行为 - 按主键查询会返回 null
     * 未来可以改进为返回更明确的错误提示
     */
    it('误传 12 位业务 ID 时应返回 null（因为数据库按主键查询）', async () => {
      const mockDb = createMockDb();
      const dbPrimaryKey = 'db20charprimarykey12345';
      const businessTaskId = 'biz12charid1';  // 12字符
      
      const mockTask = {
        id: dbPrimaryKey,
        task_id: businessTaskId,
        title: 'Dual ID Test Task',
        description: 'Testing dual ID',
        workspace_path: 'user1/task1',
        status: 'active',
      };
      // 模拟按主键查询返回 null（因为业务ID不是主键）
      mockDb._mockTask.findOne.mockResolvedValue(null);
      
      const chatService = new ChatService(mockDb);
      const session = createMockSession(false, []);
      
      // 误传业务 ID（12字符）作为主键
      const result = await chatService.getTaskContext(businessTaskId, 'user1', '', session);
      
      // 验证返回 null（因为找不到）
      expect(result).toBeNull();
    });

    /**
     * 兼容场景：task_id 字段传入主键仍可正常工作（向后兼容）
     */
    it('使用 task_id 字段传入主键仍可正常工作（兼容旧接口）', async () => {
      const mockDb = createMockDb();
      const dbPrimaryKey = 'db20charprimarykey12345';
      const businessTaskId = 'biz12charid1';  // 12字符
      
      const mockTask = {
        id: dbPrimaryKey,
        task_id: businessTaskId,
        title: 'Backward Compat Task',
        description: 'Testing backward compatibility',
        workspace_path: 'user1/task2',
        status: 'active',
      };
      mockDb._mockTask.findOne.mockResolvedValue(mockTask);
      
      const chatService = new ChatService(mockDb);
      const session = createMockSession(false, []);
      
      // 模拟旧接口调用 - 通过 _prepareTaskContext 传入 task_id
      const result = await chatService._prepareTaskContext({
        task_id: dbPrimaryKey,  // 旧字段传入主键
        user_id: 'user1',
        session,
      });
      
      // 验证仍然正常工作
      expect(result).not.toBeNull();
      expect(result.workspace_mode).toBe('task');
      expect(result.id).toBe(businessTaskId);  // 返回业务ID
    });

    /**
     * 验证 taskContext 返回的业务 ID 与传入的主键不一致
     */
    it('返回的 taskContext.id 应该是业务 ID（12字符），而不是主键', async () => {
      const mockDb = createMockDb();
      const dbPrimaryKey = 'db20charprimarykey12345';
      const businessTaskId = 'biz12charid1';  // 12字符
      
      const mockTask = {
        id: dbPrimaryKey,
        task_id: businessTaskId,
        title: 'ID Separation Test',
        description: 'Verifying ID separation',
        workspace_path: 'user1/task3',
        status: 'active',
      };
      mockDb._mockTask.findOne.mockResolvedValue(mockTask);
      
      const chatService = new ChatService(mockDb);
      const session = createMockSession(false, []);
      
      const result = await chatService.getTaskContext(dbPrimaryKey, 'user1', '', session);
      
      // 验证返回的业务ID与主键不同
      expect(result.id).toBe(businessTaskId);  // 12字符
      expect(result.id.length).toBe(12);
      expect(result.id).not.toBe(dbPrimaryKey);
    });

  });

});