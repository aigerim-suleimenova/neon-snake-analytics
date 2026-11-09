# The backend's image: the API (default), the ingestion worker and the archive worker, chosen by the command.
# Built from the repository root, as the backend uses the workspace's contract package:
#   docker build -t neon-snake-backend .
FROM node:22.18.0-slim
WORKDIR /app
RUN corepack enable
COPY . .
# The whole workspace from the root lockfile; tsx runs the TypeScript, as in development.
RUN pnpm install --frozen-lockfile
WORKDIR /app/backend
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0
USER node
CMD ["node", "--import", "tsx", "src/server.ts"]
