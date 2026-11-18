// Mounts a generated app with Element Plus (https://element-plus.org, MIT) set up: its components (registered
// globally, so templates may use <el-table> without importing it), its styles, and Genesis's design standard on top
// (theme.css: tokens, the Element Plus theme, refined components, layout classes). Injected into every preview as
// src/genesis/setup.js (never saved, never written by the model); new apps' src/main.js is `mountApp(App)`. The
// preview pins the version (frontend/src/lib/previewPackages.ts).
// Options: { theme: "dark" } for a dark app (only when its user asks). To restyle (only when asked), override the
// --app-* tokens in :root in src/style.css, imported after setup.
import { createApp } from "vue";
import ElementPlus from "element-plus";
import "element-plus/dist/index.css";
import "./theme.css";

export function mountApp(App, options = {}) {
  document.documentElement.classList.toggle("dark", options.theme === "dark");
  const app = createApp(App);
  app.use(ElementPlus);
  app.mount("#app");
  return app;
}
