# Self-host Production on Personal Server (Clone -> Run)

## 1) Chuẩn bị máy chủ

- OS khuyến nghị: Ubuntu Server 22.04/24.04 LTS
- Cài Docker + Docker Compose plugin
- DNS trỏ domain backend về IP public của máy
- `nginx` trên server sẽ reverse proxy về backend ở `127.0.0.1:3000`
- Mở port `80, 443` trên router/firewall cho `nginx`

## 2) Clone và cấu hình

```bash
git clone <your-repo-url> F8-NODEJS
cd F8-NODEJS
```

Copy `.env.example` thành `.env.prod` (hoặc tạo `.env.prod`), rồi sửa:

```bash
cp .env.example .env.prod
```

- Có thể dùng cùng template này cho local:

```bash
cp .env.example .env.dev
```

- `API_DOMAIN`, `FRONTEND_APP_URL`, `ALLOW_ORIGIN`
- Toàn bộ secret/password. **Không commit file `.env.prod`** (đã có trong `.gitignore`).
- Google Drive: nên dùng `GDRIVE_SERVICE_ACCOUNT_EMAIL` + `GDRIVE_PRIVATE_KEY` thay vì file JSON; nếu dùng file thì không đưa file key vào repo.

## 3) Chạy stack production

```bash
npm run prod:start
```

Stack production sẽ chạy:
- `mysql`
- `redis`
- `api` trên port host `3000`
- `backup`

Backend không còn tự kèm `caddy`; `nginx` hệ thống sẽ nhận traffic ngoài và proxy vào `127.0.0.1:3000`.

Lần cập nhật tiếp theo chỉ cần:

```bash
git pull
npm run prod:update
```

Kiểm tra:

```bash
npm run prod:status
npm run prod:logs
```

## 4) Cập nhật phiên bản mới

```bash
git pull
npm run prod:update
```

## 5) Quy trình đồng bộ Dev/Prod

- Local development (code liên tục): `npm run dev:full:start`
- Khi đổi code local: dùng hot reload, nếu có đổi service/compose thì chạy `npm run dev:full:update`
- Khi deploy server:
  1. `git pull`
  2. `npm run prod:update`
- Mọi lệnh quản trị prod:
  - `npm run prod:status`
  - `npm run prod:logs`
  - `npm run prod:restart`
  - `npm run prod:stop`
  - `npm run prod:down`

## 6) Backup tối thiểu

### Backup MySQL

```bash
docker exec -i f8-nodejs-prod-mysql-1 \
  mysqldump -u"$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" > backup.sql
```

### Backup volume Redis (AOF)

```bash
docker run --rm \
  -v f8-nodejs-prod_redis_data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/redis_data_backup.tar.gz -C /data .
```

## 7) Cách hệ thống chạy sau khi boot

- `api` container sẽ:
  1. chạy `prisma migrate deploy`
  2. bootstrap super admin (idempotent)
  3. start app server
- `backup` container cũng sẽ tự chờ DB + chạy migrate trước khi start worker backup
- `server.js` sẽ start BullMQ workers tự load toàn bộ `src/jobs/*.job.js`

## 8) Troubleshooting nhanh

- Lỗi reverse proxy: kiểm tra `nginx` đang trỏ về `127.0.0.1:3000`
- Lỗi SSL: kiểm tra DNS trỏ đúng và `nginx` đang nghe port 80/443
- Lỗi DB: xem log `mysql` + kiểm tra `DB_*` trong `.env.prod`
- Lỗi queue: kiểm tra log `redis` và `api` (BullMQ/Redis connection)
- Lỗi email:
  - `EMAIL_DELIVERY_MODE=gmail`: cần bật 2FA tài khoản Gmail + tạo App Password
  - kiểm tra `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `EMAIL_FROM`

## 9) Cấu hình nginx mẫu

```nginx
server {
    listen 80;
    server_name api.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
