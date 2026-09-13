// Read common image headers without decoding their pixel data.
export function imageDimensions(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const ascii = (offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  try {
    if (view.getUint32(0) === 0x89504e47 && ascii(12, 4) === 'IHDR') return { width: view.getUint32(16), height: view.getUint32(20) };
    if (ascii(0, 3) === 'GIF') return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
    if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
      const kind = ascii(12, 4);
      if (kind === 'VP8X') return { width: 1 + (view.getUint32(24, true) & 0xffffff), height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16) };
      if (kind === 'VP8 ') return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
      if (kind === 'VP8L') {
        const bits = view.getUint32(21, true);
        return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
      }
    }
    if (view.getUint16(0) === 0xffd8) {
      let offset = 2;
      let dimensions;
      let orientation = 1;
      while (offset + 4 <= bytes.length) {
        if (bytes[offset++] !== 0xff) return null;
        while (bytes[offset] === 0xff) offset++;
        const marker = bytes[offset++];
        if (marker === 0xda || marker === 0xd9) break;
        const length = view.getUint16(offset);
        if (length < 2 || offset + length > bytes.length) return null;
        if (marker === 0xe1 && ascii(offset + 2, 6) === 'Exif\0\0') {
          const base = offset + 8;
          const little = view.getUint16(base) === 0x4949;
          const ifd = base + view.getUint32(base + 4, little);
          const count = view.getUint16(ifd, little);
          for (let i = 0; i < count; i++) {
            const entry = ifd + 2 + i * 12;
            if (entry + 12 > offset + length) return null;
            if (view.getUint16(entry, little) === 0x112) orientation = view.getUint16(entry + 8, little);
          }
        }
        if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
          dimensions = { width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) };
        }
        offset += length;
      }
      if (dimensions && [5, 6, 7, 8].includes(orientation)) return { width: dimensions.height, height: dimensions.width };
      return dimensions ?? null;
    }
  } catch { return null; }
  return null;
}
