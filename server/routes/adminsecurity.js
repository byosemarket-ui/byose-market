const express = require('express');

const adminAccessDisabled = require('../middleware/adminaccessdisabled');
const { createRateLimiter } = require('../middleware/ratelimiter');
const adminSecurityController = require('../controllers/adminsecuritycontroller');

const router = express.Router();

const securityMutationLimiter = createRateLimiter({
    windowMs: 10 * 60 * 1000,
    max: 60,
    code: 'ADMIN_SECURITY_RATE_LIMITED',
    message: 'Too many security actions. Please retry shortly.'
});

router.use(adminAccessDisabled);

router.get('/', adminSecurityController.getSecurityOverview);
router.get('/sessions', adminSecurityController.listSessions);
router.get('/sessions/current', adminSecurityController.getCurrentSession);
router.get('/sessions/validate', adminSecurityController.validateSession);
router.get('/sessions/policy', adminSecurityController.getSessionPolicy);
router.put('/sessions/policy', securityMutationLimiter, adminSecurityController.updateSessionPolicy);
router.post('/sessions/logout-others', securityMutationLimiter, adminSecurityController.logoutOtherSessions);
router.post('/sessions/logout-all', securityMutationLimiter, adminSecurityController.logoutAllSessions);
router.post('/sessions/logout-selected', securityMutationLimiter, adminSecurityController.logoutSelectedSessions);
router.delete('/sessions/:sessionId', securityMutationLimiter, adminSecurityController.terminateSession);

router.get('/login-history', adminSecurityController.listLoginHistory);

router.get('/trusted-devices', adminSecurityController.listTrustedDevices);
router.post('/trusted-devices', securityMutationLimiter, adminSecurityController.trustCurrentDevice);
router.put('/trusted-devices/:deviceId', securityMutationLimiter, adminSecurityController.renameTrustedDevice);
router.delete('/trusted-devices/:deviceId', securityMutationLimiter, adminSecurityController.removeTrustedDevice);

router.get('/events', adminSecurityController.listSecurityEvents);

router.get('/two-factor', adminSecurityController.getTwoFactor);
router.put('/two-factor', securityMutationLimiter, adminSecurityController.updateTwoFactor);

module.exports = router;
