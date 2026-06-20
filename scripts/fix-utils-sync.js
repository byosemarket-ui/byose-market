const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'js', 'utils.js');
let source = fs.readFileSync(filePath, 'utf8');

const syncStart = source.indexOf('    (function initializeByoseStorefrontSync');
const scrollMarker = source.indexOf('  // SCROLL', syncStart);

if (syncStart < 0 || scrollMarker < 0) {
  console.error('Could not locate sync block markers.');
  process.exit(1);
}

let syncBlock = source.slice(syncStart, scrollMarker);
syncBlock = syncBlock.replace(
  "byose_checkout_confirmation_v1: 'checkoutConfirmation'",
  "byose_checkout_confirmation_v1: 'checkoutConfirmation',\n        byose_market_saved_v1: 'savedItems'"
);
syncBlock = syncBlock.replace(
  'checkoutConfirmation: null\n      };',
  'checkoutConfirmation: null,\n        savedItems: []\n      };'
);

const throttleFixed = `  // THROTTLE
  throttle: (func, limit = 300) => {
    let inThrottle;
    return (...args) => {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => { inThrottle = false; }, limit);
      }
    };
  },

  // SCROLL`;

source = source.replace(
  /  \/\/ THROTTLE[\s\S]*?  \/\/ SCROLL/,
  throttleFixed
);

const initBlock = syncBlock.replace(/^    /gm, '');
source = `${source.trimEnd()}\n\n${initBlock}`;

fs.writeFileSync(filePath, source, 'utf8');
console.log('Fixed js/utils.js storefront sync initialization.');
