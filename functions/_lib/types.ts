/* Shared types for the Pages Functions (A78). Env declares the bindings/secrets set in the
   Cloudflare Pages dashboard (all optional — the handlers fail closed/soft when one is unset).
   Ctx is the EventContext shape Pages passes to onRequest handlers. KVNamespace/EventContext
   come from @cloudflare/workers-types. */
export interface Env {
  STATUS_KV?: KVNamespace;
  ADMIN_KEY?: string;
  TOKEN_SECRET?: string;
  ADMIN_TOKEN_TTL_SEC?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ALLOW_PRESENCE_AUTH?: string;
  ADMIN_DEBUG?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_ONE_TIME?: string;
  STRIPE_PRICE_SUBSCRIPTION?: string;
}

export type Ctx = EventContext<Env, string, Record<string, unknown>>;
