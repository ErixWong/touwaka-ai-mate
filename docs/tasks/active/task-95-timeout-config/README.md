# Task 95: 技能执行超时配置可配置化

## 目标

解决专家执行超长任务时的 Request timeout 问题，将技能执行超时配置从硬编码改为数据库配置。

## 背景

专家执行超长任务时，存在多层超时配置不协调的问题：
- VM 沙箱执行超时：原硬编码 10 秒
- Python 执行超时：原硬编码 30 秒
- 驻留技能超时：原硬编码 120 秒

这些超时值对于复杂任务（如文档处理、LLM 调用）来说太短。

## 实现方案

1. 在 `system_settings` 表添加超时配置项
2. `SystemSettingService` 提供超时配置获取方法
3. `SkillLoader` 读取配置并传递给子进程
4. `skill-runner` 从环境变量读取超时配置

## 修改文件

- `server/services/system-setting.service.js` - 添加超时默认值和获取方法
- `lib/skill-loader.js` - 添加 `getTimeoutConfig()` 方法
- `lib/skill-runner.js` - 从环境变量读取超时配置
- `data/skills/remote-llm/index.js` - 支持可配置超时

## 超时配置项

| 配置键 | 默认值 | 范围 |
|--------|--------|------|
| `timeout.vm_execution` | 60秒 | 5-3600秒 |
| `timeout.python_execution` | 120秒 | 10-3600秒 |
| `timeout.skill_http` | 180秒 | 10-1800秒 |
| `timeout.resident_skill` | 300秒 | 30-7200秒 |

## 验证

- [x] `npm run lint` 通过
- [x] 代码审计通过
- [x] 默认值统一管理

## 相关文档

- [代码审计报告](../../tracking/code-review-timeout-config.md)