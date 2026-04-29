# 组织树层级约束与合同呈现方案

> Issue: #665
> 时间: 2026-04-29

## 问题1：层级结构约束

### 当前问题

**无约束的设计**：
```sql
CREATE TABLE contract_v2_org_nodes (
  node_type ENUM('group', 'party', 'project'),
  parent_id VARCHAR(32),  -- 任意parent_id，无约束
  level INT,              -- 任意level，无验证
  ...
);
```

**风险**：
- ❌ 用户可能创建：project → group（层级倒置）
- ❌ 用户可能创建：group → group（同级嵌套）
- ❌ 用户可能创建：party → project（跨层级）
- ❌ 层级混乱，不符合业务逻辑

---

### 解决方案：应用层 + 数据库双重约束

#### 方案A：应用层验证（API）

**约束规则**：

| node_type | parent_node_type | level | 约束 |
|-----------|------------------|-------|------|
| `group`（集团） | NULL | 1 | ✅ 只能作为顶级节点 |
| `party`（甲方） | `group` | 2 | ✅ parent必须是集团 |
| `project`（项目） | `party` | 3 | ✅ parent必须是甲方 |

**API验证逻辑**：

```javascript
// ContractV2Service.js
async createOrgNode(data) {
  const { parent_id, node_type } = data;
  
  // 验证层级规则
  if (node_type === 'group') {
    if (parent_id !== null) {
      throw new Error('集团只能作为顶级节点，不能有父节点');
    }
    data.level = 1;
    data.path = `/${data.id}`;
  }
  
  if (node_type === 'party') {
    if (!parent_id) {
      throw new Error('甲方必须有父节点（集团）');
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
      throw new Error('项目必须有父节点（甲方）');
    }
    const parent = await this.getOrgNode(parent_id);
    if (parent.node_type !== 'party') {
      throw new Error('项目的父节点必须是甲方');
    }
    data.level = 3;
    data.path = `${parent.path}/${data.id}`;
  }
  
  // 创建节点
  return await this.models.ContractV2OrgNode.create(data);
}
```

---

#### 方案B：数据库触发器约束（可选）

**触发器**：

```sql
-- 验证 group 只能作为顶级节点
CREATE TRIGGER validate_group_level
BEFORE INSERT ON contract_v2_org_nodes
FOR EACH ROW
BEGIN
  IF NEW.node_type = 'group' AND NEW.parent_id IS NOT NULL THEN
    SIGNAL SQLSTATE '45000' 
    SET MESSAGE_TEXT = '集团只能作为顶级节点';
  END IF;
END;

-- 验证 party 的 parent 必须是 group
CREATE TRIGGER validate_party_parent
BEFORE INSERT ON contract_v2_org_nodes
FOR EACH ROW
BEGIN
  IF NEW.node_type = 'party' THEN
    IF NEW.parent_id IS NULL THEN
      SIGNAL SQLSTATE '45000' 
      SET MESSAGE_TEXT = '甲方必须有父节点';
    END IF;
    
    DECLARE parent_type VARCHAR(20);
    SELECT node_type INTO parent_type 
    FROM contract_v2_org_nodes 
    WHERE id = NEW.parent_id;
    
    IF parent_type != 'group' THEN
      SIGNAL SQLSTATE '45000' 
      SET MESSAGE_TEXT = '甲方的父节点必须是集团';
    END IF;
  END IF;
END;

-- 验证 project 的 parent 必须是 party
CREATE TRIGGER validate_project_parent
BEFORE INSERT ON contract_v2_org_nodes
FOR EACH ROW
BEGIN
  IF NEW.node_type = 'project' THEN
    IF NEW.parent_id IS NULL THEN
      SIGNAL SQLSTATE '45000' 
      SET MESSAGE_TEXT = '项目必须有父节点';
    END IF;
    
    DECLARE parent_type VARCHAR(20);
    SELECT node_type INTO parent_type 
    FROM contract_v2_org_nodes 
    WHERE id = NEW.parent_id;
    
    IF parent_type != 'party' THEN
      SIGNAL SQLSTATE '45000' 
      SET MESSAGE_TEXT = '项目的父节点必须是甲方';
    END IF;
  END IF;
END;
```

**推荐**：方案A（应用层验证），更灵活且易于调试。

---

### 层级模板示例

**标准三层模板**：

```
第一层：集团/客户
  - node_type: group
  - parent_id: NULL
  - level: 1
  - 示例：联想控股、华为集团

第二层：甲方/客户方
  - node_type: party
  - parent_id: group.id
  - level: 2
  - 示例：联想北京、联想深圳、华为终端

第三层：项目/合作项目
  - node_type: project
  - parent_id: party.id
  - level: 3
  - 示例：ThinkPad X1、MateBook项目
```

**不允许的层级**：
- ❌ 第四层：node_type无法定义（超三层）
- ❌ 跨层级创建：project → group
- ❌ 同级嵌套：group → group

---

## 问题2：合同呈现方案

### 当前问题

**每一层级都可能有合同**：
- 集团层级：战略合作协议、框架协议
- 甲方层级：质量保证协议、共同开发协议
- 项目层级：供货协议、采购协议

**风险**：
- ❌ 合同散落在各层级，用户查找困难
- ❌ 界面混乱，不知道当前查看哪层级的合同
- ❌ 多层级合同同时显示，视觉混乱

---

### UI设计方案

#### 方案1：左侧树状导航 + 右侧合同清单（推荐）

**布局**：

```
┌──────────────────┬────────────────────────────────────┐
│ 组织树           │ 合同清单（当前选中节点）            │
├──────────────────┼────────────────────────────────────┤
│                  │                                    │
│ ▼ 联想控股       │  当前节点：联想控股（集团）          │
│   [战略协议 2份] │  ┌──────────────────────────────┐ │
│                  │  │ 战略合作协议 v1.0            │ │
│ ▼ 联想北京       │  │ [查看详情] [上传新版本]      │ │
│   [质保协议 1份] │  │                              │ │
│                  │  │ 框架合作协议 v1.0            │ │
│   ▼ ThinkPad项目 │  │ [查看详情] [上传新版本]      │ │
│     [供货协议 1份]│  └──────────────────────────────┘ │
│                  │                                    │
│                  │  [+上传合同到当前节点]             │
│                  │                                    │
└──────────────────┴────────────────────────────────────┘
```

**交互流程**：

1. 用户点击左侧树的某个节点
2. 右侧显示该节点下的合同清单
3. 右侧顶部显示当前节点名称（明确层级）
4. 右侧显示"上传合同到当前节点"按钮

**优势**：
- ✅ 层级清晰：左侧树显示层级结构
- ✅ 合同集中：右侧只显示当前节点的合同
- ✅ 查找方便：点击节点快速切换合同列表
- ✅ 视觉简洁：不会同时显示多层级的合同

---

#### 方案2：树节点 + 合同数量标记

**左侧树显示合同数量**：

```
组织树：
├─ 联想控股（集团） [2份合同] ← 显示合同数量
│  ├─ 战略合作协议 [集团层级合同]
│  ├─ 框架合作协议 [集团层级合同]
│  └─ 联想北京（甲方） [1份合同]
│     ├─ 质量保证协议 [甲方层级合同]
│     └─ ThinkPad X1（项目） [1份合同]
│        └─ 供货协议 [项目层级合同]
```

**问题**：
- ❌ 合同节点混在组织节点中，视觉混乱
- ❌ 不清楚当前查看的是组织节点还是合同节点
- ❌ 层级关系不明显

**不推荐方案2**。

---

#### 方案3：分Tab显示（合同清单 + 下级节点）

**右侧分Tab**：

```
┌──────────────────┬────────────────────────────────────┐
│ 组织树           │ 合同详情                            │
├──────────────────┼────────────────────────────────────┤
│ ▼ 联想控股       │  当前节点：联想控股（集团）          │
│                  │                                    │
│                  │  [本节点合同] [下级节点] [统计信息] │
│                  │  ┌──────────────────────────────┐ │
│                  │  │ 本节点合同（2份）             │ │
│                  │  │ - 战略合作协议 v1.0          │ │
│                  │  │ - 框架合作协议 v1.0          │ │
│                  │  └──────────────────────────────┘ │
│                  │                                    │
│                  │  ┌──────────────────────────────┐ │
│                  │  │ 下级节点（甲方）              │ │
│                  │  │ - 联想北京 [1份合同]         │ │
│                  │  │ - 联想深圳 [3份合同]         │ │
│                  │  └──────────────────────────────┘ │
│                  │                                    │
│                  │  ┌──────────────────────────────┐ │
│                  │  │ 统计信息                      │ │
│                  │  │ 本节点合同：2份               │ │
│                  │  │ 下级合同总数：4份             │ │
│                  │  │ 所有合同：6份                 │ │
│                  │  └──────────────────────────────┘ │
└──────────────────┴────────────────────────────────────┘
```

**优势**：
- ✅ 分类清晰：本节点合同、下级节点、统计信息分Tab显示
- ✅ 统计信息：显示合同数量汇总
- ✅ 灵活切换：用户可查看不同维度的信息

**推荐方案1 + 方案3结合**：
- 左侧树状导航（方案1）
- 右侧分Tab显示（方案3）

---

### 合同类型分类显示

**右侧合同清单可按类型筛选**：

```
当前节点：联想控股（集团）
[全部合同] [战略合作] [框架协议] [其他]

全部合同（2份）：
├─ 战略合作协议 v1.0
└─ 框架合作协议 v1.0

战略合作（1份）：
└─ 战略合作协议 v1.0

框架协议（1份）：
└─ 框架合作协议 v1.0
```

**contract_type枚举**：

| 类型 | 说明 | 典型层级 |
|------|------|---------|
| `strategy` | 战略合作协议 | 集团层级 |
| `framework` | 框架协议 | 集团层级 |
| `development` | 共同开发协议 | 甲方层级 |
| `supply` | 供货协议 | 项目层级 |
| `quality` | 质量保证协议 | 甲方层级 |
| `nda` | 保密协议 | 任意层级 |
| `other` | 其他协议 | 任意层级 |

**建议**：扩展 contract_type 枚举，增加 `framework` 类型。

---

## 数据库调整建议

### 1. contract_v2_org_nodes 增加字段

**新增字段**：
```sql
ALTER TABLE contract_v2_org_nodes
ADD COLUMN contract_count INT DEFAULT 0 COMMENT '本节点合同数量',
ADD COLUMN total_contract_count INT DEFAULT 0 COMMENT '含下级节点的合同总数';
```

**用途**：
- contract_count：本节点直属合同数量（缓存）
- total_contract_count：本节点 + 所有下级节点的合同总数（缓存）

**更新时机**：
- 上传合同到节点时：contract_count + 1
- 删除合同时：contract_count - 1
- 创建下级节点时：递归更新所有上级节点的 total_contract_count

---

### 2. contract_v2_main_records 增加字段

**新增字段**：
```sql
ALTER TABLE contract_v2_main_records
ADD COLUMN org_node_level INT COMMENT '所属节点层级（缓存）',
ADD COLUMN org_node_path VARCHAR(255) COMMENT '所属节点路径（缓存）';
```

**用途**：
- 快速查询特定层级的合同
- 快速查询特定路径下的合同

---

### 3. 扩展 contract_type 枚举

**调整枚举**：
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
) COMMENT '合同类型';
```

---

## 前端组件设计

### OrgTree.vue（左侧组织树）

**Props**：
```typescript
interface OrgTreeProps {
  selectedNodeId: string;  // 当前选中节点
  showContractCount: boolean;  // 是否显示合同数量
}
```

**功能**：
- 显示树状结构（集团 → 甲方 → 项目）
- 点击节点触发事件：`@select="handleSelect"`
- 显示合同数量标记：`联想控股 [2份]`

---

### ContractList.vue（右侧合同清单）

**Props**：
```typescript
interface ContractListProps {
  orgNodeId: string;      // 当前节点ID
  orgNodeName: string;    // 当前节点名称
  orgNodeLevel: number;   // 当前节点层级
  contractType: string;   // 合同类型筛选
}
```

**功能**：
- 显示当前节点的合同列表
- 按类型筛选合同
- 上传合同到当前节点
- 显示合同版本列表

---

### ContractTabs.vue（右侧分Tab）

**Tabs**：
- 本节点合同：当前节点的合同列表
- 下级节点：显示所有下级节点及其合同数量
- 统计信息：合同数量汇总、金额汇总

---

## API设计补充

### 组织节点API

**新增统计API**：
```
GET /api/contract-v2/org-nodes/:id/stats
返回：
{
  "contract_count": 2,          // 本节点合同数量
  "total_contract_count": 6,    // 含下级节点的合同总数
  "children_count": 3,          // 下级节点数量
  "total_amount": 5000000.00    // 合同总金额
}
```

**新增下级节点API**：
```
GET /api/contract-v2/org-nodes/:id/children
返回：
{
  "children": [
    { "id": "org002", "name": "联想北京", "contract_count": 1 },
    { "id": "org003", "name": "联想深圳", "contract_count": 3 }
  ]
}
```

---

### 合同查询API

**按层级查询**：
```
GET /api/contract-v2/contracts?level=1
返回：所有集团层级合同
```

**按路径查询**：
```
GET /api/contract-v2/contracts?path=/org001
返回：联想控股及其下级节点的所有合同
```

**按节点查询**：
```
GET /api/contract-v2/org-nodes/:id/contracts
返回：当前节点的直属合同（不含下级）
```

---

## 总结

**层级约束方案**：
- ✅ 应用层验证（API）：group只能顶级，party必须group，project必须party
- ✅ 数据库约束（可选）：触发器验证
- ✅ 层级模板：固定三层（集团 → 甲方 → 项目）

**合同呈现方案**：
- ✅ 左侧树状导航：显示层级结构 + 合同数量标记
- ✅ 右侧合同清单：只显示当前选中节点的合同
- ✅ 右侧分Tab：本节点合同 + 下级节点 + 统计信息
- ✅ 类型筛选：按contract_type筛选合同

**数据库调整**：
- ✅ org_nodes增加contract_count、total_contract_count字段
- ✅ main_records增加org_node_level、org_node_path字段
- ✅ contract_type扩展枚举（增加framework、purchase、technical）

**前端组件**：
- ✅ OrgTree.vue（左侧树）
- ✅ ContractList.vue（右侧清单）
- ✅ ContractTabs.vue（右侧分Tab）

**下一步**：
- 确认方案
- 更新表结构设计文档
- 开始编写migrations/install.js