FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential cmake ninja-build \
  && rm -rf /var/lib/apt/lists/*

COPY ml/requirements.profile.txt /app/ml/requirements.profile.txt
RUN pip install \
  --no-cache-dir \
  --default-timeout=120 \
  --retries=10 \
  -r /app/ml/requirements.profile.txt

COPY ml /app/ml

CMD ["python", "/app/ml/profile.py", "--help"]
