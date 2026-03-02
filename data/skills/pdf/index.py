"""
PDF 技能 - Python 实现
提供 PDF 文件的读取、解析、提取等功能
"""

import json
import sys
import os
import base64
import re

# 添加 scripts 目录到路径
scripts_dir = os.path.join(os.path.dirname(__file__), 'scripts')
if scripts_dir not in sys.path:
    sys.path.insert(0, scripts_dir)

# 尝试导入 PDF 库
try:
    from pypdf import PdfReader
    HAS_PYPDF = True
except ImportError:
    HAS_PYPDF = False

try:
    import pdfplumber
    HAS_PDFPLUMBER = True
except ImportError:
    HAS_PDFPLUMBER = False

try:
    from pdf2image import convert_from_path
    HAS_PDF2IMAGE = True
except ImportError:
    HAS_PDF2IMAGE = False

try:
    from PIL import Image
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

# 导入 pdf_to_markdown 模块
try:
    from pdf_to_markdown import pdf_to_markdown as _pdf_to_markdown
    HAS_PDF2MD = True
except ImportError:
    HAS_PDF2MD = False


def execute(tool_name, params, context):
    """
    技能入口函数
    
    Args:
        tool_name: 工具名称
        params: 工具参数
        context: 执行上下文
    
    Returns:
        执行结果
    """
    if tool_name == 'read_pdf':
        return read_pdf(params)
    elif tool_name == 'extract_text':
        return extract_text(params)
    elif tool_name == 'extract_tables':
        return extract_tables(params)
    elif tool_name == 'get_info':
        return get_pdf_info(params)
    elif tool_name == 'pdf_to_markdown':
        return pdf_to_markdown(params)
    else:
        raise ValueError(f'Unknown tool: {tool_name}')


def read_pdf(params):
    """
    读取 PDF 文件并提取文本
    
    Args:
        params.file_path: PDF 文件路径
        params.pages: 要读取的页码列表（可选，默认全部）
    
    Returns:
        提取的文本内容
    """
    file_path = params.get('file_path')
    if not file_path:
        raise ValueError('file_path is required')
    
    if not os.path.exists(file_path):
        raise FileNotFoundError(f'PDF file not found: {file_path}')
    
    pages = params.get('pages')  # None 表示全部页面
    
    if HAS_PDFPLUMBER:
        return _read_with_pdfplumber(file_path, pages)
    elif HAS_PYPDF:
        return _read_with_pypdf(file_path, pages)
    else:
        raise ImportError('No PDF library available. Please install pypdf or pdfplumber.')


def _read_with_pdfplumber(file_path, pages=None):
    """使用 pdfplumber 读取 PDF"""
    result = {
        'library': 'pdfplumber',
        'file_path': file_path,
        'pages': []
    }
    
    with pdfplumber.open(file_path) as pdf:
        result['total_pages'] = len(pdf.pages)
        
        page_indices = pages if pages else range(len(pdf.pages))
        
        for i in page_indices:
            if i < 0 or i >= len(pdf.pages):
                continue
            
            page = pdf.pages[i]
            text = page.extract_text() or ''
            
            result['pages'].append({
                'page_number': i + 1,
                'text': text,
                'char_count': len(text)
            })
    
    return result


def _read_with_pypdf(file_path, pages=None):
    """使用 pypdf 读取 PDF"""
    result = {
        'library': 'pypdf',
        'file_path': file_path,
        'pages': []
    }
    
    reader = PdfReader(file_path)
    result['total_pages'] = len(reader.pages)
    
    page_indices = pages if pages else range(len(reader.pages))
    
    for i in page_indices:
        if i < 0 or i >= len(reader.pages):
            continue
        
        page = reader.pages[i]
        text = page.extract_text() or ''
        
        result['pages'].append({
            'page_number': i + 1,
            'text': text,
            'char_count': len(text)
        })
    
    return result


def extract_text(params):
    """
    只提取文本内容（简化版）
    
    Args:
        params.file_path: PDF 文件路径
        params.max_chars: 最大字符数（可选，默认 10000）
    
    Returns:
        纯文本内容
    """
    result = read_pdf(params)
    
    max_chars = params.get('max_chars', 10000)
    
    all_text = []
    total_chars = 0
    
    for page in result['pages']:
        text = page['text']
        if total_chars + len(text) > max_chars:
            # 截断
            remaining = max_chars - total_chars
            if remaining > 0:
                all_text.append(text[:remaining])
            break
        all_text.append(text)
        total_chars += len(text)
    
    return {
        'text': '\n\n'.join(all_text),
        'total_chars': total_chars,
        'truncated': total_chars >= max_chars
    }


def extract_tables(params):
    """
    提取 PDF 中的表格
    
    Args:
        params.file_path: PDF 文件路径
        params.pages: 要提取的页码列表（可选）
    
    Returns:
        表格数据
    """
    file_path = params.get('file_path')
    if not file_path:
        raise ValueError('file_path is required')
    
    if not HAS_PDFPLUMBER:
        raise ImportError('pdfplumber is required for table extraction')
    
    pages = params.get('pages')
    
    result = {
        'file_path': file_path,
        'tables': []
    }
    
    with pdfplumber.open(file_path) as pdf:
        page_indices = pages if pages else range(len(pdf.pages))
        
        for i in page_indices:
            if i < 0 or i >= len(pdf.pages):
                continue
            
            page = pdf.pages[i]
            tables = page.extract_tables()
            
            for j, table in enumerate(tables):
                if table:
                    result['tables'].append({
                        'page_number': i + 1,
                        'table_index': j,
                        'rows': len(table),
                        'data': table
                    })
    
    return result


def get_pdf_info(params):
    """
    获取 PDF 文件信息
    
    Args:
        params.file_path: PDF 文件路径
    
    Returns:
        PDF 元数据
    """
    file_path = params.get('file_path')
    if not file_path:
        raise ValueError('file_path is required')
    
    if not os.path.exists(file_path):
        raise FileNotFoundError(f'PDF file not found: {file_path}')
    
    result = {
        'file_path': file_path,
        'file_size': os.path.getsize(file_path)
    }
    
    if HAS_PYPDF:
        reader = PdfReader(file_path)
        result['total_pages'] = len(reader.pages)
        
        if reader.metadata:
            result['metadata'] = {
                'title': reader.metadata.title,
                'author': reader.metadata.author,
                'subject': reader.metadata.subject,
                'creator': reader.metadata.creator,
                'producer': reader.metadata.producer,
            }
    elif HAS_PDFPLUMBER:
        with pdfplumber.open(file_path) as pdf:
            result['total_pages'] = len(pdf.pages)
            result['metadata'] = pdf.metadata
    
    return result


def pdf_to_markdown(params):
    """
    将 PDF 转换为 Markdown 格式，并提取图片
    
    Args:
        params.file_path: PDF 文件路径
        params.output_dir: 输出目录（可选，默认与 PDF 同目录）
        params.extract_images: 是否提取图片（默认 True）
        params.pages: 要转换的页码列表（可选，默认全部）
    
    Returns:
        转换结果，包含 markdown 文件路径和图片列表
    """
    if not HAS_PDF2MD:
        raise ImportError('pdf_to_markdown module not available')
    
    file_path = params.get('file_path')
    if not file_path:
        raise ValueError('file_path is required')
    
    return _pdf_to_markdown(
        file_path=file_path,
        output_dir=params.get('output_dir'),
        extract_images=params.get('extract_images', True),
        pages=params.get('pages')
    )


# 测试代码
if __name__ == '__main__':
    test_input = {
        'tool': 'get_info',
        'params': {'file_path': 'test.pdf'},
        'context': {}
    }
    
    result = execute(
        test_input['tool'],
        test_input['params'],
        test_input['context']
    )
    
    print(json.dumps(result, indent=2, ensure_ascii=False))
