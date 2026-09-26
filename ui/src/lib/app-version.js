// The About version comes from package.json, which Vite inlines at build time.
// In the desktop app the packaged version is authoritative, so prefer the
// runtime value exposed by the Electron preload and fall back to the inlined
// one for the web and Pages builds.
export async function resolveAppVersion(fallback, desktop = globalThis.window?.atpDesktop) {
  try {
    const runtime = await desktop?.getAppVersion?.();
    return runtime || fallback;
  } catch {
    return fallback;
  }
}
