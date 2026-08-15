/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_SITE_URL?: string;
  readonly PUBLIC_AGENT_SERVICE_URL?: string;
  readonly DEV_TEST_ACCOUNT_EMAIL?: string;
  readonly DEV_TEST_ACCOUNT_PASSWORD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
