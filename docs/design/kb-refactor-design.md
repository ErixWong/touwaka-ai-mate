# 知识库重构设计方案

> Issue: #34
> 状态：讨论中

## 背景

当前知识库的数据结构存在以下问题：

1. **表名不准确**：`knowledge` 表示「文章」太宽泛，`knowledge_point` 实际是「段落/片段」
2. **知识点层级**：只有一级，但实际需要至少二级（章和节）
3. **分类方式**：树状结构局限性强，标签系统更灵活

## 设计目标

1. **清晰的表名**：准确反映数据含义
2. **灵活的层级**：中间层级可无限扩展
3. **知识点标记**：段可以标记是否为知识点
4. **标签系统**：替代树状分类，实现灵活的知识组织

---

## 表结构设计

### 数据关系图

```
knowledge_bases
    ├── kb_tags (标签)
    │       └── kb_article_tags (文章-标签关联)
    │
    └── kb_articles (文章)
            ├── kb_article_tags (标签关联)
            └── kb_sections (节，自指向树状结构)
                    ├── kb_sections (子节...)
                    │       └── kb_paragraphs (段)
                    └── kb_paragraphs (段)
```

### 1. kb_articles (文章表)

```sql
CREATE TABLE kb_articles (
  id VARCHAR(20) PRIMARY KEY,
  kb_id VARCHAR(20) NOT NULL COMMENT '所属知识库',
  title VARCHAR(500) NOT NULL COMMENT '文章标题',
  summary TEXT COMMENT '文章摘要',
  source_type VARCHAR(50) COMMENT '来源类型：upload/url/manual',
  source_url VARCHAR(1000) COMMENT '来源URL',
  file_path VARCHAR(500) COMMENT '本地文件路径',
  status ENUM('pending', 'processing', 'ready', 'error') DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  INDEX idx_article_kb (kb_id),
  INDEX idx_article_status (status)
) COMMENT='文章表';
```

### 2. kb_sections (节表，允许自指向)

```sql
CREATE TABLE kb_sections (
  id VARCHAR(20) PRIMARY KEY,
  article_id VARCHAR(20) NOT NULL COMMENT '所属文章',
  parent_id VARCHAR(20) DEFAULT NULL COMMENT '父节ID（自指向，形成无限层级）',
  title VARCHAR(500) NOT NULL COMMENT '节标题',
  level INT DEFAULT 1 COMMENT '层级深度（1=章, 2=节, 3=小节...）',
  position INT DEFAULT 0 COMMENT '排序位置（同级内的顺序）',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (article_id) REFERENCES kb_articles(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES kb_sections(id) ON DELETE CASCADE,
  INDEX idx_section_article (article_id),
  INDEX idx_section_parent (parent_id),
  INDEX idx_section_level (level),
  INDEX idx_section_position (position)
) COMMENT='节表（无限层级）';
```

### 3. kb_paragraphs (段表)

```sql
CREATE TABLE kb_paragraphs (
  id VARCHAR(20) PRIMARY KEY,
  section_id VARCHAR(20) NOT NULL COMMENT '所属节',
  title VARCHAR(500) COMMENT '段落标题（可选）',
  content TEXT NOT NULL COMMENT '段落内容',
  is_knowledge_point BOOLEAN DEFAULT FALSE COMMENT '是否是知识点',
  embedding VECTOR(384) COMMENT '向量（只有知识点才向量化）',
  position INT DEFAULT 0 COMMENT '排序位置（同一节内的顺序）',
  token_count INT DEFAULT 0 COMMENT 'Token 数量',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (section_id) REFERENCES kb_sections(id) ON DELETE CASCADE,
  INDEX idx_paragraph_section (section_id),
  INDEX idx_paragraph_kp (is_knowledge_point),
  INDEX idx_paragraph_position (position)
) COMMENT='段表';
```

### 4. kb_tags (标签表)

```sql
CREATE TABLE kb_tags (
  id VARCHAR(20) PRIMARY KEY,
  kb_id VARCHAR(20) NOT NULL COMMENT '所属知识库',
  name VARCHAR(100) NOT NULL COMMENT '标签名',
  description VARCHAR(500) COMMENT '标签描述',
  article_count INT DEFAULT 0 COMMENT '关联文章数（缓存）',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  UNIQUE KEY uk_kb_tag (kb_id, name),
  INDEX idx_tag_kb (kb_id)
) COMMENT='标签表';
```

### 5. kb_article_tags (文章-标签关联表)

```sql
CREATE TABLE kb_article_tags (
  id VARCHAR(20) PRIMARY KEY,
  article_id VARCHAR(20) NOT NULL COMMENT '文章ID',
  tag_id VARCHAR(20) NOT NULL COMMENT '标签ID',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (article_id) REFERENCES kb_articles(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES kb_tags(id) ON DELETE CASCADE,
  UNIQUE KEY uk_article_tag (article_id, tag_id),
  INDEX idx_at_article (article_id),
  INDEX idx_at_tag (tag_id)
) COMMENT='文章-标签关联表';
```

---

## 层级结构示例

```
kb_articles:
└── "Python 入门教程" (article_id: art_001, tags: ['Python', '编程', '入门'])

kb_sections (树状结构):
├── 第一章 Python简介 (article_id: art_001, parent_id=NULL, level=1, position=1)
│   ├── 1.1 什么是Python (parent_id=chap_001, level=2, position=1)
│   │   ├── 1.1.1 历史背景 (parent_id=sec_001, level=3, position=1)
│   │   │   └── kb_paragraphs: 段落1, 段落2...
│   │   └── 1.1.2 设计哲学 (parent_id=sec_001, level=3, position=2)
│   │       └── kb_paragraphs: 段落3, 段落4...
│   └── 1.2 安装Python (parent_id=chap_001, level=2, position=2)
│       └── kb_paragraphs: 段落5, 段落6...
└── 第二章 基础语法 (article_id: art_001, parent_id=NULL, level=1, position=2)
    └── ...
```

---

## 排序机制

### 排序 API

```javascript
// 移动节（同级调整 / 跨级移动）
POST /api/kb/:kb_id/sections/:id/move
{
  "parent_id": "new_parent_id",  // 新的父节ID（可选）
  "position": 2                   // 新的位置
}

// 移动段
POST /api/kb/:kb_id/paragraphs/:id/move
{
  "section_id": "new_section_id",  // 新的节ID（可选）
  "position": 3                     // 新的位置
}
```

### 调整排序的后端逻辑

```javascript
async function moveSection(sectionId, newParentId, newPosition) {
  const section = await kb_sections.findByPk(sectionId);
  const oldParentId = section.parent_id;
  const oldPosition = section.position;
  
  if (oldParentId !== newParentId) {
    // 跨级移动
    await kb_sections.decrement('position', {
      where: { parent_id: oldParentId, position: { [Op.gt]: oldPosition } }
    });
    await kb_sections.increment('position', {
      where: { parent_id: newParentId, position: { [Op.gte]: newPosition } }
    });
    await kb_sections.update(
      { parent_id: newParentId, position: newPosition },
      { where: { id: sectionId } }
    );
  } else {
    // 同级调整
    if (newPosition > oldPosition) {
      await kb_sections.decrement('position', {
        where: { parent_id: oldParentId, position: { [Op.gt]: oldPosition, [Op.lte]: newPosition } }
      });
    } else {
      await kb_sections.increment('position', {
        where: { parent_id: oldParentId, position: { [Op.gte]: newPosition, [Op.lt]: oldPosition } }
      });
    }
    await kb_sections.update({ position: newPosition }, { where: { id: sectionId } });
  }
}
```

---

## kb-editor 技能实现

### 新增操作

```javascript
// 节操作
'create_section': createSection,      // 创建节
'update_section': updateSection,      // 更新节
'delete_section': deleteSection,      // 删除节（级联删除子节和段）
'move_section': moveSection,          // 移动节（调整顺序/父节）

// 段操作
'create_paragraph': createParagraph,  // 创建段
'update_paragraph': updateParagraph,  // 更新段
'delete_paragraph': deleteParagraph,  // 删除段
'move_paragraph': moveParagraph,      // 移动段（调整顺序/所属节）

// 查询操作
'get_article_structure': getArticleStructure,  // 获取完整树状结构
'get_section_tree': getSectionTree,            // 获取节的子树
'list_paragraphs': listParagraphs,              // 列出节下的段
```

### 呈现方式

```
📁 Python 入门教程
├── 📁 第一章 Python简介 [↑][↓][➕节][➕段]
│   ├── 📁 1.1 什么是Python [↑][↓][➕节][➕段]
│   │   ├── 📁 1.1.1 历史背景 [↑][↓][➕节][➕段]
│   │   │   ├── 📄 段落1 ⭐ [↑][↓][✏️][🗑️]
│   │   │   └── 📄 段落2 [↑][↓][✏️][🗑️]
│   │   └── 📁 1.1.2 设计哲学 [↑][↓][➕节][➕段]
│   └── 📁 1.2 安装Python [↑][↓][➕节][➕段]
└── 📁 第二章 基础语法 [↑][↓][➕节][➕段]
```

---

## 导入处理流程

1. **创建文章**：导入文档，创建 `kb_article` 记录
2. **结构识别**：LLM 分析文档，识别层级结构（不限层级）
3. **创建节**：按顺序创建 `kb_sections`，自动设置 position
4. **创建段**：按顺序创建 `kb_paragraphs`，自动设置 position
5. **知识点判断**：LLM 判断每个段是否包含知识点
6. **标签生成**：LLM 为文章生成 3-5 个标签
7. **向量化**：只有 `is_knowledge_point=true` 的段才向量化

---

## 搜索与呈现

### 语义搜索
- 在 `is_knowledge_point=true` 的段落中搜索
- 返回匹配的知识点及其完整路径（文章 > 章 > 节 > ... > 段）

### 标签浏览
- 按标签关联文章数排序
- 点击标签展示所有关联的文章

### 结构浏览
- 树状导航，支持展开/折叠
- 高亮显示知识点段落

---

## 迁移方案

需要编写迁移脚本：
1. 创建新表 `kb_articles`, `kb_sections`, `kb_paragraphs`, `kb_tags`, `kb_article_tags`
2. 迁移数据：`knowledges` → `kb_articles`
3. 迁移数据：`knowledge_points` → `kb_paragraphs`（需要创建默认的 section）
4. 删除旧表 `knowledges`, `knowledge_points`, `knowledge_relations`

---

## 表数量汇总

| 表名 | 用途 |
|------|------|
| `knowledge_bases` | 知识库（已存在） |
| `kb_articles` | 文章 |
| `kb_sections` | 节（自指向，无限层级） |
| `kb_paragraphs` | 段 |
| `kb_tags` | 标签 |
| `kb_article_tags` | 文章-标签关联 |

**共 6 张表**（含已有的 knowledge_bases）

---

## 优点总结

| 方面 | 说明 |
|------|------|
| **表名清晰** | articles/sections/paragraphs 准确反映含义 |
| **灵活性** | 中间层级无限级，适应各种文档结构 |
| **简洁性** | 只有 5 张新表，结构清晰 |
| **可扩展** | 新增字段不影响现有结构 |
| **兼容性** | kb-editor 技能已有树状结构经验 |
| **性能** | 段落查询不需要 JOIN 多张表 |