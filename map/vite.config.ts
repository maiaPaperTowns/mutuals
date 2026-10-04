import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The tunnel (cloudflared) gives teammates an https link to a laptop's copy of the map; Web Serial (the badge) and
// geolocation only work on https or localhost.
const tunnelHosts = ['.trycloudflare.com'];

export default defineConfig({
  plugins: [react()],
  server: { allowedHosts: tunnelHosts },
  preview: { allowedHosts: tunnelHosts },
});
