const config = require('../config/env');
const ContactMessage = require('../models/contactmessage');
const User = require('../models/user');
const messageDataService = require('../services/messagedataservice');
const userDataService = require('../services/userdataservice');
const { appLogger } = require('../utils/logger');

function normalizeText(value) {
    return String(value || '').trim();
}

function normalizeEmail(value) {
    return normalizeText(value).toLowerCase();
}

function normalizePhone(value) {
    return String(value || '').replace(/\s+/g, '').trim();
}

function normalizeStatus(value) {
    const status = normalizeText(value).toLowerCase();
    if (status.includes('resolve') || status.includes('close')) {
        return 'Resolved';
    }
    if (status.includes('review') || status.includes('read')) {
        return 'Reviewed';
    }
    return 'New';
}

function serializeMessage(message) {
    const source = message && typeof message.toObject === 'function'
        ? message.toObject({ versionKey: false })
        : { ...(message || {}) };

    return {
        id: normalizeText(source.messageId || source.id || source._id),
        messageId: normalizeText(source.messageId || source.id || source._id),
        userId: normalizeText(source.userId),
        name: normalizeText(source.name) || 'Unknown sender',
        email: normalizeEmail(source.email),
        phone: normalizePhone(source.phone),
        message: normalizeText(source.message),
        source: normalizeText(source.source) || 'contact-form',
        status: normalizeStatus(source.status),
        createdAt: source.createdAt || new Date().toISOString(),
        updatedAt: source.updatedAt || source.createdAt || new Date().toISOString(),
        contactLabel: normalizeText(source.email || source.phone) || 'No contact info',
        meta: source.meta && typeof source.meta === 'object' ? source.meta : {}
    };
}

function isSqlite() {
    return config.databaseClient === 'sqlite';
}

function buildMessageId(payload) {
    const provided = normalizeText(payload?.id || payload?.messageId);
    if (provided) {
        return provided;
    }

    return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function resolveOptionalUser(req) {
    if (!req.user || !req.user.id) {
        return null;
    }

    if (isSqlite()) {
        try {
            return await userDataService.findUserById(req.user.id);
        } catch (_error) {
            return null;
        }
    }

    return User.findOne({ id: req.user.id });
}

exports.createMessage = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'contact_messages' });
    try {
        const user = await resolveOptionalUser(req);
        const name = normalizeText(req.body?.name);
        const email = normalizeEmail(req.body?.email);
        const phone = normalizePhone(req.body?.phone);
        const messageText = normalizeText(req.body?.message);

        if (!name || !messageText || (!email && !phone)) {
            return res.status(400).json({ success: false, message: 'Name, message, and email or phone are required' });
        }

        const payload = {
            messageId: buildMessageId(req.body || {}),
            userRecordId: user?.recordId || null,
            userId: normalizeText(user?.id || req.body?.userId),
            name,
            email,
            phone,
            message: messageText,
            source: normalizeText(req.body?.source) || 'contact-form',
            status: 'New',
            meta: req.body?.meta && typeof req.body.meta === 'object' ? req.body.meta : {}
        };

        if (isSqlite()) {
            const document = await messageDataService.createMessage(payload);
            return res.status(201).json({ success: true, message: serializeMessage(document) });
        }

        const document = await ContactMessage.create({
            messageId: payload.messageId,
            user: user?._id || null,
            userId: payload.userId,
            name,
            email,
            phone,
            message: messageText,
            source: payload.source,
            status: 'New',
            meta: payload.meta
        });

        return res.status(201).json({ success: true, message: serializeMessage(document) });
    } catch (error) {
        logger.error('messages.create_failed', { error });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.listAdminMessages = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'admin_messages' });
    try {
        const status = normalizeText(req.query?.status);
        const search = normalizeText(req.query?.search);
        const limit = Math.min(300, Math.max(1, Number(req.query?.limit || 100) || 100));
        const page = Math.max(1, Number(req.query?.page || 1) || 1);

        if (isSqlite()) {
            const messages = await messageDataService.listMessages({
                status: status && status.toLowerCase() !== 'all' ? normalizeStatus(status) : '',
                search,
                limit,
                page
            });
            return res.json({ success: true, messages: messages.map(serializeMessage) });
        }

        const query = {};
        if (status && status !== 'all') {
            query.status = normalizeStatus(status);
        }

        if (search) {
            query.$or = [
                { messageId: new RegExp(search, 'i') },
                { name: new RegExp(search, 'i') },
                { email: new RegExp(search, 'i') },
                { phone: new RegExp(search, 'i') },
                { message: new RegExp(search, 'i') }
            ];
        }

        const skip = (page - 1) * limit;
        const messages = await ContactMessage.find(query)
            .sort({ createdAt: -1, updatedAt: -1 })
            .skip(skip)
            .limit(limit)
            .select('messageId userId name email phone message source status meta createdAt updatedAt')
            .lean();
        return res.json({ success: true, messages: messages.map(serializeMessage) });
    } catch (error) {
        logger.error('admin.messages.list_failed', { error });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.getAdminMessageById = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'admin_messages' });
    try {
        const identifier = normalizeText(req.params.id);

        if (isSqlite()) {
            const message = await messageDataService.findMessageById(identifier);
            if (!message) {
                return res.status(404).json({ success: false, message: 'Message not found' });
            }
            return res.json({ success: true, message: serializeMessage(message) });
        }

        const message = await ContactMessage.findOne({ $or: [{ messageId: identifier }, { _id: identifier }] })
            .select('messageId userId name email phone message source status meta createdAt updatedAt')
            .lean()
            .catch(() => ContactMessage.findOne({ messageId: identifier })
                .select('messageId userId name email phone message source status meta createdAt updatedAt')
                .lean());
        if (!message) {
            return res.status(404).json({ success: false, message: 'Message not found' });
        }

        return res.json({ success: true, message: serializeMessage(message) });
    } catch (error) {
        logger.error('admin.messages.lookup_failed', { error, requestedMessageId: req.params.id });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.updateAdminMessage = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'admin_messages' });
    try {
        const identifier = normalizeText(req.params.id);

        if (isSqlite()) {
            const updates = {};
            if (Object.prototype.hasOwnProperty.call(req.body || {}, 'status')) {
                updates.status = normalizeStatus(req.body.status);
            }
            if (Object.prototype.hasOwnProperty.call(req.body || {}, 'name')) {
                updates.name = normalizeText(req.body.name);
            }
            if (Object.prototype.hasOwnProperty.call(req.body || {}, 'email')) {
                updates.email = normalizeEmail(req.body.email);
            }
            if (Object.prototype.hasOwnProperty.call(req.body || {}, 'phone')) {
                updates.phone = normalizePhone(req.body.phone);
            }
            if (Object.prototype.hasOwnProperty.call(req.body || {}, 'message')) {
                updates.message = normalizeText(req.body.message);
            }

            const message = await messageDataService.updateMessage(identifier, updates);
            if (!message) {
                return res.status(404).json({ success: false, message: 'Message not found' });
            }
            return res.json({ success: true, message: serializeMessage(message) });
        }

        const message = await ContactMessage.findOne({ messageId: identifier });
        if (!message) {
            return res.status(404).json({ success: false, message: 'Message not found' });
        }

        if (Object.prototype.hasOwnProperty.call(req.body || {}, 'status')) {
            message.status = normalizeStatus(req.body.status);
        }
        if (Object.prototype.hasOwnProperty.call(req.body || {}, 'name')) {
            message.name = normalizeText(req.body.name) || message.name;
        }
        if (Object.prototype.hasOwnProperty.call(req.body || {}, 'email')) {
            message.email = normalizeEmail(req.body.email);
        }
        if (Object.prototype.hasOwnProperty.call(req.body || {}, 'phone')) {
            message.phone = normalizePhone(req.body.phone);
        }
        if (Object.prototype.hasOwnProperty.call(req.body || {}, 'message')) {
            message.message = normalizeText(req.body.message) || message.message;
        }

        await message.save();
        return res.json({ success: true, message: serializeMessage(message) });
    } catch (error) {
        logger.error('admin.messages.update_failed', { error, requestedMessageId: req.params.id });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.deleteAdminMessage = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'admin_messages' });
    try {
        const identifier = normalizeText(req.params.id);

        if (isSqlite()) {
            const message = await messageDataService.deleteMessage(identifier);
            if (!message) {
                return res.status(404).json({ success: false, message: 'Message not found' });
            }
            return res.json({ success: true, messageId: identifier });
        }

        const message = await ContactMessage.findOneAndDelete({ messageId: identifier });
        if (!message) {
            return res.status(404).json({ success: false, message: 'Message not found' });
        }

        return res.json({ success: true, messageId: identifier });
    } catch (error) {
        logger.error('admin.messages.delete_failed', { error, requestedMessageId: req.params.id });
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};
