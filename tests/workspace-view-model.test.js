import { describe, it, expect } from 'vitest';
import { buildWorkspacePromptViewModel } from '../lib/context-organizer/workspace-view-model.js';

describe('workspace-view-model', () => {
  describe('buildWorkspacePromptViewModel', () => {
    it('should return null for null input', () => {
      const result = buildWorkspacePromptViewModel(null);
      expect(result).toBeNull();
    });

    it('should return null for undefined input', () => {
      const result = buildWorkspacePromptViewModel(undefined);
      expect(result).toBeNull();
    });

    it('should build view model for task mode', () => {
      const taskContext = {
        workspace_mode: 'task',
        userId: 'user123',
        id: 'task-001',
        title: 'Test Task',
        description: 'Test description',
        logical_workspace_path: 'user123/task-001',
        currentPath: 'input',
        inputFiles: [{ name: 'test.txt', size: 1024, isDirectory: false }],
        isAdmin: false,
        isSkillCreator: false
      };

      const vm = buildWorkspacePromptViewModel(taskContext);

      expect(vm.mode).toBe('task');
      expect(vm.mode_label).toBe('任务工作空间模式');
      expect(vm.can_write).toBe(true);
      expect(vm.entity_id).toBe('task-001');
      expect(vm.entity_title).toBe('Test Task');
      expect(vm.files_count).toBe(1);
    });

    it('should build view model for chat mode', () => {
      const chatContext = {
        workspace_mode: 'chat',
        userId: 'user123',
        logical_workspace_path: 'user123/temp'
      };

      const vm = buildWorkspacePromptViewModel(chatContext);

      expect(vm.mode).toBe('chat');
      expect(vm.mode_label).toBe('对话模式');
      expect(vm.can_write).toBe(false);
      expect(vm.path_warning).toContain('禁止创建文件');
    });

    it('should build view model for skill mode', () => {
      const skillContext = {
        workspace_mode: 'skill',
        userId: 'user123',
        logical_workspace_path: 'skills/my-skill'
      };

      const vm = buildWorkspacePromptViewModel(skillContext);

      expect(vm.mode).toBe('skill');
      expect(vm.skill_name).toBe('my-skill');
      expect(vm.can_write).toBe(false);
    });

    it('should include README content when present', () => {
      const taskContext = {
        workspace_mode: 'task',
        userId: 'user123',
        id: 'task-001',
        logical_workspace_path: 'user123/task-001',
        readme: '# Project Readme',
        inputFiles: []
      };

      const vm = buildWorkspacePromptViewModel(taskContext);

      expect(vm.show_readme).toBe(true);
      expect(vm.readme_content).toContain('README.md 内容');
      expect(vm.readme_content).toContain('# Project Readme');
    });

    it('should include TODO content when present', () => {
      const taskContext = {
        workspace_mode: 'task',
        userId: 'user123',
        id: 'task-001',
        logical_workspace_path: 'user123/task-001',
        todo: '- [ ] TODO item',
        inputFiles: []
      };

      const vm = buildWorkspacePromptViewModel(taskContext);

      expect(vm.show_todo).toBe(true);
      expect(vm.todo_content).toContain('TODO.md');
    });

    it('should handle admin user correctly', () => {
      const taskContext = {
        workspace_mode: 'task',
        userId: 'user123',
        id: 'task-001',
        logical_workspace_path: 'user123/task-001',
        isAdmin: true,
        inputFiles: []
      };

      const vm = buildWorkspacePromptViewModel(taskContext);

      expect(vm.permission_note).toContain('管理员');
      expect(vm.user_role_label).toBe('管理员');
    });

    it('should handle skill creator correctly', () => {
      const taskContext = {
        workspace_mode: 'task',
        userId: 'user123',
        id: 'task-001',
        logical_workspace_path: 'user123/task-001',
        isSkillCreator: true,
        inputFiles: []
      };

      const vm = buildWorkspacePromptViewModel(taskContext);

      expect(vm.permission_note).toContain('技能创作者');
      expect(vm.user_role_label).toBe('技能创作者');
    });

    it('should handle empty currentPath correctly', () => {
      const taskContext = {
        workspace_mode: 'task',
        userId: 'user123',
        id: 'task-001',
        logical_workspace_path: 'user123/task-001',
        currentPath: '',
        inputFiles: []
      };

      const vm = buildWorkspacePromptViewModel(taskContext);

      expect(vm.current_path_display).toBe('user123/task-001/');
    });

    it('should handle non-empty currentPath correctly', () => {
      const taskContext = {
        workspace_mode: 'task',
        userId: 'user123',
        id: 'task-001',
        logical_workspace_path: 'user123/task-001',
        currentPath: 'output',
        inputFiles: []
      };

      const vm = buildWorkspacePromptViewModel(taskContext);

      expect(vm.current_path_display).toBe('user123/task-001/output');
    });
  });
});