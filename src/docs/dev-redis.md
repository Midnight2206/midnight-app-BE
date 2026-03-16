# Redis Dev Quick Start (Docker)

## Start

```bash
npm run dev:redis:start
```

## Check status

```bash
npm run dev:redis:status
```

## View logs

```bash
npm run dev:redis:logs
```

## Stop

```bash
npm run dev:redis:stop
```

## Remove stack

```bash
npm run dev:redis:down
```

## Notes

- Script tự detect `docker compose` hoặc `docker-compose`
- Redis chạy ở `127.0.0.1:6379`
- Dữ liệu lưu trong volume Docker: `redis_dev_data`
- Dùng xong thì stop/down để giảm RAM/CPU
