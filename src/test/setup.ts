import "@testing-library/jest-dom";

// Vite's import.meta.env is exposed via `process.env` plus Vite's runtime in
// production, but in vitest jsdom the supabase client tries to read
// VITE_SUPABASE_URL at module-load time. Provide harmless dummies so any
// transitive supabase import doesn't crash during a test render.
import.meta.env.VITE_SUPABASE_URL ??= 'http://localhost:54321';
import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??= 'test-anon-key';

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
