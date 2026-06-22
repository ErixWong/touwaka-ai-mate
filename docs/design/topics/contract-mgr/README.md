# Contract Mgr 专题入口

本目录收录合同管理相关的专题设计文档，包括最终规格、已落地增强设计与技术方案储备。

## 目录定位

- `contract-mgr/` 是合同管理专题的统一入口。
- 原来的 `parse4/` 后续专题文档已经拍平吸收到本目录根层。
- 这里存放的是合同管理这一垂直业务的设计材料，而不是系统主线阶段设计。

## 推荐阅读顺序

1. [contract-v2-final-spec.md](./contract-v2-final-spec.md)
2. [contract-mgr-metadata-design.md](./contract-mgr-metadata-design.md)
3. [contract-mgr-frontend-design.md](./contract-mgr-frontend-design.md)
4. [resident-api-design.md](./resident-api-design.md)

## 文档索引

| 文档 | 说明 | 状态 |
|------|------|------|
| [contract-v2-final-spec.md](./contract-v2-final-spec.md) | 合同管理 v2 最终规格 | 规格基线 |
| [contract-mgr-metadata-design.md](./contract-mgr-metadata-design.md) | 合同元数据结构优化设计 | 已实现 |
| [contract-mgr-frontend-design.md](./contract-mgr-frontend-design.md) | 合同管理前端详情页和筛选组件设计 | 已实现 |
| [resident-api-design.md](./resident-api-design.md) | 驻留进程实现小程序自定义 API 设计 | 草稿 |

## 说明

- 原 `parse4/` 命名来自历史阶段划分，现已收敛为合同管理专题内部文档，不再单独保留目录层级。
- 若未来还有更多合同管理设计，可继续直接归入本目录，而不是重新引入新的 `parse*` 目录。

---

*最后更新: 2026-06-20*
