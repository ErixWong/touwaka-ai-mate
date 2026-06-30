/**
 * Workspace View Model Builder
 * 
 * 负责将原始 taskContext 转换为供模板渲染使用的 view model。
 * 这是一个纯转换函数，不涉及数据库查询或文件读取。
 * 
 * 注意：本模块只使用 snake_case 字段，不再兼容 camelCase 旧字段。
 */

export function buildWorkspacePromptViewModel(taskContext) {
  if (!taskContext) {
    return null;
  }

  // 直接使用 snake_case 字段，不再做兼容映射
  const mode = taskContext.workspace_mode || 'task';
  const userId = taskContext.user_id || 'unknown';
  const logicalPath = taskContext.logical_workspace_path || '';
  const currentPath = taskContext.current_path || '';

  const vm = {
    mode,
    mode_label: getModeLabel(mode),

    workspace_path_display: logicalPath ? `${logicalPath}/` : '',
    current_path_display: currentPath 
      ? `${logicalPath}/${currentPath}` 
      : (logicalPath ? `${logicalPath}/` : ''),
    workspace_path_formatted: logicalPath ? `\`${logicalPath}/\`` : '`/`',

    permission_scope: getPermissionScope(userId, taskContext.is_admin, taskContext.is_skill_creator),
    permission_note: getPermissionNote(userId, taskContext.is_admin, taskContext.is_skill_creator),
    can_write: mode === 'task',
    can_read: true,

    path_usage_guidance: getPathUsageGuidance(mode),
    path_warning: getPathWarning(mode),

    files_description: formatFilesDescription(taskContext.input_files),
    files_count: taskContext.input_files ? taskContext.input_files.length : 0,
    has_files: taskContext.input_files && taskContext.input_files.length > 0,

    show_readme: !!(taskContext.readme && taskContext.readme.trim()),
    readme_content: null,
    show_todo: !!(taskContext.todo && taskContext.todo.trim()),
    todo_content: null,

    entity_id: taskContext.id || null,
    entity_title: taskContext.title || null,
    entity_description: taskContext.description || null,
    skill_name: mode === 'skill' ? extractSkillName(logicalPath) : null,

    user_id: userId,
    user_role_label: getUserRoleLabel(taskContext.is_admin, taskContext.is_skill_creator),
  };

  if (vm.show_readme) {
    vm.readme_content = `### README.md 内容
\`\`\`markdown
${taskContext.readme}
\`\`\`
`;
  }

  if (vm.show_todo) {
    vm.todo_content = `### TODO.md 待办事项
\`\`\`markdown
${taskContext.todo}
\`\`\`
`;
  }

  return vm;
}

function getModeLabel(mode) {
  const labels = {
    task: '任务工作空间模式',
    skill: '技能模式',
    chat: '对话模式',
  };
  return labels[mode] || '任务工作空间模式';
}

function getPermissionScope(userId, isAdmin, isSkillCreator) {
  if (isAdmin) {
    return '整个 data/ 目录';
  } else if (isSkillCreator) {
    return `data/skills/ 目录和 data/work/${userId}/ 目录`;
  }
  return `data/work/${userId}/ 目录`;
}

function getPermissionNote(userId, isAdmin, isSkillCreator) {
  if (isAdmin) {
    return '（管理员权限：可访问整个 data 目录）';
  } else if (isSkillCreator) {
    return '（技能创作者权限：可访问 skills 目录和自己的工作区）';
  }
  return '（普通用户权限：只能访问自己的工作区）';
}

function getPathUsageGuidance(mode) {
  const guidance = {
    task: '使用相对当前工作目录的路径，例如 `input/file.xlsx` 或 `output/result.txt`',
    skill: '使用 `cat SKILL.md` 或 `read_file` 查看技能说明',
    chat: '可以读取临时文件夹中的现有文件',
  };
  return guidance[mode] || guidance.task;
}

function getPathWarning(mode) {
  const warnings = {
    task: '',
    skill: '⚠️ 技能目录是只读的，不应该写入文件',
    chat: '⚠️ **禁止创建文件**：对话模式不支持文件创建操作',
  };
  return warnings[mode] || '';
}

function formatFilesDescription(inputFiles) {
  if (!inputFiles || inputFiles.length === 0) {
    return '暂无文件';
  }

  return inputFiles
    .map(file => {
      const sizeKB = file.isDirectory ? '-' : `${(file.size / 1024).toFixed(1)} KB`;
      const pathInfo = file.path ? ` (路径: ${file.path})` : '';
      return file.isDirectory 
        ? `📁 ${file.name}/${pathInfo}` 
        : `📄 ${file.name} (${sizeKB})${pathInfo}`;
    })
    .join('\n');
}

function extractSkillName(logicalPath) {
  if (!logicalPath) return 'unknown';
  return logicalPath.replace(/^skills\//, '');
}

function getUserRoleLabel(isAdmin, isSkillCreator) {
  if (isAdmin) {
    return '管理员';
  } else if (isSkillCreator) {
    return '技能创作者';
  }
  return '普通用户';
}