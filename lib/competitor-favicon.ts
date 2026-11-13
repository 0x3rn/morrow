import { assertPublicUrl, fetchPublicText } from "./url-safety.ts";

/**
 * Best-effort favicon discovery for a competitor domain. The homepage fetch
 * goes through the SSRF-safe fetcher and the discovered icon URL must be a
 * public https URL, otherwise the conventional /favicon.ico path is used.
 */
export async function findFaviconUrl(
  domain: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const homepageUrl = `https://${domain}`;
  const fallbackUrl = `${homepageUrl}/favicon.ico`;

  try {
    const page = await fetchPublicText(homepageUrl, {
      fetcher,
      protocols: ["https:"],
      maxBytes: 500_000,
      timeoutMs: 8_000,
      headers: { "User-Agent": "Morrow favicon fetcher" },
    });
    if (!page.ok) return fallbackUrl;

    for (const tag of page.text.match(/<link\b[^>]*>/gi) ?? []) {
      const rel = tag.match(/\brel=["']([^"']+)["']/i);
      if (!rel || !rel[1].toLowerCase().includes("icon")) continue;
      const href = tag.match(/\bhref=["']([^"']+)["']/i);
      if (!href) continue;
      try {
        return assertPublicUrl(new URL(href[1], page.url).toString(), {
          protocols: ["https:"],
          label: "Favicon URL",
        }).toString();
      } catch {
        continue;
      }
    }
  } catch {
    // Favicon discovery is best-effort and must never block saving a competitor.
  }

  return fallbackUrl;
}
