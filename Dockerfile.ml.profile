FROM python:3.11-slim

LABEL org.opencontainers.image.source="https://github.com/TradeJS-Dev/TradeJS" \
      org.opencontainers.image.description="TradeJS ML profiling image" \
      org.opencontainers.image.licenses="BUSL-1.1"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential cmake ninja-build \
  && rm -rf /var/lib/apt/lists/*

COPY packages/ml/python/requirements.profile.txt /app/ml/requirements.profile.txt
RUN pip install \
  --no-cache-dir \
  --default-timeout=120 \
  --retries=10 \
  -r /app/ml/requirements.profile.txt

COPY packages/ml/python /app/ml

CMD ["python", "/app/ml/profile.py", "--help"]
