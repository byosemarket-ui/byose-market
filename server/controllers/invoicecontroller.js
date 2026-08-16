const { appLogger, monitorAsyncOperation } = require('../utils/logger');
const orderDataService = require('../services/orderdataservice');
const invoiceVerification = require('../services/invoice-verification.service');

const NOT_VERIFIED = 'Invoice could not be verified.';

function normalizeText(value) {
    return String(value == null ? '' : value).trim();
}

exports.getAdminInvoiceVerification = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'admin_invoice' });
    try {
        const orderId = normalizeText(req.params.id);
        if (!orderId) {
            return res.status(400).json({ success: false, message: 'Order id required' });
        }

        const order = await monitorAsyncOperation(
            logger,
            'database.order.find_invoice_verification',
            { requestedOrderId: orderId, adminId: req.admin?.id || '' },
            () => orderDataService.findOrderByIdentifier(orderId),
            { slowThresholdMs: 700 }
        );
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        const ref = normalizeText(order.orderId || order.id);
        const url = invoiceVerification.buildVerificationUrl(ref, req);
        return res.json({
            success: true,
            verification: {
                ref,
                signature: invoiceVerification.signOrderRef(ref),
                url,
                qrSvg: await invoiceVerification.buildQrSvg(url)
            }
        });
    } catch (err) {
        logger.error('admin.invoice_verification_failed', { error: err, requestedOrderId: req.params.id });
        return res.status(500).json({ success: false, message: 'Unable to create invoice verification link.' });
    }
};

exports.verifyPublicInvoice = async (req, res) => {
    const logger = (req.log || appLogger).child({ scope: 'invoice_verify' });
    res.setHeader('Cache-Control', 'no-store');
    try {
        const ref = normalizeText(req.query?.ref || req.query?.r || req.params?.ref);
        const signature = normalizeText(req.query?.sig || req.query?.s || req.params?.sig);
        if (!ref || !signature || !invoiceVerification.verifyOrderRef(ref, signature)) {
            return res.status(404).json({ success: false, message: NOT_VERIFIED });
        }

        const order = await monitorAsyncOperation(
            logger,
            'database.order.find_invoice_public_verify',
            { orderRef: ref },
            () => orderDataService.findOrderByIdentifier(ref),
            { slowThresholdMs: 700 }
        );
        if (!order) {
            return res.status(404).json({ success: false, message: NOT_VERIFIED });
        }

        const confirmedRef = normalizeText(order.orderId || order.id);
        if (!confirmedRef || confirmedRef.toLowerCase() !== ref.toLowerCase()) {
            return res.status(404).json({ success: false, message: NOT_VERIFIED });
        }

        return res.json({
            success: true,
            verification: invoiceVerification.toLimitedVerification(order)
        });
    } catch (err) {
        logger.error('invoice.public_verify_failed', { error: err });
        return res.status(500).json({ success: false, message: NOT_VERIFIED });
    }
};
