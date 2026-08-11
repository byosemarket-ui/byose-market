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

const productionPort = Number(readEnv('PORT', '5000')) || 5000;
const nodeOptions = [
  readEnv('NODE_OPTIONS'),
  '--max-old-space-size=384',
  '--dns-result-order=ipv4first'
].filter(Boolean).join(' ').trim();

module.exports = {
    apps: [
        {
            name: readEnv('PM2_APP_NAME', 'byosemarket-api'),
            script: 'server/server.js',
            cwd: projectRoot,
            instances: 1,
            exec_mode: 'fork',
            watch: false,
            max_memory_restart: '350M',
            min_uptime: '10s',
            max_restarts: 20,
            restart_delay: 3000,
            kill_timeout: 8000,
            listen_timeout: 10000,
            exp_backoff_restart_delay: 200,
            out_file: 'logs/pm2-out.log',
            error_file: 'logs/pm2-error.log',
            merge_logs: true,
            time: true,
            env: {
                NODE_ENV: 'development',
                HOST: '0.0.0.0',
                PORT: 5000,
                DB_CLIENT: 'sqlite',
                SQLITE_DB_PATH: 'server/database/byosemarket.sqlite',
                UPLOADS_DIR: 'server/uploads',
                STORAGE_ROOT: 'server/uploads',
                NODE_OPTIONS: '--dns-result-order=ipv4first'
            },
            env_production: {
                NODE_ENV: 'production',
                HOST: readEnv('HOST', '127.0.0.1'),
                PORT: productionPort,
                DB_CLIENT: readEnv('DB_CLIENT', 'sqlite'),
                SQLITE_ENABLED: readEnv('SQLITE_ENABLED', 'true'),
                SQLITE_DB_PATH: readEnv('SQLITE_DB_PATH', path.join(deployRoot, 'server/database/byosemarket.sqlite')),
                SQLITE_MIGRATIONS_DIR: readEnv('SQLITE_MIGRATIONS_DIR', path.join(deployRoot, 'server/database/sqlite/migrations')),
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
                PAYMENT_ENCRYPTION_KEY: readEnv('PAYMENT_ENCRYPTION_KEY'),
                JWT_EXPIRES_IN: readEnv('JWT_EXPIRES_IN', '7d'),
                LOG_LEVEL: readEnv('LOG_LEVEL', 'info'),
                NODE_OPTIONS: nodeOptions
            }
        }
    ]
};
