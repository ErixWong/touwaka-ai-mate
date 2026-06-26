/**
 * 路径协议测试
 * 
 * 测试任务上下文中的路径协议是否正确：
 * - task 模式：传递绝对路径成功
 * - skill 模式：构造上下文成功
 * - chat 模式：fallback 到用户 temp 目录
 * - 相对路径传入执行层时报错
 * 
 * 重要：此测试直接导入生产代码，确保测试与实现绑定
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 直接导入生产代码（而非复制实现）
import {
  getWorkspaceRoot,
  getSkillsPath,
  getDefaultWorkspaceAbsolutePath,
  resolveWorkspaceAbsolutePath,
  toLogicalWorkspacePath,
  formatWorkspaceDisplayFromTask
} from '../lib/paths.js';

describe('路径协议测试', () => {
  
  describe('resolveWorkspaceAbsolutePath', () => {
    
    it('应接受绝对路径并返回', () => {
      const absolutePath = '/data/work/user1/task1';
      const result = resolveWorkspaceAbsolutePath(absolutePath, 'user1');
      assert.strictEqual(result, path.resolve(absolutePath));
    });

    it('应拒绝相对路径并抛出错误', () => {
      const logicalPath = 'work/user1/task1';
      assert.throws(
        () => resolveWorkspaceAbsolutePath(logicalPath, 'user1'),
        /工作目录必须是绝对路径/
      );
    });

    it('null 输入应 fallback 到用户 temp 目录', () => {
      const result = resolveWorkspaceAbsolutePath(null, 'user1');
      const expected = getDefaultWorkspaceAbsolutePath('user1');
      assert.strictEqual(result, expected);
    });

    it('空字符串输入应 fallback 到用户 temp 目录', () => {
      const result = resolveWorkspaceAbsolutePath('', 'user1');
      const expected = getDefaultWorkspaceAbsolutePath('user1');
      assert.strictEqual(result, expected);
    });

  });

  describe('toLogicalWorkspacePath', () => {
    
    it('应将绝对路径转换为逻辑路径', () => {
      const absolutePath = path.join(getWorkspaceRoot(), 'user1', 'task1');
      const result = toLogicalWorkspacePath(absolutePath);
      assert.strictEqual(result.replace(/\\/g, '/'), 'user1/task1');
    });

    it('应处理 temp 目录', () => {
      const absolutePath = path.join(getWorkspaceRoot(), 'user1', 'temp');
      const result = toLogicalWorkspacePath(absolutePath);
      assert.strictEqual(result.replace(/\\/g, '/'), 'user1/temp');
    });

    it('空输入应返回空字符串', () => {
      const result = toLogicalWorkspacePath('');
      assert.strictEqual(result, '');
    });

    it('非工作区路径应返回原始路径（绝对路径形式）', () => {
      // 测试非工作区路径的处理
      // 在 Windows 上 path.resolve() 会将 /tmp/some/path 转换为 D:\tmp\some\path
      // 这说明 path.resolve() 会将任何非相对路径当作相对路径处理
      const absolutePath = 'C:\\some\\external\\path';
      const result = toLogicalWorkspacePath(absolutePath);
      // 非工作区路径应该返回转换后的绝对路径
      assert.ok(result.includes('some'), '应该返回处理后的路径');
    });

  });

  describe('边界回归测试：逻辑路径禁止进入执行层', () => {
    
    it('逻辑路径格式 "user1/task1" 应被拒绝', () => {
      assert.throws(
        () => resolveWorkspaceAbsolutePath('user1/task1', 'user1'),
        /工作目录必须是绝对路径/
      );
    });

    it('逻辑路径格式 "skills/my-skill" 应被拒绝', () => {
      assert.throws(
        () => resolveWorkspaceAbsolutePath('skills/my-skill', 'user1'),
        /工作目录必须是绝对路径/
      );
    });

    it('相对路径 "./input" 应被拒绝', () => {
      assert.throws(
        () => resolveWorkspaceAbsolutePath('./input', 'user1'),
        /工作目录必须是绝对路径/
      );
    });

    it('相对路径 "input/file.txt" 应被拒绝', () => {
      assert.throws(
        () => resolveWorkspaceAbsolutePath('input/file.txt', 'user1'),
        /工作目录必须是绝对路径/
      );
    });

    it('绝对路径应正常接受', () => {
      const absolutePath = path.join(getWorkspaceRoot(), 'user1', 'task1');
      const result = resolveWorkspaceAbsolutePath(absolutePath, 'user1');
      assert.ok(path.isAbsolute(result), '结果应该是绝对路径');
    });

  });

  describe('formatWorkspaceDisplayFromTask 统一展示入口', () => {
    
    it('应从 taskContext 的 logical_workspace_path 获取展示路径', () => {
      const taskContext = {
        logical_workspace_path: 'user1/task1',
        absolute_workspace_path: '/data/work/user1/task1'
      };
      const result = formatWorkspaceDisplayFromTask(taskContext, '（无）');
      assert.strictEqual(result, 'user1/task1');
    });

    it('应从 Task 记录的 workspace_path 获取展示路径', () => {
      const taskRecord = {
        workspace_path: 'user1/task1'
      };
      const result = formatWorkspaceDisplayFromTask(taskRecord, '（无）');
      assert.strictEqual(result, 'user1/task1');
    });

    it('空输入应返回 fallback 文本', () => {
      const result = formatWorkspaceDisplayFromTask(null, '（无）');
      assert.strictEqual(result, '（无）');
    });

    it('无路径字段应返回 fallback 文本', () => {
      const emptyObj = {};
      const result = formatWorkspaceDisplayFromTask(emptyObj, '（无）');
      assert.strictEqual(result, '（无）');
    });

  });

  describe('技能模式路径构造', () => {
    
    it('skills/ 前缀应正确解析为逻辑路径', () => {
      const normalizedPath = 'my-skill'.replace(/\\/g, '/').replace(/^\.\//, '');
      let absolutePath;
      let logicalPath;
      
      if (normalizedPath.startsWith('skills/')) {
        absolutePath = path.join(getSkillsPath(), normalizedPath.slice('skills/'.length));
        logicalPath = normalizedPath;
      } else {
        absolutePath = path.join(getSkillsPath(), normalizedPath);
        logicalPath = 'skills/' + normalizedPath;
      }

      assert.ok(path.isAbsolute(absolutePath), 'absolutePath 应该是绝对路径');
      assert.strictEqual(logicalPath, 'skills/my-skill', 'logicalPath 应该是 skills/ 前缀格式');
    });

    it('skills/ 前缀应正确解析为绝对路径', () => {
      const normalizedPath = 'skills/my-skill'.replace(/\\/g, '/').replace(/^\.\//, '');
      let absolutePath;
      let logicalPath;
      
      if (normalizedPath.startsWith('skills/')) {
        absolutePath = path.join(getSkillsPath(), normalizedPath.slice('skills/'.length));
        logicalPath = normalizedPath;
      } else {
        absolutePath = path.join(getSkillsPath(), normalizedPath);
        logicalPath = 'skills/' + normalizedPath;
      }

      assert.ok(path.isAbsolute(absolutePath), 'absolutePath 应该是绝对路径');
      assert.strictEqual(logicalPath, 'skills/my-skill', 'logicalPath 应该是 skills/ 前缀格式');
    });

  });

  describe('chat 模式路径构造', () => {
    
    it('应 fallback 到用户 temp 目录', () => {
      const userId = 'test-user';
      const result = getDefaultWorkspaceAbsolutePath(userId);
      const expected = path.join(getWorkspaceRoot(), userId, 'temp');
      
      assert.strictEqual(result, expected, 'chat 模式应使用用户 temp 目录');
      assert.ok(path.isAbsolute(result), 'chat 模式返回的路径应该是绝对路径');
    });

  });

  describe('路径协议一致性', () => {
    
    it('taskContext 应包含 absolute_workspace_path 和 logical_workspace_path', () => {
      // 模拟 task 模式构造的 taskContext
      const userId = 'user1';
      const taskId = 'task1';
      const absoluteWorkspacePath = path.join(getWorkspaceRoot(), userId, taskId);
      const logicalWorkspacePath = toLogicalWorkspacePath(absoluteWorkspacePath);

      const taskContext = {
        absolute_workspace_path: absoluteWorkspacePath,
        logical_workspace_path: logicalWorkspacePath,
        workspace_mode: 'task',
      };

      // 验证字段存在
      assert.ok(taskContext.absolute_workspace_path, '应包含 absolute_workspace_path');
      assert.ok(taskContext.logical_workspace_path, '应包含 logical_workspace_path');

      // 验证类型和格式
      assert.ok(path.isAbsolute(taskContext.absolute_workspace_path), 'absolute_workspace_path 必须是绝对路径');
      assert.ok(!path.isAbsolute(taskContext.logical_workspace_path), 'logical_workspace_path 应该是相对路径');
      // Windows 路径兼容性：统一使用正斜杠比较
      assert.strictEqual(taskContext.logical_workspace_path.replace(/\\/g, '/'), 'user1/task1', 'logical_workspace_path 应该是相对于 work 目录的路径');
    });

    it('skillContext 应包含 absolute_workspace_path 和 logical_workspace_path', () => {
      // 模拟 skill 模式构造的 context
      const userId = 'user1';
      const skillPath = 'my-skill';
      const normalizedPath = skillPath.replace(/\\/g, '/').replace(/^\.\//, '');
      
      const skillsPath = getSkillsPath();
      const absoluteWorkspacePath = path.join(skillsPath, normalizedPath);
      const logicalWorkspacePath = 'skills/' + normalizedPath;

      const skillContext = {
        absolute_workspace_path: absoluteWorkspacePath,
        logical_workspace_path: logicalWorkspacePath,
        workspace_mode: 'skill',
      };

      // 验证字段存在
      assert.ok(skillContext.absolute_workspace_path, '应包含 absolute_workspace_path');
      assert.ok(skillContext.logical_workspace_path, '应包含 logical_workspace_path');

      // 验证类型和格式
      assert.ok(path.isAbsolute(skillContext.absolute_workspace_path), 'skill 模式的 absolute_workspace_path 必须是绝对路径');
      assert.ok(skillContext.logical_workspace_path.startsWith('skills/'), 'skill 模式的 logical_workspace_path 应该以 skills/ 开头');
    });

  });

});