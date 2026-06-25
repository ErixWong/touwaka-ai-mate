import { describe, expect, it } from 'vitest';
import { BaseContextOrganizer } from '../lib/context-organizer/base-organizer.js';
import { MinimalContextOrganizer } from '../lib/context-organizer/minimal-organizer.js';

const baseOrganizer = new BaseContextOrganizer({});
const minimalOrganizer = new MinimalContextOrganizer({}, { enableNotes: false });

describe('workspace context renderer', () => {
  it('renders task mode with readme todo files and permissions', () => {
    const section = baseOrganizer.generateTaskContextSection({
      workspace_mode: 'task',
      id: 'task-001',
      title: 'Refactor context pipeline',
      description: 'Stabilize task context rendering',
      logical_workspace_path: 'user-1/task-001',
      current_path: 'input/specs',
      user_id: 'user-1',
      is_skill_creator: true,
      input_files: [
        { name: 'brief.md', size: 1024, isDirectory: false, path: 'input/specs/brief.md' },
        { name: 'assets', size: 0, isDirectory: true, path: 'input/specs/assets' },
      ],
      readme: '# README',
      todo: '- [ ] verify renderer',
    });

    expect(section).toContain('## 当前任务工作空间');
    expect(section).toContain('任务工作空间模式');
    expect(section).toContain('Refactor context pipeline');
    expect(section).toContain('user-1/task-001/input/specs');
    expect(section).toContain('README.md 内容');
    expect(section).toContain('TODO.md 待办事项');
    expect(section).toContain('data/skills/ 目录和 data/work/user-1/ 目录');
    expect(section).toContain('📄 brief.md (1.0 KB)');
    expect(section).toContain('📁 assets/');
  });

  it('renders skill mode with readonly guidance and creator permissions', () => {
    const section = baseOrganizer.generateTaskContextSection({
      workspace_mode: 'skill',
      logical_workspace_path: 'skills/context-refactor',
      current_path: '',
      user_id: 'user-2',
      is_skill_creator: true,
    });

    expect(section).toContain('## 当前技能工作目录');
    expect(section).toContain('技能名称');
    expect(section).toContain('context-refactor');
    expect(section).toContain('cat SKILL.md');
    expect(section).toContain('技能目录是只读的');
    expect(section).toContain('data/skills/ 目录和 data/work/user-2/ 目录');
  });

  it('renders chat mode with no-file-creation guidance and admin permissions', () => {
    const section = baseOrganizer.generateTaskContextSection({
      workspace_mode: 'chat',
      logical_workspace_path: 'work/admin/temp',
      current_path: '',
      user_id: 'admin',
      is_admin: true,
    });

    expect(section).toContain('## 当前工作目录');
    expect(section).toContain('对话模式');
    expect(section).toContain('禁止创建文件');
    expect(section).toContain('整个 data/ 目录');
    expect(section).toContain('创建一个任务（Task）');
  });

  it('reuses base renderer for all modes in minimal organizer', () => {
    const contexts = [
      {
        workspace_mode: 'task',
        id: 'task-002',
        title: 'Task mode',
        logical_workspace_path: 'user-3/task-002',
        current_path: '',
        user_id: 'user-3',
        input_files: [],
      },
      {
        workspace_mode: 'skill',
        logical_workspace_path: 'skills/my-skill',
        current_path: '',
        user_id: 'user-3',
      },
      {
        workspace_mode: 'chat',
        logical_workspace_path: 'work/user-3/temp',
        current_path: '',
        user_id: 'user-3',
      },
    ];

    for (const taskContext of contexts) {
      expect(minimalOrganizer._buildTaskContextSection(taskContext)).toBe(
        baseOrganizer.generateTaskContextSection(taskContext)
      );
    }
  });
});
