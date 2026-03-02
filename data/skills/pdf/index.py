"""
PDF Tools Skill - Python Implementation

Comprehensive PDF processing tools including:
- Basic operations: read, extract text/tables
- Editing: merge, split, rotate pages
- Creation: create PDFs from content
- Conversion: to images, to markdown
- Security: encrypt, decrypt, watermark
- Forms: fill and extract form data

All tools use Python PDF libraries (pypdf, pdfplumber, reportlab, etc.)
Form-related tools delegate to existing scripts in scripts/ directory.
"""

import os
import sys
import subprocess
from pathlib import Path

# Get skill directory
SKILL_DIR = Path(__file__).parent.resolve()
SCRIPTS_DIR = SKILL_DIR / "scripts"

# Maximum file size to process (100MB)
MAX_FILE_SIZE = 100 * 1024 * 1024


def validate_pdf_file(file_path):
    """Check if file exists and is a PDF"""
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")
    
    file_size = os.path.getsize(file_path)
    if file_size > MAX_FILE_SIZE:
        raise ValueError(f"File too large: {file_size} bytes (max: {MAX_FILE_SIZE})")
    
    if not file_path.lower().endswith('.pdf'):
        raise ValueError(f"Not a PDF file: {file_path}")
    
    return True


def run_script(script_name, args):
    """Run a Python script from scripts/ directory and return output"""
    script_path = SCRIPTS_DIR / script_name
    
    # 安全检查：防止命令注入
    dangerous_chars = [';', '|', '`', '$', '&&', '||', '\n', '\r']
    for arg in args:
        for char in dangerous_chars:
            if char in arg:
                raise ValueError(f"Invalid character in argument: {repr(char)}")
    
    cmd = [sys.executable, str(script_path)] + args
    
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        cwd=str(SKILL_DIR)
    )
    
    if result.returncode != 0:
        raise RuntimeError(f"Script error: {result.stderr}")
    
    return result.stdout


# ============================================================
# Basic PDF Operations
# ============================================================

def read_pdf(params):
    """Read PDF metadata and basic info"""
    from pypdf import PdfReader
    
    file_path = params['path']
    validate_pdf_file(file_path)
    
    reader = PdfReader(file_path)
    meta = reader.metadata
    
    return {
        'page_count': len(reader.pages),
        'metadata': {
            'title': meta.title if meta else None,
            'author': meta.author if meta else None,
            'subject': meta.subject if meta else None,
            'creator': meta.creator if meta else None,
            'producer': meta.producer if meta else None,
        },
        'encrypted': reader.is_encrypted
    }


def extract_text(params):
    """Extract text from PDF pages"""
    from pypdf import PdfReader
    
    file_path = params['path']
    validate_pdf_file(file_path)
    
    from_page = params.get('from_page', 1)
    to_page = params.get('to_page')
    
    reader = PdfReader(file_path)
    total_pages = len(reader.pages)
    
    start = max(1, from_page) - 1
    end = min(to_page if to_page else total_pages, total_pages)
    
    text_parts = []
    for i in range(start, end):
        page = reader.pages[i]
        text_parts.append(f"--- Page {i+1} ---")
        text_parts.append(page.extract_text() or "")
    
    return {
        'page_count': total_pages,
        'extracted_pages': end - start,
        'text': '\n'.join(text_parts)
    }


def extract_tables(params):
    """Extract tables from PDF using pdfplumber"""
    import pdfplumber
    
    file_path = params['path']
    validate_pdf_file(file_path)
    
    page_num = params.get('page')
    
    all_tables = []
    
    with pdfplumber.open(file_path) as pdf:
        if page_num:
            pages_to_process = [page_num - 1]
        else:
            pages_to_process = range(len(pdf.pages))
        
        for i in pages_to_process:
            page = pdf.pages[i]
            tables = page.extract_tables()
            for j, table in enumerate(tables):
                if table:
                    all_tables.append({
                        'page': i + 1,
                        'table_index': j + 1,
                        'rows': len(table),
                        'columns': len(table[0]) if table else 0,
                        'data': table[:10]  # Limit to first 10 rows
                    })
    
    return {
        'total_tables': len(all_tables),
        'tables': all_tables
    }


# ============================================================
# PDF Editing Operations
# ============================================================

def merge_pdfs(params):
    """Merge multiple PDFs into one"""
    from pypdf import PdfWriter, PdfReader
    
    file_paths = params['paths']
    output_path = params['output']
    
    if not file_paths or len(file_paths) < 2:
        raise ValueError('At least 2 PDF files are required for merging')
    
    for fp in file_paths:
        validate_pdf_file(fp)
    
    writer = PdfWriter()
    
    for pdf_file in file_paths:
        reader = PdfReader(pdf_file)
        for page in reader.pages:
            writer.add_page(page)
    
    with open(output_path, 'wb') as output:
        writer.write(output)
    
    return {
        'success': True,
        'input_files': file_paths,
        'output_file': output_path,
        'total_pages': len(writer.pages)
    }


def split_pdf(params):
    """Split PDF into multiple files"""
    from pypdf import PdfWriter, PdfReader
    
    file_path = params['path']
    output_dir = params['output_dir']
    pages_per_file = params.get('pages_per_file', 1)
    prefix = params.get('prefix', 'page')
    
    validate_pdf_file(file_path)
    
    os.makedirs(output_dir, exist_ok=True)
    
    reader = PdfReader(file_path)
    total_pages = len(reader.pages)
    
    output_files = []
    for i in range(0, total_pages, pages_per_file):
        writer = PdfWriter()
        end = min(i + pages_per_file, total_pages)
        for j in range(i, end):
            writer.add_page(reader.pages[j])
        
        output_path = os.path.join(output_dir, f"{prefix}_{i // pages_per_file + 1}.pdf")
        with open(output_path, 'wb') as output:
            writer.write(output)
        output_files.append(output_path)
    
    return {
        'success': True,
        'input_file': file_path,
        'output_dir': output_dir,
        'total_pages': total_pages,
        'pages_per_file': pages_per_file,
        'output_files': output_files
    }


def rotate_pages(params):
    """Rotate pages in PDF"""
    from pypdf import PdfWriter, PdfReader
    
    file_path = params['path']
    output_path = params['output']
    pages = params.get('pages', [])
    degrees = params.get('degrees', 90)
    
    validate_pdf_file(file_path)
    
    reader = PdfReader(file_path)
    writer = PdfWriter()
    
    for i, page in enumerate(reader.pages):
        if pages:
            if (i + 1) in pages:
                page.rotate(degrees)
        else:
            page.rotate(degrees)
        writer.add_page(page)
    
    with open(output_path, 'wb') as output:
        writer.write(output)
    
    return {
        'success': True,
        'input_file': file_path,
        'output_file': output_path,
        'rotated_pages': pages if pages else 'all',
        'degrees': degrees
    }


# ============================================================
# PDF Creation and Conversion
# ============================================================

def create_pdf(params):
    """Create a new PDF with text content"""
    from reportlab.lib.pagesizes import letter, A4
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak
    from reportlab.lib.styles import getSampleStyleSheet
    
    output_path = params['output']
    title = params.get('title', '')
    content = params.get('content', [])
    page_size = params.get('page_size', 'a4')
    
    page_sizes = {'letter': letter, 'a4': A4}
    
    doc = SimpleDocTemplate(
        output_path,
        pagesize=page_sizes.get(page_size, A4),
        title=title
    )
    
    styles = getSampleStyleSheet()
    story = []
    
    for i, page_content in enumerate(content):
        if i > 0:
            story.append(PageBreak())
        
        # Split content into paragraphs
        paragraphs = page_content.split('\n\n')
        for para in paragraphs:
            if para.strip():
                # Convert newlines to <br/> for proper rendering
                formatted = para.strip().replace('\n', '<br/>')
                story.append(Paragraph(formatted, styles['Normal']))
                story.append(Spacer(1, 12))
    
    doc.build(story)
    
    return {
        'success': True,
        'output_file': output_path,
        'pages': len(content)
    }


def convert_to_images(params):
    """Convert PDF pages to images"""
    file_path = params['path']
    output_dir = params['output_dir']
    dpi = params.get('dpi', 150)
    image_format = params.get('format', 'png')  # 避免覆盖内置函数 format()
    from_page = params.get('from_page')
    to_page = params.get('to_page')
    
    validate_pdf_file(file_path)
    
    # Use the existing script
    args = [file_path, output_dir, f'--dpi={dpi}', f'--format={image_format}']
    if from_page:
        args.append(f'--from={from_page}')
    if to_page:
        args.append(f'--to={to_page}')
    
    result = run_script('convert_pdf_to_images.py', args)
    
    return {
        'success': True,
        'output_dir': output_dir,
        'format': image_format,
        'dpi': dpi,
        'message': result.strip()
    }


def pdf_to_markdown(params):
    """Convert PDF to Markdown format"""
    file_path = params['path']
    output_path = params.get('output')
    from_page = params.get('from_page')
    to_page = params.get('to_page')
    
    validate_pdf_file(file_path)
    
    args = [file_path]
    if output_path:
        args.append(output_path)
    if from_page:
        args.append(f'--from={from_page}')
    if to_page:
        args.append(f'--to={to_page}')
    
    result = run_script('pdf_to_markdown.py', args)
    
    return {
        'success': True,
        'input_file': file_path,
        'output_file': output_path,
        'markdown': result
    }


# ============================================================
# PDF Security Operations
# ============================================================

def encrypt_pdf(params):
    """Encrypt PDF with password"""
    from pypdf import PdfWriter, PdfReader
    
    file_path = params['path']
    output_path = params['output']
    user_password = params['user_password']
    owner_password = params.get('owner_password', user_password)
    
    validate_pdf_file(file_path)
    
    if not user_password:
        raise ValueError('user_password is required')
    
    reader = PdfReader(file_path)
    writer = PdfWriter()
    
    for page in reader.pages:
        writer.add_page(page)
    
    writer.encrypt(user_password, owner_password)
    
    with open(output_path, 'wb') as output:
        writer.write(output)
    
    return {
        'success': True,
        'input_file': file_path,
        'output_file': output_path,
        'encrypted': True
    }


def decrypt_pdf(params):
    """Remove password protection from PDF"""
    from pypdf import PdfWriter, PdfReader
    
    file_path = params['path']
    output_path = params['output']
    password = params['password']
    
    validate_pdf_file(file_path)
    
    reader = PdfReader(file_path)
    
    if reader.is_encrypted:
        reader.decrypt(password)
    
    writer = PdfWriter()
    
    for page in reader.pages:
        writer.add_page(page)
    
    with open(output_path, 'wb') as output:
        writer.write(output)
    
    return {
        'success': True,
        'input_file': file_path,
        'output_file': output_path,
        'decrypted': True
    }


def add_watermark(params):
    """Add watermark to PDF"""
    from pypdf import PdfWriter, PdfReader
    from reportlab.pdfgen import canvas
    from reportlab.lib.pagesizes import letter
    from io import BytesIO
    
    file_path = params['path']
    output_path = params['output']
    watermark = params['watermark']
    is_text = params.get('is_text', True)
    
    validate_pdf_file(file_path)
    
    if is_text:
        # Create text watermark using reportlab
        packet = BytesIO()
        c = canvas.Canvas(packet, pagesize=letter)
        width, height = letter
        
        # Draw watermark text
        c.setFont("Helvetica", 50)
        c.setFillColorRGB(0.8, 0.8, 0.8, alpha=0.5)
        c.saveState()
        c.translate(width / 2, height / 2)
        c.rotate(45)
        c.drawCentredString(0, 0, watermark)
        c.restoreState()
        c.save()
        
        # Move to beginning
        packet.seek(0)
        watermark_pdf = PdfReader(packet)
        watermark_page = watermark_pdf.pages[0]
    else:
        # Use existing PDF as watermark - 验证文件存在
        if not os.path.exists(watermark):
            raise FileNotFoundError(f"Watermark file not found: {watermark}")
        validate_pdf_file(watermark)
        watermark_page = PdfReader(watermark).pages[0]
    
    # Apply watermark
    reader = PdfReader(file_path)
    writer = PdfWriter()
    
    for page in reader.pages:
        page.merge_page(watermark_page)
        writer.add_page(page)
    
    with open(output_path, 'wb') as output:
        writer.write(output)
    
    return {
        'success': True,
        'input_file': file_path,
        'output_file': output_path,
        'watermark': watermark if is_text else watermark
    }


# ============================================================
# Form Operations (using Python scripts)
# ============================================================

def check_fillable_fields(params):
    """Check if PDF has fillable form fields"""
    file_path = params['path']
    validate_pdf_file(file_path)
    
    result = run_script('check_fillable_fields.py', [file_path])
    
    return {
        'success': True,
        'file': file_path,
        'result': result.strip()
    }


def extract_form_field_info(params):
    """Extract form field information"""
    file_path = params['path']
    output_path = params['output']
    
    validate_pdf_file(file_path)
    
    result = run_script('extract_form_field_info.py', [file_path, output_path])
    
    return {
        'success': True,
        'file': file_path,
        'output_file': output_path,
        'result': result.strip()
    }


def fill_fillable_fields(params):
    """Fill fillable form fields"""
    file_path = params['path']
    field_values = params['field_values']
    output_path = params['output']
    
    validate_pdf_file(file_path)
    
    result = run_script('fill_fillable_fields.py', [file_path, field_values, output_path])
    
    return {
        'success': True,
        'input_file': file_path,
        'field_values_file': field_values,
        'output_file': output_path,
        'result': result.strip()
    }


def extract_form_structure(params):
    """Extract form structure for non-fillable forms"""
    file_path = params['path']
    output_path = params['output']
    
    validate_pdf_file(file_path)
    
    result = run_script('extract_form_structure.py', [file_path, output_path])
    
    return {
        'success': True,
        'file': file_path,
        'output_file': output_path,
        'result': result.strip()
    }


def fill_pdf_form_with_annotations(params):
    """Fill non-fillable PDF forms with text annotations"""
    file_path = params['path']
    fields_json = params['fields_json']
    output_path = params['output']
    
    validate_pdf_file(file_path)
    
    result = run_script('fill_pdf_form_with_annotations.py', [file_path, fields_json, output_path])
    
    return {
        'success': True,
        'input_file': file_path,
        'fields_json_file': fields_json,
        'output_file': output_path,
        'result': result.strip()
    }


def check_bounding_boxes(params):
    """Validate bounding boxes for form fields"""
    fields_json = params['fields_json']
    
    result = run_script('check_bounding_boxes.py', [fields_json])
    
    return {
        'success': True,
        'fields_json_file': fields_json,
        'result': result.strip()
    }


# ============================================================
# Other Operations
# ============================================================

def extract_images(params):
    """Extract embedded images from PDF"""
    from pypdf import PdfReader
    
    file_path = params['path']
    output_dir = params['output_dir']
    
    validate_pdf_file(file_path)
    
    os.makedirs(output_dir, exist_ok=True)
    
    reader = PdfReader(file_path)
    extracted = []
    failed = []
    
    for page_num, page in enumerate(reader.pages):
        # 安全访问 /Resources，避免 KeyError
        resources = page.get('/Resources', {})
        if not resources or '/XObject' not in resources:
            continue
        
        try:
            xobjects = resources['/XObject'].get_object()
            for obj_name in xobjects:
                obj = xobjects[obj_name]
                if obj['/Subtype'] == '/Image':
                    # Extract image data
                    try:
                        data = obj.get_data()
                        img_path = os.path.join(output_dir, f"page{page_num+1}_{obj_name[1:]}.jpg")
                        with open(img_path, 'wb') as f:
                            f.write(data)
                        extracted.append(img_path)
                    except Exception as e:
                        # 记录失败但继续处理其他图片
                        failed.append(f"page{page_num+1}_{obj_name}: {str(e)}")
        except Exception as e:
            # 记录页面处理失败
            failed.append(f"page{page_num+1}: {str(e)}")
    
    return {
        'success': True,
        'input_file': file_path,
        'output_dir': output_dir,
        'images': extracted,
        'failed': failed if failed else None
    }


# ============================================================
# Tool Router
# ============================================================

def execute(tool_name, params, context=None):
    """
    Execute a PDF tool.
    
    Args:
        tool_name: Name of the tool to execute
        params: Tool parameters
        context: Execution context (optional)
    
    Returns:
        Tool execution result
    """
    # Tool name mapping (support both snake_case and camelCase)
    tool_map = {
        # Basic operations
        'read_pdf': read_pdf,
        'readPdf': read_pdf,
        'extract_text': extract_text,
        'extractText': extract_text,
        'extract_tables': extract_tables,
        'extractTables': extract_tables,
        
        # Editing operations
        'merge_pdfs': merge_pdfs,
        'mergePdfs': merge_pdfs,
        'split_pdf': split_pdf,
        'splitPdf': split_pdf,
        'rotate_pages': rotate_pages,
        'rotatePages': rotate_pages,
        
        # Creation and conversion
        'create_pdf': create_pdf,
        'createPdf': create_pdf,
        'convert_to_images': convert_to_images,
        'convertToImages': convert_to_images,
        'pdf_to_markdown': pdf_to_markdown,
        'pdfToMarkdown': pdf_to_markdown,
        
        # Security operations
        'encrypt_pdf': encrypt_pdf,
        'encryptPdf': encrypt_pdf,
        'decrypt_pdf': decrypt_pdf,
        'decryptPdf': decrypt_pdf,
        'add_watermark': add_watermark,
        'addWatermark': add_watermark,
        
        # Form operations
        'check_fillable_fields': check_fillable_fields,
        'checkFillableFields': check_fillable_fields,
        'extract_form_field_info': extract_form_field_info,
        'extractFormFieldInfo': extract_form_field_info,
        'fill_fillable_fields': fill_fillable_fields,
        'fillFillableFields': fill_fillable_fields,
        'extract_form_structure': extract_form_structure,
        'extractFormStructure': extract_form_structure,
        'fill_pdf_form_with_annotations': fill_pdf_form_with_annotations,
        'fillPdfFormWithAnnotations': fill_pdf_form_with_annotations,
        'check_bounding_boxes': check_bounding_boxes,
        'checkBoundingBoxes': check_bounding_boxes,
        
        # Other operations
        'extract_images': extract_images,
        'extractImages': extract_images,
    }
    
    if tool_name not in tool_map:
        raise ValueError(f"Unknown tool: {tool_name}")
    
    return tool_map[tool_name](params)
