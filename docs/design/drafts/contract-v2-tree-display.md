# 组织树与合同显示规则

> Issue: #665
> 时间: 2026-04-29

## UI设计规则

**左侧组织树**：只显示节点（集团、甲方、项目），**不显示合同**

**右侧清单**：点击节点后，显示该节点下的合同

---

## 场景1：集团层级合同（战略合作协议）

**用户操作**：
1. 在左侧树中点击"联想控股"（集团节点）
2. 右侧清单显示：
   - 战略合作协议 v1.0
   - 框架合作协议 v1.0

**数据关联**：
```
contract_v2_org_nodes:
  id=org001, node_type=group, name="联想控股"

contract_v2_main_records:
  id=contract001, org_node_id=org001, contract_name="战略合作协议"
  id=contract002, org_node_id=org001, contract_name="框架合作协议"
```

---

## 场景2：甲方层级合同（质量保证协议）

**用户操作**：
1. 在左侧树中点击"联想北京"（甲方节点）
2. 右侧清单显示：
   - 质量保证协议 v1.0
   - 共同开发协议 v1.0

**数据关联**：
```
contract_v2_org_nodes:
  id=org002, node_type=party, name="联想北京"

contract_v2_main_records:
  id=contract003, org_node_id=org002, contract_name="质量保证协议"
  id=contract004, org_node_id=org002, contract_name="共同开发协议"
```

---

## 场景3：项目层级合同（供货协议）

**用户操作**：
1. 在左侧树中点击"ThinkPad X1"（项目节点）
2. 右侧清单显示：
   - 供货协议 v1.0
   - 供货协议 v2.0（补充版）

**数据关联**：
```
contract_v2_org_nodes:
  id=org003, node_type=project, name="ThinkPad X1"

contract_v2_main_records:
  id=contract005, org_node_id=org003, contract_name="供货协议"
  
contract_v2_versions:
  id=version001, contract_id=contract005, version_number="v1.0"
  id=version002, contract_id=contract005, version_number="v2.0"
```

---

## node_type 与合同类型对应关系

**建议约束**（应用层验证）：

| node_type | 允许的合同类型 | 典型场景 |
|-----------|--------------|---------|
| `group`（集团） | strategy, framework, nda | 战略合作、框架协议、保密协议 |
| `party`（甲方） | development, quality, nda, other | 共同开发、质量保证、保密协议 |
| `project`（项目） | supply, purchase, technical, nda | 供货协议、采购协议、技术协议 |

**验证逻辑**：
```javascript
async createContract(data) {
  const { org_node_id, contract_type } = data;
  
  // 获取组织节点
  const node = await this.getOrgNode(org_node_id);
  
  // 验证合同类型与节点类型匹配
  const allowedTypes = {
    group: ['strategy', 'framework', 'nda'],
    party: ['development', 'quality', 'nda', 'other'],
    project: ['supply', 'purchase', 'technical', 'nda'],
  };
  
  if (!allowedTypes[node.node_type].includes(contract_type)) {
    throw new Error(`${node.node_type}节点不允许${contract_type}类型合同`);
  }
  
  // 创建合同
  return await this.models.ContractV2MainRecord.create(data);
}
```

---

## UI布局示例

```
┌──────────────────┬────────────────────────────────────┐
│ 组织树           │ 合同清单（点击节点后显示）          │
├──────────────────┼────────────────────────────────────┤
│                  │                                    │
│ ▼ 联想控股       │  当前节点：联想控股（集团）          │
│                  │  ┌──────────────────────────────┐ │
│ ▼ 联想北京       │  │ 战略合作协议 v1.0            │ │
│                  │  │ [查看详情] [上传新版本]      │ │
│   ▼ ThinkPad项目 │  │                              │ │
│                  │  │ 框架合作协议 v1.0            │ │
│                  │  │ [查看详情] [上传新版本]      │ │
│                  │  └──────────────────────────────┘ │
│                  │                                    │
│                  │  [+上传合同到当前节点]             │
│                  │                                    │
└──────────────────┴────────────────────────────────────┘
```

**点击不同节点，右侧显示不同合同**：

- 点击"联想控股"：显示集团层级合同（战略合作、框架协议）
- 点击"联想北京"：显示甲方层级合同（质量保证、共同开发）
- 点击"ThinkPad项目"：显示项目层级合同（供货协议）

---

## 合同不在树状结构中的优势

**优势**：
- ✅ 组织树结构清晰（只显示节点）
- ✅ 合同集中显示（右侧清单）
- ✅ 层级关系明确（不会混乱）
- ✅ 查找方便（点击节点快速切换）

**如果合同也显示在树状结构**（❌ 不推荐）：
```
├─ 联想控股
│  ├─ 战略合作协议 ← 合同节点混在组织节点中（混乱）
│  ├─ 框架合作协议
│  └─ 联想北京
│     ├─ 质量保证协议 ← 不清楚是组织节点还是合同
│     └─ ThinkPad项目
│        └─ 供货协议
```

---

## 数据查询API

### 查询某节点的合同

```javascript
async getNodeContracts(nodeId) {
  return await this.models.ContractV2MainRecord.findAll({
    where: { org_node_id: nodeId },
    include: [{
      model: this.models.ContractV2Version,
      as: 'versions',
      where: { is_current: true },
      limit: 1,
    }],
    order: [['created_at', 'DESC']],
  });
}
```

### 查询某节点及其子节点的所有合同

```javascript
async getNodeWithChildrenContracts(nodeId) {
  const node = await this.getOrgNode(nodeId);
  
  return await this.models.ContractV2MainRecord.findAll({
    where: {
      org_node_id: {
        [Op.in]: Sequelize.literal(`
          (SELECT id FROM contract_v2_org_nodes 
           WHERE path LIKE '${node.path}%')
        `)
      }
    },
    order: [['created_at', 'DESC']],
  });
}
```

---

## contract_type 扩展建议

**扩展枚举**：
```sql
ALTER TABLE contract_v2_main_records
MODIFY COLUMN contract_type ENUM(
  'strategy',     -- 战略合作（集团层级）
  'framework',    -- 框架协议（集团层级）
  'development',  -- 共同开发（甲方层级）
  'supply',       -- 供货协议（项目层级）
  'purchase',     -- 采购协议（项目层级）
  'quality',      -- 质量保证（甲方层级）
  'nda',          -- 保密协议（任意层级）
  'technical',    -- 技术协议（项目层级）
  'other'         -- 其他协议（任意层级）
);
```

---

## 前端交互流程

### 用户上传合同

```
1. 用户在左侧树中选择某个节点（如"联想控股")
2. 右侧显示当前节点信息 + [+上传合同到当前节点]按钮
3. 用户点击上传按钮
4. 弹出对话框：
   - 选择合同类型（strategy/framework/nda）
   - 上传合同文件
   - 系统自动验证合同类型与节点类型匹配
5. 上传成功，右侧清单显示新合同
```

### 前端组件

**OrgTree.vue**：
- 显示组织树（只显示节点）
- 点击节点触发事件：`@select="handleSelect"`
- 不显示合同（合同在右侧清单）

**ContractList.vue**：
- 显示当前节点的合同清单
- Props: `orgNodeId`, `orgNodeName`, `orgNodeType`
- 显示上传按钮：`[+上传合同到${orgNodeName}]`

---

## 总结

**设计规则**：
- ✅ 组织树只显示节点（集团、甲方、项目）
- ✅ 合同不显示在树状结构中
- ✅ 点击节点后，右侧显示该节点的合同
- ✅ 不同层级允许不同合同类型（应用层验证）

**优势**：
- ✅ 组织树结构清晰
- ✅ 合同集中显示
- ✅ 层级关系明确
- ✅ 查找方便

**下一步**：
- 确认设计规则
- 更新主设计文档