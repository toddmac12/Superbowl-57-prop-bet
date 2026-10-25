const enc = new TextEncoder();
const cookieName = '__Host-commcrae-access';
const lifetime = 8 * 60 * 60;
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
const unhex = value => Uint8Array.from(value.match(/../g) || [], b => parseInt(b, 16));
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function secure(response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Strict-Transport-Security', 'max-age=31536000');
  headers.set('Vary', 'Cookie');
  return new Response(response.body, { status: response.status, headers });
}
function page(title, message = '', next = '/', status = 200) {
  return secure(new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unlock ${escape(title)} · CommCrae</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#f6f4ee;color:#192b29;font:16px system-ui,sans-serif}main{box-sizing:border-box;width:min(420px,calc(100% - 32px));background:#fff;padding:38px;border:1px solid #dedfd6;border-radius:20px;box-shadow:0 18px 55px #1230250a}a{color:#32664a}small{letter-spacing:.12em;text-transform:uppercase;color:#597063}h1{font-size:30px;margin:20px 0 10px}p{line-height:1.6;color:#59635d}label{display:block;font-weight:650;margin:25px 0 8px}input,button{box-sizing:border-box;width:100%;font:inherit;padding:14px;border-radius:9px}input{border:1px solid #aab8ad}button{margin-top:14px;border:0;background:#244d37;color:#fff;font-weight:650;cursor:pointer}input:focus-visible,button:focus-visible{outline:3px solid #a3c4ae;outline-offset:3px}.error{color:#a52e25}footer{margin-top:25px;font-size:14px}</style></head><body><main><small>CommCrae · Private app</small><h1>${escape(title)}</h1><p>Enter this app’s access code to continue.</p>${message ? `<p class="error" role="alert">${escape(message)}</p>` : ''}<form method="post" action="/_access"><input type="hidden" name="next" value="${escape(next)}"><label for="code">Access code</label><input id="code" name="code" type="password" autocomplete="current-password" maxlength="128" required autofocus><button>Unlock app</button></form><footer><a href="https://commcrae.com/">← All apps</a></footer></main></body></html>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" } }));
}
function safeNext(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !/[\\\x00-\x20\x7f]/.test(value) && !value.startsWith('/_access') ? value : '/';
}
async function mac(secret, value) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(value)));
}
async function equal(a, b) {
  // Compare fixed-size digests, not the submitted code's length or prefix.
  const x = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(a)));
  const y = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(b)));
  let diff = 0; for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
export async function verifyCode(code, verifier) {
  const key = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveBits']);
  const hash = hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:unhex(verifier.salt),iterations:100000,hash:'SHA-256'},key,256));
  return equal(hash, verifier.hash);
}
export function memoryLimiter() {
  const buckets = new Map();
  return async key => {
    const now = Date.now();
    for (const [k,v] of buckets) if (v.until <= now) buckets.delete(k);
    const item = buckets.get(key) || { count: 0, until: now + 900000 };
    // Bound isolate memory. Persistent limiters can be supplied by the host.
    if (buckets.size >= 10000 && !buckets.has(key)) return false;
    item.count++; buckets.set(key, item);
    return item.count <= 10;
  };
}
export async function access(request, {title, secret, code, verifier, consume}) {
  const url = new URL(request.url);
  if (typeof secret !== 'string' || secret.length < 32 || (!code && !verifier)) return secure(new Response('Access setup is required.', {status:503}));
  const version = await mac(secret, code || verifier.hash);
  const scope = `${url.host}:${title}:${version}`;
  const now = Math.floor(Date.now() / 1000);
  const redirect = (to, cookie) => secure(new Response(null, {status:303,headers:{Location:to,...(cookie ? {'Set-Cookie':cookie} : {})}}));
  const cookie = value => `${cookieName}=${value}; Path=/; Max-Age=${lifetime}; Secure; HttpOnly; SameSite=Strict`;
  if (url.pathname === '/_access/logout') {
    if (request.method !== 'POST' || request.headers.get('Origin') !== url.origin) return secure(new Response('Forbidden',{status:403}));
    return redirect('/_access',`${cookieName}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict`);
  }
  if (url.pathname === '/_access') {
    if (request.method === 'GET' || request.method === 'HEAD') return page(title, '', safeNext(url.searchParams.get('next')));
    if (request.method !== 'POST' || request.headers.get('Origin') !== url.origin) return secure(new Response('Forbidden', {status:403}));
    if (!request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded')) return secure(new Response('Invalid form', {status:415}));
    if (Number(request.headers.get('Content-Length')) > 2048) return secure(new Response('Form too large',{status:413}));
    const reader = request.body?.getReader(); let raw = '', size = 0;
    if (reader) { try { while (true) { const {done,value} = await reader.read(); if (done) break; size += value.byteLength; if(size > 2048) { await reader.cancel(); return secure(new Response('Form too large',{status:413})); } raw += new TextDecoder().decode(value,{stream:true}); } } finally {reader.releaseLock();} }
    const form = new URLSearchParams(raw), next = safeNext(form.get('next'));
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const key = await mac(secret, `${scope}:${ip}`);
    if (!await consume(key)) {const r = page(title,'Too many attempts. Try again in 15 minutes.',next,429);r.headers.set('Retry-After','900');return r;}
    const candidate = form.get('code') || '';
    const valid = candidate.length <= 128 && (verifier ? await verifyCode(candidate,verifier) : await equal(candidate,code));
    if (!valid) return page(title,'Incorrect access code. Please try again.',next,401);
    const expiry = now + lifetime;
    return redirect(next, cookie(`${expiry}.${await mac(secret,`${scope}:${expiry}`)}`));
  }
  const session = request.headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  if (session) {
    const parts = session.split('.');
    if (parts.length === 2 && /^\d{10}$/.test(parts[0]) && /^[a-f0-9]{64}$/.test(parts[1])) {
      const expires = Number(parts[0]);
      if (expires > now && expires <= now + lifetime && await equal(parts[1], await mac(secret, `${scope}:${expires}`))) return null;
    }
  }
  if (['GET','HEAD'].includes(request.method) && !url.pathname.startsWith('/api/') && !/\.[a-z0-9]+$/i.test(url.pathname)) return redirect('/_access?next='+encodeURIComponent(safeNext(url.pathname+url.search)));
  return secure(url.pathname.startsWith('/api/')
    ? new Response(JSON.stringify({error:'Access code required. Unlock the app again.'}),{status:401,headers:{'Content-Type':'application/json'}})
    : new Response('Access code required.',{status:401}));
}
