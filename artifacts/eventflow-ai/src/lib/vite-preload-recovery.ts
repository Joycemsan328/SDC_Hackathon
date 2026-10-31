const PRELOAD_RELOAD_KEY = "eventflow-vite-preload-reload-at";
const PRELOAD_RELOAD_COOLDOWN_MS = 60_000;

export function shouldRetryAfterVitePreloadError(
  lastReloadAt: string | null,
  now: number,
): boolean {
  if (lastReloadAt === null) return true;
  const previousReload = Number(lastReloadAt);
  return !Number.isFinite(previousReload)
    || (now >= previousReload && now - previousReload >= PRELOAD_RELOAD_COOLDOWN_MS);
}

export function handleVitePreloadError(
  event: Pick<Event, "preventDefault">,
  getStorage: () => Pick<Storage, "getItem" | "setItem">,
  reload: () => void,
  now = Date.now(),
): void {
  event.preventDefault();
  try {
    const storage = getStorage();
    const lastReloadAt = storage.getItem(PRELOAD_RELOAD_KEY);
    if (!shouldRetryAfterVitePreloadError(lastReloadAt, now)) return;
    storage.setItem(PRELOAD_RELOAD_KEY, String(now));
    reload();
  } catch {
    // If session storage is unavailable, React's existing error boundary remains the fallback.
  }
}

export function installVitePreloadRecovery(): void {
  window.addEventListener("vite:preloadError", (event) =>
    handleVitePreloadError(
      event,
      () => window.sessionStorage,
      () => window.location.reload(),
    ),
  );
}
