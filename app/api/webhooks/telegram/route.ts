import { env } from "cloudflare:workers";
import { createTelegramWebhookHandler } from "@/lib/telegram-bot";

export const POST = createTelegramWebhookHandler(env);
