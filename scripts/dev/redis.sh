#!/bin/sh
set -eu

ACTION="${1:-status}"
COMPOSE_FILE="docker-compose.dev.yml"

if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD="docker-compose"
else
  echo "Docker Compose not found. Install Docker Desktop or docker-compose." >&2
  exit 1
fi

case "$ACTION" in
  start)
    sh -c "$COMPOSE_CMD -f $COMPOSE_FILE up -d redis"
    ;;
  stop)
    sh -c "$COMPOSE_CMD -f $COMPOSE_FILE stop redis"
    ;;
  down)
    sh -c "$COMPOSE_CMD -f $COMPOSE_FILE down"
    ;;
  logs)
    sh -c "$COMPOSE_CMD -f $COMPOSE_FILE logs -f redis"
    ;;
  status)
    sh -c "$COMPOSE_CMD -f $COMPOSE_FILE ps redis"
    ;;
  *)
    echo "Unknown action: $ACTION" >&2
    echo "Use: start | stop | down | logs | status" >&2
    exit 1
    ;;
esac
