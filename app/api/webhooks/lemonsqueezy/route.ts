import { env } from "cloudflare:workers";
import { createLemonSqueezyWebhookHandler } from "@/lib/lemonsqueezy";

export const POST = createLemonSqueezyWebhookHandler(env);
