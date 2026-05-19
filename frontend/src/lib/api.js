import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

// C-AUTH-4: Store access token in memory only (not localStorage) to mitigate XSS.
// The refresh token lives in an httpOnly SameSite=Strict cookie managed by the backend.
let _accessToken = null;

export function setAccessToken(token) {
  _accessToken = token;
}

export function getAccessToken() {
  return _accessToken;
}

// H-SEC-2: Read CSRF token from the csrf_token cookie (set by GET /api/auth/csrf-token).
// The double-submit cookie pattern: cookie is set by server (same-origin only),
// client echoes it in X-CSRF-Token header; CSRF attacks can't read cookies cross-origin.
function getCsrfCookie() {
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

const api = axios.create({
  baseURL: API_URL,
  headers: {
    "Content-Type": "application/json",
  },
  // C-AUTH-4: Send httpOnly cookies (refresh_token) automatically on same-origin requests
  withCredentials: true,
});

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    // C-AUTH-4: Read from in-memory variable, not localStorage
    const token = _accessToken;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    // H-SEC-2: Include CSRF token header on state-changing requests to /api/admin/*
    const method = (config.method || "").toUpperCase();
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      const csrfToken = getCsrfCookie();
      if (csrfToken) {
        config.headers["X-CSRF-Token"] = csrfToken;
      }
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// Queue for requests waiting on token refresh
let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

// Response interceptor — refresh access token on 401, queue concurrent requests
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    const isAuthEndpoint = originalRequest.url?.includes("/auth/");
    if (error.response?.status === 401 && !originalRequest._retry && !isAuthEndpoint) {
      // If a refresh is already in progress, queue this request
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return api(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        // C-AUTH-4: Don't send refresh token in body — the httpOnly cookie is sent automatically
        // via withCredentials. The backend reads the cookie and returns a new access token.
        // Sending null (no body) so FastAPI doesn't try to validate an empty {} as RefreshTokenRequest.
        const response = await axios.post(`${API_URL}/api/auth/refresh`, null, {
          withCredentials: true,
        });

        const { access_token } = response.data;
        // C-AUTH-4: Store new access token in memory only
        setAccessToken(access_token);
        // H-FE-2: reset isRefreshing BEFORE draining the queue so that any new
        // 401 that arrives while the queue processes does not re-join a stale queue.
        isRefreshing = false;
        processQueue(null, access_token);

        originalRequest.headers.Authorization = `Bearer ${access_token}`;
        return api(originalRequest);
      } catch (refreshError) {
        // H-FE-2: reset flag before draining failure queue for the same reason
        isRefreshing = false;
        processQueue(refreshError, null);
        // C-AUTH-4: Clear in-memory token on refresh failure
        setAccessToken(null);
        // M-AUTH-9: dispatch a custom event instead of hard-navigating so that
        // React Router (and any in-flight state) is preserved; AuthContext listens.
        window.dispatchEvent(new CustomEvent("auth:logout"));
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  },
);

export default api;
