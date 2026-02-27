/**
 * Skill Parser - 技能元数据解析工具
 * 
 * 从 SKILL.md 文件中解析技能信息
 * 供 controller 和工具层共用
 */

/**
 * 解析 SKILL.md 内容，提取技能元信息
 * @param {string} content - SKILL.md 文件内容
 * @returns {{ name: string, description: string, version: string, author: string, tags: string[] }}
 */
export function parseSkillMd(content) {
  const info = {
    name: '',
    description: '',
    version: '',
    author: '',
    tags: [],
  };

  if (!content || typeof content !== 'string') {
    return info;
  }

  const lines = content.split('\n');

  // 提取标题（第一个 # 开头的行）
  const titleMatch = content.match(/^#\s+(.+)$/m);
  if (titleMatch) {
    info.name = titleMatch[1].trim();
  }

  // 提取描述（第一个 ## 描述/Description 下的内容）
  const descMatch = content.match(/##\s*(?:描述|Description)\s*\n+([^#]+)/i);
  if (descMatch) {
    info.description = descMatch[1].trim();
  }

  // 尝试解析 YAML frontmatter
  const yamlMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (yamlMatch) {
    const yaml = yamlMatch[1];
    const versionMatch = yaml.match(/version:\s*(.+)/);
    const authorMatch = yaml.match(/author:\s*(.+)/);
    const tagsMatch = yaml.match(/tags:\s*\[(.*?)\]/);

    if (versionMatch) info.version = versionMatch[1].trim();
    if (authorMatch) info.author = authorMatch[1].trim();
    if (tagsMatch) {
      info.tags = tagsMatch[1].split(',').map(t => t.trim().replace(/['"]/g, ''));
    }
  }

  // 遍历行解析元数据（支持行内格式）
  for (const line of lines) {
    const trimmed = line.trim();

    // 解析版本（version: 或 版本:）
    if (/^(version|版本)\s*:/i.test(trimmed)) {
      info.version = trimmed.split(':')[1]?.trim() || info.version;
    }

    // 解析作者（author: 或 作者:）
    if (/^(author|作者)\s*:/i.test(trimmed)) {
      info.author = trimmed.split(':')[1]?.trim() || info.author;
    }

    // 解析标签（tags: 或 标签:）
    if (/^(tags|标签)\s*:/i.test(trimmed)) {
      const tagsStr = trimmed.split(':')[1]?.trim() || '';
      if (tagsStr && info.tags.length === 0) {
        info.tags = tagsStr.split(',').map(t => t.trim()).filter(Boolean);
      }
    }
  }

  return info;
}

/**
 * 验证技能路径是否安全（防止路径遍历攻击）
 * @param {string} sourcePath - 用户提供的路径
 * @param {string} projectRoot - 项目根目录
 * @param {string[]} allowedDirs - 允许的目录列表（相对于项目根目录）
 * @returns {{ valid: boolean, fullPath: string, error?: string }}
 */
export async function validateSkillPath(sourcePath, projectRoot, allowedDirs = ['data']) {
  const path = await import('path');
  const fs = await import('fs');
  
  // 规范化路径
  let fullPath;
  if (path.isAbsolute(sourcePath)) {
    fullPath = path.normalize(sourcePath);
  } else {
    // 相对路径：只允许在指定的允许目录下
    fullPath = path.normalize(path.resolve(projectRoot, ...allowedDirs[0].split('/'), sourcePath));
  }

  // 检查路径是否在允许的目录内
  const allowedPaths = allowedDirs.map(dir => 
    path.resolve(projectRoot, dir)
  );

  const isAllowed = allowedPaths.some(allowedPath => 
    fullPath.startsWith(allowedPath + path.sep) || fullPath === allowedPath
  );

  if (!isAllowed) {
    return {
      valid: false,
      fullPath,
      error: `Invalid path: skill must be in allowed directories (${allowedDirs.join(', ')})`,
    };
  }

  // 检查路径是否存在
  if (!fs.existsSync(fullPath)) {
    return {
      valid: false,
      fullPath,
      error: `Directory not found: ${sourcePath}`,
    };
  }

  return { valid: true, fullPath };
}

export default {
  parseSkillMd,
  validateSkillPath,
};