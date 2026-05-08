# Google Cloud Run (and other container hosts)
FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public

ENV NODE_ENV=production
# Cloud Run injects PORT; app falls back to 3000 locally
EXPOSE 8080

CMD ["node", "src/server.js"]
