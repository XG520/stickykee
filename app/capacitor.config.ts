import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.luminahome.app',
  appName: 'Sticky Nuo',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
}

export default config