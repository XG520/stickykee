import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.luminahome.app',
  appName: '归栖',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
}

export default config