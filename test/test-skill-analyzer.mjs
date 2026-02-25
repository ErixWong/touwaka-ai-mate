/**
 * 测试 SKILL.md 解析功能
 * 运行方式: node test/test-skill-analyzer.mjs
 */

import SkillAnalyzer from '../lib/skill-analyzer.js';
import fs from 'fs';
import path from 'path';

const analyzer = new SkillAnalyzer();

// 测试用例 1: 标准 Claude Code 格式
const testSkill1 = `---
name: searxng
description: Privacy-respecting metasearch using your local SearXNG instance. Use when you need to search the web.
argument-hint: "[query]"
disable-model-invocation: false
user-invocable: true
allowed-tools:
  - Read
  - Bash(curl *)
---

# SearXNG Search

Search the web using your local SearXNG instance.

## Tools

### web_search

Search the web using SearXNG.

**Parameters:**
- query (string, required): The search query
- n (number, optional): Number of results

## Usage

\`\`\`javascript
{
  "name": "searxng_web_search",
  "arguments": { "query": "test" }
}
\`\`\`
`;

// 测试用例 2: 多行 description
const testSkill2 = `---
name: deep-research
description: |
  Research a topic thoroughly using multiple sources.
  Use when you need comprehensive analysis or deep dive into a subject.
argument-hint: "[topic]"
context: fork
agent: Explore
allowed-tools: [Glob, Grep, Read]
---

# Deep Research

Research $ARGUMENTS thoroughly:

1. Find relevant files using Glob and Grep
2. Read and analyze the code
3. Summarize findings
`;

// 测试用例 3: 简单格式（无 frontmatter）
const testSkill3 = `# Simple Skill

This is a simple skill without frontmatter.

## Tools

### hello
Says hello.

Usage: hello
`;

// 测试用例 4: 布尔值和数组格式
const testSkill4 = `---
name: deploy
description: Deploy the application to production
disable-model-invocation: true
user-invocable: false
allowed-tools:
  - Bash(npm *)
  - Bash(git *)
model: claude-3-opus
---

# Deploy

Deploy $ARGUMENTS to production:

1. Run tests
2. Build
3. Push
`;

// 官方 skills 路径
const officialSkillsPath = 'D:/projects/github/anthropics-skills/skills';

console.log('='.repeat(60));
console.log('测试 SKILL.md 解析功能');
console.log('='.repeat(60));

// 运行内置测试
const tests = [
  { name: '标准 Claude Code 格式', skill: testSkill1 },
  { name: '多行 description', skill: testSkill2 },
  { name: '简单格式（无 frontmatter）', skill: testSkill3 },
  { name: '布尔值和数组格式', skill: testSkill4 },
];

for (const test of tests) {
  console.log('\n' + '-'.repeat(60));
  console.log(`测试: ${test.name}`);
  console.log('-'.repeat(60));
  
  const result = analyzer.basicAnalysis({ skillMd: test.skill });
  
  console.log('解析结果:');
  console.log(JSON.stringify(result, null, 2));
  
  // 验证关键字段
  console.log('\n验证:');
  console.log(`  name: "${result.name}" ${result.name ? '✅' : '❌'}`);
  console.log(`  description: "${result.description?.substring(0, 50)}..." ${result.description ? '✅' : '❌'}`);
  console.log(`  argument_hint: "${result.argument_hint}" ${result.argument_hint !== undefined ? '✅' : '❌'}`);
  console.log(`  disable_model_invocation: ${result.disable_model_invocation} ${typeof result.disable_model_invocation === 'boolean' ? '✅' : '❌'}`);
  console.log(`  user_invocable: ${result.user_invocable} ${typeof result.user_invocable === 'boolean' ? '✅' : '❌'}`);
  console.log(`  allowed_tools: [${result.allowed_tools?.join(', ')}] ${Array.isArray(result.allowed_tools) ? '✅' : '❌'}`);
  console.log(`  tools count: ${result.tools?.length} ${result.tools?.length > 0 ? '✅' : '⚠️'}`);
}

// 测试官方 skills
console.log('\n' + '='.repeat(60));
console.log('测试官方 Skills');
console.log('='.repeat(60));

const officialSkills = ['pdf', 'mcp-builder', 'skill-creator'];

for (const skillName of officialSkills) {
  const skillPath = path.join(officialSkillsPath, skillName, 'SKILL.md');
  
  if (fs.existsSync(skillPath)) {
    console.log('\n' + '-'.repeat(60));
    console.log(`测试官方 skill: ${skillName}`);
    console.log('-'.repeat(60));
    
    const skillMd = fs.readFileSync(skillPath, 'utf-8');
    const result = analyzer.basicAnalysis({ skillMd });
    
    console.log('解析结果:');
    console.log(JSON.stringify({
      name: result.name,
      description: result.description?.substring(0, 100) + '...',
      license: result.license,
      tools_count: result.tools?.length,
    }, null, 2));
    
    // 验证
    console.log('\n验证:');
    console.log(`  name: "${result.name}" ${result.name === skillName ? '✅' : '❌'}`);
    console.log(`  description 长度: ${result.description?.length} ${result.description?.length > 0 ? '✅' : '❌'}`);
  } else {
    console.log(`\n⚠️ 跳过 ${skillName}: 文件不存在`);
  }
}

console.log('\n' + '='.repeat(60));
console.log('测试完成');
console.log('='.repeat(60));
