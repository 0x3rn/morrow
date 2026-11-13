/*
 * Outbound URL safety (SSRF defence).
 *
 * Users supply competitor domains, monitored page URLs and notification
 * webhook URLs. Morrow's Worker fetches them, so every such URL must point at
 * a public internet host. This module rejects loopback, private, link-local,
 * metadata, carrier-grade NAT and reserved addresses, single-label and
 * internal-only hostnames, embedded credentials and non-HTTP(S) schemes.
 *
 * It checks hostnames and IP literals. It cannot see DNS answers, so callers
 * that follow redirects must re-check every hop (see fetchPublicText).
 */

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

const BLOCKED_HOSTNAME_SUFFIXES = [
  ".localhost",
  ".local",
  ".localdomain",
  ".internal",
  ".intranet",
  ".lan",
  ".home",
  ".corp",
  ".private",
  ".onion",
  ".arpa",
];

function parseIpv4(hostname: string): number[] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!match) return null;
  const octets = match.slice(1).map(Number);
  return octets.every((octet) => octet <= 255) ? octets : null;
}

function isBlockedIpv4(octets: number[]): boolean {
  const [a, b, c] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function parseIpv6(hostname: string): number[] | null {
  let value = hostname;
  const zone = value.indexOf("%");
  if (zone !== -1) value = value.slice(0, zone);
  if (!/^[0-9a-f:.]+$/i.test(value) || !value.includes(":")) return null;

  // Convert a trailing dotted IPv4 part into two hextets.
  const lastColon = value.lastIndexOf(":");
  const tail = value.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIpv4(tail);
    if (!v4) return null;
    value =
      value.slice(0, lastColon + 1) +
      ((v4[0] << 8) | v4[1]).toString(16) +
      ":" +
      ((v4[2] << 8) | v4[3]).toString(16);
  }

  const halves = value.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  if (groups.length !== 8) return null;
  const parsed = groups.map((group) => (/^[0-9a-f]{1,4}$/i.test(group) ? parseInt(group, 16) : NaN));
  return parsed.some(Number.isNaN) ? null : parsed;
}

function isBlockedIpv6(groups: number[]): boolean {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  const embeddedV4 = [g6 >> 8, g6 & 255, g7 >> 8, g7 & 255];

  // :: and ::1
  if (groups.slice(0, 7).every((group) => group === 0) && (g7 === 0 || g7 === 1)) return true;
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d)
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0)) {
    return isBlockedIpv4(embeddedV4);
  }
  // NAT64 well-known prefix 64:ff9b::/96 embeds an IPv4 address
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isBlockedIpv4(embeddedV4);
  }
  // 6to4 (2002::/16) embeds an IPv4 address in the next 32 bits
  if (g0 === 0x2002) {
    return isBlockedIpv4([g1 >> 8, g1 & 255, g2 >> 8, g2 & 255]);
  }
  return (
    (g0 & 0xfe00) === 0xfc00 || // unique local fc00::/7
    (g0 & 0xffc0) === 0xfe80 || // link-local fe80::/10
    (g0 & 0xffc0) === 0xfec0 || // site-local fec0::/10
    (g0 & 0xff00) === 0xff00 || // multicast
    (g0 === 0x2001 && g1 === 0x0db8) // documentation
  );
}

/** True when the hostname is a public, routable internet name or address. */
export function isPublicHostname(rawHostname: string): boolean {
  let hostname = rawHostname.trim().toLowerCase();
  if (hostname.startsWith("[") && hostname.endsWith("]")) hostname = hostname.slice(1, -1);
  while (hostname.endsWith(".")) hostname = hostname.slice(0, -1);
  if (!hostname) return false;

  if (hostname.includes(":")) {
    const groups = parseIpv6(hostname);
    return groups !== null && !isBlockedIpv6(groups);
  }

  const v4 = parseIpv4(hostname);
  if (v4) return !isBlockedIpv4(v4);

  // Anything numeric-looking that the URL parser did not normalise is rejected.
  if (/^[0-9.x]+$/i.test(hostname)) return false;

  if (hostname === "localhost" || !hostname.includes(".")) return false;
  if (BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return false;
  if (hostname.length > 253) return false;
  return true;
}

export interface PublicUrlOptions {
  /** Allowed URL schemes. Defaults to https only. */
  protocols?: readonly ("http:" | "https:")[];
  /** Used in error messages, for example "Webhook URL". */
  label?: string;
}

/** Parse a URL and throw UnsafeUrlError unless it targets a public host. */
export function assertPublicUrl(raw: string, options: PublicUrlOptions = {}): URL {
  const label = options.label ?? "URL";
  const protocols = options.protocols ?? ["https:"];
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UnsafeUrlError(`${label} must be a valid URL.`);
  }
  if (!protocols.includes(url.protocol as "http:" | "https:")) {
    throw new UnsafeUrlError(
      protocols.length === 1 && protocols[0] === "https:"
        ? `${label} must use HTTPS.`
        : `${label} must use HTTP or HTTPS.`,
    );
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError(`${label} must not embed credentials in the URL.`);
  }
  if (!isPublicHostname(url.hostname)) {
    throw new UnsafeUrlError(`${label} must point to a public website, not a private or internal address.`);
  }
  return url;
}

/**
 * Normalise a competitor domain such as "https://www.Example.com/pricing" to
 * "example.com". Rejects ports, credentials, IP literals and internal names.
 */
export function normalizeCompetitorDomain(value: string): string {
  let input = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");
  input = input.split(/[/?#]/)[0].replace(/\.+$/, "");
  if (!input || /[\s@:\\[\]]/.test(input) || !/^[a-z0-9.-]+$/.test(input.replace(/[^\x00-\x7f]/g, "a"))) {
    throw new UnsafeUrlError("Enter a valid domain such as example.com.");
  }
  let hostname: string;
  try {
    hostname = new URL(`https://${input}`).hostname;
  } catch {
    throw new UnsafeUrlError("Enter a valid domain such as example.com.");
  }
  if (!isPublicHostname(hostname) || parseIpv4(hostname) || hostname.includes(":")) {
    throw new UnsafeUrlError("Enter a public website domain such as example.com.");
  }
  return hostname;
}

export interface FetchPublicTextOptions {
  fetcher?: typeof fetch;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxRedirects?: number;
  maxBytes?: number;
  protocols?: readonly ("http:" | "https:")[];
}

export interface FetchPublicTextResult {
  ok: boolean;
  status: number;
  url: string;
  text: string;
}

/**
 * GET a public URL, following at most maxRedirects redirects manually so that
 * every hop is re-validated, and reading at most maxBytes of the body.
 */
export async function fetchPublicText(
  rawUrl: string,
  options: FetchPublicTextOptions = {},
): Promise<FetchPublicTextResult> {
  const fetcher = options.fetcher ?? fetch;
  const maxRedirects = options.maxRedirects ?? 3;
  const maxBytes = options.maxBytes ?? 2_000_000;
  const protocols = options.protocols ?? ["https:", "http:"];
  let current = assertPublicUrl(rawUrl, { protocols, label: "Page URL" });

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const response = await fetcher(current.toString(), {
      method: "GET",
      redirect: "manual",
      headers: options.headers,
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location || hop === maxRedirects) {
        throw new UnsafeUrlError("Too many redirects.");
      }
      current = assertPublicUrl(new URL(location, current).toString(), { protocols, label: "Redirect URL" });
      continue;
    }

    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > maxBytes) {
      await response.body?.cancel();
      throw new UnsafeUrlError("The page is too large.");
    }

    let text = "";
    if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > maxBytes) {
          await reader.cancel();
          throw new UnsafeUrlError("The page is too large.");
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    }
    return { ok: response.ok, status: response.status, url: current.toString(), text };
  }
  throw new UnsafeUrlError("Too many redirects.");
}
