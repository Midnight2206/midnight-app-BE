#!/bin/sh
set -eu

ACTION="${1:-status}"
COMPOSE_FILE="docker-compose.dev.full.yml"
ENV_FILE=".env.dev"

if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD="docker-compose"
else
  echo "Docker Compose not found. Install Docker Desktop or docker-compose." >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE. Create it from .env.example first:" >&2
  echo "  cp .env.example $ENV_FILE" >&2
  exit 1
fi

case "$ACTION" in
  start)
    sh -c "$COMPOSE_CMD --env-file $ENV_FILE -f $COMPOSE_FILE up -d"
    ;;
  update)
    sh -c "$COMPOSE_CMD --env-file $ENV_FILE -f $COMPOSE_FILE up -d --remove-orphans"
    ;;
  stop)
    sh -c "$COMPOSE_CMD --env-file $ENV_FILE -f $COMPOSE_FILE stop"
    ;;
  down)
    sh -c "$COMPOSE_CMD --env-file $ENV_FILE -f $COMPOSE_FILE down"
    ;;
  logs)
    sh -c "$COMPOSE_CMD --env-file $ENV_FILE -f $COMPOSE_FILE logs -f"
    ;;
  status)
    sh -c "$COMPOSE_CMD --env-file $ENV_FILE -f $COMPOSE_FILE ps"
    ;;
  restart)
    sh -c "$COMPOSE_CMD --env-file $ENV_FILE -f $COMPOSE_FILE restart"
    ;;
  *)
    echo "Unknown action: $ACTION" >&2
    echo "Use: start | update | stop | down | logs | status | restart" >&2
    exit 1
    ;;
esac
