import { env } from "cloudflare:workers";
import { createMorrowAuth } from "./auth-config";

export const auth = createMorrowAuth(env);
