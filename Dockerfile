# ============================================
# Touwaka Mate - Multi-stage Docker Build
# Supports both Node.js and Python runtimes
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

# Install Python and required system dependencies
RUN apk add --no-cache \
    python3 \
    py3-pip \
    python3-dev \
    build-base \
    libffi-dev \
    openssl-dev \
    make \
    g++ \
    sqlite \
    sqlite-dev \
    git \
    curl \
    && ln -sf python3 /usr/bin/python \
    && ln -sf pip3 /usr/bin/pip

# Create virtual environment for Python packages (optional, for skill dependencies)
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install common Python packages that skills might need
RUN pip install --no-cache-dir \
    python-docx \
    PyPDF2 \
    pdfplumber \
    openpyxl \
    pandas \
    beautifulsoup4 \
    lxml \
    requests \
    markdown \
    pillow

WORKDIR /app

# Copy backend package files
COPY package*.json ./

# Install backend dependencies (production only)
RUN npm ci --only=production

# Copy backend source
COPY server/ ./server/
COPY lib/ ./lib/
COPY models/ ./models/
COPY scripts/ ./scripts/
COPY config/ ./config/
COPY data/ ./data/

# Copy built frontend from builder stage
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Create data directory for persistence
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