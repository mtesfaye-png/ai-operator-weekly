# Runs the n8n trigger server. No npm dependencies to install.
FROM node:22-alpine
WORKDIR /app
COPY . .
RUN rm -rf data out data-mock out-mock .env
ENV AOW_DATA_DIR=/data/data AOW_OUT_DIR=/data/out
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK CMD wget -qO- http://localhost:8787/health || exit 1
CMD ["node", "src/server.js"]
