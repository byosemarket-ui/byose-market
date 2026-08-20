#!/usr/bin/env node
/**
 * STEP 1 — Instant ORDER_CREATED admin email wiring verification.
 * Run: node scripts/verify-order-created-email.js
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const failures = [];

function assert(condition, message) {
    if (!condition) failures.push(message);
}

function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

function checkSourceGuards() {
    const orderController = read('server/controllers/ordercontroller.js');
    assert(orderController.includes('notificationEngine.notifyOrderCreated(order)'), 'createOrder must trigger notification engine after persist');
    assert(orderController.includes("return res.json({ success: true, existing: true, order: existingOrder })"), 'duplicate order submissions must not re-create the order');
    assert(
        orderController.indexOf('await monitorAsyncOperation(logger, \'database.order.create\'')
            < orderController.indexOf('notificationEngine.notifyOrderCreated(order)'),
        'ORDER_CREATED must run after the order is saved'
    );
    assert(
        orderController.indexOf('notificationEngine.notifyOrderCreated(order)')
            > orderController.indexOf('if (redemption?.error)'),
        'ORDER_CREATED must not fire when coupon redeem rolls the order back'
    );

    assert(
        orderController.indexOf("database.order.save_status_admin")
            < orderController.indexOf('notificationEngine.notifyOrderStatusChanged(order, oldStatus'),
        'admin order status notifications must run after the order is saved'
    );
    assert(orderController.includes('recordActivity'), 'admin order status changes must write an activity log after save');

    const engine = read('server/services/notification-engine.service.js');
    assert(engine.includes('listOrderCreatedEvents'), 'engine must use the shared order-created event map');
    assert(engine.includes('listOrderStatusChangedEvents'), 'engine must use the shared status-change event map');
    assert(!engine.includes("safePublish('PAYMENT_SUCCESSFUL'"), 'must reuse PAYMENT_RECEIVED instead of a duplicate PAYMENT_SUCCESSFUL key');

    const lifecycleMap = read('server/services/notification-lifecycle.map.js');
    assert(lifecycleMap.includes("'PAYMENT_PENDING'"), 'lifecycle map must include PAYMENT_PENDING');
    assert(lifecycleMap.includes("'PAYMENT_RECEIVED'"), 'lifecycle map must include PAYMENT_RECEIVED (Payment Successful)');
    assert(lifecycleMap.includes("'PAYMENT_FAILED'"), 'lifecycle map must include PAYMENT_FAILED');
    assert(lifecycleMap.includes("'PAYMENT_CANCELLED'"), 'lifecycle map must include PAYMENT_CANCELLED');
    assert(lifecycleMap.includes('statusEvent !== previousKey'), 'same order status must not re-fire the lifecycle event');

    const automation = read('server/services/notification-automation.service.js');
    assert(automation.includes('serializeOrderForNotification'), 'automation must serialize full order snapshots');
    assert(automation.includes('items, products: items'), 'serialized orders must include items');
    assert(automation.includes('notificationEmailService.safeDeliverNotificationEmail')
        || automation.includes('hub.safeDispatchChannels'), 'automation must dispatch email after notification create');

    const emailService = read('server/services/email/notification-email.service.js');
    assert(emailService.includes('hydrateEmailContext'), 'email send must hydrate order details from the database');
    assert(emailService.includes('no_active_recipients'), 'email send must record when no recipients are active');
    assert(emailService.includes('recipientDedupeKey') || emailService.includes(':to:'), 'email send must dedupe per recipient');

    const dpo = read('server/services/dpopayment.service.js');
    assert(dpo.includes('notifyPaymentChange'), 'payment verification must notify from the server, not the frontend redirect');
    assert(dpo.includes('previousOrderStatus'), 'DPO notify must use the pre-update order status so processing can fire after paid');
    assert(
        dpo.indexOf('await orderDataService.saveOrder(updated)')
            < dpo.indexOf('await notifyPaymentChange(updated'),
        'payment notifications must run only after the payment update is saved'
    );

    const settingsUi = read('admin/app/pages/settings-notifications.js');
    assert(settingsUi.includes('Email Notification Recipients'), 'settings UI must have the recipients section');
    assert(settingsUi.includes('Email Notification Events'), 'settings UI must have the Email Notification Events section');
    assert(settingsUi.includes('PAYMENT_PENDING: "Payment Pending"'), 'settings UI must expose Payment Pending');
    assert(settingsUi.includes('PAYMENT_RECEIVED: "Payment Successful"'), 'settings UI must label PAYMENT_RECEIVED as Payment Successful');
    assert(settingsUi.includes('adminNotificationEmailEnabled'), 'settings UI must expose recipient 1 enabled toggle');
    assert(settingsUi.includes('adminNotificationEmail2Enabled'), 'settings UI must expose recipient 2 enabled toggle');
    assert(settingsUi.includes('Send Test Email'), 'settings UI must have send test email');
    assert(settingsUi.includes('data-ns-clear'), 'settings UI must allow clearing a recipient email');
    assert(!settingsUi.includes('Send Test SMS'), 'settings UI must not offer Send Test SMS');
    assert(!settingsUi.includes('SMS Recipient'), 'settings UI must not show SMS recipients');

    const routes = read('server/routes/adminnotifications.js');
    const hub = read('server/services/notifications/notification-hub.service.js');
    assert(!routes.includes('/settings/test-sms'), 'admin SMS test route must not exist');
    assert(hub.includes('resolved[CHANNELS.SMS] = false'), 'admin hub must never enable SMS');

    const nav = read('admin/app/core/navigation.js');
    assert(nav.includes('messages-notification-settings'), 'Messages & Notifications must include Notification Settings');
    assert(nav.includes('?panel=notifications'), 'Notification Settings must reuse the existing settings panel route');
}

function checkTemplates() {
    const {
        buildAdminEventEmail,
        resolveOrderEmailHeadline,
        collectOrderItems
    } = require('../server/services/email/admin-email-templates');

    const sampleOrder = {
        orderId: 'BYOSE-TEST-1001',
        createdAt: '2026-08-19T10:00:00.000Z',
        status: 'Pending',
        paymentStatus: 'awaiting_payment',
        paymentStatusLabel: 'Awaiting Payment',
        paymentMethod: 'mtn',
        paymentMethodLabel: 'MTN MoMo',
        customerName: 'Test Customer',
        customerEmail: 'customer@example.com',
        customerPhone: '0780000000',
        subtotal: 20000,
        couponDiscount: 2000,
        deliveryFee: 2000,
        totalAmount: 20000,
        currency: 'RWF',
        note: 'Leave at the gate',
        shippingAddress: {
            fullName: 'Test Customer',
            provinceCity: 'Kigali',
            district: 'Gasabo',
            sector: 'Remera',
            cell: 'Rukiri',
            village: 'Gisimenti',
            note: 'Leave at the gate'
        },
        items: [
            {
                productId: '42',
                productName: 'Canvas Sneaker',
                sku: 'SNK-42-BLK-42',
                quantity: 2,
                price: 10000,
                color: 'Black',
                size: '42'
            }
        ]
    };

    const items = collectOrderItems(sampleOrder);
    assert(items.length === 1, 'collectOrderItems should keep product lines');
    assert(items[0].lineTotal === 20000, 'line total should be qty * unit price');

    const pendingHeadline = resolveOrderEmailHeadline('ORDER_CREATED', sampleOrder);
    assert(
        pendingHeadline && pendingHeadline.subject.includes('New Order Received') && pendingHeadline.subject.includes('BYOSE-TEST-1001'),
        'ORDER_CREATED subject must be New Order Received — Order #XXXX'
    );
    assert(
        !pendingHeadline.subject.includes('Payment Pending'),
        'ORDER_CREATED must not duplicate the Payment Pending subject'
    );

    const paymentPendingHeadline = resolveOrderEmailHeadline('PAYMENT_PENDING', sampleOrder);
    assert(
        paymentPendingHeadline && paymentPendingHeadline.subject.includes('Payment Pending'),
        'PAYMENT_PENDING subject must say Payment Pending'
    );

    const paidHeadline = resolveOrderEmailHeadline('PAYMENT_RECEIVED', { ...sampleOrder, paymentStatus: 'paid' });
    assert(
        paidHeadline && paidHeadline.subject.includes('Payment Successful'),
        'PAYMENT_RECEIVED subject must say Payment Successful'
    );

    const failedHeadline = resolveOrderEmailHeadline('PAYMENT_FAILED', sampleOrder);
    assert(
        failedHeadline && failedHeadline.subject.includes('Payment Failed'),
        'PAYMENT_FAILED subject must say Payment Failed'
    );

    const processingHeadline = resolveOrderEmailHeadline('ORDER_PROCESSING', sampleOrder);
    assert(
        processingHeadline && processingHeadline.subject.includes('Order Processing'),
        'ORDER_PROCESSING subject must say Order Processing'
    );

    const shippedHeadline = resolveOrderEmailHeadline('ORDER_SHIPPED', sampleOrder);
    assert(
        shippedHeadline && shippedHeadline.subject.includes('Order Shipped'),
        'ORDER_SHIPPED subject must say Order Shipped'
    );

    const deliveredHeadline = resolveOrderEmailHeadline('ORDER_DELIVERED', sampleOrder);
    assert(
        deliveredHeadline && deliveredHeadline.subject.includes('Order Delivered'),
        'ORDER_DELIVERED subject must say Order Delivered'
    );

    const cancelledHeadline = resolveOrderEmailHeadline('ORDER_CANCELLED', sampleOrder);
    assert(
        cancelledHeadline && cancelledHeadline.subject.includes('Order Cancelled'),
        'ORDER_CANCELLED subject must say Order Cancelled'
    );

    const email = buildAdminEventEmail('ORDER_CREATED', { order: sampleOrder });
    assert(Boolean(email?.html && email?.text && email?.subject), 'ORDER_CREATED template must return subject/html/text');
    assert(email.subject.includes('New Order Received'), 'generated ORDER_CREATED email subject must be New Order Received');
    assert(email.html.includes('Canvas Sneaker'), 'email HTML must include product name');
    assert(email.html.includes('SNK-42-BLK-42'), 'email HTML must include SKU');
    assert(email.html.includes('Black / 42') || email.html.includes('Black'), 'email HTML must include variant');
    assert(email.html.includes('Subtotal'), 'email HTML must include subtotal');
    assert(email.html.includes('Discount'), 'email HTML must include discount when present');
    assert(email.html.includes('Delivery Fee'), 'email HTML must include delivery fee');
    assert(email.html.includes('Gisimenti') || email.html.includes('Kigali'), 'email HTML must include delivery location');
    assert(email.html.includes('Leave at the gate'), 'email HTML must include delivery notes');
    assert(email.text.includes('Canvas Sneaker'), 'email text must include product name');
    assert(!email.html.toLowerCase().includes('smtp'), 'email must not leak SMTP configuration');
    assert(!email.html.toLowerCase().includes('password'), 'email must not leak passwords');

    const paidEmail = buildAdminEventEmail('PAYMENT_RECEIVED', {
        order: {
            ...sampleOrder,
            paymentStatus: 'paid',
            paymentStatusLabel: 'Paid',
            paymentReference: 'DPO-REF-12345',
            transactionId: 'DPO-REF-12345',
            payment: { status: 'paid', reference: 'DPO-REF-12345', transaction: { reference: 'DPO-REF-12345' } }
        }
    });
    assert(paidEmail.subject.includes('Payment Successful'), 'payment success email subject must be Payment Successful');
    assert(paidEmail.html.includes('DPO-REF-12345'), 'payment success email must include the safe transaction reference');
    assert(!paidEmail.html.toLowerCase().includes('companytoken'), 'payment email must not expose gateway secrets');
}

function checkMailConfigAndSerialization() {
    const mail = require('../server/config/notification-mail.config');
    const {
        resolveAdminNotificationEmails,
        resolveAdminEmailMasterEnabled,
        resolveActiveAdminNotificationRecipients
    } = mail;

    const previousNotify = process.env.NOTIFY_EMAIL_ENABLED;
    const previousAdmin = process.env.ADMIN_EMAIL_NOTIFICATIONS_ENABLED;
    delete process.env.ADMIN_EMAIL_NOTIFICATIONS_ENABLED;
    process.env.NOTIFY_EMAIL_ENABLED = 'false';
    assert(resolveAdminEmailMasterEnabled() === true, 'admin emails must not be killed by NOTIFY_EMAIL_ENABLED=false');
    process.env.ADMIN_EMAIL_NOTIFICATIONS_ENABLED = 'false';
    assert(resolveAdminEmailMasterEnabled() === false, 'ADMIN_EMAIL_NOTIFICATIONS_ENABLED=false must disable admin emails');
    if (previousNotify == null) delete process.env.NOTIFY_EMAIL_ENABLED;
    else process.env.NOTIFY_EMAIL_ENABLED = previousNotify;
    if (previousAdmin == null) delete process.env.ADMIN_EMAIL_NOTIFICATIONS_ENABLED;
    else process.env.ADMIN_EMAIL_NOTIFICATIONS_ENABLED = previousAdmin;

    const emails = resolveAdminNotificationEmails({
        adminNotificationEmail: 'ops@byosemarket.com',
        adminNotificationEmail2: 'backup@byosemarket.com'
    });
    assert(emails.length === 2, 'settings should resolve two unique admin recipients');
    assert(emails[0] === 'ops@byosemarket.com' && emails[1] === 'backup@byosemarket.com', 'recipient order should be 1 then 2');

    const onlyFirst = resolveAdminNotificationEmails({
        adminNotificationEmail: 'ops@byosemarket.com',
        adminNotificationEmail2: 'backup@byosemarket.com',
        adminNotificationEmailEnabled: true,
        adminNotificationEmail2Enabled: false
    });
    assert(onlyFirst.length === 1 && onlyFirst[0] === 'ops@byosemarket.com', 'disabled recipient 2 must not receive mail');

    const onlySecond = resolveAdminNotificationEmails({
        adminNotificationEmail: 'ops@byosemarket.com',
        adminNotificationEmail2: 'backup@byosemarket.com',
        adminNotificationEmailEnabled: false,
        adminNotificationEmail2Enabled: true
    });
    assert(onlySecond.length === 1 && onlySecond[0] === 'backup@byosemarket.com', 'disabled recipient 1 must not receive mail');

    const none = resolveActiveAdminNotificationRecipients({
        adminNotificationEmail: 'ops@byosemarket.com',
        adminNotificationEmail2: 'backup@byosemarket.com',
        adminNotificationEmailEnabled: false,
        adminNotificationEmail2Enabled: false
    });
    assert(none.length === 0, 'both disabled recipients must produce no active inboxes');

    assert(!mail.isValidEmail('not-an-email'), 'backend must reject malformed recipient emails');
    assert(mail.isValidEmail('ops@byosemarket.com'), 'backend must accept valid recipient emails');

    const automation = read('server/services/notification-automation.service.js');
    assert(automation.includes("'paymentReference'"), 'serialized orders must keep payment reference');
    assert(automation.includes("'cancellationReason'"), 'serialized orders must keep cancellation reason');
    assert(automation.includes("'transactionId'"), 'serialized orders must keep transaction id');
}

async function checkEngineLifecycle() {
    const {
        listOrderCreatedEvents,
        listOrderStatusChangedEvents,
        mapStatusToEventKey,
        isPendingPayment,
        isPaidStatus,
        isFailedPayment,
        isCancelledPayment
    } = require('../server/services/notification-lifecycle.map');
    const { listEmailEventKeys } = require('../server/services/email/admin-email-templates');

    const catalog = listEmailEventKeys();
    assert(catalog.includes('ORDER_CREATED'), 'email catalog must include ORDER_CREATED');
    assert(catalog.includes('PAYMENT_PENDING'), 'email catalog must include PAYMENT_PENDING');
    assert(catalog.includes('PAYMENT_RECEIVED'), 'email catalog must include PAYMENT_RECEIVED');
    assert(catalog.includes('PAYMENT_FAILED'), 'email catalog must include PAYMENT_FAILED');
    assert(catalog.includes('PAYMENT_CANCELLED'), 'email catalog must include PAYMENT_CANCELLED');
    assert(catalog.includes('ORDER_PROCESSING'), 'email catalog must include ORDER_PROCESSING');
    assert(catalog.includes('ORDER_SHIPPED'), 'email catalog must include ORDER_SHIPPED');
    assert(catalog.includes('ORDER_DELIVERED'), 'email catalog must include ORDER_DELIVERED');
    assert(catalog.includes('ORDER_CANCELLED'), 'email catalog must include ORDER_CANCELLED');
    assert(!catalog.includes('PAYMENT_SUCCESSFUL'), 'must not add a duplicate PAYMENT_SUCCESSFUL event key');

    assert(mapStatusToEventKey('Pending') === '', 'Pending order status must not invent a lifecycle event');
    assert(mapStatusToEventKey('Processing') === 'ORDER_PROCESSING', 'Processing maps to ORDER_PROCESSING');
    assert(mapStatusToEventKey('Shipping') === 'ORDER_SHIPPED', 'Shipping maps to ORDER_SHIPPED');
    assert(mapStatusToEventKey('Shipped') === 'ORDER_SHIPPED', 'Shipped maps to ORDER_SHIPPED');
    assert(mapStatusToEventKey('Delivered') === 'ORDER_DELIVERED', 'Delivered maps to ORDER_DELIVERED');
    assert(mapStatusToEventKey('Cancelled') === 'ORDER_CANCELLED', 'Cancelled maps to ORDER_CANCELLED');
    assert(mapStatusToEventKey('Packed') === 'ORDER_PACKED', 'Packed maps to ORDER_PACKED');
    assert(isPendingPayment('awaiting_payment'), 'awaiting_payment is pending');
    assert(isPendingPayment('awaiting_delivery_payment'), 'COD awaiting is pending');
    assert(isPaidStatus('paid') && !isPaidStatus('awaiting_payment'), 'paid and pending stay separate');
    assert(isFailedPayment('failed'), 'failed payment status is recognized');
    assert(isCancelledPayment('cancelled'), 'cancelled payment status is recognized');

    let published = listOrderCreatedEvents({
        orderId: 'BM-STEP3-1',
        status: 'Pending',
        paymentStatus: 'awaiting_payment',
        customerName: 'Ada'
    });
    assert(published.includes('ORDER_CREATED'), 'TEST 1: new order emits ORDER_CREATED');
    assert(published.includes('PAYMENT_PENDING'), 'TEST 2: unpaid order emits PAYMENT_PENDING');
    assert(!published.includes('PAYMENT_RECEIVED'), 'unpaid order must not emit payment success');

    published = listOrderStatusChangedEvents({
        orderId: 'BM-STEP3-1',
        status: 'Processing',
        paymentStatus: 'awaiting_payment'
    }, 'Pending', { previousPaymentStatus: 'awaiting_payment' });
    assert(published.includes('ORDER_PROCESSING'), 'TEST 5: pending→processing emits ORDER_PROCESSING');
    assert(!published.includes('PAYMENT_PENDING'), 'unchanged payment must not re-emit PAYMENT_PENDING');

    published = listOrderStatusChangedEvents({
        orderId: 'BM-STEP3-1',
        status: 'Processing',
        paymentStatus: 'awaiting_payment'
    }, 'Processing', { previousPaymentStatus: 'awaiting_payment' });
    assert(published.length === 0, 'TEST 9: saving the same status must not emit another event');

    published = listOrderStatusChangedEvents({
        orderId: 'BM-STEP3-1',
        status: 'Processing',
        paymentStatus: 'paid'
    }, 'Processing', { previousPaymentStatus: 'awaiting_payment' });
    assert(published.includes('PAYMENT_RECEIVED'), 'TEST 3: verified paid emits PAYMENT_RECEIVED');
    assert(!published.includes('ORDER_PROCESSING'), 'payment-only change must not re-emit processing');

    published = listOrderStatusChangedEvents({
        orderId: 'BM-STEP3-1',
        status: 'Processing',
        paymentStatus: 'paid'
    }, 'Processing', { previousPaymentStatus: 'paid' });
    assert(published.length === 0, 'TEST 10: duplicate paid callback must not emit another success');

    published = listOrderStatusChangedEvents({
        orderId: 'BM-STEP3-1',
        status: 'Processing',
        paymentStatus: 'failed'
    }, 'Processing', { previousPaymentStatus: 'awaiting_payment' });
    assert(published.includes('PAYMENT_FAILED'), 'TEST 4: failed payment emits PAYMENT_FAILED');

    published = listOrderStatusChangedEvents({
        orderId: 'BM-STEP3-1',
        status: 'Shipped',
        paymentStatus: 'paid'
    }, 'Processing', { previousPaymentStatus: 'paid' });
    assert(published.includes('ORDER_SHIPPED'), 'TEST 6: processing→shipped emits ORDER_SHIPPED');

    published = listOrderStatusChangedEvents({
        orderId: 'BM-STEP3-1',
        status: 'Delivered',
        paymentStatus: 'paid'
    }, 'Shipped', { previousPaymentStatus: 'paid' });
    assert(published.includes('ORDER_DELIVERED'), 'TEST 7: shipped→delivered emits ORDER_DELIVERED');

    published = listOrderStatusChangedEvents({
        orderId: 'BM-STEP3-1',
        status: 'Cancelled',
        paymentStatus: 'paid'
    }, 'Processing', { previousPaymentStatus: 'paid' });
    assert(published.includes('ORDER_CANCELLED'), 'TEST 8: cancel emits ORDER_CANCELLED');

    published = listOrderStatusChangedEvents({
        orderId: 'BM-STEP3-1',
        status: 'Processing',
        paymentStatus: 'paid'
    }, 'Pending', { previousPaymentStatus: 'awaiting_payment' });
    assert(
        published.includes('PAYMENT_RECEIVED') && published.includes('ORDER_PROCESSING'),
        'DPO paid that moves the order to processing emits both payment success and ORDER_PROCESSING'
    );

    const emailService = read('server/services/email/notification-email.service.js');
    assert(emailService.includes("reason: 'event_disabled'"), 'TEST 11: disabled events skip email without failing the order');
    assert(emailService.includes('safeDeliverNotificationEmail') || emailService.includes('deliverNotificationEmail'), 'email delivery is fire-and-forget from the business transaction');
}

async function main() {
    checkSourceGuards();
    checkTemplates();
    checkMailConfigAndSerialization();
    await checkEngineLifecycle();

    if (failures.length) {
        console.error('Order lifecycle notification verification FAILED:');
        failures.forEach((item) => console.error(` - ${item}`));
        process.exit(1);
    }

    console.log('Order lifecycle notification verification PASSED.');
    process.exit(0);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
