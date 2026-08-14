FROM node:20-alpine

WORKDIR /app

COPY backend/package*.json ./
ARG TARGETARCH
RUN apk add --no-cache iputils curl ipmitool \
  && KVER=$(curl -fsSL https://dl.k8s.io/release/stable.txt) \
  && ARCH="${TARGETARCH:-amd64}" \
  && curl -fsSL "https://dl.k8s.io/release/${KVER}/bin/linux/${ARCH}/kubectl" -o /usr/local/bin/kubectl \
  && chmod +x /usr/local/bin/kubectl \
  && npm ci --omit=dev \
  # cpu-features (optional ssh2 dep) SIGILL-crashes Node on some hosts (exit 132, empty logs).
  && find node_modules -type d -name cpu-features -prune -print0 | xargs -0 -r rm -rf

COPY backend/src ./src
COPY database ./database

ENV NODE_ENV=production
ENV MIGRATIONS_DIR=/app/database/migrations
ENV PORT=3001

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
