// Tiny PNG dimension reader (no deps).
// PNG header: 8 bytes signature, then IHDR chunk (4 bytes length, 4 bytes "IHDR", 4 bytes width, 4 bytes height, ...)
const fs = require('node:fs');
const buf = fs.readFileSync(process.argv[2]);
if (buf.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') {
  console.error('not a png');
  process.exit(1);
}
const width = buf.readUInt32BE(16);
const height = buf.readUInt32BE(20);
console.log(`image: ${width}x${height}, aspect=${(width / height).toFixed(4)}`);
console.log(`board: 144x180, aspect=${(144 / 180).toFixed(4)}`);
console.log(`diff:  ${Math.abs(width / height - 144 / 180).toFixed(4)}`);
