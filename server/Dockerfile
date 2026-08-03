FROM node:22-alpine

WORKDIR /app

# Install dependencies first so they cache separately from code changes
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server.js ./
COPY public ./public

ENV PORT=3000
ENV DATA_DIR=/app/data
RUN mkdir -p /app/data && chown node:node /app/data
EXPOSE 3000

# Run as the non-root user bundled with the node image
USER node

CMD ["node", "server.js"]
