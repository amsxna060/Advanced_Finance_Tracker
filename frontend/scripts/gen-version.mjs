// Writes public/version.json with a unique id for THIS build. The same file
// is read by vite.config.js to bake the id into the app bundle, so the
// running app and version.json always agree per build. The app polls
// version.json and reloads when it changes (see src/hooks/useVersionCheck.js),
// which auto-updates browsers after every deploy — no manual hard-refresh.
import { writeFileSync, mkdirSync } from "fs";

mkdirSync("public", { recursive: true });
const version = Date.now().toString();
writeFileSync("public/version.json", JSON.stringify({ version }) + "\n");
console.log("[gen-version] build version:", version);
