# CFA 单独合并

## 目标
- 从 `PR #902` 中仅提取 `current-feature-analyzer` 相关改动。
- 避免把知识库、文档平台、附件和其他无关历史改动带入当前分支。
- 在合并 CFA 迁移代码时，同步修复本轮审计已确认的阻塞问题。

## 范围
- `apps/current-feature-analyzer/**`
- `frontend/src/api/current-feature-analyzer.ts`
- `frontend/src/components/current-feature-analyzer/**`
- `frontend/src/composables/useCurrentFeatureAnalyzerError.ts`
- `frontend/src/composables/useCurrentFeatureAnalyzerPolling.ts`
- `frontend/src/stores/currentFeatureAnalyzer.ts`
- `frontend/src/views/current-feature-analyzer/CurrentFeatureAnalyzerView.vue`
- `lib/chat/base-llm.js`
- `server/controllers/current-feature-analyzer.controller.js`
- `server/routes/current-feature-analyzer.routes.js`

## 处理策略
- 基线使用当前 `origin/master`。
- 仅从 `origin/pr-902` checkout CFA 必需文件，不接入 KB/文档平台相关文件。
- 对照审计结论做最小必要修补，不原样照搬 PR 中已确认有问题的实现。

## 本次额外修补
- 修复会话失效后 `reset()` 未清理 `sessionExpired` 的问题。
- 修复页面卸载时未显式停止 polling 的问题。
- 修复快速切换文件时详情请求被全局锁直接丢弃的问题，改为补拉最后一次目标文件详情。
- 修复安装态默认配置缺口：在 `manifest.json` 与配置服务默认值中补齐 `analysis_prompt_template` / `json_output_schema`，避免新安装后管理员看到空白配置。

## 验证计划
- `npm run lint`
- 对涉及 `import` / `export` 的后端文件做 ES 模块导入验证
- 检查工作树仅包含 CFA 相关变更和任务留痕
