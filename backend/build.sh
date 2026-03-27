#!/usr/bin/env bash
# Render build script for native Python deployment.
# Set this as the Build Command in Render: bash build.sh
set -e

echo "Installing Python dependencies..."
pip install -r requirements.txt

echo "Running database migrations..."
python prestart.py

echo "Build complete."
