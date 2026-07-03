# Crew of One — single-service deployment (static files + websockets)
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY shared ./shared
COPY public ./public
EXPOSE 3000
CMD ["node", "server/index.js"]
