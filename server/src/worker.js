// Gym Rush energy server. It owns every player's energy balance, so editing the page or its storage can't mint any.
// The game itself runs on the player's device, so this server can't prove a wall was cleared. Instead it caps what
// a run can earn at the number of walls the game's own schedule allows in the time since the run began.

const ENERGY_GOOD = 1, ENERGY_PERFECT = 3, CONTINUE_COST = 30, MAX_CONTINUES = 10;
const DEVICES_PER_IP_PER_DAY = 20, RUN_TTL = 3 * 3600e3, CAP_SLACK = 1.1;
const CG_KEY_URL = 'https://sdk.crazygames.com/publicKey.json';

// Mirrors the wall schedule in index.html: speed(), WALLS_PER_STAGE, ZMAX and the gaps spawnWall() picks.
const ZMAX = 1150, WALLS_PER_STAGE = 8;
const speed = lv => Math.min(380 + 42 * (lv - 1), 880);
const minGap = lv => (lv >= 3 ? 250 : Math.max(430, 720 - 38 * lv));

// The most walls anyone could reach in `seconds`: every gap at its shortest, every stage at full speed, no crashes.
export function maxWalls(seconds) {
  let n = 0, time = ZMAX / speed(1);
  while (time <= seconds) {
    n++;
    const lv = 1 + Math.floor(n / WALLS_PER_STAGE);
    time += minGap(lv) / speed(lv);
  }
  return n;
}

export const energyFor = (walls, perfects) => (walls - perfects) * ENERGY_GOOD + perfects * ENERGY_PERFECT;
export const continueCost = n => CONTINUE_COST * 2 ** (n - 1);

class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export default {
  async fetch(req, env) {
    const cors = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    let res;
    try {
      res = await route(req, env);
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      res = json({ error: e.code }, e.status);
    }
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  },
};

async function route(req, env) {
  const { pathname } = new URL(req.url);
  const [, a, id, action] = pathname.split('/');
  if (req.method === 'POST' && pathname === '/device') return newDevice(req, env);
  const player = await authenticate(req, env);
  if (req.method === 'GET' && pathname === '/wallet') return json({ energy: await balance(env, player) });
  if (req.method === 'POST' && pathname === '/run') return startRun(env, player);
  if (req.method === 'POST' && a === 'run' && id && action === 'settle') {
    const body = await readBody(req);
    return json(await settle(env, player, id, body.walls, body.perfects, body.end === true));
  }
  if (req.method === 'POST' && a === 'run' && id && action === 'continue') return continueRun(env, player, id, await readBody(req));
  throw new HttpError(404, 'not_found');
}

function corsHeaders(req, env) {
  const origin = req.headers.get('Origin');
  if (!origin || !originAllowed(origin, env.ALLOWED_ORIGINS || '')) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function originAllowed(origin, list) {
  let url;
  try { url = new URL(origin); } catch (e) { return false; }
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return true;
  return list.split(',').map(s => s.trim()).filter(Boolean).some(rule =>
    rule.startsWith('*.') ? url.protocol === 'https:' && url.hostname.endsWith(rule.slice(1)) : origin === rule);
}

async function readBody(req) {
  try { return await req.json(); } catch (e) { throw new HttpError(400, 'bad_request'); }
}

function count(v) {
  if (!Number.isSafeInteger(v) || v < 0) throw new HttpError(400, 'bad_request');
  return v;
}

// Players sign in with `Bearer cg:<CrazyGames user token>` or `Bearer dev:<device token from POST /device>`.
async function authenticate(req, env) {
  const m = (req.headers.get('Authorization') || '').match(/^Bearer (cg|dev):(\S+)$/);
  if (!m) throw new HttpError(401, 'unauthenticated');
  const id = m[1] === 'cg' ? `cg:${await crazyGamesUser(m[2], env)}` : `dev:${await deviceId(m[2], env)}`;
  await env.DB.prepare('INSERT OR IGNORE INTO players (id, created) VALUES (?, ?)').bind(id, Date.now()).run();
  return id;
}

async function newDevice(req, env) {
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown', day = Math.floor(Date.now() / 864e5);
  const { n } = await env.DB.prepare(
    'INSERT INTO device_ips (ip, day, n) VALUES (?, ?, 1) ON CONFLICT (ip, day) DO UPDATE SET n = n + 1 RETURNING n',
  ).bind(ip, day).first();
  if (n > DEVICES_PER_IP_PER_DAY) throw new HttpError(429, 'too_many_devices');
  const id = hex(crypto.getRandomValues(new Uint8Array(16))), secret = base64url(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare('INSERT INTO devices (id, secret_hash, created) VALUES (?, ?, ?)').bind(id, await sha256(secret), Date.now()).run();
  return json({ device: `${id}.${secret}` });
}

async function deviceId(token, env) {
  const [id, secret] = token.split('.');
  const row = id && secret && await env.DB.prepare('SELECT secret_hash FROM devices WHERE id = ?').bind(id).first();
  if (!row || row.secret_hash !== await sha256(secret)) throw new HttpError(401, 'bad_token');
  return id;
}

let cgKey = null;

// CrazyGames user tokens are RS256 JWTs. The key can rotate, so a failed check re-fetches it once before refusing.
async function crazyGamesUser(jwt, env) {
  const [h, p, s] = jwt.split('.');
  let header, claims, sig;
  try {
    header = JSON.parse(text(base64urlBytes(h)));
    claims = JSON.parse(text(base64urlBytes(p)));
    sig = base64urlBytes(s);
  } catch (e) { throw new HttpError(401, 'bad_token'); }
  if (header.alg !== 'RS256') throw new HttpError(401, 'bad_token');
  const signed = new TextEncoder().encode(`${h}.${p}`);
  const check = async () => crypto.subtle.verify('RSASSA-PKCS1-v1_5', await crazyGamesKey(env), sig, signed);
  let ok = await check().catch(() => false);
  if (!ok && !env.CG_PUBLIC_KEY) { cgKey = null; ok = await check().catch(() => false); }
  if (!ok) throw new HttpError(401, 'bad_token');
  if (!(claims.exp * 1000 > Date.now())) throw new HttpError(401, 'expired_token');
  if (env.CG_GAME_ID && claims.gameId !== env.CG_GAME_ID) throw new HttpError(401, 'bad_token');
  if (typeof claims.userId !== 'string' || !claims.userId) throw new HttpError(401, 'bad_token');
  return claims.userId;
}

function crazyGamesKey(env) {
  cgKey ??= (async () => {
    const pem = env.CG_PUBLIC_KEY || (await (await fetch(CG_KEY_URL)).json()).publicKey;
    const der = base64urlBytes(pem.replace(/-----[^-]+-----/g, '').replace(/[^A-Za-z0-9+/]/g, ''));
    const spki = /BEGIN RSA PUBLIC KEY/.test(pem) ? spkiFromPkcs1(der) : der;
    return crypto.subtle.importKey('spki', spki, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  })();
  cgKey.catch(() => { cgKey = null; });
  return cgKey;
}

// WebCrypto imports only SubjectPublicKeyInfo, and CrazyGames publishes a bare PKCS#1 RSAPublicKey, so wrap it:
// SEQUENCE { SEQUENCE { rsaEncryption OID, NULL }, BIT STRING { 0x00, key } }.
function spkiFromPkcs1(key) {
  const rsaEncryption = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  return new Uint8Array(der(0x30, [...rsaEncryption, ...der(0x03, [0x00, ...key])]));
}

function der(tag, body) {
  const n = body.length;
  return [tag, ...(n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : [0x82, n >> 8, n & 0xff]), ...body];
}

async function balance(env, player) {
  return (await env.DB.prepare('SELECT energy FROM players WHERE id = ?').bind(player).first()).energy;
}

// Starting a run closes the player's other runs, so only one run per player can be earning at a time.
async function startRun(env, player) {
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare('UPDATE runs SET closed = 1 WHERE player = ? AND closed = 0').bind(player),
    env.DB.prepare('INSERT INTO runs (id, player, started) VALUES (?, ?, ?)').bind(id, player, Date.now()),
  ]);
  return json({ run: id, energy: await balance(env, player), cost: continueCost(1) });
}

async function openRun(env, player, id) {
  const run = await env.DB.prepare('SELECT * FROM runs WHERE id = ? AND player = ?').bind(id, player).first();
  if (!run) throw new HttpError(404, 'no_run');
  if (run.closed) throw new HttpError(409, 'run_closed');
  return run;
}

// The client reports its run totals so far. They only ever go up, and walls are capped by elapsed time, so
// re-sending the same totals (a retry) credits nothing twice.
async function settle(env, player, id, walls, perfects, end) {
  const run = await openRun(env, player, id);
  const seconds = Math.min(Date.now() - run.started, RUN_TTL) / 1000;
  const cap = Math.floor(maxWalls(seconds) * CAP_SLACK) + 1;
  const w = Math.max(run.walls, Math.min(count(walls), cap));
  const pf = Math.max(run.perfects, Math.min(count(perfects), w));
  const gain = energyFor(w, pf) - energyFor(run.walls, run.perfects);
  if (gain > 0 || end) {
    // Guarded by the totals just read, so of two settles racing on one run only one credits the gain.
    const { meta } = await env.DB.prepare(
      'UPDATE runs SET walls = ?, perfects = ?, closed = ? WHERE id = ? AND walls = ? AND perfects = ? AND closed = 0',
    ).bind(w, pf, end ? 1 : 0, id, run.walls, run.perfects).run();
    if (meta.changes === 1 && gain > 0) await env.DB.prepare('UPDATE players SET energy = energy + ? WHERE id = ?').bind(gain, player).run();
  }
  const now = await env.DB.prepare('SELECT walls, perfects FROM runs WHERE id = ?').bind(id).first();
  return { energy: await balance(env, player), earned: energyFor(now.walls, now.perfects) };
}

// Continue n of a run costs CONTINUE_COST doubled n-1 times; an ad continue is free but allowed once per run.
async function continueRun(env, player, id, body) {
  const n = count(body.n), method = body.method;
  if (n < 1 || n > MAX_CONTINUES || (method !== 'energy' && method !== 'ad')) throw new HttpError(400, 'bad_request');
  await settle(env, player, id, body.walls, body.perfects, false);
  const cost = method === 'ad' ? 0 : continueCost(n);
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO continues (run, n, method, cost) VALUES (?, ?, ?, ?)').bind(id, n, method, cost),
      env.DB.prepare('UPDATE players SET energy = energy - ? WHERE id = ?').bind(cost, player),
    ]);
  } catch (e) {
    const same = await env.DB.prepare('SELECT method FROM continues WHERE run = ? AND n = ?').bind(id, n).first();
    if (!same) {
      const adUsed = method === 'ad' && await env.DB.prepare("SELECT 1 FROM continues WHERE run = ? AND method = 'ad'").bind(id).first();
      throw new HttpError(409, adUsed ? 'ad_used' : 'short');
    }
    if (same.method !== method) throw new HttpError(409, 'continue_taken');
  }
  return json({ energy: await balance(env, player), cost: continueCost(n + 1) });
}

const text = bytes => new TextDecoder().decode(bytes);
const hex = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
const base64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function base64urlBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), c => c.charCodeAt(0));
}
const sha256 = async s => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));
