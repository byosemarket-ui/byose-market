const path = require('path');

const serverRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(serverRoot, '..');
const dataRoot = path.resolve(projectRoot, 'data');
const uploadsRoot = path.resolve(serverRoot, 'uploads');

module.exports = {
    serverRoot,
    projectRoot,
    dataRoot,
    uploadsRoot,
    sqlite: {
        root: path.resolve(serverRoot, 'database', 'sqlite'),
        migrations: path.resolve(serverRoot, 'database', 'sqlite', 'migrations'),
        repositories: path.resolve(serverRoot, 'repositories', 'sqlite'),
        databaseFile: path.resolve(dataRoot, 'byosemarket.sqlite')
    },
    uploads: {
        products: path.resolve(uploadsRoot, 'products'),
        categories: path.resolve(uploadsRoot, 'categories'),
        users: path.resolve(uploadsRoot, 'users'),
        reviews: path.resolve(uploadsRoot, 'reviews'),
        temp: path.resolve(uploadsRoot, 'temp')
    }
};