/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Address of the analytics backend; defaults to http://localhost:3000. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
