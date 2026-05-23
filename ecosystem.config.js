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
                DB_CLIENT: 'sqlite'
            },
            env_production: {
                NODE_ENV: 'production',
                HOST: '0.0.0.0',
                PORT: 5000,
                DB_CLIENT: process.env.DB_CLIENT || 'sqlite'
            }
        }
    ]
};