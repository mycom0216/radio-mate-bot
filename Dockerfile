FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json core.mjs server.mjs spoon.mjs ./
COPY public ./public
RUN mkdir data && chown -R node:node /app
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4310
EXPOSE 4310
VOLUME ["/app/data"]
CMD ["node", "server.mjs"]
