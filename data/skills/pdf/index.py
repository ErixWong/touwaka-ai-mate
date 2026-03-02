"""
PDF 技能 - Python 实现
提供 PDF 文件的读取、解析、提取等功能
"""

import json
import sys
import os
import base64
import re

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
        params.image_dir: 图片子目录名（默认 'images'）
        params.pages: 要转换的页码列表（可选，默认全部）
    
    Returns:
        转换结果，包含 markdown 文件路径和图片列表
    """
    file_path = params.get('file_path')
    if not file_path:
        raise ValueError('file_path is required')
    
    if not os.path.exists(file_path):
        raise FileNotFoundError(f'PDF file not found: {file_path}')
    
    # 输出目录
    pdf_dir = os.path.dirname(file_path)
    pdf_name = os.path.splitext(os.path.basename(file_path))[0]
    output_dir = params.get('output_dir', pdf_dir)
    
    # 图片目录
    extract_images = params.get('extract_images', True)
    image_dir_name = params.get('image_dir', 'images')
    image_dir = os.path.join(output_dir, image_dir_name)
    
    # 页码
    pages = params.get('pages')
    
    # 创建输出目录
    if extract_images and not os.path.exists(image_dir):
        os.makedirs(image_dir, exist_ok=True)
    
    result = {
        'pdf_file': file_path,
        'output_dir': output_dir,
        'markdown_file': os.path.join(output_dir, f'{pdf_name}.md'),
        'images': [],
        'pages_processed': 0
    }
    
    # 收集所有 Markdown 内容
    markdown_parts = []
    
    # 添加标题
    markdown_parts.append(f'# {pdf_name}\n\n')
    markdown_parts.append(f'> 来源: {os.path.basename(file_path)}\n\n')
    markdown_parts.append('---\n\n')
    
    if HAS_PDFPLUMBER:
        md_content, images = _convert_with_pdfplumber(
            file_path, image_dir if extract_images else None, pages, pdf_name
        )
        markdown_parts.append(md_content)
        result['images'].extend(images)
        result['method'] = 'pdfplumber'
    elif HAS_PYPDF:
        md_content, images = _convert_with_pypdf(
            file_path, image_dir if extract_images else None, pages, pdf_name
        )
        markdown_parts.append(md_content)
        result['images'].extend(images)
        result['method'] = 'pypdf'
    else:
        raise ImportError('No PDF library available. Please install pypdf or pdfplumber.')
    
    # 写入 Markdown 文件
    full_markdown = ''.join(markdown_parts)
    with open(result['markdown_file'], 'w', encoding='utf-8') as f:
        f.write(full_markdown)
    
    result['markdown_length'] = len(full_markdown)
    result['image_count'] = len(result['images'])
    
    return result


def _convert_with_pdfplumber(file_path, image_dir, pages, pdf_name):
    """使用 pdfplumber 转换 PDF 为 Markdown"""
    markdown_parts = []
    all_images = []
    image_counter = 0
    
    with pdfplumber.open(file_path) as pdf:
        page_indices = pages if pages else range(len(pdf.pages))
        
        for i in page_indices:
            if i < 0 or i >= len(pdf.pages):
                continue
            
            page = pdf.pages[i]
            
            # 添加页面分隔
            markdown_parts.append(f'\n## 第 {i + 1} 页\n\n')
            
            # 提取文本
            text = page.extract_text() or ''
            if text.strip():
                # 清理文本
                text = _clean_text(text)
                markdown_parts.append(text)
                markdown_parts.append('\n')
            
            # 提取图片
            if image_dir and HAS_PIL:
                # 获取页面中的图片
                if hasattr(page, 'images') and page.images:
                    for img_info in page.images:
                        try:
                            # 裁剪图片区域
                            x0 = img_info.get('x0', 0)
                            y0 = img_info.get('top', 0)
                            x1 = img_info.get('x1', page.width)
                            y1 = img_info.get('bottom', page.height)
                            
                            # 限制在页面范围内
                            x0 = max(0, min(x0, page.width))
                            y0 = max(0, min(y0, page.height))
                            x1 = max(0, min(x1, page.width))
                            y1 = max(0, min(y1, page.height))
                            
                            if x1 > x0 and y1 > y0:
                                # 裁剪区域
                                cropped = page.crop((x0, y0, x1, y1))
                                im = cropped.to_image()
                                
                                # 保存图片
                                image_counter += 1
                                image_filename = f'{pdf_name}_p{i+1}_img{image_counter}.png'
                                image_path = os.path.join(image_dir, image_filename)
                                im.save(image_path)
                                
                                # 添加到 Markdown
                                rel_path = f'images/{image_filename}'
                                markdown_parts.append(f'\n![图片 {image_counter}]({rel_path})\n\n')
                                
                                all_images.append({
                                    'page': i + 1,
                                    'index': image_counter,
                                    'path': image_path,
                                    'relative_path': rel_path
                                })
                        except Exception as e:
                            # 忽略单个图片提取失败
                            pass
            
            markdown_parts.append('\n---\n')
    
    return ''.join(markdown_parts), all_images


def _convert_with_pypdf(file_path, image_dir, pages, pdf_name):
    """使用 pypdf 转换 PDF 为 Markdown"""
    markdown_parts = []
    all_images = []
    image_counter = 0
    
    reader = PdfReader(file_path)
    page_indices = pages if pages else range(len(reader.pages))
    
    for i in page_indices:
        if i < 0 or i >= len(reader.pages):
            continue
        
        page = reader.pages[i]
        
        # 添加页面分隔
        markdown_parts.append(f'\n## 第 {i + 1} 页\n\n')
        
        # 提取文本
        text = page.extract_text() or ''
        if text.strip():
            text = _clean_text(text)
            markdown_parts.append(text)
            markdown_parts.append('\n')
        
        # 提取图片
        if image_dir and HAS_PIL:
            if '/XObject' in page.get('/Resources', {}):
                xobject = page['/Resources']['/XObject']
                if hasattr(xobject, 'get_object'):
                    xobject = xobject.get_object()
                
                for obj_name in xobject:
                    obj = xobject[obj_name]
                    if hasattr(obj, 'get') and obj.get('/Subtype') == '/Image':
                        try:
                            # 提取图片数据
                            data = obj.get_data()
                            if data:
                                image_counter += 1
                                image_filename = f'{pdf_name}_p{i+1}_img{image_counter}.png'
                                image_path = os.path.join(image_dir, image_filename)
                                
                                # 尝试保存图片
                                with open(image_path, 'wb') as f:
                                    f.write(data)
                                
                                # 添加到 Markdown
                                rel_path = f'images/{image_filename}'
                                markdown_parts.append(f'\n![图片 {image_counter}]({rel_path})\n\n')
                                
                                all_images.append({
                                    'page': i + 1,
                                    'index': image_counter,
                                    'path': image_path,
                                    'relative_path': rel_path
                                })
                        except Exception as e:
                            # 忽略单个图片提取失败
                            pass
        
        markdown_parts.append('\n---\n')
    
    return ''.join(markdown_parts), all_images


def _clean_text(text):
    """清理提取的文本"""
    # 移除多余的空行
    text = re.sub(r'\n{3,}', '\n\n', text)
    # 移除行尾空格
    text = '\n'.join(line.rstrip() for line in text.split('\n'))
    return text


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
