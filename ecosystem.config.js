const path = require('path');
const dotenv = require('dotenv');
const { PRODUCTION_CORS_ORIGINS, PRODUCTION_SITE_ORIGIN, PRODUCTION_API_BASE_URL, VPS } = require('./config/production-targets');

const projectRoot = __dirname;
const deployRoot = process.env.DEPLOY_ROOT || projectRoot;
const uploadsRoot = process.env.UPLOADS_DIR || VPS.uploadsRoot || path.join(deployRoot, 'server/uploads');

dotenv.config({ path: path.join(projectRoot, '.env') });

function readEnv(name, fallback = '') {
  const value = String(process.env[name] || '').trim();
  return value || fallback;
}

module.exports = {
    apps: [
        {
            name: readEnv('PM2_APP_NAME', 'byosemarket-api'),
            script: 'server/server.js',
            cwd: projectRoot,
            instances: 1,
            exec_mode: 'fork',
            watch: false,
            max_memory_restart: '300M',
            out_file: 'logs/pm2-out.log',
            error_file: 'logs/pm2-error.log',
            env: {
                NODE_ENV: 'development',
                HOST: '0.0.0.0',
                PORT: 5000,
                DB_CLIENT: 'sqlite',
                SQLITE_DB_PATH: 'data/byosemarket.sqlite',
                UPLOADS_DIR: 'server/uploads',
                STORAGE_ROOT: 'server/uploads'
            },
            env_production: {
                NODE_ENV: 'production',
                HOST: readEnv('HOST', '0.0.0.0'),
                PORT: Number(readEnv('PORT', '5000')) || 5000,
                DB_CLIENT: readEnv('DB_CLIENT', 'sqlite'),
                SQLITE_DB_PATH: path.join(deployRoot, 'server/database/byosemarket.sqlite'),
                SQLITE_MIGRATIONS_DIR: path.join(deployRoot, 'server/database/sqlite/migrations'),
                UPLOADS_DIR: uploadsRoot,
                STORAGE_ROOT: uploadsRoot,
                UPLOADS_PUBLIC_PATH: readEnv('UPLOADS_PUBLIC_PATH', '/uploads'),
                APP_BASE_URL: readEnv('APP_BASE_URL', PRODUCTION_SITE_ORIGIN),
                API_BASE_URL: readEnv('API_BASE_URL', PRODUCTION_API_BASE_URL),
                CORS_ORIGINS: readEnv('CORS_ORIGINS', PRODUCTION_CORS_ORIGINS.join(',')),
                TRUST_PROXY: Number(readEnv('TRUST_PROXY', '1')) || 1,
                ADMIN_EMAIL: readEnv('ADMIN_EMAIL'),
                ADMIN_PASSWORD_HASH: readEnv('ADMIN_PASSWORD_HASH'),
                JWT_SECRET: readEnv('JWT_SECRET'),
                JWT_EXPIRES_IN: readEnv('JWT_EXPIRES_IN', '7d')
            }
        }
    ]
};
