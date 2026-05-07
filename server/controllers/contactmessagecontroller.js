const ContactMessage = require('../models/contactmessage');
const User = require('../models/user');

function normalizeText(value) {
    return String(value || '').trim();
}

function normalizeEmail(value) {
    return normalizeText(value).toLowerCase();
}

function normalizePhone(value) {
    const digits = String(value || '').replace(/\s+/g, '').trim();
    return digits;
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

async function resolveOptionalUser(req) {
    if (!req.user || !req.user.id) {
        return null;
    }

    return User.findOne({ id: req.user.id });
}

function buildMessageId(payload) {
    const provided = normalizeText(payload?.id || payload?.messageId);
    if (provided) {
        return provided;
    }

    return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

exports.createMessage = async (req, res) => {
    try {
        const user = await resolveOptionalUser(req);
        const name = normalizeText(req.body?.name);
        const email = normalizeEmail(req.body?.email);
        const phone = normalizePhone(req.body?.phone);
        const messageText = normalizeText(req.body?.message);

        if (!name || !messageText || (!email && !phone)) {
            return res.status(400).json({ success: false, message: 'Name, message, and email or phone are required' });
        }

        const document = await ContactMessage.create({
            messageId: buildMessageId(req.body || {}),
            user: user?._id || null,
            userId: normalizeText(user?.id || req.body?.userId),
            name,
            email,
            phone,
            message: messageText,
            source: normalizeText(req.body?.source) || 'contact-form',
            status: 'New',
            meta: req.body?.meta && typeof req.body.meta === 'object' ? req.body.meta : {}
        });

        return res.status(201).json({ success: true, message: serializeMessage(document) });
    } catch (error) {
        console.error('createMessage error', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.listAdminMessages = async (req, res) => {
    try {
        const query = {};
        const status = normalizeText(req.query?.status);
        if (status && status !== 'all') {
            query.status = normalizeStatus(status);
        }

        const search = normalizeText(req.query?.search);
        if (search) {
            query.$or = [
                { messageId: new RegExp(search, 'i') },
                { name: new RegExp(search, 'i') },
                { email: new RegExp(search, 'i') },
                { phone: new RegExp(search, 'i') },
                { message: new RegExp(search, 'i') }
            ];
        }

        const limit = Math.min(300, Math.max(1, Number(req.query?.limit || 100) || 100));
        const messages = await ContactMessage.find(query).sort({ createdAt: -1, updatedAt: -1 }).limit(limit);
        return res.json({ success: true, messages: messages.map(serializeMessage) });
    } catch (error) {
        console.error('listAdminMessages error', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.getAdminMessageById = async (req, res) => {
    try {
        const identifier = normalizeText(req.params.id);
        const message = await ContactMessage.findOne({ $or: [{ messageId: identifier }, { _id: identifier }] }).catch(() => ContactMessage.findOne({ messageId: identifier }));
        if (!message) {
            return res.status(404).json({ success: false, message: 'Message not found' });
        }

        return res.json({ success: true, message: serializeMessage(message) });
    } catch (error) {
        console.error('getAdminMessageById error', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.updateAdminMessage = async (req, res) => {
    try {
        const identifier = normalizeText(req.params.id);
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
        console.error('updateAdminMessage error', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.deleteAdminMessage = async (req, res) => {
    try {
        const identifier = normalizeText(req.params.id);
        const message = await ContactMessage.findOneAndDelete({ messageId: identifier });
        if (!message) {
            return res.status(404).json({ success: false, message: 'Message not found' });
        }

        return res.json({ success: true, messageId: identifier });
    } catch (error) {
        console.error('deleteAdminMessage error', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};