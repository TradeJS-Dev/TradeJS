FROM python:3.11-slim

LABEL org.opencontainers.image.source="https://github.com/TradeJS-Dev/TradeJS" \
      org.opencontainers.image.description="TradeJS ML training image" \
      org.opencontainers.image.licenses="BUSL-1.1"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential \
  && rm -rf /var/lib/apt/lists/*

COPY packages/ml/python/requirements.txt /app/ml/requirements.txt
RUN pip install \
  --no-cache-dir \
  --default-timeout=120 \
  --retries=10 \
  -r /app/ml/requirements.txt

COPY packages/ml/python /app/ml

CMD ["python", "/app/ml/train.py", "--help"]
