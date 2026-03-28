# PPTX 技能工具重构设计

## 设计原则

1. **简洁性**：工具数量从 6 个精简为 4 个
2. **一致性**：统一使用 `action` 参数区分操作类型
3. **完整性**：覆盖 pptxgenjs 4.0 核心功能
4. **扩展性**：预留高级功能参数，不增加工具数量

---

## 新工具架构

### 工具总览

| 工具 | 说明 | Actions |
|------|------|---------|
| `pptx_file` | 文件级操作 | read, create, merge |
| `pptx_slide` | 幻灯片管理 | add, update, delete, move, duplicate |
| `pptx_object` | 内容对象操作 | add, update, delete (text/image/table/chart/shape/media/notes) |
| `pptx_master` | 模板与样式 | define, apply, list |

---

## 工具详细设计

### 1. pptx_file - 文件级操作

**统一入口**：读取、创建、合并演示文稿

```javascript
// 读取演示文稿
pptx_file({
  action: 'read',
  path: 'presentation.pptx',
  scope: 'info' | 'text' | 'structure' | 'media',
  slideNumbers: [1, 3, 5]  // 可选，scope=text 时
})

// 创建演示文稿
pptx_file({
  action: 'create',
  path: 'output.pptx',
  source: 'data' | 'markdown' | 'template',
  slides: [...],           // source=data
  markdown: '...',         // source=markdown
  template: 'template.pptx', // source=template
  properties: {            // 文档属性
    title: '演示文稿标题',
    author: '作者',
    company: '公司',
    subject: '主题'
  }
})

// 合并演示文稿
pptx_file({
  action: 'merge',
  paths: ['part1.pptx', 'part2.pptx'],
  output: 'merged.pptx'
})
```

**合并 pptx_read + pptx_write + pptx_export(merge)**

---

### 2. pptx_slide - 幻灯片管理

**统一入口**：幻灯片增删改查

```javascript
// 添加幻灯片
pptx_slide({
  action: 'add',
  path: 'presentation.pptx',
  position: 3,             // 可选，默认末尾
  master: 'TITLE_SLIDE',   // 可选，使用母版
  title: '新幻灯片标题',
  content: ['要点1', '要点2'],
  output: 'output.pptx'    // 可选，默认覆盖
})

// 更新幻灯片
pptx_slide({
  action: 'update',
  path: 'presentation.pptx',
  slideNumber: 2,
  title: '更新后的标题',
  content: ['新要点'],
  background: { color: 'F0F0F0' },
  hidden: false,           // 隐藏幻灯片
  output: 'output.pptx'
})

// 删除幻灯片
pptx_slide({
  action: 'delete',
  path: 'presentation.pptx',
  slideNumbers: [3, 5],    // 支持批量删除
  output: 'output.pptx'
})

// 移动幻灯片
pptx_slide({
  action: 'move',
  path: 'presentation.pptx',
  from: 5,
  to: 2,
  output: 'output.pptx'
})

// 复制幻灯片
pptx_slide({
  action: 'duplicate',
  path: 'presentation.pptx',
  slideNumber: 3,
  position: 5,             // 可选，默认紧随原幻灯片
  output: 'output.pptx'
})
```

**合并 pptx_slide + 新增 move/duplicate/hidden**

---

### 3. pptx_object - 内容对象操作

**统一入口**：所有内容对象的增删改

```javascript
// 添加对象
pptx_object({
  action: 'add',
  path: 'presentation.pptx',
  slideNumber: 1,
  type: 'text' | 'image' | 'table' | 'chart' | 'shape' | 'media' | 'notes',
  
  // type=text
  text: '文本内容',
  options: { x: 0.5, y: 1, w: 8, fontSize: 24, bold: true, color: '363636' },
  
  // type=image
  image: { path: 'chart.png', x: 1, y: 2, w: 6, h: 4 },
  
  // type=table
  table: { 
    rows: [['Name', 'Value'], ['A', '100']],
    x: 0.5, y: 1.5, w: 9,
    options: { border: { pt: 1, color: 'CFCFCF' } }
  },
  
  // type=chart (新增)
  chart: {
    type: 'bar' | 'line' | 'pie' | 'doughnut' | 'area' | 'scatter' | 'bubble' | 'radar' | 'bar3D' | 'bubble3D',
    data: [
      { name: 'Series 1', labels: ['Q1', 'Q2', 'Q3'], values: [100, 150, 200] }
    ],
    x: 1, y: 1, w: 8, h: 5,
    options: { title: '图表标题', showLegend: true }
  },
  
  // type=shape
  shape: {
    type: 'rect' | 'ellipse' | 'line' | 'arrow' | ...,
    x: 0, y: 0, w: 1, h: 1,
    fill: { color: 'CCCCCC' },
    line: { color: '000000', width: 1 }
  },
  
  // type=media (新增)
  media: {
    type: 'audio' | 'video' | 'online',
    path: 'video.mp4' | 'https://youtube.com/...',
    x: 1, y: 1, w: 6, h: 4
  },
  
  // type=notes (新增)
  notes: '演讲者备注内容',
  
  output: 'output.pptx'
})

// 更新对象
pptx_object({
  action: 'update',
  path: 'presentation.pptx',
  slideNumber: 1,
  objectId: 'text_1',      // 对象标识（可选，按位置查找）
  position: { x: 0.5, y: 1 },  // 按位置查找
  type: 'text',
  text: '更新后的文本',
  options: { fontSize: 28 },
  output: 'output.pptx'
})

// 删除对象
pptx_object({
  action: 'delete',
  path: 'presentation.pptx',
  slideNumber: 1,
  objectId: 'image_1',
  output: 'output.pptx'
})

// 提取对象（特殊操作）
pptx_object({
  action: 'extract',
  path: 'presentation.pptx',
  type: 'image',
  outputDir: './images'
})
```

**合并 pptx_image + pptx_table + 新增 chart/media/notes/shape**

---

### 4. pptx_master - 模板与样式

**统一入口**：母版定义与应用

```javascript
// 定义母版
pptx_master({
  action: 'define',
  path: 'presentation.pptx',  // 可选，定义全局母版
  name: 'TITLE_SLIDE',
  background: { color: 'FFFFFF' } | { path: 'bg.png' },
  objects: [
    { type: 'text', text: '标题占位符', placeholder: 'title', x: 0.5, y: 0.5, w: 9, fontSize: 36 },
    { type: 'text', text: '副标题占位符', placeholder: 'subtitle', x: 0.5, y: 1.5, w: 9 },
    { type: 'image', path: 'logo.png', x: 8, y: 0, w: 1, h: 1 }
  ],
  slideNumber: { x: 9, y: 5, fontSize: 12 },
  margin: [0.5, 0.5, 0.5, 0.5]
})

// 应用母版
pptx_master({
  action: 'apply',
  path: 'presentation.pptx',
  master: 'TITLE_SLIDE',
  slideNumbers: [1, 2, 3],  // 可选，默认全部
  output: 'output.pptx'
})

// 列出母版
pptx_master({
  action: 'list',
  path: 'presentation.pptx'
})

// 删除母版
pptx_master({
  action: 'delete',
  path: 'presentation.pptx',
  name: 'OLD_MASTER'
})
```

**新增工具**：覆盖 defineSlideMaster 功能

---

## 功能对比

### 新旧工具映射

| 旧工具 | 新工具 | Action |
|--------|--------|--------|
| pptx_read | pptx_file | read |
| pptx_write (create) | pptx_file | create |
| pptx_export (merge) | pptx_file | merge |
| pptx_slide (add) | pptx_slide | add |
| pptx_slide (delete) | pptx_slide | delete |
| pptx_slide (update) | pptx_slide | update |
| pptx_image (extract) | pptx_object | extract (type=image) |
| pptx_image (add) | pptx_object | add (type=image) |
| pptx_table | pptx_object | add (type=table) |
| - | pptx_object | add (type=chart) **新增** |
| - | pptx_object | add (type=media) **新增** |
| - | pptx_object | add (type=notes) **新增** |
| - | pptx_object | add (type=shape) **增强** |
| - | pptx_slide | move **新增** |
| - | pptx_slide | duplicate **新增** |
| - | pptx_master | define/apply **新增** |

### 新增功能

| 功能 | 工具 | 说明 |
|------|------|------|
| 图表 | pptx_object | 10 种图表类型 |
| 音频/视频 | pptx_object | 多媒体嵌入 |
| 演讲者备注 | pptx_object | addNotes |
| 幻灯片移动 | pptx_slide | move |
| 幻灯片复制 | pptx_slide | duplicate |
| 隐藏幻灯片 | pptx_slide | hidden 属性 |
| 幻灯片母版 | pptx_master | defineSlideMaster |
| 形状增强 | pptx_object | 70+ 形状类型 |

---

## 实现优先级

### 第一阶段（核心重构）

1. 重构现有 6 个工具为 4 个
2. 保持向后兼容（旧工具名映射）
3. 升级 pptxgenjs 到 4.0.1

### 第二阶段（功能增强）

1. 实现 pptx_object 的 chart 功能
2. 实现 pptx_object 的 media/notes 功能
3. 实现 pptx_master 工具

### 第三阶段（高级功能）

1. 幻灯片 move/duplicate
2. 形状增强
3. 超链接支持

---

## 向后兼容

保留旧工具名映射，确保现有调用不受影响：

```javascript
// 旧工具名 -> 新工具映射
case 'pptx_read': return pptx_file({ action: 'read', ...params });
case 'pptx_write': return pptx_file({ action: 'create', ...params });
case 'pptx_image': return pptx_object({ type: 'image', ...params });
case 'pptx_table': return pptx_object({ type: 'table', ...params });
```

---

## 相关 Issue

- #428: pptxgenjs 4.0 功能对比与 pptx 技能缺口分析