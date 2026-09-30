// Uzbūvē www/ mapi Android lietotnei no src/app.html:
// - aizvieto Google Fonts ar lokāliem fontiem (darbojas bez interneta)
// - pievieno HTML karkasu un src/native.js
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const www = join(root, "www");
if (existsSync(www)) rmSync(www, { recursive: true });
mkdirSync(join(www, "fonts"), { recursive: true });

const fonts = [
  ["barlow-condensed", "Barlow Condensed", [500, 600, 700]],
  ["figtree", "Figtree", [400, 500, 600, 700]],
];
const ranges = {
  "latin": "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
  "latin-ext": "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF",
};
let css = "";
for (const [pkg, family, weights] of fonts) {
  for (const w of weights) {
    for (const sub of ["latin-ext", "latin"]) {
      const file = `${pkg}-${sub}-${w}-normal.woff2`;
      const src = join(root, "node_modules", "@fontsource", pkg, "files", file);
      if (!existsSync(src)) { console.warn("Nav fonta:", file); continue; }
      copyFileSync(src, join(www, "fonts", file));
      css += `@font-face{font-family:"${family}";font-style:normal;font-weight:${w};font-display:swap;src:url(fonts/${file}) format("woff2");unicode-range:${ranges[sub]}}\n`;
    }
  }
}
writeFileSync(join(www, "fonts.css"), css);
copyFileSync(join(root, "src", "native.js"), join(www, "native.js"));

let app = readFileSync(join(root, "src", "app.html"), "utf8");
app = app.replace(/<link[^>]+fonts\.(googleapis|gstatic)\.com[^>]*>\s*/g, "");

const head = `<!doctype html><html lang="lv"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<link rel="stylesheet" href="fonts.css">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
<script src="native.js"></script>
</head><body>
`;
writeFileSync(join(www, "index.html"), head + app + "\n</body></html>\n");
console.log("www/ gatavs");
