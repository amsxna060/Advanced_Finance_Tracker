FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# Make scripts executable
RUN chmod +x start.sh prestart.py

# Run migrations then start server with a single worker (appropriate for Render free tier)
# --reload is intentionally omitted — it wastes CPU/RAM in production
CMD ["sh", "-c", "python prestart.py && uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1"]
