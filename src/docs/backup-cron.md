# Backup Cron (DB -> Gzip -> Encrypt -> Google Drive -> Email)

## 1) Required env

- `BACKUP_CRON_ENABLED=true`
- `BACKUP_CRON=0 2 * * *` (5-field cron, local timezone of server/container)
- `BACKUP_ENCRYPTION_KEY=...` (secret for AES-256-GCM key derivation)
- `GDRIVE_FOLDER_ID=...`

**Google Drive auth (chọn một trong hai):**

- **Khuyến nghị — dùng biến môi trường:**  
  `GDRIVE_SERVICE_ACCOUNT_EMAIL=...` và `GDRIVE_PRIVATE_KEY=...` (private key dạng chuỗi, `\n` escaped). Không cần file JSON trong repo.
- **Legacy — file service account:**  
  `GOOGLE_SERVICE_ACCOUNT_KEY=./path/to/key.json`. **Không được commit file này vào git.** Thêm `google-service-account.json` (và mọi đường dẫn key) vào `.gitignore`. Ưu tiên chuyển sang `GDRIVE_SERVICE_ACCOUNT_EMAIL` + `GDRIVE_PRIVATE_KEY` khi có thể.

## 2) Optional env

- `BACKUP_RUN_ON_BOOT=false`
- `BACKUP_WORK_DIR=/tmp/f8-backups`
- `BACKUP_KEEP_LOCAL_FILES=2`
- `BACKUP_MYSQLDUMP_BIN=mysqldump`
- `BACKUP_MYSQL_BIN=mysql`
- `BACKUP_NOTIFY_EMAILS=a@example.com,b@example.com`
- `BACKUP_RESTORE_FILE_ID=<drive_file_id>`
- `GDRIVE_TOKEN_URI=https://oauth2.googleapis.com/token`
- `GDRIVE_SCOPE=https://www.googleapis.com/auth/drive.file`
- `ADMIN_EMAIL=...` (legacy mail fallback)

## 3) Recipient emails

Backup report email is sent to:

1. all active users with role `SUPER_ADMIN` from database
2. `BACKUP_NOTIFY_EMAILS` (if configured)
3. `SUPER_ADMIN_EMAIL` (fallback/additional)
4. `ADMIN_EMAIL` (legacy fallback)

## 4) Notes

- Backup file format: `*.sql.gz.enc`
- Encryption: AES-256-GCM
- File is uploaded to Google Drive folder configured by `GDRIVE_FOLDER_ID`
- SQL and Gzip temp files are removed after each run

## 5) Docker packaging

In `docker-compose.prod.yml` there is a dedicated `backup` service:

- runs `node ./backupWorker.js`
- has `BACKUP_CRON_ENABLED=true`
- uses shared env from `.env.prod`
- keeps local encrypted files in volume mounted to `/tmp/f8-backups`

API container has `BACKUP_CRON_ENABLED=false` to avoid duplicate scheduling.

## 6) Restore database

Restore by Google Drive file ID:

```bash
npm run backup:restore -- --fileId=<drive_file_id>
```

or set env:

- `BACKUP_RESTORE_FILE_ID=<drive_file_id>`

then run:

```bash
npm run backup:restore
```

Restore flow:

1. download encrypted backup from Google Drive
2. decrypt `AES-256-GCM`
3. gunzip SQL
4. import SQL into configured MySQL database

## 7) Super admin API (for FE)

- `GET /api/backups?pageSize=30&pageToken=...`: list backup files from Drive
- `POST /api/backups/run`: trigger manual backup now
- `POST /api/backups/restore`: restore database from Drive file

Request body for restore:

```json
{
  "fileId": "<google_drive_file_id>",
  "fileName": "optional-file-name.sql.gz.enc"
}
```
