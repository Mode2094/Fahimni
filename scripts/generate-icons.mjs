import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const svg = await readFile(path.join(root, 'public/favicon.svg'));
const outDir = path.join(root, 'public/icons');
await mkdir(outDir, { recursive: true });

const render = (size, file, padding = 0) => {
  const inner = size - padding * 2;
  return sharp(svg, { density: 384 })
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({
      top: padding,
      bottom: padding,
      left: padding,
      right: padding,
      background: '#6c4bf4',
    })
    .png()
    .toFile(path.join(outDir, file));
};

await render(192, 'icon-192.png');
await render(512, 'icon-512.png');
await render(512, 'maskable-512.png', 64);
await render(180, 'apple-touch-icon.png', 18);
console.log('Generated PWA icons in public/icons');
