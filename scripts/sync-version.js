/**
 * 版本号同步脚本
 * 将根目录 package.json 的版本号同步到 frontend/package.json
 * 
 * 使用方式：
 * 1. 手动执行：node scripts/sync-version.js
 * 2. 自动执行：在 npm version 命令后自动触发（通过 postversion hook）
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootPackagePath = path.join(__dirname, '..', 'package.json');
const frontendPackagePath = path.join(__dirname, '..', 'frontend', 'package.json');

function syncVersion() {
  try {
    // 读取根目录 package.json
    const rootPackage = JSON.parse(fs.readFileSync(rootPackagePath, 'utf8'));
    const rootVersion = rootPackage.version;

    // 读取 frontend package.json
    const frontendPackage = JSON.parse(fs.readFileSync(frontendPackagePath, 'utf8'));
    const frontendVersion = frontendPackage.version;

    // 检查版本是否一致
    if (rootVersion === frontendVersion) {
      console.log(`✓ 版本号已同步: ${rootVersion}`);
      return;
    }

    // 同步版本号
    frontendPackage.version = rootVersion;
    fs.writeFileSync(frontendPackagePath, JSON.stringify(frontendPackage, null, 2) + '\n', 'utf8');

    console.log(`✓ 版本号已同步: frontend/package.json ${frontendVersion} → ${rootVersion}`);
  } catch (error) {
    console.error('✗ 版本号同步失败:', error.message);
    process.exit(1);
  }
}

syncVersion();