# VPS SQLite & Local Storage Setup

Target environment: InterServer Ubuntu 24.04 VPS

- **VPS ID:** vps3407735
- **Host Server:** KVM509
- **IP Address:** 153.75.227.160
- **SSH:** `ssh root@153.75.227.160`
- **Deploy root:** `/var/www/byosemarket/`
- **SQLite DB:** `/var/www/byosemarket/server/database/byosemarket.sqlite`
- **Uploads root:** `/var/www/byosemarket/server/uploads/`

## Architecture

```
Admin Add Product (browser)
  → POST /api/uploads/products        (JWT auth)
  → files saved to /var/www/byosemarket/server/uploads/products/
  → POST /api/admin/products          (product + image paths)
  → SQLite at /var/www/byosemarket/server/database/byosemarket.sqlite
  → GET /api/products                 (storefront catalog sync)
  → GET /uploads/products/{uuid}.png  (public image serving)
```

When the site is served from the VPS (IP or domain), the frontend uses **same-origin** `/api` automatically via `config/runtime-api-bootstrap.js`.

## 1. Prerequisites

```bash
sudo mkdir -p /var/www/byosemarket
sudo chown -R $USER:$USER /var/www/byosemarket
cd /var/www/byosemarket
npm ci --production
mkdir -p server/database server/uploads/{products,categories,users,reviews,temp} data logs
```

## 2. Environment variables

Create `/var/www/byosemarket/.env`:

```env
NODE_ENV=production
HOST=0.0.0.0
PORT=5000
DB_CLIENT=sqlite
SQLITE_DB_PATH=/var/www/byosemarket/server/database/byosemarket.sqlite
SQLITE_MIGRATIONS_DIR=/var/www/byosemarket/server/database/sqlite/migrations
UPLOADS_DIR=/var/www/byosemarket/server/uploads
STORAGE_ROOT=/var/www/byosemarket/server/uploads
UPLOADS_PUBLIC_PATH=/uploads
APP_BASE_URL=http://153.75.227.160
API_BASE_URL=http://153.75.227.160/api
TRUST_PROXY=1
JWT_SECRET=<secure-random-secret>
ADMIN_EMAIL=<admin email>
ADMIN_PASSWORD_HASH=<bcrypt hash>
CORS_ORIGINS=http://153.75.227.160,https://153.75.227.160,http://153.75.227.160:5000,https://byosemarket.com,https://www.byosemarket.com
```

Migrations run automatically on startup via `server/database/providers/sqlite.provider.js`.

## 3. Process manager

```bash
cd /var/www/byosemarket
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup
```

Or systemd (see previous section in this doc).

## 4. Nginx reverse proxy (recommended)

```nginx
server {
    listen 80;
    server_name 153.75.227.160 byosemarket.com www.byosemarket.com;

    root /var/www/byosemarket;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:5000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 10M;
    }

    location /uploads/ {
        proxy_pass http://127.0.0.1:5000/uploads/;
        proxy_set_header Host $host;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

## 5. Verify deployment

On the VPS:

```bash
curl http://127.0.0.1:5000/healthz
curl http://127.0.0.1:5000/api/uploads/health
node server/scripts/verify-upload-flow.js
node server/scripts/verify-vps-production-config.js
```

## 6. Admin product workflow check

1. Open `http://153.75.227.160/admin/dashboard.html#/products?view=create&step=info`
2. Sign in with admin credentials
3. Upload main + gallery images on the Media step
4. Save on Review
5. Confirm success → View Product
6. Verify image URL resolves to `/uploads/products/...`
7. Confirm product appears on homepage/shop after catalog sync

## Persistence notes

- Uploads and SQLite must live on the VPS disk paths above (not inside `/tmp`).
- Do **not** point admin API calls to Render when running on the VPS.
- After server restart, files remain in `/var/www/byosemarket/server/uploads/` and data in SQLite.
