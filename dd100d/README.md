# SiteSignal — dd100d remote-income experiment

An automated, globally accessible **website audit micro-product** deployed as a Cloudflare Worker. Free homepage diagnostics → one-time $59 report sale via Stripe Checkout → Stripe webhook → private report stored in Cloudflare KV → email via Resend.

**Business hypothesis, not a revenue guarantee:** 2 sales/day × $59 = $118/day gross before fees, refunds, taxes, operating costs. Current paid conversion rate and customer demand are unknown. Do not advertise this as verified income.

## Local checks
```sh
cd dd100d
npm install
npm test
npm run dev
```

## Cloudflare setup
1. `npx wrangler login` and `npx wrangler kv namespace create REPORTS`. Put the new namespace ID into `wrangler.jsonc` (replace placeholder).
2. Use `npx wrangler secret put STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, and `MAIL_FROM` (verified Resend sender).
3. `npx wrangler deploy`. Configure Stripe's `checkout.session.completed` webhook at `https://YOUR_DOMAIN/api/stripe-webhook`. Set signing secret.
4. Configure production domain, business contact, tax policies, Terms and refunds before collecting real payments. Verify a real Stripe test-mode purchase end to end.
5. GitHub Actions automatic deployment requires repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

Endpoints: `/` landing page; `/api/scan?url=https://example.com` free audit; `/api/checkout` payment session; `/api/stripe-webhook` webhook; `/report/{token}` shareable audit; `/health` readiness.

**Production hardening still required:** add Cloudflare WAF/rate limits, require robots/terms compliance, pin a trusted public origin instead of request Host for links, protect against DNS rebinding and outbound SSRF (validation alone is not enough), transactional idempotency/outbox for webhook retries, proper support/refund/privacy policies, monitoring, and multiple-site testing. Do not enable real money checkout until hardened. This is a functional technical MVP, not a finished commercial service.

**Status:** source pushed to branch dd100d; Cloudflare deployment not performed from this environment because authenticated Cloudflare access is not connected.