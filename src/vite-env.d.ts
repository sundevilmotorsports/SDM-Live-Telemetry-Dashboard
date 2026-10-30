/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_TELEMETRY_SESSION_ID?: string
  readonly VITE_TELEMETRY_STALE_MS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
