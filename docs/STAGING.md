# Staging environment

Staging is a full copy of the Morrow stack used for penetration and vulnerability
testing. Never run those tests against production.

| Part | Production | Staging |
| --- | --- | --- |
| Worker | `morrow` | `morrow-staging` |
| URL | custom domain | https://morrow-staging.somtochukwu-ike.workers.dev |
| D1 database | `morrow-db` | `morrow-db-staging` (own data, never a copy of prod) |
| KV cache | `VINEXT_KV_CACHE` | `VINEXT_KV_CACHE_STAGING` |
| R2 bucket | `morrow-snapshots` | `morrow-snapshots-staging` |
| Cron (every 5 min) | on | off (no automatic page checks or alerts) |
| Git branch | `main` | `staging` |

All staging bindings live under `env.staging` in `wrangler.jsonc`. Wrangler does not
inherit bindings into an environment, so nothing in that block may point at a
production id.

## Deploy

From the `staging` branch:

```bash
npm run deploy:staging
```

This builds with `CLOUDFLARE_ENV=staging` and deploys `morrow-staging` only.

## Database

Staging has its own database. Apply new migrations with:

```bash
npm run db:migrate:staging
```

## Secrets (per worker, never in git)

Set with `npx wrangler secret put <NAME> --name morrow-staging`.

| Secret | Staging value |
| --- | --- |
| `BETTER_AUTH_SECRET` | Random value, different from prod (set) |
| `MORROW_APP_URL` | The staging URL above (set) |
| `RESEND_API_KEY` | Staging-only key; without it signup and login codes return 503 |
| `LEMONSQUEEZY_*` | Test-mode store keys only, never live keys |
| `MORROW_TELEGRAM_BOT_TOKEN`, `MORROW_TELEGRAM_WEBHOOK_SECRET` | A separate staging bot |

Do **not** set `BETTER_AUTH_URL` on staging. With it set, `/login` and `/register`
returned a 500 on the deployed worker. The app already falls back to `MORROW_APP_URL`.
