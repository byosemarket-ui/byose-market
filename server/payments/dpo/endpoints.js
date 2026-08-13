/**
 * Official DPO Pay API v6 host used by this integration.
 *
 * LIVE API endpoint supplied by DPO:
 *   https://secure.3gdirectpay.com/API/v6/
 *
 * LIVE payment URL supplied by DPO for this API v6 account:
 *   https://secure.3gdirectpay.com/payv3.php?ID=token
 *
 * dpopayment.php was mentioned as a possible path but is not present in this
 * integration and was not the official URL in the DPO LIVE configuration email.
 * Do not silently switch to it. Admin LIVE endpoints can store a later official
 * URL if DPO confirms one — never guess a different path here.
 *
 * TEST and LIVE use this same documented host; Company Token + Service Type
 * select the merchant environment. Production checkout is LIVE-only and never
 * falls back to TEST.
 */

const DEFAULT_API_BASE = 'https://secure.3gdirectpay.com/API/v6/';
const DEFAULT_PAYMENT_PAGE = 'https://secure.3gdirectpay.com/payv3.php?ID=token';

module.exports = {
    DEFAULT_API_BASE,
    DEFAULT_PAYMENT_PAGE
};
