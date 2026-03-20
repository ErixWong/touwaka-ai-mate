#!/usr/bin/env node
/**
 * Git Hooks 安装脚本
 * 将 config/git-hooks/ 中的 hooks 复制到 .git/hooks/
 * 
 * 使用方法：node scripts/install-git-hooks.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, '..');
const hooksSourceDir = path.join(rootDir, 'config', 'git-hooks');
const hooksTargetDir = path.join(rootDir, '.git', 'hooks');

console.log('🔧 安装 Git Hooks...\n');

// 确保目标目录存在
if (!fs.existsSync(hooksTargetDir)) {
  fs.mkdirSync(hooksTargetDir, { recursive: true });
}

// 获取所有 hook 文件
const hookFiles = fs.readdirSync(hooksSourceDir);

let installed = 0;
for (const hookFile of hookFiles) {
  const sourcePath = path.join(hooksSourceDir, hookFile);
  const targetPath = path.join(hooksTargetDir, hookFile);

  // 复制文件
  fs.copyFileSync(sourcePath, targetPath);

  // 设置可执行权限 (Unix)
  if (process.platform !== 'win32') {
    fs.chmodSync(targetPath, 0o755);
  }

  console.log(`✅ 已安装: ${hookFile}`);
  installed++;
}

console.log(`\n🎉 完成！已安装 ${installed} 个 Git Hooks`);
console.log('\n💡 提示：');
console.log('   - 提交代码时会自动检查分支和显示审计提醒');
console.log('   - 如需跳过检查，使用 git commit --no-verify');