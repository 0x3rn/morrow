import { env } from "cloudflare:workers";
import { createPolarWebhookHandler } from "@/lib/polar";

export const POST = createPolarWebhookHandler(env);
