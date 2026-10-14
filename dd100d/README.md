# SiteSignal — dd100d remote-income experiment

An automated, globally accessible **website audit micro-product** deployed as a Cloudflare Worker. Free homepage diagnostics → one-time $59 report sale via Stripe Checkout → Stripe webhook → private report stored in Cloudflare KV → email via Resend.

**Business hypothesis, not a revenue guarantee:** 2 sales/day × $59 = $118/day gross before fees, refunds, taxes, operating costs. Current paid conversion rate and customer demand are unknown. Do not advertise this as verified income.

## GitHub Pages preview (no credentials needed)

Static demo files are at `dd100d/preview/` on the `dd100d` branch. The workflow `.github/workflows/dd100d-pages.yml` uploads and deploys **only this directory** to GitHub Pages, leaving `main` untouched. The page includes a labeled fictional sample report and a real, **fully client-side HTML markup analyzer**; URL scanning is opportunistic and subject to cross-origin restrictions. Payments are visibly disabled.

**One-time GitHub Pages initialization:** go to `https://github.com/Ltre/Ltre.biz/settings/pages` → Build and deployment → Source → **GitHub Actions**. GitHub's `GITHUB_TOKEN` cannot enable Pages for a repository that has never used it; this repository currently returns `Get Pages site failed: Not Found`. After selecting GitHub Actions, run `Deploy dd100d preview to GitHub Pages` via Actions → Run workflow on branch `dd100d` (or push another change). The expected site address after a successful deploy, barring a custom domain, is `https://ltre.github.io/Ltre.biz/`.

You can also open `dd100d/preview/index.html` as a local static file to preview the UI. Its CSS and JS use relative paths and no build step.

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