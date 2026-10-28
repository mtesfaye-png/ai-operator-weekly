# Runs the n8n trigger server. No npm dependencies to install.
# Secrets come from the environment at run time; .dockerignore keeps .env and data out of the image.
FROM node:22-alpine
WORKDIR /app
COPY . .
RUN rm -rf data out data-mock out-mock .env && mkdir -p /data && chown node:node /data
USER node
# HOST=0.0.0.0 is inside the container only; docker-compose publishes the port on 127.0.0.1.
ENV AOW_DATA_DIR=/data/data AOW_OUT_DIR=/data/out HOST=0.0.0.0
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK CMD wget -qO- http://127.0.0.1:8787/health || exit 1
CMD ["node", "src/server.js"]
