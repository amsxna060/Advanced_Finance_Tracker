import { lazy } from "react";

/**
 * lazy() that survives deploys. After a redeploy the JS chunk filenames
 * change; a browser holding the old index.html will 404 when it tries to
 * import a lazy chunk, and React would blank the page. Here we catch that
 * failure and reload ONCE (which fetches the fresh index.html + chunks).
 * The one-shot guard prevents an infinite reload loop if the failure is
 * something other than a stale chunk.
 */
const RELOAD_FLAG = "chunk_reload_attempted";

export function lazyWithRetry(importer) {
  return lazy(async () => {
    try {
      const mod = await importer();
      // success → clear the guard so future stale-chunk reloads can happen
      window.sessionStorage.removeItem(RELOAD_FLAG);
      return mod;
    } catch (err) {
      const alreadyReloaded = window.sessionStorage.getItem(RELOAD_FLAG);
      const looksLikeChunkError =
        /Loading chunk|dynamically imported module|Failed to fetch/i.test(String(err?.message));
      if (!alreadyReloaded && looksLikeChunkError) {
        window.sessionStorage.setItem(RELOAD_FLAG, "1");
        window.location.reload();
        // return an empty module so React doesn't throw before the reload
        return { default: () => null };
      }
      throw err;
    }
  });
}
