// Pure helpers, shared by the Worker and Node's built-in test runner.
export const DATASET = "https://data.seattle.gov/resource/76t5-zqzr.json";
export const DATASET_PAGE = "https://data.seattle.gov/d/76t5-zqzr";
export const PRICE_USD = 79;

export function clampInt(value, fallback, min, max) {
  const n = Number(value);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export function parseFilters(input = {}) {
  const type = String(input.type || "all").toLowerCase();
  const category = ["all", "building", "demolition", "roofing", "grading"].includes(type) ? type : "all";
  const sector = String(input.sector || "all").toLowerCase();
  const segment = ["all", "residential", "non-residential"].includes(sector) ? sector : "all";
  return {
    type: category,
    sector: segment,
    minCost: clampInt(input.minCost, 0, 0, 1000000000),
    keyword: String(input.keyword || "").trim().slice(0, 60).replace(/[<>]/g, "")
  };
}

export function cleanPermit(p) {
  return {
    id: String(p.permitnum || ""),
    type: String(p.permittypemapped || "Other"),
    detail: String(p.permittypedesc || ""),
    sector: String(p.permitclassmapped || "Unknown"),
    description: String(p.description || ""),
    status: String(p.statuscurrent || "Unknown"),
    address: String(p.originaladdress1 || ""),
    zip: String(p.originalzip || ""),
    cost: Number(p.estprojectcost) || 0,
    applied: p.applieddate || null,
    issued: p.issueddate || null
  };
}

export function matches(p, f) {
  if (f.type !== "all" && !p.type.toLowerCase().includes(f.type)) return false;
  if (f.sector !== "all" && p.sector.toLowerCase() !== f.sector) return false;
  if (p.cost < f.minCost) return false;
  if (f.keyword) {
    const haystack = [p.description, p.address, p.zip, p.id, p.detail].join(" ").toLowerCase();
    if (!haystack.includes(f.keyword.toLowerCase())) return false;
  }
  return true;
}

export function csvEscape(value) {
  // Prevent Excel/Sheets formula injection when exporting untrusted public descriptions.
  let str = String(value ?? "").replace(/\r?\n/g, " ");
  if (/^[\s]*[=+@\-]/.test(str)) str = "'" + str;
  return '"' + str.replace(/"/g, '""') + '"';
}

export function makeCsv(rows) {
  const fields = ["id", "applied", "issued", "type", "detail", "sector", "status", "address", "zip", "cost", "description"];
  return "\ufeff" + fields.join(",") + "\r\n" + rows.map(p => fields.map(field => csvEscape(p[field])).join(",")).join("\r\n");
}

export function htmlEscape(input) {
  return String(input ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

export function isEmail(email) {
  return typeof email === "string" && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isEnabled(env) {
  return Boolean(env.SUBSCRIBERS && env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_ID &&
    env.STRIPE_WEBHOOK_SECRET && env.RESEND_API_KEY && env.ALERT_FROM_EMAIL);
}

export async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, "0")).join("");
}

export async function stripeSignatureIsValid(payload, header, secret, now = Date.now()) {
  if (!header || !secret) return false;
  const pairs = Object.fromEntries(header.split(",").map(p => p.split("=", 2)));
  const ts = Number(pairs.t);
  if (!Number.isInteger(ts) || Math.abs(now / 1000 - ts) > 300 || !pairs.v1) return false;
  const hmac = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", hmac, new TextEncoder().encode(ts + "." + payload));
  const expected = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
  // Equal-length, non-short-circuit comparison.
  if (expected.length !== pairs.v1.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ pairs.v1.charCodeAt(i);
  return mismatch === 0;
}
