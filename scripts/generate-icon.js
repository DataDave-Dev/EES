const fs = require('node:fs');
const path = require('node:path');
const pngToIco = require('png-to-ico').default;

const SRC = path.join(__dirname, '..', 'src', 'assets', 'logo', 'logo.png');
const OUT_ICO = path.join(__dirname, '..', 'src', 'assets', 'logo', 'icon.ico');

async function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`[generate-icon] missing source: ${SRC}`);
    process.exit(1);
  }
  const buf = await pngToIco(SRC);
  fs.writeFileSync(OUT_ICO, buf);
  console.log(`[generate-icon] wrote ${OUT_ICO} (${buf.length} bytes)`);
}

main().catch((err) => {
  console.error('[generate-icon] failed:', err);
  process.exit(1);
});
