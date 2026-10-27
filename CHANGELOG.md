# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2026-10-27

> 本轮跨度 339 个提交（v0.4.0 之后），主线是 **erix 引擎接入与消息面第一性重构**（epic #1094 / #1156），
> 以及文档平台、标准管理 App、App 平台 runtime 的成体系落地。以下按主题归并，条目末尾为 issue/PR 号。

### Added

**erix 引擎与消息面**（epic #1094 / #1156）
- **Provider 适配层（L3-M1）** - 桥接 `LLMClient` 到 erix provider 契约，零业务侧改动
- **`runToolLoop` 装配层（L3-M2）** - tool executor 适配 + completion/retry/context 配置 + store 接线 (#1112)
- **`AgentLoop.runErix`（L3-M3a）** - 由 erix `runToolLoop` 承载专家循环，平行实现不动原 `run` (#1113)
- **切流量（L3-M3b）** - `ERIX_LOOP` 开关 + 观测日志 + attempt 对齐 + 复用 `execute_tools` (#1114)
- **消息面 Stage A** - 新增 `agent_transcript_rounds` 与 `llm_kit_run_checkpoint`（仅 DDL）(#1156)
- **消息面 Stage B** - `appendRound` 单事务写入并落 canonical 真相 + 回填与全量比对脚本 (#1156)
- **消息面 Stage C** - 读侧 `ERIX_TRANSCRIPT_READ_MODE` 开关与两模式等价比对 (#1156)
- **消息面 Stage D** - 读侧默认切 canonical(new) + dedup 竞态守卫 + 升级手册 (#1187)
- **erix-agent 0.23.0 存储收敛适配** - 轮行不再携带 `messages`，宿主侧 `foldMessageRows()` 把消息行折回轮（canonical 与 legacy 两条读路径同步）；同批落地上游差集：`usage.total` 按 provider 族派生、只回 reasoning 时打 `providerThinkingOnly` 标记、压缩有界化 `stillOverBudget`、逐条 `ts` 与多字节安全截断原语 (#1223)
- **erix-agent 升级链** - 0.2.0 → 0.3.x → 0.10.0 → 0.14.0 → 0.16.0 → 0.17.0 → 0.18.0 → 0.19.0 → 0.20.0 → 0.23.0，逐版契约对齐与回归（#1108 / #1122 / #1129 / #1133 / #1138 / #1148 / #1150 / #1202 / #1211 / #1213）
- **judge 决策增强** - judge 接入反思模型（reflective，fallback 主模型）(#1118)、judge task 简报 + 三态开关 (#1119)
- **`system-bot` 平台通用系统账户** - 后台任务身份，登录禁用 (#1101)

**文档平台**
- **文档集合（Collection）统一管理** - 可见性、归属与检索闭环 (#774)
- **检索真原子化 Phase 1** - 6 原子 tool 名实一致 + handle 交接 + 消费层数据驱动 (#967)
- **检索 Phase 2** - parser 锚点识别集成 + 四维 rerank + 证据覆盖统计 (#968)
- **版本管理完整闭环** - 检索版本感知 (#1028)
- **MinerU v2 OCR 流程** - 吸收 TaskID 导入 (#996)、OCR 闭环与真实 task_id + 后台任务隔离 (#803)、新增 OCR 工具应用 (#754)
- **集合卡片视觉重做 + 页宽放宽** (#1076)、**CSV 预览与任务文件类型放宽** (#885)、**CJK 字体支持** (@pdf-lib/fontkit, #762)

**标准管理 App**
- **标准管理全量落地 + 审计修复** (#1047)
- 反向引用视图 (#1098)、跨标准 gap 聚合清单 (#1097)、清洗进度可见 + 增量清洗/断点续洗 (#1099)、一键重洗新版本 + 失效锚点可见性 (#1103)、筛选能力并入左树 (#1100)

**App 平台与业务 App**
- **App 平台 runtime 架构重构 Phase 1-6** (#891)、**路由前缀规范化 + 声明式 apis + legacy 兼容层** (#894)、**CFA app 迁移与增强恢复** (#922)
- invoice-mgr 专属界面与配置 (#775)、架构审计（共享模块 / tick 拆分 / 前端重构）(#769)
- contract-mgr-v2 前端接入 Doc Platform 处理状态 / 重试 / revisions / 分类建议 (#791)
- ELS study workspace (#815)

**记忆与上下文**
- notes 兼容别名 `note_*` + 文案对齐（Phase 3 阶段一）(#1131)
- `messages.meta_json` 列，保住 message 级 meta（erix 0.16 store 保真最后一处缺口）(#1149)
- CFA 压缩框架升级 - minimax 最优分段转正默认 + LLM 输入重构 (#974)、前端本地压缩 + 后端 LLM 阶段识别 (#930)

### Changed

- **持久化表结构重构** - run / round / message / tool_call 三层物化，退役 `llm_kit_transcripts` (#1135)
- **退役 `llm_kit_run_state`** - drop 表并删除老建表迁移步骤 (#1136)
- **读侧默认真相源切换** - `ERIX_TRANSCRIPT_READ_MODE` 默认 `new`（canonical）(#1187)
- **notes 存储层废除乐观锁** - `record_version` CAS 移除，同 key 并发改 LWW (#1207)
- **内置 Notes 工具名去点号** - `notes.take/read/list` → `notes_*`，修严格 provider 400 (#1125)
- **上下文压缩与 recall 治理** - legacy 检查降频、压缩锁与归档器分组纳入 task 维度 (#1037 / #1145)
- **运行时与部署** - 基础镜像 Node 20 → 22（对齐 erix-agent `engines>=22`）(#1110)；compose 定义入库并改名为 `dev`、密钥插值、依赖 mtime 判定修「升级静默不生效」；`upgrade-database` 支持 `--dry-run` / `--step` (#1158)
- **`xlsx` 启动期硬依赖移除** (#903)、**execute script runner 重设计** (#870)、**设置页个人安全配置拆分** (#983)

### Fixed

- **消息面** - 工具调用 `duration_ms` 静默落 NULL (#1213)；删除三条坏 226 天且无消费方的消息读接口 + `attributes` 列守卫 (#1188)；`max_tool_rounds` 服务端校验与运行时共用夹取 (#1166)；tool context 仅透传 string，结构化 context 不再崩前端 (#1120)
- **持久化** - 上游诊断事件与持久化失败可见化 (#1155)；补持久化落库与生产包装层真实覆盖 (#1154)；MCP 管理 i18n 消息含未转义 `@`/花括号致页面崩溃 (#1105)
- **反思与记忆** - 反思解析改容错提取，作废返回 null、不再往 psyche 写假反思 (#1215)；反思输出预算改用 `max_tokens` 并按实测分位数定值 (#1224)；notes 过期清理复核过期谓词并分批 purge (#1209)；notes 端口补 list filters 校验与生效、purge scanned 换算 scope 数 (#1211)；notes 请求级 `scopeRef` 校验 + 上游一致 canonicalize + 幂等迁移 (#1153)
- **数据库与迁移** - 空库首跑 upgrade 三个建表步骤按 FK 父表顺序重排 (#1190)；新装库补齐 erix 持久化表并在 init 收尾跑 upgrade (#1179)；`llm_kit_transcripts` 建表迁移补充 (#1115)；迁移脚本 check 先判表存在
- **文档与检索** - 回填脚本生产路径改用 mysql 驱动 (#1156)；`fapiao` 返回结构补 `pages` 字段修商品明细未入库；standard-mgr 重装被表名安全校验拦截加 legacy 豁免 (#1080)
- **前端** - 登录页视觉重构 + i18n 全量覆盖 (#801)；聊天消息状态与渲染稳定性收敛；OCR 工具界面左右布局与识别计时
- **测试与守卫** - 消息面行级 SQL 不变式闸门 + parity 三分类修 exit 语义 (#1196)；破坏性测试前硬断言目标必须是测试库 (#1167)；接入上游契约套件（executeTool / engineApi / modelConfigProvider，#1152）；删除死导出并补未导入标识符守卫 (#1219)

### 未包含（本次发版不处理的已知项）

- `frontend` 的 `npm audit` 仍有 27 条告警（high 含 `axios ≤1.19.0` 的 NO_PROXY 绕过 CVE-2026-42043）。服务端不使用 axios，该 CVE 属 Node 侧机制、浏览器侧不可利用，故本次**不做**依赖跳跃；第三方扫描器提交的自动修复 PR 经评估已关闭（目标版本 1.18.0 仍在受影响区间）。
- 默认 admin 密码仍由 seed 脚本硬编码（`password123`，仅影响**新装库**）。已播种库是否仍为该口令属**数据**问题，需运维侧核实与改密；代码侧改法（`DEFAULT_ADMIN_PASSWORD` 强制注入 + 生产不播种 `test`）留待独立变更。
- erix 消息面上游差集的剩余项未开工：#439 B（`load()` 出口剥档案信封 `ts`）、#416（有界 journal）、#458（工具名归一，0.23.0 无对应物）、0.22.0 的 dedup 冲突抛错语义（需先拍板），均需真环境基线（详见 #1222 / #1220）。

## [0.4.0] - 2026-05-26

### Added
- **前端组件统一迁移** - 所有前端组件统一使用 Element Plus (#752)
- **LLM 请求中断支持** - 支持 abort 取消 LLM 请求 (#747)
- **多模态图片识别处理优化** - 改进图片识别流程 (#747)
- **工具调用限制通知** - 80% 警告 + 100% 摘要 (#737)
- **ECharts 可视化集成** - vue-echarts + echarts 依赖 (#729, #718)
- **发票管理小程序** - 完整的发票管理功能 (#715, #720, #723, #725)
- **合同管理v2** - 全新合同管理应用架构 (#665, #667, #669, #670, #673, #674, #676, #677, #679, #683)
- **动态组件加载** - 消除 AppComponentMap 硬编码 (#696, #699)
- **Handler Registry** - 消除后端硬编码特判 (#696)
- **MCP Stateless HTTP 传输支持** - 支持无状态 HTTP 传输 (#635)
- **App Step 资源配置化** - Handler MCP/LLM 可选 + params_mapping (#634)
- **合同比对功能** - 选中两份合同逐章节语义比对生成报告 (#662, #671)
- **App Market 动态组件注册** - 支持动态注册前端组件
- **误工分析工具优化** - ECharts 可视化 + 按账号聚合 (#710, #717)
- **PM Judge 机制增强** - 自主任务判断优化 (#731)
- **LLM 上下文大小评估与自动分块** (#685)

### Changed
- **合同管理v2 架构优化** - Handler 分层、专用持久化、文本过滤 (#663, #687, #689)
- **销售合同管理 Handler 配置优化** (#639, #643)
- **OCR 异步处理与文本过滤流程** (#644)
- **Vue Router 导航守卫优化** - 去除废弃的 next() 回调 (#672)
- **前端类型系统完善** - 修复 TypeScript 类型错误

### Fixed
- **i18n 翻译键补充** - 知识库、专家、Tab 标签等翻译键 (#749, #750)
- **Excel 技能路径规则统一** - 与 FS 技能一致 (#736, #739, #740)
- **docx 技能路径说明** - 统一规则 (#741)
- **技能访问权限限制** - fs skill 只能访问当前工作目录 (#707)
- **App 生命周期缺陷修复** - uninstall 清理 registry + 安装回滚 + 安全更新 (#696)
- **前端语法错误修复** - AppDetailView 等 (#727)
- **重提取 API 实现** - 支持状态重置触发重新提取 (#649, #666)
- **App 安装卸载流程多项修复** (#652)
- **文本过滤分块滑动窗口** - 支持超长文本 (#657)
- **内网访问优化** - 移除自动更新检查和 modal 点击关闭 (#686)
- **多模态重试机制** - 添加 EOF 和 do_request_failed 到可重试错误 (#745)

## [0.3.1] - 2026-04-19

### Added
- **Element Plus 全面重构 (续)** - SettingsView 完全重构 (#625)
  - 左侧菜单 → `el-menu` 组件
  - 个人资料子 Tab → `el-tabs`
  - User/Role/Provider/Model/Expert/Skills 对话框全部使用 `el-dialog` + `el-form`
  - 清理 380+ 行不再需要的自定义 CSS
  - 删除确认对话框统一使用 `ElMessageBox.confirm`

### Changed
- **Pagination 组件** - 改用 `el-pagination`
- **Toast 组件** - 内部使用 `ElMessage` 替代自定义实现

### Docs
- **代码审计清单** - 新增 Element Plus 使用规范检查项

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
| 0.3.1 | 2026-04-19 | Element Plus重构完成、SettingsView全面升级 |
| 0.3.0 | 2026-04-19 | App Market小程序市场、MCP Client、Element Plus重构、pypdf技能 |
| 0.2.5 | 2026-04-01 | Psyche 上下文管理系统、Windows 平台支持、安全修复 |
| 0.2.4 | 2026-03-31 | 新增发票解析技能、助理通知重发、知识库卡片信息展示、多项 Bug 修复 |
| 0.2.3 | 2026-03-30 | 修复 TypeScript 类型错误、角色管理权限配置修复、管理员可修改邀请配额 |
| 0.2.2 | 2026-03-30 | 技能工具命名规范化、PDF/PPTX/DOCX 技能重构、skill-manager 精简 |
| 0.2.0 | 2026-03-26 | 自主任务状态优化、助理系统增强、Bug 修复 |
| 0.1.0 | 2026-03-25 | Initial release |
 |