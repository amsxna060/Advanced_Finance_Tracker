import { useEffect } from "react";

/**
 * Auto-update the app after a deploy. Every build bakes in __APP_VERSION__
 * and ships a matching /version.json. We poll version.json (bypassing the
 * browser cache); when it differs from the running build, a new version is
 * live, so we reload once to pick it up — no manual hard-refresh, so users
 * never get stuck on a stale menu/UI.
 *
 * Loop-safe: we only reload once per detected version. If the page is still
 * stale after that (e.g. a proxy hard-caches index.html), we stop instead of
 * looping — the proper permanent fix in that case is a no-cache header on
 * index.html at the web server.
 */
const CURRENT = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";
const GUARD = "version_reload_for";

async function check() {
  if (CURRENT === "dev") return; // no version file in dev
  try {
    const res = await fetch("/version.json", { cache: "no-store" });
    if (!res.ok) return;
    const { version } = await res.json();
    if (!version) return;
    if (version !== CURRENT) {
      if (sessionStorage.getItem(GUARD) !== version) {
        sessionStorage.setItem(GUARD, version);
        window.location.reload();
      }
      // else: already tried reloading for this version, still stale — stop.
    } else {
      sessionStorage.removeItem(GUARD);
    }
  } catch {
    /* offline / network hiccup — ignore */
  }
}

export function useVersionCheck() {
  useEffect(() => {
    check();
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    const id = setInterval(check, 5 * 60 * 1000);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(id);
    };
  }, []);
}
