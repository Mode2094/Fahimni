# syntax=docker/dockerfile:1
# Fahimni production image: Next.js web + indexing worker share one image.
# Contains Node 22, pnpm and Python 3 + PyMuPDF for the book indexing pipeline.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
RUN corepack enable \
  && apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN pip3 install --no-cache-dir --break-system-packages pymupdf==1.28.2
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build:next

FROM build AS runner
ENV NODE_ENV=production
ENV PORT=3100
ENV HOSTNAME=0.0.0.0
ENV INDEX_PYTHON_BIN=python3
EXPOSE 3100
CMD ["node_modules/.bin/next", "start", "--hostname", "0.0.0.0", "--port", "3100"]
