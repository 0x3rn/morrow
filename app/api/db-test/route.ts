import { env } from "cloudflare:workers";

export async function GET() {
  const result = await env.DB.prepare(
    "SELECT 1 AS connected"
  ).first<{ connected: number }>();

  return Response.json({
    connected: result?.connected === 1,
  });
}