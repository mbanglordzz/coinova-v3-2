/**
 * Centralized API URL builder for COINOVA.
 * Always uses same-origin relative `/api/...` in production so Vercel requests
 * never target localhost, 127.0.0.1, port 3000, or external dev URLs.
 */
export const API_BASE_URL = '';

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}
