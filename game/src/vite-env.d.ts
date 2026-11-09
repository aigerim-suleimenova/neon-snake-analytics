/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Analytics endpoint, e.g. http://localhost:3000/api/events; unset turns analytics off. */
  readonly VITE_ANALYTICS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
