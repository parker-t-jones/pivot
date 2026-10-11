const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Null when `raw` is a loopback URL. Otherwise a reason to refuse. */
export function localUrlRefusal(name: string, raw: string | undefined): string | null {
  if (raw === undefined || raw.trim() === '') return `${name} is not set`;
  let host: string;
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return `${name} is not a URL`;
  }
  if (!LOCAL_HOSTS.has(host)) {
    return `refusing to run: ${name} host is ${host}, not localhost or 127.0.0.1`;
  }
  return null;
}
