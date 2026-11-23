import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // The PHP lexer uses this flag to select 64-bit PHP integer limits.
  define: { "process.arch": JSON.stringify("x64") },
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
