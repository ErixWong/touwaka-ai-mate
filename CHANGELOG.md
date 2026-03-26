# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-03-26

### Fixed
- 修复用户代码执行器 `Illegal return statement` 错误 (#415)
- 修复 PDF 技能代码审计问题 (#411)
- 修复开启自动运行模式时覆盖已有 `expert_id` 的问题 (#409)
- 修复自动执行按钮设置正确的 `autonomous_wait` 状态 (#403)
- 修复任务状态被错误地从 `active` 改为 `autonomous_wait` (#401)
- 修复专家上下文拼接程序历史消息顺序混乱问题 (#398)
- 修复 `updateTaskLastExecutedByTopic` 方法缺失导致的运行时错误 (#392)
- 修复 `createAssistant` 类型定义，id 由后端生成无需前端传入 (#389)

### Added
- 自主任务完成判断与错误状态处理 (#414)
- 将所有 Modal 改为 static 模式防止误关闭 (#395)
- 为 `file-operations` 技能添加文件操作引导提示 (#388)

### Changed
- 移除已废弃的 `autonomous` 状态 (#405, #406)
- 移除 `skills-data.json` 中的 `user-code-executor` 技能定义 (#396)

### Chore
- 清理根目录下的临时文件 (#390)
- 添加缺失的 `install-git-hooks.js` 脚本

## [0.2.0] - 2026-03-26

### Added
- 自主任务状态优化：添加 `autonomous_wait` / `autonomous_working` 状态，改善任务执行状态管理
- file-operations 技能引导提示：指导 LLM 先调用 `fs_info` 获取文件信息，避免直接读取二进制文件
- 专家调用助理时机指导：在 System Prompt 中添加助理召唤时机说明
- 助理请求重试功能：支持失败任务重试，归档任务禁止重试

### Fixed
- 修复 `updateTaskLastExecutedByTopic` 方法缺失导致的运行时错误
- 修复 `createAssistant` 类型定义，id 由后端生成无需前端传入
- 修复助理面板细节：归档时关闭详情、已归档禁止重试删除、仅失败允许重试
- 修复助理系统反馈专家失败及图片路径解析问题
- 修复助理调用时图片路径解析错误
- 修复 `refreshAssistantsCache` 返回值解构错误
- 修复助理页面 `assistant_type` 字段输入验证缺失

### Changed
- 重构 `streamChat` 方法：提取 `_prepareTaskContext`、`_executeLLMRounds`、`_executeTools` 私有方法
- 将 `assistant_type` 重命名为 `id`，优化字段命名语义
- 合并 `http_headers` 到 `net_check`，新增 `net_connect` 工具

### Chore
- 清理根目录下的临时文件

## [0.1.0] - 2026-03-25

### Added
- Initial release of Touwaka Mate v2
- AI Expert system with bicameral mind architecture
- Expert management with unique personas
- Topic-based conversation history
- Skill system for tool capabilities
- Knowledge base management
- User management and authentication
- Multi-language support (i18n)
- Docker deployment support

### Technical Stack
- Frontend: Vue 3 + TypeScript + Vite + Pinia
- Backend: Node.js + Koa + MySQL
- AI: LLM application development, Prompt Engineering

---

## Version History

| Version | Date | Description |
|---------|------|-------------|
| 0.2.0 | 2026-03-26 | 自主任务状态优化、助理系统增强、Bug 修复 |
| 0.1.0 | 2026-03-25 | Initial release |