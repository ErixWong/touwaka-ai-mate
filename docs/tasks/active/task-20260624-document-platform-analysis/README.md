# 文档平台需求分析与差距审计

## 目标

- 对照“独立文档平台 + 对外文档服务 + 专家文档检索技能”三类目标，核对当前仓库已实现能力与缺口。
- 将首轮分析结果沉淀为可持续迭代的任务文档，供后续多轮讨论和开发交付使用。
- 在不改动业务代码的前提下，明确应优先建设的能力、风险点与可能的重构方向。

## 需求摘要

- 平台可作为独立模块运行，允许用户创建自己的文档集合、上传文档、更新版本，并自动完成向量化。
- 平台可为其他 app / 模块提供文档服务，支持外部上传文档、查询文档解析进度，并按外部提交的预期 JSON 格式执行元数据提取。
- 专家对话需要具备对有权限文档执行向量召回的技能能力。

## 范围

- 当前仓库内与文档平台相关的后端路由、控制器、服务、模型与脚本。
- 当前前端文档平台 API / store 与文档流水线配置实现。
- 当前设计文档中与文档智能、合同、元数据提取、版本管理相关的草稿和已落地说明。
- `docs/tasks/active/task-20260624-document-platform-analysis/` 下的审计与跟踪文档。

## 当前结论

- 当前仓库已经具备统一文档平台的核心底座：集合、文档、版本、OCR、分块、向量化、召回、版本比对等能力均已有落地实现。
- 当前最主要缺口不在“文档平台从零开始”，而在“平台服务化能力没有打通”：内部 API 缺少文档服务入口，专家技能也尚未接上文档召回，metadata 抽取能力也尚未以正确的对外接口形态落地。
- 当前代码中还存在少量实现未收口问题，如流水线阶段前后端定义不一致、召回使用环境变量而非统一模型配置、集合移除文档接口实际不可用等。
- 经需求澄清，`metadata` 抽取不应进入文档平台内部状态机；它属于对外能力接口，同一文档允许按不同需求多次抽取，且抽取结果归调用方所有，不作为平台内持久化主数据。
- 从全局最优出发，本需求不应继续依赖知识库兼容层、旧召回结构和跨模块重复抽象，而应以现有文档平台表结构和处理链为核心执行一次跨模块收敛重构。
- 截至 `audit-round04.md` 对应修复，`doc_ocr_result.status` 与 `documents.processing_status` 的状态边界已重新拆开；但 `metadata extraction` 服务面与控制器进一步收口仍属于后续任务，当前不能据此判定“进入下一阶段开发”。

## 产出物

- `README.md`：任务目标、范围、当前结论。
- `BRANCH.md`：分支与改动范围记录。
- `audit-round01.md`：本轮完整审计结果，已合并需求差距、metadata 边界修正、第一性原理分析、跨模块重构建议、行动计划与技术指导。
- `audit-round04.md`：Round 03 回归复审与阶段阻断审计。
- `changelog_round04.md`：针对 `audit-round04.md` 的实现修复、口径纠偏、验证与提交记录。

## 已拆分后续任务

- `docs/tasks/active/task-20260624-doc-platform-audit-fix-regressions/`：承接本次修复提交引入的回归与 changelog 口径修正。
- `docs/tasks/active/task-20260624-doc-platform-default-model-strategy/`：承接 `P1` 默认 embedding 模型策略与集合创建入口策略设计。
- `docs/tasks/active/task-20260624-doc-platform-service-contract-design/`：承接 `/internal/docs/*` 服务协议与 metadata extraction 接口设计。
- `docs/tasks/active/task-20260624-doc-platform-domain-convergence-refactor/`：承接知识库兼容层清理与文档域跨模块统一重构。

## 任务去混淆原则

- 主审计任务只保留总分析、总结论和任务拆分，不承接后续实现细节。
- `task-20260624-doc-platform-audit-fix-regressions` 只处理当前修复批次回归，不扩展到协议设计或跨模块统一。
- `task-20260624-doc-platform-default-model-strategy` 只处理 `P1` 策略决策，不吞并服务协议细节或领域统一重构。
- `task-20260624-doc-platform-service-contract-design` 只处理服务协议，不处理兼容层清理和代码回归。
- `task-20260624-doc-platform-domain-convergence-refactor` 只处理文档域统一重构，不吞并协议细节和单点回归修复。

## 后续迭代方式

- 后续每一轮补充分析、边界确认或方案细化，再追加新的 `audit-roundxx.md` 或专题说明文档。
- 在需求范围和实施边界明确后，再拆解为设计文档或开发任务文档供开发团队执行。
- 若后续出现需求边界修正，优先追加新一轮 audit 文档，不直接覆盖前一轮结论，保留分析演进轨迹。

✌Bazinga！
