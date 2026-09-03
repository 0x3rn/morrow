import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";

import {
  kvDataAdapter,
} from "@vinext/cloudflare/cache/kv-data-adapter";

import {
  cdnAdapter,
} from "@vinext/cloudflare/cache/cdn-adapter";

import {
  imagesOptimizer,
} from "@vinext/cloudflare/images/images-optimizer";

export default defineConfig({
  plugins: [
    vinext({
      /*
       * Morrow runs as a Cloudflare Worker-backed SaaS.
       *
       * Server components and server actions use real
       * Cloudflare bindings such as:
       *
       * - D1
       * - R2
       * - KV
       * - Workers AI
       * - Browser Run
       *
       * We intentionally DO NOT configure:
       *
       * prerender: {
       *   routes: "*"
       * }
       *
       * Vinext's all-route build-time prerender currently
       * loads the Worker bundle inside bare Node.
       *
       * That environment cannot resolve the Workerd-only
       * "cloudflare:workers" virtual module.
       *
       * Morrow therefore keeps its authenticated application
       * server-rendered inside the Cloudflare Worker runtime.
       */

      cache: {
        /*
         * Existing Workers KV-backed Next.js data cache.
         *
         * Wrangler binding:
         * VINEXT_KV_CACHE
         */
        data:
          kvDataAdapter(),

        /*
         * Existing Cloudflare Workers Cache integration.
         *
         * wrangler.jsonc already contains:
         *
         * "cache": {
         *   "enabled": true
         * }
         */
        cdn:
          cdnAdapter(),
      },

      /*
       * Existing Cloudflare Images optimization.
       *
       * Wrangler binding:
       * IMAGES
       */
      images: {
        optimizer:
          imagesOptimizer(),
      },
    }),

    /*
     * Run the RSC and SSR environments inside the
     * Cloudflare runtime.
     *
     * This is what allows application server code to use:
     *
     * import { env } from "cloudflare:workers";
     */
    cloudflare({
      viteEnvironment: {
        name:
          "rsc",

        childEnvironments: [
          "ssr",
        ],
      },
    }),
  ],
});