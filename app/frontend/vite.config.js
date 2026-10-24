import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' e' OBBLIGATORIO: sotto Ingress l'app vive in
// /api/hassio_ingress/<token>/ — tutti gli asset e le fetch devono
// essere relativi, mai assoluti.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: '../www',
    emptyOutDir: true,
  },
})
