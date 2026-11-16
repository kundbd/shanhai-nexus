FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ARG SITE_URL=http://localhost:3000
ENV SITE_URL=${SITE_URL}
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM dependencies AS directory-ops
COPY --chown=node:node scripts/merchant-directory.ts ./scripts/merchant-directory.ts
COPY --chown=node:node scripts/directory-refresh.ts ./scripts/directory-refresh.ts
COPY --chown=node:node lib/directory ./lib/directory
COPY --chown=node:node content/directory-seed.json ./content/directory-seed.json
COPY --chown=node:node tsconfig.json ./
RUN install -d -o node -g node /app/data
USER node
ENV DB_PATH=/app/data/directory.sqlite
ENTRYPOINT ["npm", "run", "directory:batch", "--"]

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ARG SITE_URL=https://shanhainexus.com
ENV SITE_URL=${SITE_URL}
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --chown=node:node scripts/backup-directory.mjs ./scripts/backup-directory.mjs
RUN install -d -o node -g node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD ["node","-e","fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]
