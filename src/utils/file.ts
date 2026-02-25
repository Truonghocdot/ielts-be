import { env } from "../config/env.js";

/**
 * Lấy base URL của server (API host).
 * Dùng APP_URL nếu có trong env, ngược lại tự build từ PORT.
 */
function getBaseUrl(): string {
  // Ưu tiên APP_URL từ .env (khuyên set trên production: https://api.yourdomain.com)
  if (env.APP_URL) return env.APP_URL;
  const port = env.PORT ?? "3000";
  return `http://localhost:${port}`;
}

/**
 * Chuyển một đường dẫn tương đối (relative path) của file thành Full URL.
 *
 * @example
 * toFileUrl("/uploads/images/avatar.jpg")
 * // => "http://localhost:3000/uploads/images/avatar.jpg"
 *
 * toFileUrl("http://cdn.example.com/image.jpg")
 * // => "http://cdn.example.com/image.jpg"  (giữ nguyên nếu đã là full URL)
 *
 * toFileUrl(null) // => null
 */
export function toFileUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  // Nếu đã là URL đầy đủ (http/https hoặc data:) thì giữ nguyên
  if (/^(https?:\/\/|data:)/i.test(path)) return path;
  // Đảm bảo chỉ có 1 dấu /
  const base = getBaseUrl().replace(/\/$/, "");
  const relative = path.startsWith("/") ? path : `/${path}`;
  return `${base}${relative}`;
}

/**
 * Áp dụng toFileUrl cho một tập hợp key của object.
 * Trả về object mới với các field được chỉ định đã được chuyển thành Full URL.
 *
 * @example
 * withFileUrls(user, ["avatarUrl", "coverUrl"])
 * // => { ...user, avatarUrl: "http://localhost:3000/uploads/...", coverUrl: null }
 */
export function withFileUrls<T extends Record<string, any>>(
  obj: T,
  keys: (keyof T)[],
): T {
  if (!obj) return obj;
  const result = { ...obj };
  for (const key of keys) {
    (result as any)[key] = toFileUrl((obj as any)[key]);
  }
  return result;
}

/**
 * Áp dụng withFileUrls cho một mảng object.
 *
 * @example
 * withFileUrlsMany(users, ["avatarUrl"])
 */
export function withFileUrlsMany<T extends Record<string, any>>(
  arr: T[],
  keys: (keyof T)[],
): T[] {
  return arr.map((item) => withFileUrls(item, keys));
}
