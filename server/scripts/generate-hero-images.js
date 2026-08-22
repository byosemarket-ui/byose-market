#!/usr/bin/env node
const heroImage = require('../services/hero-image.service');

const summary = heroImage.generateMissingHeroImages(50);
process.stdout.write(`${JSON.stringify(summary)}\n`);
if (summary.failed && !summary.generated) {
    process.exit(1);
}
