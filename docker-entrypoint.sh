#!/bin/bash
set -e

echo "=== Touwaka Mate Docker Entrypoint ==="

# Check if system packages are installed
if ! command -v libreoffice &> /dev/null; then
    echo "Installing system packages..."
    apt-get update
    apt-get install -y --no-install-recommends \
        libreoffice-writer \
        libreoffice-impress \
        libreoffice-calc \
        poppler-utils \
        fonts-noto-cjk \
        fonts-dejavu \
        build-essential \
        sqlite3 \
        libsqlite3-dev \
        libvips-dev \
        wget
    apt-get clean
    rm -rf /var/lib/apt/lists/*
    echo "System packages installed."
else
    echo "System packages already installed."
fi

# Check if Python packages are installed
if [ ! -f "/root/.cache/pip/.installed" ]; then
    echo "Installing Python packages..."
    pip install --no-cache-dir -r /app/requirements.txt
    touch /root/.cache/pip/.installed
    echo "Python packages installed."
else
    echo "Python packages already installed."
fi

# Check if Node modules are installed
if [ ! -d "/app/node_modules" ] || [ ! -f "/app/node_modules/.package-lock.json" ]; then
    echo "Installing Node.js dependencies..."
    cd /app
    npm ci --only=production
    npm install -g pptxgenjs
    echo "Node.js dependencies installed."
else
    echo "Node.js dependencies already installed."
fi

# Check if frontend is built
if [ ! -d "/app/frontend/dist" ] || [ ! -f "/app/frontend/dist/index.html" ]; then
    echo "Building frontend..."
    cd /app/frontend
    if [ ! -d "node_modules" ]; then
        npm ci
    fi
    npm run build
    echo "Frontend built."
else
    echo "Frontend already built."
fi

cd /app

echo "=== Starting application ==="
exec "$@"