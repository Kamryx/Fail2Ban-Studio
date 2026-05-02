FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY server.mjs ./
COPY backend ./backend
COPY public ./public

ENV PORT=8080
ENV FAIL2BAN_CONFIG_DIR=/data/fail2ban
ENV FAIL2BAN_CONTAINER_NAME=fail2ban
ENV DOCKER_SOCKET_PATH=/var/run/docker.sock
ENV MANAGED_CONFIG_NAME=zz-fail2ban-studio.local
ENV UI_STATE_NAME=fail2ban-studio-state.json

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/state >/dev/null || exit 1

CMD ["node", "server.mjs"]
