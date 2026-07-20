import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.abascheduler',
  appName: 'SAssi Cal',
  webDir: 'dist-client',
  // Dark-slate base under the WebView so cold launch never flashes black
  // while the JS bundle boots. Matches the launch storyboard + lock screen.
  backgroundColor: '#333f45',
  ios: {
    backgroundColor: '#333f45'
  }
};

export default config;
