/**
 * 测试 SKILL.md 解析和技能导入
 *
 * 运行方式：
 *   node test/test-skill-md-parsing.mjs
 *   node test/test-skill-md-parsing.mjs --importer
 */

import fs from 'fs';
import path from 'path';
import SkillAnalyzer from '../lib/skill-analyzer.js';

// PDF 技能路径
const PDF_SKILL_PATH = 'D:/projects/github/anthropics-skills/skills/pdf';

// 本地 searxng 技能路径
const SEARXNG_SKILL_PATH = 'data/skills/searxng';

// 技能导入器路径
const SKILL_IMPORTER_PATH = 'data/skills/skill-importer';

async function main() {
  const args = process.argv.slice(2);
  const analyzer = new SkillAnalyzer();
  
  console.log('='.repeat(60));
  console.log('SKILL.md 解析测试');
  console.log('='.repeat(60));
  
  // 测试 PDF 技能
  await testSkill(analyzer, PDF_SKILL_PATH, 'PDF (Claude Code 官方 - 知识型)');
  
  console.log('\n');
  
  // 测试本地 searxng 技能
  await testSkill(analyzer, SEARXNG_SKILL_PATH, 'SearXNG (本地 - 工具型)');
  
  console.log('\n');
  
  // 测试技能导入器
  if (args.includes('--importer')) {
    await testSkillImporter();
    console.log('\n');
  }
  
  printFieldMapping();
}

async function testSkill(analyzer, skillPath, label) {
  console.log(`\n### 测试技能: ${label}`);
  console.log(`路径: ${skillPath}`);
  console.log('-'.repeat(50));
  
  // 读取 SKILL.md
  const skillMdPath = path.join(skillPath, 'SKILL.md');
  let skillMd = '';
  
  try {
    skillMd = fs.readFileSync(skillMdPath, 'utf-8');
    console.log(`✓ 成功读取 SKILL.md (${skillMd.length} 字符)`);
  } catch (e) {
    console.log(`✗ 读取 SKILL.md 失败: ${e.message}`);
    return;
  }
  
  // 读取 index.js（可选）
  let indexJs = '';
  try {
    indexJs = fs.readFileSync(path.join(skillPath, 'index.js'), 'utf-8');
    console.log(`✓ 成功读取 index.js (${indexJs.length} 字符)`);
  } catch {
    console.log('- 无 index.js 文件');
  }
  
  // 解析技能
  const result = analyzer.basicAnalysis({ skillMd, indexJs });
  
  // 打印解析结果
  console.log('\n#### 解析结果:\n');
  
  console.log('--- skills 表字段 ---');
  console.log(`name: "${result.name}"`);
  console.log(`description: "${result.description.substring(0, 100)}..."`);
  console.log(`version: "${result.version}"`);
  console.log(`author: "${result.author}"`);
  console.log(`license: "${result.license}"`);
  console.log(`tags: ${JSON.stringify(result.tags)}`);
  console.log(`argument_hint: "${result.argument_hint}"`);
  console.log(`disable_model_invocation: ${result.disable_model_invocation}`);
  console.log(`user_invocable: ${result.user_invocable}`);
  console.log(`allowed_tools: ${JSON.stringify(result.allowed_tools)}`);
  console.log(`security_score: ${result.security_score}`);
  console.log(`security_warnings: ${JSON.stringify(result.security_warnings)}`);
  
  console.log('\n--- skill_tools 表字段 ---');
  console.log(`工具数量: ${result.tools.length}`);
  
  result.tools.forEach((tool, i) => {
    console.log(`\n工具 ${i + 1}:`);
    console.log(`  name: "${tool.name}"`);
    console.log(`  description: "${tool.description.substring(0, 80)}..."`);
    console.log(`  parameters: "${tool.parameters.substring(0, 80)}..."`);
  });
  
  // 打印原始 frontmatter
  console.log('\n--- 原始 Frontmatter ---');
  const frontmatterMatch = skillMd.match(/^---\s*\n([\s\S]*?)\n---/);
  if (frontmatterMatch) {
    console.log(frontmatterMatch[1]);
  } else {
    console.log('(无 frontmatter)');
  }
}

function printFieldMapping() {
  console.log('='.repeat(60));
  console.log('SKILL.md 字段与数据库表映射关系');
  console.log('='.repeat(60));
  
  console.log(`
┌─────────────────────────────────────────────────────────────────┐
│                    SKILL.md Frontmatter                         │
├──────────────────────┬──────────────────────────────────────────┤
│ Frontmatter 字段      │ 数据库字段 (skills 表)                   │
├──────────────────────┼──────────────────────────────────────────┤
│ name                 │ name                                     │
│ description          │ description                              │
│ version              │ version                                  │
│ author               │ author                                   │
│ license              │ license                                  │
│ tags                 │ tags (JSON 数组)                         │
│ argument-hint        │ argument_hint                            │
│ disable-model-invocation │ disable_model_invocation            │
│ user-invocable       │ user_invocable                           │
│ allowed-tools        │ allowed_tools (JSON 数组)                │
│ model                │ (暂未存储)                                │
│ context              │ (暂未存储)                                │
│ agent                │ (暂未存储)                                │
├──────────────────────┴──────────────────────────────────────────┤
│                    SKILL.md Body 内容                           │
├──────────────────────┬──────────────────────────────────────────┤
│ Body 内容             │ 数据库字段                               │
├──────────────────────┼──────────────────────────────────────────┤
│ 整个文件内容          │ skill_md (TEXT)                          │
│ ## Tools 部分        │ 解析后存入 skill_tools 表                │
├──────────────────────┴──────────────────────────────────────────┤
│                    skill_tools 表字段                           │
├──────────────────────┬──────────────────────────────────────────┤
│ 解析来源              │ 数据库字段                               │
├──────────────────────┼──────────────────────────────────────────┤
│ ### toolName         │ name                                     │
│ 工具描述（第一段）    │ description                              │
│ Parameters 部分      │ parameters (JSON Schema)                 │
│ (父级)               │ skill_id (关联 skills.id)                │
│ (生成)               │ id (唯一标识)                            │
└──────────────────────┴──────────────────────────────────────────┘
`);
}

async function testSkillImporter() {
  console.log('='.repeat(60));
  console.log('技能导入器测试');
  console.log('='.repeat(60));
  
  // 动态导入技能导入器
  const importerPath = path.join(process.cwd(), SKILL_IMPORTER_PATH, 'index.js');
  
  try {
    const { default: importer } = await import(`file://${importerPath}`);
    
    // 测试分析 PDF 技能
    console.log('\n### 测试导入 PDF 技能\n');
    const result = await importer({
      action: 'analyze',
      skill_path: PDF_SKILL_PATH
    });
    
    if (result.success) {
      console.log('✓ 分析成功\n');
      console.log('--- skills 表记录 ---');
      console.log(`id: ${result.skill.id}`);
      console.log(`name: ${result.skill.name}`);
      console.log(`description: ${result.skill.description.substring(0, 100)}...`);
      console.log(`license: ${result.skill.license}`);
      console.log(`source_path: ${result.skill.source_path}`);
      
      console.log('\n--- skill_tools 表记录 ---');
      console.log(`工具数量: ${result.tools.length}`);
      result.tools.forEach((tool, i) => {
        console.log(`\n工具 ${i + 1}:`);
        console.log(`  id: ${tool.id}`);
        console.log(`  skill_id: ${tool.skill_id}`);
        console.log(`  name: ${tool.name}`);
        console.log(`  description: ${tool.description.substring(0, 80)}...`);
      });
      
      console.log('\n--- 发现的文件 ---');
      result.files.forEach(file => {
        console.log(`  ${file.name} (${file.type || 'markdown'})`);
      });
    } else {
      console.log(`✗ 分析失败: ${result.error}`);
    }
  } catch (e) {
    console.log(`✗ 导入技能导入器失败: ${e.message}`);
  }
}

main().catch(console.error);
