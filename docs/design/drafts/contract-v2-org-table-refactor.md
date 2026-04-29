# contract_v2_org_nodes 表设计优化

> Issue: #665
> 时间: 2026-04-29

## 用户质疑分析

### 1. node_type是否够用？

**问题**：contract属于node吗？

**分析**：
- ❌ contract不是组织节点
- ✅ contract是挂在组织节点下的业务实体（通过contract_v2_main_records关联）
- ✅ node_type只用于组织层级：group（集团）, party（甲方）, project（项目）

**结论**：node_type定义正确，contract不属于node_type

---

### 2. 字段必要性评估

| 字段 | 是否需要 | 分析 |
|------|---------|------|
| `code`（节点编码） | ❌ 不需要 | 非必须，可通过name直接查询 |
| `full_name`（完整路径名称） | ❌ 不需要 | 可通过path查询动态拼接 |
| `description`（节点描述） | ❌ 不需要 | 组织节点通常不需要描述 |
| `metadata`（扩展信息） | ❌ 不需要 | 暂无明确用途 |
| `contract_count`（合同数量缓存） | ❌ 不需要 | 增加维护成本，可查询时计算 |
| `total_contract_count`（总合同数量） | ❌ 不需要 | 增加维护成本，可查询时计算 |
| `path`（层级路径） | ✅ **需要** | 性能优化，避免递归查询 |
| `level`（层级深度） | ✅ **需要** | 快速查询特定层级节点 |
| `sort_order`（排序） | ✅ **需要** | 控制节点显示顺序 |
| `is_active`（是否启用） | ✅ **需要** | 支持节点禁用 |

---

### 3. path字段的作用

**保留理由**：性能优化

**用途**：
```sql
-- 快速查询某节点及其所有子节点
WHERE path LIKE '/org001/%'

-- 避免递归查询（性能优化）
-- 无path：需要递归查询parent_id，性能差
-- 有path：一次LIKE查询，性能好
```

**示例**：
```
org001（集团）: path="/org001"
org002（甲方）: path="/org001/org002"
org003（项目）: path="/org001/org002/org003"

查询"联想控股"及其所有子节点：
SELECT * FROM contract_v2_org_nodes 
WHERE path LIKE '/org001%';

返回：org001, org002, org003（一次查询）
```

**结论**：保留path字段

---

### 4. contract_count字段的问题

**去掉理由**：增加维护成本

**问题**：
- ❌ 每次上传合同需更新contract_count
- ❌ 每次删除合同需更新contract_count
- ❌ 每次移动合同需更新contract_count
- ❌ 增加数据一致性风险

**替代方案**：查询时计算

```sql
-- 查询某节点的合同数量
SELECT COUNT(*) FROM contract_v2_main_records 
WHERE org_node_id = 'org001';

-- 查询某节点及其子节点的合同总数
SELECT COUNT(*) FROM contract_v2_main_records 
WHERE org_node_id IN (
  SELECT id FROM contract_v2_org_nodes 
  WHERE path LIKE '/org001%'
);
```

**结论**：去掉缓存字段，查询时计算

---

## 精简后的表结构

```sql
CREATE TABLE contract_v2_org_nodes (
  id VARCHAR(32) PRIMARY KEY COMMENT '节点ID',
  parent_id VARCHAR(32) NULL COMMENT '父节点ID（NULL表示顶级）',
  node_type ENUM('group', 'party', 'project') NOT NULL COMMENT '节点类型：集团/甲方/项目',
  name VARCHAR(128) NOT NULL COMMENT '节点名称',
  path VARCHAR(255) NOT NULL COMMENT '层级路径（如：/org001/org002/org003）',
  level INT NOT NULL COMMENT '层级深度（1=集团, 2=甲方, 3=项目）',
  sort_order INT DEFAULT 0 COMMENT '同级排序',
  is_active BIT(1) DEFAULT 1 COMMENT '是否启用',
  created_by VARCHAR(32) COMMENT '创建人',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_parent (parent_id),
  INDEX idx_type (node_type),
  INDEX idx_path (path),
  INDEX idx_level (level),
  INDEX idx_active (is_active),
  
  FOREIGN KEY (parent_id) REFERENCES contract_v2_org_nodes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合同v2组织节点表';
```

**保留字段**（8个核心字段）：
1. ✅ id（节点ID）
2. ✅ parent_id（父节点ID）
3. ✅ node_type（节点类型）
4. ✅ name（节点名称）
5. ✅ path（层级路径）- **性能优化**
6. ✅ level（层级深度）- **快速查询**
7. ✅ sort_order（排序）
8. ✅ is_active（是否启用）

**去掉字段**（6个冗余字段）：
1. ❌ code（节点编码）
2. ❌ full_name（完整路径名称）
3. ❌ description（节点描述）
4. ❌ metadata（扩展信息）
5. ❌ contract_count（合同数量缓存）
6. ❌ total_contract_count（总合同数量）

---

## path字段生成规则

**API逻辑**：

```javascript
// ContractV2Service.js
async createOrgNode(data) {
  const { parent_id, node_type, name } = data;
  
  // 验证层级规则（应用层约束）
  if (node_type === 'group') {
    if (parent_id !== null) {
      throw new Error('集团只能作为顶级节点');
    }
    data.level = 1;
    data.path = `/${data.id}`;
  }
  
  if (node_type === 'party') {
    if (!parent_id) {
      throw new Error('甲方必须有父节点');
    }
    const parent = await this.getOrgNode(parent_id);
    if (parent.node_type !== 'group') {
      throw new Error('甲方的父节点必须是集团');
    }
    data.level = 2;
    data.path = `${parent.path}/${data.id}`;
  }
  
  if (node_type === 'project') {
    if (!parent_id) {
      throw new Error('项目必须有父节点');
    }
    const parent = await this.getOrgNode(parent_id);
    if (parent.node_type !== 'party') {
      throw new Error('项目的父节点必须是甲方');
    }
    data.level = 3;
    data.path = `${parent.path}/${data.id}`;
  }
  
  return await this.models.ContractV2OrgNode.create(data);
}
```

**path生成示例**：
```
创建集团（org001）:
  parent_id = NULL
  path = "/org001"
  level = 1

创建甲方（org002）:
  parent_id = org001
  parent.path = "/org001"
  path = "/org001/org002"
  level = 2

创建项目（org003）:
  parent_id = org002
  parent.path = "/org001/org002"
  path = "/org001/org002/org003"
  level = 3
```

---

## 查询合同数量的API

**不使用缓存，查询时计算**：

```javascript
// ContractV2Service.js

// 查询某节点的直属合同数量
async getNodeContractCount(nodeId) {
  const count = await this.models.ContractV2MainRecord.count({
    where: { org_node_id: nodeId }
  });
  return count;
}

// 查询某节点及其子节点的合同总数
async getTotalContractCount(nodeId) {
  const node = await this.getOrgNode(nodeId);
  
  const count = await this.models.ContractV2MainRecord.count({
    where: {
      org_node_id: {
        [Op.in]: Sequelize.literal(`
          (SELECT id FROM contract_v2_org_nodes 
           WHERE path LIKE '${node.path}%')
        `)
      }
    }
  });
  
  return count;
}

// 获取组织树（含合同数量，动态计算）
async getOrgTreeWithContractCount() {
  const nodes = await this.models.ContractV2OrgNode.findAll({
    order: [['level', 'ASC'], ['sort_order', 'ASC']],
    raw: true,
  });
  
  // 为每个节点计算合同数量
  for (const node of nodes) {
    node.contract_count = await this.getNodeContractCount(node.id);
  }
  
  return nodes;
}
```

**性能优化**：
- 批量查询合同数量（避免N+1问题）
- 使用path索引快速查询

---

## 前端显示动态拼接full_name

**不存储full_name，前端动态拼接**：

```javascript
// OrgTree.vue
computed: {
  nodeFullName() {
    // 根据path拼接完整路径名称
    const pathIds = this.node.path.split('/').filter(id => id);
    const pathNames = pathIds.map(id => {
      const node = this.allNodes.find(n => n.id === id);
      return node ? node.name : id;
    });
    return pathNames.join('/');
  }
}
```

**显示示例**：
```
path = "/org001/org002/org003"
动态拼接：
org001.name = "联想控股"
org002.name = "联想北京"
org003.name = "ThinkPad项目"
full_name = "联想控股/联想北京/ThinkPad项目"
```

**优势**：
- ✅ 不存储冗余字段
- ✅ name变化时自动更新（无需维护full_name）
- ✅ 减少数据库维护成本

---

## 总结

**精简后的表结构**：

| 字段 | 类型 | 必要性 | 说明 |
|------|------|--------|------|
| id | VARCHAR(32) | ✅ 必须 | 节点ID |
| parent_id | VARCHAR(32) | ✅ 必须 | 父节点ID |
| node_type | ENUM | ✅ 必须 | 集团/甲方/项目 |
| name | VARCHAR(128) | ✅ 必须 | 节点名称 |
| path | VARCHAR(255) | ✅ **必须** | 层级路径（性能优化） |
| level | INT | ✅ 必须 | 层级深度（快速查询） |
| sort_order | INT | ✅ 必须 | 排序 |
| is_active | BIT(1) | ✅ 必须 | 是否启用 |

**去掉的冗余字段**：
- ❌ code（节点编码）
- ❌ full_name（完整路径名称）
- ❌ description（节点描述）
- ❌ metadata（扩展信息）
- ❌ contract_count（合同数量缓存）
- ❌ total_contract_count（总合同数量）

**替代方案**：
- contract_count：查询时计算（COUNT查询）
- full_name：前端动态拼接（根据path）

**优势**：
- ✅ 表结构精简（8个核心字段）
- ✅ 减少维护成本（无缓存字段）
- ✅ 数据一致性更好（无冗余数据）
- ✅ 性能优化（path索引）

**下一步**：
- 确认精简后的表结构
- 更新设计文档