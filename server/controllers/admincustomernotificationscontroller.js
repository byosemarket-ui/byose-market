const customerNotificationDataService = require('../services/customernotificationdataservice');
const userDataService = require('../services/userdataservice');
const orderDataService = require('../services/orderdataservice');
const { findProductByIdentifier } = require('../services/productdataservice');
const { createRateLimiter } = require('../middleware/ratelimiter');
const { appLogger } = require('../utils/logger');

const mutationLimiter = createRateLimiter({
    windowMs: 5 * 60 * 1000,
    max: 60,
    code: 'ADMIN_CUSTOMER_NOTIFICATION_RATE_LIMITED',
    message: 'Too many customer notification requests. Please retry shortly.'
});

const VALID_CATEGORIES = new Set([
    'general',
    'important',
    'promotion',
    'order',
    'account',
    'product'
]);

const TITLE_MAX = 120;
const BODY_MAX = 2000;

function normalizeText(value) {
    return String(value || '').trim();
}

function validationError(message, details) {
    const error = new Error(message);
    error.statusCode = 400;
    error.code = 'CUSTOMER_NOTIFICATION_VALIDATION_FAILED';
    error.details = details;
    return error;
}

async function resolveCustomer(identifier) {
    const user = await userDataService.findUserByIdentifier(identifier, { includeAdmins: false });
    if (!user || user.role === 'admin') return null;
    return user;
}

async function verifyOrderBelongsToCustomer(orderId, customerPublicId) {
    const order = await orderDataService.findOrderByIdentifier(orderId);
    if (!order) {
        throw validationError('Related order was not found.');
    }

    const ownerId = normalizeText(order.customerId || order.userId || order.accountId);
    if (!ownerId || ownerId !== normalizeText(customerPublicId)) {
        throw validationError('The selected order does not belong to this customer.');
    }

    return order;
}

async function verifyProductExists(productId) {
    const product = await findProductByIdentifier(productId);
    if (!product) {
        throw validationError('Related product was not found.');
    }
    return product;
}

function sendError(req, res, error, eventName) {
    const statusCode = Number(error?.statusCode || 500) || 500;
    if (statusCode >= 500) {
        (req.log || appLogger).error(eventName, { error });
    } else {
        (req.log || appLogger).warn(eventName, {
            code: error?.code || '',
            message: error?.message || ''
        });
    }

    return res.status(statusCode).json({
        success: false,
        code: error?.code || (statusCode >= 500 ? 'ADMIN_CUSTOMER_NOTIFICATION_ERROR' : 'CUSTOMER_NOTIFICATION_VALIDATION_FAILED'),
        message: error?.message || 'Unable to send customer notification'
    });
}

exports.mutationLimiter = mutationLimiter;

exports.sendToCustomer = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'admin_customer_notifications' });
    try {
        const customerId = normalizeText(req.body?.customerId || req.body?.customer?.id);
        const title = normalizeText(req.body?.title);
        const message = normalizeText(req.body?.message || req.body?.body);
        const category = normalizeText(req.body?.category || req.body?.type || 'general').toLowerCase();
        const orderId = normalizeText(req.body?.orderId);
        const productId = normalizeText(req.body?.productId);
        const idempotencyKey = normalizeText(req.body?.idempotencyKey);

        if (!customerId) {
            throw validationError('Customer is required.');
        }
        if (!title) {
            throw validationError('Notification title is required.');
        }
        if (title.length > TITLE_MAX) {
            throw validationError(`Notification title must be ${TITLE_MAX} characters or fewer.`);
        }
        if (!message) {
            throw validationError('Notification message is required.');
        }
        if (message.length > BODY_MAX) {
            throw validationError(`Notification message must be ${BODY_MAX} characters or fewer.`);
        }
        if (!VALID_CATEGORIES.has(category)) {
            throw validationError('Notification category is invalid.');
        }

        const customer = await resolveCustomer(customerId);
        if (!customer?.recordId) {
            return res.status(404).json({
                success: false,
                code: 'CUSTOMER_NOT_FOUND',
                message: 'Customer not found.'
            });
        }

        if (orderId) {
            await verifyOrderBelongsToCustomer(orderId, customer.id);
        }
        if (productId) {
            await verifyProductExists(productId);
        }

        const notification = await customerNotificationDataService.sendAdminCustomerNotification({
            userId: Number(customer.recordId),
            category,
            title,
            body: message,
            orderId,
            productId,
            idempotencyKey
        });

        if (!notification) {
            throw new Error('Unable to create customer notification.');
        }

        logger.info('admin.customer_notification.sent', {
            customerId: customer.id,
            notificationId: notification.id,
            category,
            hasOrder: Boolean(orderId),
            hasProduct: Boolean(productId)
        });

        return res.status(201).json({
            success: true,
            message: 'Notification sent successfully.',
            notification: {
                id: notification.id,
                customerId: customer.id,
                title: notification.title,
                type: notification.type,
                createdAt: notification.createdAt,
                isRead: notification.isRead
            }
        });
    } catch (error) {
        return sendError(req, res, error, 'admin.customer_notification.send_failed');
    }
};
