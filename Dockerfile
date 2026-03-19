# ============================================
# Touwaka Mate - Docker Image
# Based on nikolaik/python-nodejs (Python + Node.js)
# ============================================

# Build frontend first
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Production image - use slim variant for smaller size
FROM nikolaik/python-nodejs:python3.12-nodejs20-slim

# Install system dependencies for Office/PDF processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Office document processing
    libreoffice-writer \
    libreoffice-impress \
    libreoffice-calc \
    # PDF processing
    poppler-utils \
    # Fonts
    fonts-noto-cjk \
    fonts-dejavu \
    # Build tools for native modules
    build-essential \
    # SQLite
    sqlite3 \
    libsqlite3-dev \
    # Image processing
    libvips-dev \
    # Utility
    wget \
    # Cleanup
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy Python requirements and install
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy Node package files and install
COPY package*.json ./
RUN npm ci --only=production

# Install global npm packages
RUN npm install -g pptxgenjs

# Copy application code
COPY server/ ./server/
COPY lib/ ./lib/
COPY models/ ./models/
COPY scripts/ ./scripts/
COPY config/ ./config/
COPY data/ ./data/

# Copy built frontend
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Create directories
RUN mkdir -p /app/data /app/work

# Create non-root user
RUN groupadd -g 1001 appgroup && \
    useradd -u 1001 -g appgroup -m appuser && \
    chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "server/index.js"]