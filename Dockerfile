FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json *.mjs ./
COPY weather-districts.json travel-airports.json ./
COPY public ./public
COPY extensions/listener-voice ./extensions/listener-voice
RUN mkdir data && chown -R node:node /app
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4310
EXPOSE 4310
VOLUME ["/app/data"]
CMD ["node", "server.mjs"]
