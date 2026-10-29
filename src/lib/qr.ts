import qrcode from "qrcode-generator";

// The authenticator-app QR code (IAM-7), drawn on the server from the otpauth URI so the TOTP secret never
// goes to a third party and no client script is needed. `qrcode-generator` is pure arithmetic: no network,
// no DOM. The image is returned as an inline SVG data URI.
const QUIET_ZONE_MODULES = 4;

function modules(text: string): { size: number; dark: (row: number, col: number) => boolean } {
  const code = qrcode(0, "M");
  code.addData(text);
  code.make();
  return { size: code.getModuleCount(), dark: (row, col) => code.isDark(row, col) };
}

export function qrModuleCount(text: string): number {
  return modules(text).size;
}

export function qrSvgDataUri(text: string): string {
  const { size, dark } = modules(text);
  const total = size + 2 * QUIET_ZONE_MODULES;
  // One rectangle per horizontal run of dark modules, in a single path.
  let path = "";
  for (let row = 0; row < size; row += 1) {
    let col = 0;
    while (col < size) {
      if (!dark(row, col)) {
        col += 1;
        continue;
      }
      const start = col;
      while (col < size && dark(row, col)) col += 1;
      path += `M${start + QUIET_ZONE_MODULES} ${row + QUIET_ZONE_MODULES}h${col - start}v1h-${col - start}z`;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">`
    + `<rect width="${total}" height="${total}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}
