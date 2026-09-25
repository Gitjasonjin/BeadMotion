import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      onwarn(warning, warn) {
        // Appica/Base UI also support React server frameworks. This is a
        // client-only Vite app, so their client directives are redundant.
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message.includes('use client')) return;
        warn(warning);
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three/')) return 'three';
        },
      },
    },
  },
});
