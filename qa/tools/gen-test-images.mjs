import { createRequire } from 'node:module';

const require = createRequire('/Users/mrik/Desktop/fahimni/package.json');
const sharp = require('sharp');

await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 108, g: 75, b: 244 } } })
  .png()
  .toFile('/tmp/phase1-image-a.png');
await sharp({ create: { width: 80, height: 48, channels: 3, background: { r: 20, g: 150, b: 120 } } })
  .jpeg()
  .toFile('/tmp/phase1-image-b.jpg');
console.log('images-ready');
