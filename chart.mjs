const size = 320;
const center = size / 2;
const digits = [
  "111101101101111", "010110010010111", "111001111100111",
  "111001111001111", "101101111001001", "111100111001111",
  "111100111101111", "111001001001001", "111101111101111",
  "111101111001111",
];
const palette = [250, 252, 249, 122, 197, 112, 237, 91, 91, 28, 59, 59];
const crcTable = Uint32Array.from({length: 256}, (_, value) => {
  for (let i = 0; i < 8; i++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value;
});

function chunk(type, data) {
  const bytes = new Uint8Array(data.length + 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, data.length);
  bytes.set(new TextEncoder().encode(type), 4);
  bytes.set(data, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < bytes.length - 4; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 255];
  view.setUint32(bytes.length - 4, crc ^ 0xffffffff);
  return bytes;
}

function paintLabel(pixels, label, x, y, scale) {
  const left = Math.round(x - (label.length * 4 - 1) * scale / 2);
  const top = Math.round(y - 5 * scale / 2);
  for (const [index, digit] of [...label].entries()) {
    const glyph = digits[digit] ?? "000000000000010";
    for (let row = 0; row < 5 * scale; row++) {
      for (let col = 0; col < 3 * scale; col++) {
        if (glyph[Math.floor(row / scale) * 3 + Math.floor(col / scale)] === "1") {
          pixels[(top + row) * (size + 1) + 1 + left + index * 4 * scale + col] = 3;
        }
      }
    }
  }
}

export function outageMinutes(hours) {
  const minutes = new Uint8Array(1440);
  const minute = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  for (const [start, end] of [...hours.matchAll(/(\d\d:\d\d)–(\d\d:\d\d)/g)].map(match => match.slice(1))) {
    minutes.fill(1, minute(start), minute(end));
  }
  return minutes;
}

export async function scheduleChart({hours, queue, day}) {
  const pixels = new Uint8Array(size * (size + 1));
  const minutes = outageMinutes(hours);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - center;
      const dy = y + 0.5 - center;
      const radiusSquared = dx * dx + dy * dy;
      if (radiusSquared < 79 ** 2 || radiusSquared > 157 ** 2) continue;
      const minute = (Math.atan2(dx, -dy) * 720 / Math.PI + 1440) % 1440;
      if (Math.min(minute % 60, 60 - minute % 60) < 1.3) continue;
      pixels[y * (size + 1) + 1 + x] = minutes[Math.floor(minute)] ? 2 : 1;
    }
  }
  for (let hour = 0; hour < 24; hour++) {
    const angle = hour * Math.PI / 12;
    const x = center + 139 * Math.sin(angle);
    const y = center - 139 * Math.cos(angle);
    for (let dy = -9; dy <= 9; dy++) {
      for (let dx = -9; dx <= 9; dx++) {
        if (dx * dx + dy * dy <= 81) pixels[(Math.round(y) + dy) * (size + 1) + 1 + Math.round(x) + dx] = 0;
      }
    }
    paintLabel(pixels, String(hour), x, y, 2);
  }
  if (day) paintLabel(pixels, day.slice(5).split("-").reverse().join("."), center, center - 28, 3);
  paintLabel(pixels, queue, center, center + (day ? 13 : 0), 8);

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  header.set([8, 3], 8);
  const compressed = await new Response(new Blob([pixels]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer();
  return new Blob([
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    chunk("IHDR", header), chunk("PLTE", Uint8Array.from(palette)),
    chunk("IDAT", new Uint8Array(compressed)), chunk("IEND", new Uint8Array()),
  ], {type: "image/png"});
}
