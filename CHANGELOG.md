# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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