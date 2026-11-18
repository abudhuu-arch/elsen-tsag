// Copies the web app into www/, the folder Capacitor bundles into the iOS app (npm run build).
// The service worker and the install screenshots/splash images are left out: the native app
// carries its own files, icon and launch screen.
import { cpSync, rmSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "www");
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
for (const f of ["index.html", "i18n.js", "native.js", "manifest.json", "icons", "fonts"])
  cpSync(join(root, f), join(out, f), { recursive: true });
console.log("www/ ready");
