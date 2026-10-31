import axios from 'axios';

const baseURL = import.meta.env.VITE_API_URL || '/api';

export const api = axios.create({ baseURL, withCredentials: true });

let accessToken = null;
const listeners = [];
const pausedListeners = [];

export const setAccessToken = (t) => { accessToken = t; };
export const getAccessToken = () => accessToken;
export const onAuthFailure = (fn) => listeners.push(fn);
// Fired when the server returns 402 (subscription paused). Receives the message.
export const onAccountPaused = (fn) => pausedListeners.push(fn);

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

let refreshing = null;

// On 401, try one silent refresh then replay the original request.
// Skip retry if:
//   • we already retried this request (_retry flag)
//   • the failing request was itself a refresh or login (prevents infinite loops)
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;

    // Identify auth-endpoint requests by the flag we stamp on them below,
    // or by the url path as a fallback — either way we never loop.
    const isAuthRoute =
      original._isAuthRoute ||
      (typeof original.url === 'string' && original.url.includes('/auth/'));

    if (status === 401 && !original._retry && !isAuthRoute) {
      original._retry = true;
      try {
        // Coalesce concurrent 401s into a single refresh call.
        refreshing = refreshing || api.post('/auth/refresh', null, { _isAuthRoute: true });
        const { data } = await refreshing;
        refreshing = null;
        setAccessToken(data.accessToken);
        original.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(original);
      } catch (e) {
        refreshing = null;
        setAccessToken(null);
        listeners.forEach((fn) => fn());
        return Promise.reject(e);
      }
    }

    // 402 = subscription paused (expired / past due / cancelled). Notify the
    // app so it can show a full-screen "account paused" notice.
    if (status === 402) {
      const msg = error.response?.data?.message || 'Your account is paused.';
      pausedListeners.forEach((fn) => fn(msg));
    }

    return Promise.reject(error);
  }
);

export const apiError = (err) =>
  err?.response?.data?.message || err?.message || 'Something went wrong';