# Topics 专题设计入口

本目录收录不属于单一主线阶段、但具有明确主题边界的专题设计文档。

## 目录定位

- `topics/` 用于承载跨阶段横切能力或垂直业务专题。
- 如果某设计不适合放进 `core/` 或 `app-platform/`，但主题明确、值得长期维护，应优先放入这里的语义化子目录。

## 当前专题分类

| 目录 | 说明 |
|------|------|
| [knowledge-base/](./knowledge-base/) | 知识库结构、召回、知识点提取 |
| [resident-processes/](./resident-processes/) | 驻留技能、远程 LLM、MCP、SSH 等驻留进程专题 |
| [chat/](./chat/) | 对话体验、工具上下文、文件预览等专题 |
| [skills/](./skills/) | 技能目录、包白名单、用户代码执行 |
| [attachment/](./attachment/) | 通用附件服务专题 |
| [contract-mgr/](./contract-mgr/) | 合同管理及其后续专题设计 |

## 放置规则

- 横切能力专题：放入对应语义化子目录
- 垂直业务专题：优先为业务创建独立子目录
- 若主题尚不稳定，先放 `../drafts/`
- 若专题已被新方案替代，转入 `../archive/`

## 说明

- 合同管理后续专题已拍平到 `topics/contract-mgr/` 根层，不再保留单独的 `parse4/` 目录壳。

---

*最后更新: 2026-06-20*
