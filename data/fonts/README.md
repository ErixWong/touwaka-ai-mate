# 共享字体目录

此目录用于存放项目级别的共享字体文件，所有技能都可以使用。

## 当前内置字体

| 文件名 | 字体名称 | 许可证 | 说明 |
|--------|----------|--------|------|
| `simhei.ttf` | 黑体 | Windows 系统字体 | 简体中文字体，适用于 PDF 生成 |
| `wqy-microhei.ttc` | 文泉驿微米黑 | GPL v3 + Apache v2 | 开源简体中文字体 |

## 添加新字体

### 推荐字体

#### 思源黑体 (Noto Sans CJK SC)
- **文件名**: `NotoSansSC-Regular.ttf`
- **下载**: https://github.com/googlefonts/noto-cjk/releases
- **许可证**: SIL Open Font License 1.1
- **特点**: Google 和 Adobe 联合开发，支持简体中文，质量高
- **注意**: 需要下载 TTF (TrueType) 格式，reportlab 不支持 OTF 格式

## 使用方法

### Python (reportlab)
```python
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from pathlib import Path

# 获取字体目录
FONTS_DIR = Path(__file__).parent.parent / 'fonts'
font_path = FONTS_DIR / 'simhei.ttf'

# 注册字体
pdfmetrics.registerFont(TTFont('ChineseFont', str(font_path)))

# TTC 文件需要指定 subfontIndex
# pdfmetrics.registerFont(TTFont('ChineseFont', str(font_path), subfontIndex=0))
```

### 使用公共字体模块
```python
import sys
sys.path.insert(0, 'path/to/data')
from fonts import register_chinese_font, get_pil_font

# 为 reportlab 注册字体
font_registered = register_chinese_font('ChineseFont')

# 获取 PIL 字体
pil_font = get_pil_font(font_size=14)
```

## 字体加载优先级

代码中的字体加载逻辑会按以下顺序查找：
1. 项目内置字体 (`data/fonts/`)
2. Windows 系统字体 (`C:/Windows/Fonts/`)
3. Linux 系统字体 (`/usr/share/fonts/`)
4. macOS 系统字体 (`/System/Library/Fonts/`)

## 注意事项

- **reportlab 只支持 TrueType (TTF) 格式**，不支持 OpenType (OTF) 格式
- 对于 TTC (TrueType Collection) 文件，需要指定 `subfontIndex` 参数
- 字体文件可能较大（5-10MB），请考虑是否需要纳入版本控制