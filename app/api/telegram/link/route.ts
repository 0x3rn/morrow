import { createTelegramLinkValidationHandler } from "@/lib/telegram-bot";
import { env } from "cloudflare:workers";

export async function POST(request: Request) {
  return createTelegramLinkValidationHandler(env)(request);
}
