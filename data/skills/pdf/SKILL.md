---
name: pdf
description: Use this skill whenever the user wants to do anything with PDF files. This includes reading or extracting text/tables from PDFs, combining or merging multiple PDFs into one, splitting PDFs apart, rotating pages, adding watermarks, creating new PDFs, filling PDF forms, encrypting/decrypting PDFs, extracting images, and converting PDFs to images for VL model recognition. If the user mentions a .pdf file or asks to produce one, use this skill.
license: Proprietary. LICENSE.txt has complete terms
argument-hint: "[operation] [path]"
user-invocable: true
tools:
  - read_pdf
  - extract_text
  - extract_tables
  - merge_pdfs
  - split_pdf
  - rotate_pages
  - create_pdf
  - convert_to_images
  - pdf_to_markdown
  - encrypt_pdf
  - decrypt_pdf
  - add_watermark
  - check_fillable_fields
  - extract_form_field_info
  - fill_fillable_fields
  - extract_form_structure
  - fill_pdf_form_with_annotations
  - check_bounding_boxes
  - extract_images
---

# PDF Processing Guide

## Overview

This guide covers essential PDF processing operations using Python libraries and command-line tools. For advanced features, JavaScript libraries, and detailed examples, see REFERENCE.md. If you need to fill out a PDF form, read FORMS.md and follow its instructions.

## Tools

### Basic Operations

#### read_pdf

Read PDF metadata and basic information.

**Parameters:**
- `path` (string, required): PDF file path

**Returns:** Page count, metadata (title, author, subject, creator), encryption status

#### extract_text

Extract text content from PDF pages.

**Parameters:**
- `path` (string, required): PDF file path
- `from_page` (number, optional): Start page (1-based, default: 1)
- `to_page` (number, optional): End page (inclusive)
- `preserve_layout` (boolean, optional): Preserve layout (default: false)

#### extract_tables

Extract tables from PDF using pdfplumber.

**Parameters:**
- `path` (string, required): PDF file path
- `page` (number, optional): Specific page number (1-based, extracts all if not specified)

### Editing Operations

#### merge_pdfs

Merge multiple PDF files into one.

**Parameters:**
- `paths` (string[], required): Array of PDF file paths (at least 2)
- `output` (string, required): Output file path

#### split_pdf

Split PDF into multiple files.

**Parameters:**
- `path` (string, required): PDF file path
- `output_dir` (string, required): Output directory
- `pages_per_file` (number, optional): Pages per output file (default: 1)
- `prefix` (string, optional): Output filename prefix (default: "page")

#### rotate_pages

Rotate pages in PDF.

**Parameters:**
- `path` (string, required): PDF file path
- `output` (string, required): Output file path
- `pages` (number[], optional): Page numbers to rotate (1-based, all if empty)
- `degrees` (number, optional): Rotation degrees - 90, 180, 270 (default: 90)

### Creation and Conversion

#### create_pdf

Create a new PDF with text content.

**Parameters:**
- `output` (string, required): Output file path
- `title` (string, optional): PDF title
- `content` (string[], required): Array of text content (each item is a page)
- `page_size` (string, optional): Page size - "letter" or "a4" (default: "a4")

#### convert_to_images

Convert PDF pages to images.

**Parameters:**
- `path` (string, required): PDF file path
- `output_dir` (string, required): Output directory
- `dpi` (number, optional): Resolution DPI (default: 150)
- `format` (string, optional): Image format - "png" or "jpeg" (default: "png")
- `from_page` (number, optional): Start page (1-based)
- `to_page` (number, optional): End page (inclusive)

#### pdf_to_markdown

Convert PDF to Markdown format.

**Parameters:**
- `path` (string, required): PDF file path
- `output` (string, optional): Output markdown file path
- `from_page` (number, optional): Start page (1-based)
- `to_page` (number, optional): End page (inclusive)

### Security Operations

#### encrypt_pdf

Encrypt PDF with password protection.

**Parameters:**
- `path` (string, required): PDF file path
- `output` (string, required): Output file path
- `user_password` (string, required): Password to open the PDF
- `owner_password` (string, optional): Password for editing (defaults to user_password)

#### decrypt_pdf

Remove password protection from PDF.

**Parameters:**
- `path` (string, required): PDF file path
- `output` (string, required): Output file path
- `password` (string, required): Current password

#### add_watermark

Add watermark to PDF pages.

**Parameters:**
- `path` (string, required): PDF file path
- `output` (string, required): Output file path
- `watermark` (string, required): Watermark text or watermark PDF path
- `is_text` (boolean, optional): True if watermark is text, false if PDF path (default: true)

### Form Operations

#### check_fillable_fields

Check if PDF has fillable form fields.

**Parameters:**
- `path` (string, required): PDF file path

#### extract_form_field_info

Extract information about fillable form fields.

**Parameters:**
- `path` (string, required): PDF file path
- `output` (string, required): Output JSON file path

#### fill_fillable_fields

Fill fillable form fields in a PDF.

**Parameters:**
- `path` (string, required): PDF file path
- `field_values` (string, required): JSON file with field values
- `output` (string, required): Output PDF file path

#### extract_form_structure

Extract form structure for non-fillable forms.

**Parameters:**
- `path` (string, required): PDF file path
- `output` (string, required): Output JSON file path

#### fill_pdf_form_with_annotations

Fill non-fillable PDF forms with text annotations.

**Parameters:**
- `path` (string, required): PDF file path
- `fields_json` (string, required): Fields JSON file path
- `output` (string, required): Output PDF file path

#### check_bounding_boxes

Validate bounding boxes for form fields.

**Parameters:**
- `fields_json` (string, required): Fields JSON file path

### Other Operations

#### extract_images

Extract embedded images from PDF.

**Parameters:**
- `path` (string, required): PDF file path
- `output_dir` (string, required): Output directory

## Quick Start

```python
from pypdf import PdfReader, PdfWriter

# Read a PDF
reader = PdfReader("document.pdf")
print(f"Pages: {len(reader.pages)}")

# Extract text
text = ""
for page in reader.pages:
    text += page.extract_text()
```

## Python Libraries

### pypdf - Basic Operations

#### Merge PDFs

```python
from pypdf import PdfWriter, PdfReader

writer = PdfWriter()
for pdf_file in ["doc1.pdf", "doc2.pdf", "doc3.pdf"]:
    reader = PdfReader(pdf_file)
    for page in reader.pages:
        writer.add_page(page)

with open("merged.pdf", "wb") as output:
    writer.write(output)
```

#### Split PDF

```python
reader = PdfReader("input.pdf")
for i, page in enumerate(reader.pages):
    writer = PdfWriter()
    writer.add_page(page)
    with open(f"page_{i+1}.pdf", "wb") as output:
        writer.write(output)
```

#### Extract Metadata

```python
reader = PdfReader("document.pdf")
meta = reader.metadata
print(f"Title: {meta.title}")
print(f"Author: {meta.author}")
print(f"Subject: {meta.subject}")
print(f"Creator: {meta.creator}")
```

#### Rotate Pages

```python
reader = PdfReader("input.pdf")
writer = PdfWriter()

page = reader.pages[0]
page.rotate(90)  # Rotate 90 degrees clockwise
writer.add_page(page)

with open("rotated.pdf", "wb") as output:
    writer.write(output)
```

### pdfplumber - Text and Table Extraction

#### Extract Text with Layout

```python
import pdfplumber

with pdfplumber.open("document.pdf") as pdf:
    for page in pdf.pages:
        text = page.extract_text()
        print(text)
```

#### Extract Tables

```python
with pdfplumber.open("document.pdf") as pdf:
    for i, page in enumerate(pdf.pages):
        tables = page.extract_tables()
        for j, table in enumerate(tables):
            print(f"Table {j+1} on page {i+1}:")
            for row in table:
                print(row)
```

#### Advanced Table Extraction

```python
import pandas as pd

with pdfplumber.open("document.pdf") as pdf:
    all_tables = []
    for page in pdf.pages:
        tables = page.extract_tables()
        for table in tables:
            if table:  # Check if table is not empty
                df = pd.DataFrame(table[1:], columns=table[0])
                all_tables.append(df)

# Combine all tables
if all_tables:
    combined_df = pd.concat(all_tables, ignore_index=True)
    combined_df.to_excel("extracted_tables.xlsx", index=False)
```

### reportlab - Create PDFs

#### Basic PDF Creation

```python
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

c = canvas.Canvas("hello.pdf", pagesize=letter)
width, height = letter

# Add text
c.drawString(100, height - 100, "Hello World!")
c.drawString(100, height - 120, "This is a PDF created with reportlab")

# Add a line
c.line(100, height - 140, 400, height - 140)

# Save
c.save()
```

#### Create PDF with Multiple Pages

```python
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak
from reportlab.lib.styles import getSampleStyleSheet

doc = SimpleDocTemplate("report.pdf", pagesize=letter)
styles = getSampleStyleSheet()
story = []

# Add content
title = Paragraph("Report Title", styles['Title'])
story.append(title)
story.append(Spacer(1, 12))

body = Paragraph("This is the body of the report. " * 20, styles['Normal'])
story.append(body)
story.append(PageBreak())

# Page 2
story.append(Paragraph("Page 2", styles['Heading1']))
story.append(Paragraph("Content for page 2", styles['Normal']))

# Build PDF
doc.build(story)
```

#### Subscripts and Superscripts

**IMPORTANT**: Never use Unicode subscript/superscript characters (₀₁₂₃₄₅₆₇₈₉, ⁰¹²³⁴⁵⁶⁷⁸⁹) in ReportLab PDFs. The built-in fonts do not include these glyphs, causing them to render as solid black boxes.

Instead, use ReportLab's XML markup tags in Paragraph objects:

```python
from reportlab.platypus import Paragraph
from reportlab.lib.styles import getSampleStyleSheet

styles = getSampleStyleSheet()

# Subscripts: use <sub> tag
chemical = Paragraph("H<sub>2</sub>O", styles['Normal'])

# Superscripts: use <super> tag
squared = Paragraph("x<super>2</super> + y<super>2</super>", styles['Normal'])
```

For canvas-drawn text (not Paragraph objects), manually adjust font the size and position rather than using Unicode subscripts/superscripts.

## Command-Line Tools

### pdftotext (poppler-utils)

```bash
# Extract text
pdftotext input.pdf output.txt

# Extract text preserving layout
pdftotext -layout input.pdf output.txt

# Extract specific pages
pdftotext -f 1 -l 5 input.pdf output.txt  # Pages 1-5
```

### qpdf

```bash
# Merge PDFs
qpdf --empty --pages file1.pdf file2.pdf -- merged.pdf

# Split pages
qpdf input.pdf --pages . 1-5 -- pages1-5.pdf
qpdf input.pdf --pages . 6-10 -- pages6-10.pdf

# Rotate pages
qpdf input.pdf output.pdf --rotate=+90:1  # Rotate page 1 by 90 degrees

# Remove password
qpdf --password=mypassword --decrypt encrypted.pdf decrypted.pdf
```

### pdftk (if available)

```bash
# Merge
pdftk file1.pdf file2.pdf cat output merged.pdf

# Split
pdftk input.pdf burst

# Rotate
pdftk input.pdf rotate 1east output rotated.pdf
```

## Common Tasks

### Convert Scanned PDFs to Images for VL Model Recognition

For scanned PDFs or image-based PDFs where text extraction fails, use `convert_to_images` tool to convert PDF pages to images, then send images to VL (Vision-Language) model for text recognition.

**Workflow:**
1. Use `convert_to_images` tool to convert PDF pages to PNG/JPEG images
2. Send the generated images to VL model (e.g., GPT-4V, Claude Vision, Qwen-VL)
3. VL model will recognize and extract text from the images

**Example:**
```
# Step 1: Convert PDF to images
Tool: convert_to_images
Params: { "path": "scanned.pdf", "output_dir": "./images", "dpi": 200 }

# Step 2: Send images to VL model for recognition
# The images are now ready for VL model processing
```

**Benefits of using VL model over traditional OCR:**
- Better handling of complex layouts
- Multi-language support without additional language packs
- Understanding of tables, forms, and structured content
- No need to install Tesseract or language packs

### Add Watermark

```python
from pypdf import PdfReader, PdfWriter

# Create watermark (or load existing)
watermark = PdfReader("watermark.pdf").pages[0]

# Apply to all pages
reader = PdfReader("document.pdf")
writer = PdfWriter()

for page in reader.pages:
    page.merge_page(watermark)
    writer.add_page(page)

with open("watermarked.pdf", "wb") as output:
    writer.write(output)
```

### Extract Images

```bash
# Using pdfimages (poppler-utils)
pdfimages -j input.pdf output_prefix

# This extracts all images as output_prefix-000.jpg, output_prefix-001.jpg, etc.
```

### Password Protection

```python
from pypdf import PdfReader, PdfWriter

reader = PdfReader("input.pdf")
writer = PdfWriter()

for page in reader.pages:
    writer.add_page(page)

# Add password
writer.encrypt("userpassword", "ownerpassword")

with open("encrypted.pdf", "wb") as output:
    writer.write(output)
```

## Quick Reference

| Task               | Best Tool                       | Command/Code                 |
| ------------------ | ------------------------------- | ---------------------------- |
| Merge PDFs         | pypdf                           | `writer.add_page(page)`    |
| Split PDFs         | pypdf                           | One page per file            |
| Extract text       | pdfplumber                      | `page.extract_text()`      |
| Extract tables     | pdfplumber                      | `page.extract_tables()`    |
| Create PDFs        | reportlab                       | Canvas or Platypus           |
| Command line merge | qpdf                            | `qpdf --empty --pages ...` |
| Scanned PDFs       | convert_to_images + VL model    | Convert to image first       |
| Fill PDF forms     | pdf-lib or pypdf (see FORMS.md) | See FORMS.md                 |

## Next Steps

- For advanced pypdfium2 usage, see REFERENCE.md
- For JavaScript libraries (pdf-lib), see REFERENCE.md
- If you need to fill out a PDF form, follow the instructions in FORMS.md
- For troubleshooting guides, see REFERENCE.md

---
