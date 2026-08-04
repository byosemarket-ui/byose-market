const { getRepositoryBundle } = require('../repositories');

function getRepos() {
    const repositories = getRepositoryBundle();
    if (!repositories.messages) {
        throw new Error('Message data service requires the SQLite repository bundle.');
    }

    return repositories;
}

async function createMessage(payload) {
    return getRepos().messages.create(payload);
}

async function listMessages(options) {
    return getRepos().messages.list(options);
}

async function findMessageById(messageId) {
    return getRepos().messages.findByMessageId(messageId);
}

async function updateMessage(messageId, updates) {
    return getRepos().messages.update(messageId, updates);
}

async function deleteMessage(messageId) {
    return getRepos().messages.deleteByMessageId(messageId);
}

async function countMessages(options) {
    return getRepos().messages.count(options);
}

module.exports = {
    countMessages,
    createMessage,
    deleteMessage,
    findMessageById,
    listMessages,
    updateMessage
};
