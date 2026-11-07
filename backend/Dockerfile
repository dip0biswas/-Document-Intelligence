FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN npm ci --workspace=@document-intelligence/backend --include-workspace-root=false --no-audit --no-fund
COPY backend/tsconfig.json ./backend/tsconfig.json
COPY backend/src ./backend/src
RUN npm run build --workspace=@document-intelligence/backend && npm prune --workspace=@document-intelligence/backend --omit=dev --include-workspace-root=false
WORKDIR /app/backend
CMD ["node", "dist/server.js"]
