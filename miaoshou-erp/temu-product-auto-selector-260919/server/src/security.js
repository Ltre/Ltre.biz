const enc = new TextEncoder();
const dec = new TextDecoder();

export function nowIso() { return new Date().toISOString(); }
export function plusMinutes(minutes) { return new Date(Date.now() + Number(minutes || 0) * 60000).toISOString(); }
export function plusDays(days) { return new Date(Date.now() + Number(days || 0) * 86400000).toISOString(); }

export function randomHex(bytes = 24) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map(x => x.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(String(value)));
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}

export async function sha1Hex(value) {
  const digest = await crypto.subtle.digest('SHA-1', enc.encode(String(value)));
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}

function b64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function unb64(s) {
  const raw = atob(s);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

async function importMasterKey(base64) {
  if (!base64) throw new Error('UPSTREAM_MASTER_KEY 未配置');
  const raw = unb64(base64.trim());
  if (raw.length !== 32) throw new Error('UPSTREAM_MASTER_KEY 必须是 32 字节 base64');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptJson(masterKeyB64, obj) {
  if (obj == null) return null;
  const iv = new Uint8Array(12); crypto.getRandomValues(iv);
  const key = await importMasterKey(masterKeyB64);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return `v1.${b64(iv)}.${b64(new Uint8Array(ciphertext))}`;
}

export async function decryptJson(masterKeyB64, payload) {
  if (!payload) return {};
  const [version, ivs, cts] = String(payload).split('.');
  if (version !== 'v1' || !ivs || !cts) throw new Error('无法识别的凭据密文格式');
  const key = await importMasterKey(masterKeyB64);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(ivs) }, key, unb64(cts));
  return JSON.parse(dec.decode(plain));
}

export function safeEqualText(a, b) {
  const aa = String(a || ''), bb = String(b || '');
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa.charCodeAt(i) ^ bb.charCodeAt(i);
  return diff === 0;
}
