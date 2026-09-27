// Secrets are set with `wrangler secret put` and never appear in wrangler.jsonc,
// so `wrangler types` cannot see them. Declaration-merge them onto the
// generated Env here (this file must stay a global script: no import/export).
// Every secret is optional: the gateway degrades gracefully when one is unset.
interface Env {
  AISSTREAM_API_KEY?: string;
  TOMTOM_API_KEY?: string;
  SWIFTLY_API_KEY?: string;
}
