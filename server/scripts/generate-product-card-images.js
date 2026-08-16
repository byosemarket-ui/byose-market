#!/usr/bin/env node
const productCardImage = require('../services/product-card-image.service');

const summary = productCardImage.generateMissingProductCards(1000);
process.stdout.write(`${JSON.stringify(summary)}\n`);
if (summary.failed && !summary.generated) {
    process.exit(1);
}
