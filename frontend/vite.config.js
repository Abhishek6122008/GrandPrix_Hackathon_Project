import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // The backend pins cors.allowed-origins to localhost:5173, so failing here is better than
    // silently starting on 5174 and getting CORS errors that look like a backend problem.
    strictPort: true,
  },
});
