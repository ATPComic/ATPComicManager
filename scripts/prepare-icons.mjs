import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const artwork = path.join(root, 'design/atp-comic/icon.svg');
const foreground = path.join(root, 'design/atp-comic/foreground.svg');
const output = path.join(root, 'generated/icons');
await mkdir(output, { recursive: true });
await sharp(artwork).resize(256, 256).png().toFile(path.join(output, 'app.png'));
// This single checked-in PNG is for README rendering, refreshed explicitly.
if (process.argv.includes('--readme')) {
  await sharp(artwork).resize(512, 512).png().toFile(path.join(root, 'design/atp-comic/icon.png'));
}

// Windows ICO: a directory of PNG frames, no external ImageMagick dependency.
const sizes = [16, 24, 32, 48, 64, 128, 256];
const frames = await Promise.all(sizes.map(size => sharp(artwork).resize(size, size).png().toBuffer()));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
for (const [index, size] of sizes.entries()) {
  const entry = 6 + index * 16;
  header[entry] = header[entry + 1] = size === 256 ? 0 : size;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(frames[index].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += frames[index].length;
}
await writeFile(path.join(output, 'app.ico'), Buffer.concat([header, ...frames]));

const resources = path.join(root, 'android/app/src/main/res');
for (const [density, size] of Object.entries({mdpi:48, hdpi:72, xhdpi:96, xxhdpi:144, xxxhdpi:192})) {
  const directory = path.join(resources, `mipmap-${density}`);
  await mkdir(directory, {recursive:true});
  for (const name of ['ic_launcher.png', 'ic_launcher_round.png']) {
    await sharp(artwork).resize(size, size).png().toFile(path.join(directory, name));
  }
  const canvas = Math.round(size * 2.25);
  const inner = Math.round(canvas * 0.66);
  const padding = Math.floor((canvas - inner) / 2);
  await sharp(foreground).resize(inner, inner).extend({
    top:padding, left:padding, bottom:canvas-inner-padding, right:canvas-inner-padding,
    background:{r:0,g:0,b:0,alpha:0}
  }).png().toFile(path.join(directory, 'ic_launcher_foreground.png'));
}
const splashSizes = {
  drawable:[480,320],
  'drawable-land-mdpi':[480,320], 'drawable-land-hdpi':[800,480],
  'drawable-land-xhdpi':[1280,720], 'drawable-land-xxhdpi':[1600,960], 'drawable-land-xxxhdpi':[1920,1280],
  'drawable-port-mdpi':[320,480], 'drawable-port-hdpi':[480,800],
  'drawable-port-xhdpi':[720,1280], 'drawable-port-xxhdpi':[960,1600], 'drawable-port-xxxhdpi':[1280,1920]
};
for (const [directory, [width, height]] of Object.entries(splashSizes)) {
  await mkdir(path.join(resources, directory), {recursive:true});
  const size = Math.round(Math.min(width, height) * 0.3);
  const logo = await sharp(foreground).resize(size, size).png().toBuffer();
  await sharp({create:{width,height,channels:4,background:'#171b26'}})
    .composite([{input:logo,gravity:'centre'}]).png().toFile(path.join(resources,directory,'splash.png'));
}
console.log('Generated Windows and Android icons from design/atp-comic SVG sources.');
