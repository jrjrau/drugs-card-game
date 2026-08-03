FROM node:22-alpine

WORKDIR /app

# Full install (incl. esbuild) to bundle the Discord SDK, then prune to prod
COPY package.json package-lock.json* ./
RUN npm install

COPY server.js sdk-entry.js ./
COPY public ./public
RUN npm run build && npm prune --omit=dev

ENV PORT=3000
ENV DATA_DIR=/app/data
RUN mkdir -p /app/data && chown node:node /app/data
EXPOSE 3000

# Run as the non-root user bundled with the node image
USER node

CMD ["node", "server.js"]
