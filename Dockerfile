# ============================================
# Touwaka Mate - Multi-stage Docker Build
# Supports both Node.js and Python runtimes
# Includes Office document processing (PPTX, XLSX, DOCX)
# ============================================

# Stage 1: Build frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

# Copy frontend package files
COPY frontend/package*.json ./

# Install frontend dependencies
RUN npm ci

# Copy frontend source
COPY frontend/ ./

# Build frontend
RUN npm run build

# Stage 2: Production image with Node.js and Python
FROM node:20-alpine

# Install Python and all required system dependencies for native modules
# - build-base, g++, make: for compiling native Node modules (better-sqlite3, tiktoken)
# - vips-dev: for sharp image processing
# - sqlite-dev: for better-sqlite3
# - python3, py3-pip: for Python skills
# - LibreOffice: for Office document processing (PPTX, XLSX, DOCX)
# - Poppler: for PDF to image conversion
# - git, curl: utility tools
RUN apk add --no-cache \
    # Build tools for native modules
    build-base \
    g++ \
    gcc \
    make \
    python3 \
    # Sharp dependencies (image processing)
    vips-dev \
    # SQLite for better-sqlite3
    sqlite \
    sqlite-dev \
    # Python runtime
    py3-pip \
    python3-dev \
    libffi-dev \
    openssl-dev \
    # Office document processing
    libreoffice \
    libreoffice-common \
    poppler-utils \
    # Fonts for LibreOffice (minimal set)
    font-noto-cjk \
    font-dejavu \
    # Utility tools
    git \
    curl \
    wget \
    && ln -sf python3 /usr/bin/python \
    && ln -sf pip3 /usr/bin/pip

# Create virtual environment for Python packages (for skill dependencies)
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install common Python packages that skills might need
# Including Office document processing libraries
RUN pip install --no-cache-dir \
    # Office document processing
    python-docx \
    python-pptx \
    openpyxl \
    xlrd \
    # PDF processing
    PyPDF2 \
    pdfplumber \
    # Data analysis
    pandas \
    # Web scraping and parsing
    beautifulsoup4 \
    lxml \
    # HTTP and utilities
    requests \
    markdown \
    # Image processing
    pillow \
    # Markitdown for document text extraction
    "markitdown[pptx,xlsx,docx]"

WORKDIR /app

# Copy backend package files
COPY package*.json ./

# Install backend dependencies (production only)
# This will compile native modules like better-sqlite3, sharp, tiktoken
RUN npm ci --only=production

# Install global npm packages for Office processing
RUN npm install -g pptxgenjs

# Copy backend source
COPY server/ ./server/
COPY lib/ ./lib/
COPY models/ ./models/
COPY scripts/ ./scripts/
COPY config/ ./config/
COPY data/ ./data/

# Copy built frontend from builder stage
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Create data and work directories for persistence
RUN mkdir -p /app/data /app/work

# Create non-root user for security
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup && \
    chown -R appuser:appgroup /app

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Start the application
CMD ["node", "server/index.js"]