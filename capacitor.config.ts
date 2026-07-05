import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.abascheduling',
  appName: 'SAssi Cal',
  webDir: 'dist-client',
  // Loads the deployed site (Cloudflare Pages) instead of the bundled dist-client.
  // Remove before shipping an offline-capable build (a real build should load dist-client).
  server: {
    url: 'https://sassi.nooutco.me'
  }
};

export default config;
