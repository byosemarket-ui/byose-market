/**
 * Documented DPO Pay API host used by this integration.
 *
 * DPO's published API host is https://secure.3gdirectpay.com/.
 * TEST and LIVE merchants use this host; the Company Token selects the environment.
 * Do not invent a different production URL. If DPO later provides an official
 * LIVE host that differs, store it in Admin LIVE endpoints — never guess it.
 *
 * LIVE checkout remains gated off in the DPO config resolver.
 */

const DEFAULT_API_BASE = 'https://secure.3gdirectpay.com/API/v6/';
const DEFAULT_PAYMENT_PAGE = 'https://secure.3gdirectpay.com/payv3.php?ID=token';

module.exports = {
    DEFAULT_API_BASE,
    DEFAULT_PAYMENT_PAGE
};
