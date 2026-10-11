import { env } from "cloudflare:workers";
import { auth } from "@/lib/auth";
import { createAccountSettings } from "@/lib/account-settings";

export const POST = createAccountSettings(env, auth);
