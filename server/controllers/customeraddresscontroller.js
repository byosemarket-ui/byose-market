const customerAddressService = require('../services/customeraddress.service');
const { appLogger } = require('../utils/logger');

const addressLogger = appLogger.child({ scope: 'customer-addresses' });

function sendError(res, error, fallbackMessage) {
    const status = Number(error?.statusCode || 500);
    if (status >= 500) {
        addressLogger.error('customer_address.failed', { error });
    }
    return res.status(status).json({
        success: false,
        message: error?.message || fallbackMessage,
        code: error?.code || 'ADDRESS_ERROR',
        details: error?.details || undefined
    });
}

function requireUser(req, res) {
    const userId = req.user && req.user.id;
    if (!userId) {
        res.status(401).json({ success: false, message: 'Unauthorized', code: 'UNAUTHORIZED' });
        return '';
    }
    return userId;
}

exports.list = async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;
        const addresses = await customerAddressService.listForUser(userId);
        return res.json({ success: true, addresses });
    } catch (error) {
        return sendError(res, error, 'Unable to load shipping addresses');
    }
};

exports.create = async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;
        const row = customerAddressService.createForUser(userId, req.body || {});
        return res.status(201).json({ success: true, address: customerAddressService.toClientAddress(row) });
    } catch (error) {
        return sendError(res, error, 'Unable to save shipping address');
    }
};

exports.update = async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;
        const row = customerAddressService.updateForUser(userId, req.params.id, req.body || {});
        return res.json({ success: true, address: customerAddressService.toClientAddress(row) });
    } catch (error) {
        return sendError(res, error, 'Unable to update shipping address');
    }
};

exports.remove = async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;
        const result = customerAddressService.removeForUser(userId, req.params.id);
        return res.json({ success: true, ...result });
    } catch (error) {
        return sendError(res, error, 'Unable to delete shipping address');
    }
};

exports.setDefault = async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;
        const row = customerAddressService.setDefaultForUser(userId, req.params.id);
        return res.json({ success: true, address: customerAddressService.toClientAddress(row) });
    } catch (error) {
        return sendError(res, error, 'Unable to set default shipping address');
    }
};
