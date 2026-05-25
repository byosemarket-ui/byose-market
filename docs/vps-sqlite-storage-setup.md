# VPS SQLite & Local Storage Setup

Target environment: InterServer Ubuntu 24.04 VPS

- **SSH:** `ssh root@153.75.227.160`
- **Deploy root:** `/var/www/byosemarket/`
- **SQLite DB:** `/var/www/byosemarket/server/database/byosemarket.sqlite`
- **Uploads root:** `/var/www/byosemarket/server/uploads/`

## 1. Prerequisites

```bash
# create deployment root
sudo mkdir -p /var/www/byosemarket
sudo chown -R root:root /var/www/byosemarket

# install Node dependencies
cd /var/www/byosemarket
npm ci --production

# create SQLite database & upload directories
mkdir -p server/database
mkdir -p server/uploads/{products,categories,users,reviews,temp}
```

## 2. Environment variables

Create `/var/www/byosemarket/.env`:
```env
NODE_ENV=production
HOST=0.0.0.0
PORT=5000
DB_CLIENT=sqlite
SQLITE_DB_PATH=/var/www/byosemarket/server/database/byosemarket.sqlite
UPLOADS_DIR=/var/www/byosemarket/server/uploads
STORAGE_ROOT=/var/www/byosemarket/server/uploads
UPLOADS_PUBLIC_PATH=/uploads
# optional
TRUST_PROXY=1
JWT_SECRET=<set secure secret>
ADMIN_EMAIL=<admin email>
ADMIN_PASSWORD_HASH=<bcrypt hash>
```

Apply migrations automatically on start (handled by `server/database/providers/sqlite.provider.js`).

## 3. System service

Create `/etc/systemd/system/byosemarket.service`:
```ini
[Unit]
Description=Byose Market API
After=network.target

[Service]
WorkingDirectory=/var/www/byosemarket
ExecStart=/usr/bin/node server/server.js
Restart=always
Environment=NODE_ENV=production
EnvironmentFile=/var/www/byosemarket/.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable byosemarket
sudo systemctl start byosemarket
```

The API exposes uploads at `https://<domain>/uploads/...`.
