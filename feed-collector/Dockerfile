FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY feed-collector/requirements.txt feed-collector/requirements.txt
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r feed-collector/requirements.txt

COPY feed-collector/ feed-collector/

CMD ["python", "feed-collector/main.py", "--no-dry-run"]
