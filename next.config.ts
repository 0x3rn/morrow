import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

/*
 * Content Security Policy.
 *
 * Scripts keep 'unsafe-inline' because the framework streams inline RSC payload
 * scripts and next-themes injects an inline theme script; a nonce-based policy
 * needs a request-time proxy and is tracked as a follow-up. Every other
 * directive is locked down so injected markup cannot load remote scripts,
 * embed the app, post forms elsewhere or change the base URL.
 *
 * img-src allows any https origin because competitor favicons are loaded from
 * the competitor's own site.
 */
function buildContentSecurityPolicy() {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
    `style-src 'self' 'unsafe-inline'${isProduction ? "" : " https://fonts.googleapis.com"}`,
    `font-src 'self' data:${isProduction ? "" : " https://fonts.gstatic.com"}`,
    "img-src 'self' data: blob: https:",
    `connect-src 'self'${isProduction ? "" : " ws: wss:"}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];

  if (isProduction) {
    directives.push("upgrade-insecure-requests");
  }

  return directives.join("; ");
}

function buildSecurityHeaders() {
  const headers = [
    { key: "Content-Security-Policy", value: buildContentSecurityPolicy() },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value:
        "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), accelerometer=(), gyroscope=(), magnetometer=(), interest-cohort=()",
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];

  if (isProduction) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    });
  }

  return headers;
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: buildSecurityHeaders(),
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/terms-of-service",
        destination: "/terms",
        permanent: true,
      },
      {
        source: "/privacy-policy",
        destination: "/privacy",
        permanent: true,
      },
      {
        source: "/refund-policy",
        destination: "/refund",
        permanent: true,
      },
      {
        source: "/cancellation-policy",
        destination: "/refund",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
