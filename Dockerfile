# Single container: API, Socket.IO and the built client on one port, plus Python for YouTube transcripts.
FROM node:22-slim
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl python3 python3-pip \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY server/requirements.txt server/requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages -r server/requirements.txt

COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY server/prisma server/prisma
COPY client/package.json client/
RUN npm ci
COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV API_PORT=4000
ENV DATABASE_URL=file:/data/classroom.db
VOLUME /data
EXPOSE 4000
WORKDIR /app/server
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD node -e "fetch('http://localhost:4000/api/health').then((r) => { process.exitCode = r.ok ? 0 : 1; }, () => { process.exitCode = 1; })"
# Every start: apply migrations, load Ashray Akruti's YouTube lessons into an empty library, then serve.
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx prisma/import.ts ../resources/ashray-akruti-youtube.csv --if-empty && exec node dist/index.js"]
