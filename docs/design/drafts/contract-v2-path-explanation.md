# path字段作用详解

> Issue: #665
> 时间: 2026-04-29

## 问题：path字段有什么用？

---

## 场景1：查询"联想控股"及其所有子节点

### ❌ 无path字段（需要递归查询）

**查询逻辑**：
```javascript
// 第1步：查询顶级节点
SELECT * FROM contract_v2_org_nodes WHERE id = 'org001';

// 第2步：查询org001的直接子节点
SELECT * FROM contract_v2_org_nodes WHERE parent_id = 'org001';
// 返回：org002, org005

// 第3步：查询org002的子节点
SELECT * FROM contract_v2_org_nodes WHERE parent_id = 'org002';
// 返回：org003, org004

// 第4步：查询org003的子节点
SELECT * FROM contract_v2_org_nodes WHERE parent_id = 'org003';
// 返回：无

// 第5步：查询org004的子节点
SELECT * FROM contract_v2_org_nodes WHERE parent_id = 'org004';
// 返回：无

// 第6步：查询org005的子节点
SELECT * FROM contract_v2_org_nodes WHERE parent_id = 'org005';
// 返回：org006

// 第7步：查询org006的子节点
SELECT * FROM contract_v2_org_nodes WHERE parent_id = 'org006';
// 返回：无

// 总查询次数：7次
```

**问题**：
- ❌ 需要多次查询（递归）
- ❌ 性能差（每层需要一次查询）
- ❌ 层级越深，查询次数越多

---

### ✅ 有path字段（一次查询）

**查询逻辑**：
```sql
SELECT * FROM contract_v2_org_nodes 
WHERE path LIKE '/org001%';

-- 或更精确
WHERE path LIKE '/org001/%' OR path = '/org001';
```

**返回结果**（一次查询）：
```
org001: path='/org001'       （联想控股）
org002: path='/org001/org002' （联想北京）
org003: path='/org001/org002/org003' （ThinkPad项目）
org004: path='/org001/org002/org004' （ThinkPad X2项目）
org005: path='/org001/org005' （联想深圳）
org006: path='/org001/org005/org006' （华为合作项目）
```

**优势**：
- ✅ 只需一次查询
- ✅ 利用path索引（性能好）
- ✅ 层级深度不影响性能

---

## 场景2：查询"联想北京"及其所有子节点

### ❌ 无path字段（递归查询）

```javascript
// 第1步：查询org002
SELECT * FROM contract_v2_org_nodes WHERE id = 'org002';

// 第2步：查询org002的子节点
SELECT * FROM contract_v2_org_nodes WHERE parent_id = 'org002';
// 返回：org003, org004

// 第3步：查询org003的子节点
SELECT * FROM contract_v2_org_nodes WHERE parent_id = 'org003';
// 返回：无

// 第4步：查询org004的子节点
SELECT * FROM contract_v2_org_nodes WHERE parent_id = 'org004';
// 返回：无

// 总查询次数：4次
```

---

### ✅ 有path字段（一次查询）

```sql
SELECT * FROM contract_v2_org_nodes 
WHERE path LIKE '/org001/org002%';
```

**返回结果**：
```
org002: path='/org001/org002'
org003: path='/org001/org002/org003'
org004: path='/org001/org002/org004'
```

---

## 场景3：查询某节点及其子节点的所有合同

### ❌ 无path字段（复杂查询）

```sql
-- 需要先递归查询所有子节点ID，再查合同
SELECT * FROM contract_v2_main_records 
WHERE org_node_id IN (
  -- 递归查询（需要存储过程或多次查询）
  ...
);
```

---

### ✅ 有path字段（简单高效）

```sql
-- 一次查询完成
SELECT * FROM contract_v2_main_records 
WHERE org_node_id IN (
  SELECT id FROM contract_v2_org_nodes 
  WHERE path LIKE '/org001%'
);
```

**优势**：
- ✅ 一次SQL查询
- ✅ 利用索引（path索引 + org_node_id索引）
- ✅ 性能极佳

---

## 数据示例

### 组织树结构

```
org001（联想控股）
├── org002（联想北京）
│   ├── org003（ThinkPad X1）
│   └── org004（ThinkPad X2）
└── org005（联想深圳）
    └── org006（华为合作）
```

### 数据表内容

```
id     | parent_id | name         | path                | level
-------|-----------|--------------|---------------------|-------
org001 | NULL      | 联想控股      | /org001             | 1
org002 | org001    | 联想北京      | /org001/org002      | 2
org003 | org002    | ThinkPad X1  | /org001/org002/org003 | 3
org004 | org002    | ThinkPad X2  | /org001/org002/org004 | 3
org005 | org001    | 联想深圳      | /org001/org005      | 2
org006 | org005    | 华为合作      | /org001/org005/org006 | 3
```

---

## path生成规则

**创建节点时自动生成path**：

```javascript
async createOrgNode(data) {
  const { parent_id } = data;
  
  if (!parent_id) {
    // 顶级节点
    data.path = `/${data.id}`;
    data.level = 1;
  } else {
    // 子节点
    const parent = await this.getOrgNode(parent_id);
    data.path = `${parent.path}/${data.id}`;
    data.level = parent.level + 1;
  }
  
  return await this.models.ContractV2OrgNode.create(data);
}
```

**示例**：

```
创建org001（联想控股，顶级）:
  parent_id = NULL
  path = "/org001"

创建org002（联想北京，parent=org001）:
  parent_id = org001
  parent.path = "/org001"
  path = "/org001" + "/" + "org002" = "/org001/org002"

创建org003（ThinkPad，parent=org002）:
  parent_id = org002
  parent.path = "/org001/org002"
  path = "/org001/org002" + "/" + "org003" = "/org001/org002/org003"
```

---

## 性能对比

### 查询层级3的节点及其所有子节点

| 方案 | 查询次数 | 性能 |
|------|---------|------|
| 无path | 3-5次（递归） | 差 |
| 有path | 1次（LIKE） | 好 |

### 查询层级5的节点及其所有子节点

| 方案 | 查询次数 | 性能 |
|------|---------|------|
| 无path | 10+次（递归） | 很差 |
| 有path | 1次（LIKE） | 好（不变） |

**结论**：
- 层级越深，无path方案性能越差
- 有path方案性能恒定（一次查询）

---

## 前端用途

### 场景：前端显示树状结构，需要展开某节点显示子节点

**API**：
```javascript
// 查询某节点及其所有子节点
async getNodeWithChildren(nodeId) {
  const node = await this.getOrgNode(nodeId);
  
  return await this.models.ContractV2OrgNode.findAll({
    where: {
      path: { [Op.like]: `${node.path}%` }
    },
    order: [['level', 'ASC'], ['sort_order', 'ASC']],
  });
}
```

**前端使用**：
```vue
<template>
  <el-tree :data="treeData" @node-click="handleClick">
    <!-- 点击某节点，加载其子节点 -->
  </el-tree>
</template>

<script>
export default {
  async handleClick(node) {
    // 一次查询加载所有子节点（性能好）
    const children = await getNodeWithChildren(node.id);
    node.children = buildTree(children);
  }
}
</script>
```

---

## 总结

**path字段的作用**：

1. **性能优化**：
   - ✅ 一次查询获取某节点及其所有子节点
   - ✅ 避免递归查询（层级越深性能越好）
   - ✅ 利用索引（path LIKE查询）

2. **简化查询**：
   - ✅ WHERE path LIKE '/org001%' 代替复杂递归
   - ✅ 查询合同：WHERE org_node_id IN (SELECT id WHERE path LIKE ...)
   - ✅ 前端加载子节点：一次API调用

3. **维护简单**：
   - ✅ 创建节点时自动生成path
   - ✅ 无需额外维护（path基于id生成）
   - ✅ 删除节点时级联删除（path LIKE查询）

**类比**：
- path类似文件系统的路径（如 `/usr/local/bin`）
- 通过路径可快速定位某个目录及其所有子目录
- 无需逐层递归查询

**结论**：
- ✅ **保留path字段**
- ✅ 性能优化必需
- ✅ 简化查询逻辑
- ✅ 维护成本低