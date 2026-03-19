# ============================================
# Touwaka Mate - Multi-stage Docker Build
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

# Stage 2: Production image
FROM node:20-alpine

# Install required system dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    sqlite \
    sqlite-dev

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
RUN mkdir -p /app/data

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Start the application
CMD ["node", "server/index.js"]