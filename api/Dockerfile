# Build context is the repo root (see docker-compose.yml).
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
# Identity + bind-mount ownership for the git timestamp witness (GitCommit).
RUN git config --system user.name "Fair Drop seal" && git config --system user.email "seal@fairdrop.invalid" && git config --system --add safe.directory '*'
WORKDIR /srv
COPY api/requirements.txt api/requirements.txt
RUN pip install --no-cache-dir -r api/requirements.txt
COPY common common
RUN pip install --no-cache-dir ./common
COPY contracts contracts
COPY scripts scripts
COPY api api

WORKDIR /srv/api
EXPOSE 8000
CMD python -m app.migrate && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
