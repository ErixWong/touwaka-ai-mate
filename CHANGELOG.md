# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-04-19

### Added
- **App Market 小程序市场** - 完整的App市场前端界面和后端实现 (#605, #606, #607, #608, #609, #610)
- **MCP Client 支持** - SSE传输支持、HTTP Stream传输、驻留进程管理 (#616)
- **pypdf 技能** - 全新PDF解析技能，支持图文混编PDF一次性解析 (#568, #569, #570, #575, #577)
- **知识库图文召回 API** - 实现图片存储与召回功能 (#556, #564)
- **版本号自动同步机制** - 新增版本同步功能 (#517)
- **Element Plus 全面重构** - 前端界面全面升级 (#621, #622, #627, #628, #629, #630, #631, #632, #633)

### Changed
- **UI/UX 改进**: SettingsView 系统设置页面左右布局改造
- **驻留进程管理** - 改为左右布局：左侧列表+分页，右侧详情+通信记录
- **技能工具命名规范化** - 进一步规范化工具命名
- **SSE流式输出性能优化** - 移除rAF等待，添加批量缓冲机制 (#523)
- **统一分页实现规范** (#555)
- 升级 exceljs 替代 xlsx (#621)

### Fixed
- 修复技能注册后缓存未失效问题 (#581)
- 修复 MCP 前后端契约问题 (#614, #616)
- 修复 App Market 安装流程问题 (#612, #613)
- 修复 SettingsView TypeScript 类型错误 (#633)
- 修复 pypdf 技能依赖问题 (#569, #573)
- 修复前端代码审计问题 (#609, #611)
- 修复多项 ESLint 错误

### Security
- 前端开发依赖漏洞修复 (#620)
- 安全漏洞修复与依赖升级 (#620)

## [0.2.5] - 2026-04-01

### Added
- 实现 Psyche 上下文管理系统 - 消息检索优化和工具调用 ID 映射 (#507, #437)
- 为 Markdown 文件预览添加刷新按钮 (#514, #513)
- 添加 Windows 平台支持 - 区分 Unix/Windows 命令白名单，工具描述自动显示当前平台 (#508, #510)
- 改进 execute_javascript 工具 - 重命名为 execute 并支持安全系统命令 (#509)

### Fixed
- 安全修复 - 移除 Windows copy 命令，加强 Windows 路径检查 (#511)

## [0.2.4] - 2026-03-31

### Added
- 新增 fapiao 技能 - 中国增值税发票解析 (#498, #499)
- 实现助理通知重发功能 (#493, #494)
- 知识库卡片显示创建者和管理者信息 (#488, #489)
- 管理员可修改用户邀请配额 (#468, #482)

### Fixed
- 修复 fapiao skill 的 pdfjs-dist VM 沙箱兼容性问题 (#505)
- 修复 pdfjs-dist worker 加载错误 (#503)
- 修复用户管理界面用户列表缺少垂直滚动条的问题 (#495, #497)
- 修复用户管理界面滚动问题，统一使用 Pagination 组件 (#495, #496)
- i18n 翻译键修复、邀请管理界面优化及自动化检查工具 (#491)
- 修复 isSystemAdmin 使用 mark 字段而非 level 字段判断 admin 角色 (#485, #487)
- 移除知识库内置模型选项并修复数据库外键约束 (#485, #486)
- 修复 SettingsView.vue TypeScript 类型错误 (#472, #484)
- 修复知识库页面卡片高度异常、搜索空值检查、徽章重叠问题 (#465, #483)
- 添加 user_skill_parameters 表到数据库迁移脚本 (#479, #480)
- 统一技能管理界面敏感参数图标样式并修复翻译缺失 (#478)
- 修复 skill_parameters 表 allow_user_override 字段缺失数据库迁移及安全问题 (#476)

### Changed
- 重新组织文档结构以支持开源 (#472)
- 更新 README.md，替换 init-core-skills.js 为 init-skills-from-json.js，添加前端构建说明 (#481)

### Chore
- 清理临时 Issue 和 PR body 文件

## [0.2.3] - 2026-03-30

### Fixed
- 修复 SettingsView.vue TypeScript 类型错误 (#472)
  - `permissionsData` 类型不包含 `is_admin` 属性
  - 仅使用 `expertsData.is_admin` 判断管理员角色
- 修复角色管理页面权限配置报错 (#470)
  - 后端 `getRolePermissions` 和 `getRoleExperts` 接口添加 `is_admin` 标记
  - 前端正确判断管理员角色并禁用权限编辑

### Added
- 管理员可修改用户邀请配额 (#468)

## [0.2.2] - 2026-03-30

### Changed
- **技能工具命名规范化** - 消除工具名与技能标记的语义重复 (#440)
  - 所有技能工具名简化，移除冗余前缀（如 `pdf_read` → `read`）
  - 更新 xlsx、pptx、kb-editor 等技能的 SKILL.md 文档
- **PDF 技能重构** - 工具精简为 read/write 两个核心工具 (#419)
- **PPTX 技能重构** - 工具架构优化为 4-tool 设计 (#428)
- **DOCX 技能重构** - 升级到 docx v9 并实现 Patcher API (#423)
- **skill-manager 技能精简** - 工具数量从 7 个减少到 5 个 (#454)
  - 移除 `assign_skill` 和 `unassign_skill` 工具
  - 简化工具名：`list_skills`→`list`, `register_skill`→`register` 等
- **hacknews 技能重构** - 合并 8 个工具为 1 个 (#451)
- **file-operations 技能重命名** - 更名为 `fs`，更新工具命名 (#446)
- **unifuncs-web-reader 技能重命名** - 更名为 `unifuncs` (#435)
- **erix-ssh 技能改造** - 代码审计与驻留程序优化 (#448)
- 移除旧工具名向后兼容代码 (#421)
- 清理技能工具名别名 (#438)

### Fixed
- 添加 kb-editor 子资源权限校验 (#431)

### Chore
- 同步 skill-manager 技能数据到初始化脚本 (#456)
- 清理根目录下的临时 PR 文件 (#458)

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
| 0.3.0 | 2026-04-19 | App Market小程序市场、MCP Client、Element Plus重构、pypdf技能 |
| 0.2.5 | 2026-04-01 | Psyche 上下文管理系统、Windows 平台支持、安全修复 |
| 0.2.4 | 2026-03-31 | 新增发票解析技能、助理通知重发、知识库卡片信息展示、多项 Bug 修复 |
| 0.2.3 | 2026-03-30 | 修复 TypeScript 类型错误、角色管理权限配置修复、管理员可修改邀请配额 |
| 0.2.2 | 2026-03-30 | 技能工具命名规范化、PDF/PPTX/DOCX 技能重构、skill-manager 精简 |
| 0.2.0 | 2026-03-26 | 自主任务状态优化、助理系统增强、Bug 修复 |
| 0.1.0 | 2026-03-25 | Initial release |
 |