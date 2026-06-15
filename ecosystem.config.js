const { VPS, LEGACY_RENDER_ORIGIN, PRODUCTION_CORS_ORIGINS } = require('./config/production-targets');

module.exports = {
    apps: [
        {
            name: process.env.PM2_APP_NAME || 'byosemarket-api',
            script: 'server/server.js',
            cwd: __dirname,
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
                HOST: '0.0.0.0',
                PORT: VPS.apiPort,
                DB_CLIENT: process.env.DB_CLIENT || 'sqlite',
                SQLITE_DB_PATH: VPS.sqlitePath,
                SQLITE_MIGRATIONS_DIR: `${VPS.deployRoot}/server/database/sqlite/migrations`,
                UPLOADS_DIR: VPS.uploadsRoot,
                STORAGE_ROOT: VPS.uploadsRoot,
                UPLOADS_PUBLIC_PATH: VPS.publicUploadsPath,
                APP_BASE_URL: process.env.APP_BASE_URL || `http://${VPS.host}`,
                API_BASE_URL: process.env.API_BASE_URL || `http://${VPS.host}/api`,
                CORS_ORIGINS: process.env.CORS_ORIGINS || PRODUCTION_CORS_ORIGINS.join(','),
                TRUST_PROXY: 1
            }
        }
    ]
};