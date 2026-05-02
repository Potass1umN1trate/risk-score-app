FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY feed_collector/requirements.txt feed_collector/requirements.txt
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r feed_collector/requirements.txt

COPY feed_collector/ feed_collector/

CMD ["python", "feed_collector/main.py", "--no-dry-run"]
