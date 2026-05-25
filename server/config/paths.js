const path = require('path');

const serverRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(serverRoot, '..');
const databaseRoot = path.resolve(serverRoot, 'database');
const uploadsRoot = path.resolve(serverRoot, 'uploads');

module.exports = {
    serverRoot,
    projectRoot,
    databaseRoot,
    // legacy alias retained for backwards compatibility
    dataRoot: databaseRoot,
    uploadsRoot,
    sqlite: {
        root: path.resolve(databaseRoot, 'sqlite'),
        migrations: path.resolve(databaseRoot, 'sqlite', 'migrations'),
        repositories: path.resolve(serverRoot, 'repositories', 'sqlite'),
        databaseFile: path.resolve(databaseRoot, 'byosemarket.sqlite')
    },


    uploads: {
        products: path.resolve(uploadsRoot, 'products'),
        categories: path.resolve(uploadsRoot, 'categories'),
        users: path.resolve(uploadsRoot, 'users'),
        reviews: path.resolve(uploadsRoot, 'reviews'),
        temp: path.resolve(uploadsRoot, 'temp')
    }
};