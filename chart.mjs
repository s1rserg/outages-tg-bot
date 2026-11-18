import fonts from "./chart-font.mjs";

const size = 480;
const center = size / 2;
const palette = [250, 252, 249, 122, 197, 112, 237, 91, 91, 28, 59, 59, 176, 188, 186, 102, 123, 122];
for (const color of [1, 2]) {
  for (let opacity = 1; opacity < 8; opacity++) {
    for (let channel = 0; channel < 3; channel++) {
      palette.push(Math.round((palette[channel] * (8 - opacity) + palette[color * 3 + channel] * opacity) / 8));
    }
  }
}

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
        const color = [0, 4, 5, 3][coverage.charCodeAt(col) - 48];
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

function paintSchedule(pixels, stride, {hours, queue, day, scope}) {
  const minutes = outageMinutes(hours);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - center;
      const dy = y + 0.5 - center;
      const radiusSquared = dx * dx + dy * dy;
      if (radiusSquared < 117 ** 2 || radiusSquared > 226 ** 2) continue;
      const radius = Math.sqrt(radiusSquared);
      const minute = (Math.atan2(dx, -dy) * 720 / Math.PI + 1440) % 1440;
      const hourDistance = Math.min(minute % 60, 60 - minute % 60) * radius * Math.PI / 720;
      const coverage = Math.round(8 * Math.max(0, Math.min(1, radius - 117.5, 226.5 - radius, hourDistance - 0.65)));
      if (!coverage) continue;
      const color = minutes[Math.floor(minute)] ? 2 : 1;
      pixels[y * stride + 1 + x] = coverage === 8 ? color : 5 + (color - 1) * 7 + coverage;
    }
  }
  for (let hour = 0; hour < 24; hour++) {
    const angle = hour * Math.PI / 12;
    const x = center + 201 * Math.sin(angle);
    const y = center - 201 * Math.cos(angle);
    for (let dy = -17; dy <= 17; dy++) {
      for (let dx = -17; dx <= 17; dx++) {
        if (dx * dx + dy * dy <= 289) pixels[(Math.round(y) + dy) * stride + 1 + Math.round(x) + dx] = 0;
      }
    }
    paintLabel(pixels, stride, String(hour), x, y, 21);
  }
  if (day) paintLabel(pixels, stride, day.slice(5).split("-").reverse().join("."), center, center - 50, 27);
  paintLabel(pixels, stride, queue, center, center, 72);
  paintLabel(pixels, stride, scope === "uman" ? "УМАНЬ" : "ОБЛАСТЬ", center, center + 57, 22);
}

export async function scheduleChart(schedule) {
  const stride = size + 1;
  const pixels = new Uint8Array(size * stride);
  paintSchedule(pixels, stride, schedule);

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
