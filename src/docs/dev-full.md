# Full Dev Stack (Docker Desktop)

## Cấu hình env

Copy `.env.example` thành `.env.dev` (hoặc tạo `.env.dev`), điền giá trị thật. Xem `.env.example` để biết biến bắt buộc/khuyến nghị.

## Muc tieu

Chay toan bo stack local bang Docker:
- MySQL
- Redis
- API (Node.js)
- Worker (BullMQ)

Compose file: `docker-compose.dev.full.yml`

## Lenh nhanh

```bash
npm run dev:full:start
npm run dev:full:status
npm run dev:full:logs
npm run dev:full:stop
npm run dev:full:down
```

## Truy cap

- API: `http://localhost:3000`
- MySQL: `127.0.0.1:3306`
- Redis: `127.0.0.1:6379`

## Quan ly bang Docker Desktop

Ban co the quan ly gan nhu toan bo bang Docker Desktop:
- Containers: start/stop/restart, xem logs, exec shell
- Images
- Volumes
- Networks

Khuyen nghi: van giu npm scripts o tren de team co cung mot cach chay, Docker Desktop dung de quan sat/quan tri truc quan.
