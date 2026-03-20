"""
共享字体工具模块

提供跨平台的中文字体加载功能，所有技能都可以使用。
"""

import os
from pathlib import Path

# 字体目录路径
FONTS_DIR = Path(__file__).parent.resolve()


def get_chinese_font_path():
    """
    获取可用的中文字体路径。
    
    Returns:
        tuple: (字体路径, subfontIndex) 或 (None, None) 如果没有可用字体
               subfontIndex 对于 TTF 文件为 None，对于 TTC 文件为整数索引
    """
    # 字体列表：优先使用项目内置字体，其次使用系统字体
    # 格式：(字体路径, subfontIndex) - TTF 文件使用 None，TTC 文件使用索引
    chinese_fonts = [
        # 项目内置字体（data/fonts/ 目录）- 最高优先级
        (str(FONTS_DIR / 'simhei.ttf'), None),                  # 黑体（Windows 系统字体复制）
        (str(FONTS_DIR / 'wqy-microhei.ttc'), 0),               # 文泉驿微米黑（开源，TTC 格式）
        (str(FONTS_DIR / 'NotoSansSC-Regular.ttf'), None),      # 思源黑体简体 (TTF)
        (str(FONTS_DIR / 'NotoSansCJKsc-Regular.ttf'), None),   # 思源黑体简体（备用名）
        (str(FONTS_DIR / 'SourceHanSansSC-Regular.ttf'), None), # 思源黑体简体（备用名）
        # Windows TTF 字体
        ('C:/Windows/Fonts/simhei.ttf', None),        # 黑体
        ('C:/Windows/Fonts/msyh.ttf', None),          # 微软雅黑（TTF 版本）
        ('C:/Windows/Fonts/simsun.ttf', None),        # 宋体（TTF 版本）
        # Windows TTC 字体（需要 subfontIndex）
        ('C:/Windows/Fonts/msyh.ttc', 0),             # 微软雅黑（TTC，索引 0 = 常规）
        ('C:/Windows/Fonts/simsun.ttc', 0),           # 宋体（TTC，索引 0 = 常规）
        # Linux 字体
        ('/usr/share/fonts/truetype/wqy/wqy-microhei.ttc', 0),
        ('/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc', 0),
        ('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', 0),
        ('/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc', 0),
        # macOS 字体
        ('/System/Library/Fonts/PingFang.ttc', 0),
        ('/System/Library/Fonts/STHeiti Light.ttc', 0),
    ]
    
    for font_path, subfont_index in chinese_fonts:
        if os.path.exists(font_path):
            return font_path, subfont_index
    
    return None, None


def register_chinese_font(font_name='ChineseFont'):
    """
    为 reportlab 注册中文字体。
    
    Args:
        font_name: 注册后的字体名称，默认 'ChineseFont'
    
    Returns:
        bool: 是否成功注册字体
    """
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    
    font_path, subfont_index = get_chinese_font_path()
    
    if font_path is None:
        return False
    
    try:
        if subfont_index is not None:
            pdfmetrics.registerFont(TTFont(font_name, font_path, subfontIndex=subfont_index))
        else:
            pdfmetrics.registerFont(TTFont(font_name, font_path))
        return True
    except Exception as e:
        # 记录错误但不抛出，返回 False 表示失败
        import sys
        print(f"[fonts] Warning: Failed to register font '{font_name}' from '{font_path}': {e}", file=sys.stderr)
        return False


def get_pil_font(font_size=14):
    """
    获取 PIL/Pillow 可用的中文字体。
    
    Args:
        font_size: 字体大小，默认 14
    
    Returns:
        PIL.ImageFont.FreeTypeFont 或 None
    """
    from PIL import ImageFont
    
    font_path, subfont_index = get_chinese_font_path()
    
    if font_path is None:
        return None
    
    try:
        return ImageFont.truetype(font_path, font_size)
    except Exception as e:
        # 记录错误但不抛出，返回 None 表示失败
        import sys
        print(f"[fonts] Warning: Failed to load PIL font from '{font_path}': {e}", file=sys.stderr)
        return None