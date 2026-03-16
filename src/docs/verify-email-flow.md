# Verify Email Flow (BullMQ + Redis)

## Kiến trúc

- Queue engine: `BullMQ`
- Broker/store: `Redis`
- Worker loader: tự động quét `src/jobs/*.job.js`
- API process: chỉ enqueue job
- Worker process: chạy riêng tại `worker.js`

## Cách load job tự động

- Loader ở `src/jobs/index.js`
- Mỗi file `*.job.js` cần export default object:
  - `queueName`
  - `jobName`
  - `processor(job)`
  - tùy chọn: `concurrency`, `defaultJobOptions`

## Verify email jobs

- File: `src/jobs/verify-email.job.js`
- Queue: `email.verify`
- Job: `send-verify-email`

## Endpoints

- `POST /api/auth/verify-email/request` (authenticated)
  - tạo token verify email
  - enqueue job gửi email vào BullMQ
- `POST /api/auth/verify-email/test` (authenticated)
  - gửi mail test ngay lập tức (không qua queue)
  - body tùy chọn: `{ "to": "you@example.com" }`
- `GET /api/auth/verify-email/confirm?token=...` (public)
  - xác thực token
  - cập nhật `users.verifiedAt`

## ENV

```env
# Redis
REDIS_URL=redis://127.0.0.1:6379
# Hoặc dùng host/port
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_USERNAME=
REDIS_PASSWORD=
REDIS_DB=0

# Verify email delivery
EMAIL_DELIVERY_MODE=log
EMAIL_WEBHOOK_URL=
EMAIL_FROM=

# Gmail mode
GMAIL_USER=
GMAIL_APP_PASSWORD=

# SMTP mode
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=

VERIFY_EMAIL_COOLDOWN_MS=60000
FRONTEND_APP_URL=http://localhost:5173

# Job tuning
VERIFY_EMAIL_JOB_CONCURRENCY=2
VERIFY_EMAIL_JOB_ATTEMPTS=3
VERIFY_EMAIL_JOB_BACKOFF_MS=1000
```

## Lưu ý

- `EMAIL_DELIVERY_MODE=log`: không gửi mail thật, chỉ log link verify
- `EMAIL_DELIVERY_MODE=webhook`: gửi payload mail sang `EMAIL_WEBHOOK_URL`
- `EMAIL_DELIVERY_MODE=gmail`: gửi mail thật qua Gmail (App Password)
- `EMAIL_DELIVERY_MODE=smtp`: gửi mail qua SMTP server bất kỳ
