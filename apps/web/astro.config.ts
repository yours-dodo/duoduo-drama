import node from '@astrojs/node';
import react from '@astrojs/react';
import vue from '@astrojs/vue';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: process.env.PUBLIC_SITE_URL,
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [
    vue(),
    react({
      include: /\/workspaces\/drama\/.*\.[jt]sx?$/,
      exclude: /\.vue/,
    }),
  ],
  vite: {
    plugins: [
      {
        name: 'disable-react-refresh-for-vue-sfc',
        enforce: 'pre',
        transform(_code, id) {
          if (!id.includes('.vue')) return;
          const jsx = this.environment?.config.oxc?.jsx;
          if (jsx) {
            jsx.refresh = false;
          }
        },
      },
      {
        name: 'restore-react-refresh-after-vue-sfc',
        enforce: 'post',
        transform(_code, id) {
          if (!id.includes('.vue')) return;
          const jsx = this.environment?.config.oxc?.jsx;
          if (jsx) {
            jsx.refresh = true;
          }
        },
      },
    ],
  },
});
