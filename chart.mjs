import fonts from "./chart-font.mjs";

const size = 320;
const center = size / 2;
const palette = [250, 252, 249, 122, 197, 112, 237, 91, 91, 28, 59, 59, 176, 188, 186, 102, 123, 122];
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

function paintLabel(pixels, stride, label, x, y, fontSize) {
  const font = fonts[fontSize];
  const glyphs = Array.from(label, character => font[character]);
  const width = glyphs.reduce((sum, [advance]) => sum + advance, 0);
  let left = Math.round(x - width / 2);
  const top = Math.round(y - fontSize * 0.60);
  for (const [advance, rows] of glyphs) {
    for (const [row, coverage] of rows.entries()) {
      for (let col = 0; col < coverage.length; col++) {
        const color = {1: 4, 2: 5, 3: 3}[coverage[col]];
        if (color) pixels[(top + row) * stride + 1 + left + col] = color;
      }
    }
    left += advance;
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

function paintSchedule(pixels, stride, offset, {hours, queue, day, scope}, combined) {
  const minutes = outageMinutes(hours);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - center;
      const dy = y + 0.5 - center;
      const radiusSquared = dx * dx + dy * dy;
      if (radiusSquared < 79 ** 2 || radiusSquared > 157 ** 2) continue;
      const minute = (Math.atan2(dx, -dy) * 720 / Math.PI + 1440) % 1440;
      if (Math.min(minute % 60, 60 - minute % 60) < 1.3) continue;
      pixels[y * stride + 1 + offset + x] = minutes[Math.floor(minute)] ? 2 : 1;
    }
  }
  for (let hour = 0; hour < 24; hour++) {
    const angle = hour * Math.PI / 12;
    const x = offset + center + 139 * Math.sin(angle);
    const y = center - 139 * Math.cos(angle);
    for (let dy = -11; dy <= 11; dy++) {
      for (let dx = -11; dx <= 11; dx++) {
        if (dx * dx + dy * dy <= 121) pixels[(Math.round(y) + dy) * stride + 1 + Math.round(x) + dx] = 0;
      }
    }
    paintLabel(pixels, stride, String(hour), x, y, 13);
  }
  const middle = offset + center;
  if (day) paintLabel(pixels, stride, day.slice(5).split("-").reverse().join("."), middle, center - 34, 18);
  paintLabel(pixels, stride, queue, middle, center, 48);
  if (combined) paintLabel(pixels, stride, scope === "uman" ? "УМАНЬ" : "ОБЛАСТЬ", middle, center + 38, 15);
}

export async function scheduleChart(schedules) {
  const width = size * schedules.length;
  const stride = width + 1;
  const pixels = new Uint8Array(size * stride);
  schedules.forEach((schedule, index) => paintSchedule(pixels, stride, index * size, schedule, schedules.length > 1));

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, size);
  header.set([8, 3], 8);
  const compressed = await new Response(new Blob([pixels]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer();
  return new Blob([
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    chunk("IHDR", header), chunk("PLTE", Uint8Array.from(palette)),
    chunk("IDAT", new Uint8Array(compressed)), chunk("IEND", new Uint8Array()),
  ], {type: "image/png"});
}
