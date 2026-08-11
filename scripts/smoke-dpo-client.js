#!/usr/bin/env node
const dpoClient = require('../server/payments/dpo/client');
const xml = require('../server/payments/dpo/xml');

const url = dpoClient.buildPaymentPageUrl('https://secure.3gdirectpay.com/payv3.php?ID=token', 'ABC');
if (url !== 'https://secure.3gdirectpay.com/payv3.php?ID=ABC') {
  throw new Error(`bad url: ${url}`);
}

const redacted = xml.redactXmlSecrets('<CompanyToken>SECRET</CompanyToken>');
if (redacted.includes('SECRET')) {
  throw new Error('secret leak');
}

console.log('client-helpers-ok');
console.log(JSON.stringify(dpoClient.mapVerifyResultToPaymentStatus('000')));
console.log(JSON.stringify(dpoClient.mapVerifyResultToPaymentStatus('901')));
console.log(JSON.stringify(dpoClient.mapVerifyResultToPaymentStatus('904')));
console.log(JSON.stringify(dpoClient.mapVerifyResultToPaymentStatus('802')));
