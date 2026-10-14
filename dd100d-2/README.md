# MarginPilot — SKU Profit Stress Tester

**Status: functional local MVP / not validated commercially / no payment collection.**

An offline-first mobile PWA and browser-extension-based tool for cross-border e-commerce sellers. Analyze a **whole SKU portfolio**, rank loss-making items and simulate a combined shock in ads, return rate and FX costs. Runs entirely on your device without Cloudflare, Stripe, web APIs or login.

## Quick start

```sh
cd dd100d-2
npm test
npm run check
npm run extension
cd app && python3 -m http.server 8080
```

Visit `http://localhost:8080` on your computer. For phone testing, serve the app over HTTPS (PWA installation requires a secure context). Another option is opening the bundled Chrome extension.

### Chrome / Chromium extension

Run `npm run extension` from `dd100d-2/`. In desktop Chromium's `chrome://extensions` enable Developer mode → Load unpacked → select `dd100d-2/dist/extension/`. Click the MarginPilot toolbar button → Open dashboard.

**No host permissions, no marketplace scraping, no sign-in, no third-party JavaScript.**

### CSV file

Required columns: `price,cogs`; optional:
`sku,name,shipping,fulfillment,adCpa,returnRate,returnLoss,units`

CSV import accepts common aliases (e.g. `cost`, `sale_price`, `quantity`, `ad_cost`); explicit headers are safest. There is a **2 MB / 5000-SKU limit**; importing replaces the current workspace only after confirmation. Duplicate IDs and malformed cost fields are rejected.

```csv
sku,name,price,cogs,shipping,fulfillment,adCpa,returnRate,returnLoss,units
SKU-1,Test phone stand,28.00,9.00,3.20,1.30,5.00,3,10.00,180
SKU-2,Test pet mat,49.00,23.00,5.50,1.70,8.00,10,27.00,75
```

- All amounts must already use the **same reporting currency** (currency selector only changes display labels).
- `returnLoss` is the **additional loss per returned order**; user must specify what is unrecovered/refunded rather than assuming an automatic refund model.
- Global marketplace/payment/FX rate assumptions are **editable** and **not live fee feeds**.
- Model calculates contribution margin, *not accounting net profit*. No ad attribution or taxes are inferred.
- Browser `localStorage` holds your data. Export CSV before clearing it or switching devices.

## Monetization hypothesis

$39/month for **future** recurring features such as authorized import/sync, threshold alerts, alerts to chat apps and cross-device dashboards. Current MVP stays free; no subscription enforcement or checkout exists. At $39/month, $100/day gross implies ~79 active paying customers; this is **a target, not a guarantee or actual revenue**.

## Project management

See [project thesis, alternatives, competitors and validation gates](./PROJECT.md).

**Branch:** `dd100d-2` derived from `dd100d`. All *new* software lives in `dd100d-2/`; the inherited `dd100d/` is deliberately untouched. No Pages deployment is performed so it cannot replace the earlier SiteSignal preview.
