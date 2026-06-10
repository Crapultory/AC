import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // Allow remote editing sessions to disable HMR/file watching when needed.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Reduce CPU churn during automated edits when HMR is turned off.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
