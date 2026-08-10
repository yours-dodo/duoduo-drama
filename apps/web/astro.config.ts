import node from '@astrojs/node';
import react from '@astrojs/react';
import vue from '@astrojs/vue';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: process.env.PUBLIC_SITE_URL,
  output: 'static',
  adapter: node({ mode: 'standalone' }),
  integrations: [vue(), react()],
});
