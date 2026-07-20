import React from "react";

/**
 * App-wide safety net. Instead of a blank white screen when something throws
 * during render (a stale chunk after deploy, an unexpected data shape, …),
 * show a friendly message with a reload button. Chunk-load errors auto-reload
 * once so the user rarely even sees this.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, isChunkError: false };
  }

  static getDerivedStateFromError(error) {
    const isChunkError = /Loading chunk|dynamically imported module|Failed to fetch/i.test(
      String(error?.message),
    );
    return { hasError: true, isChunkError };
  }

  componentDidCatch(error) {
    // A stale-chunk error means a new version deployed — reload once to get it.
    if (this.state.isChunkError && !window.sessionStorage.getItem("boundary_reloaded")) {
      window.sessionStorage.setItem("boundary_reloaded", "1");
      window.location.reload();
    }
    // eslint-disable-next-line no-console
    console.error("App error boundary caught:", error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="max-w-sm w-full text-center bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
          <div className="text-3xl mb-3">🔄</div>
          <h1 className="text-lg font-semibold text-slate-800">Something needs a refresh</h1>
          <p className="text-sm text-slate-500 mt-2">
            The app was likely just updated. Reload to get the latest version.
          </p>
          <button
            onClick={() => {
              window.sessionStorage.removeItem("boundary_reloaded");
              window.location.reload();
            }}
            className="mt-6 px-6 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
