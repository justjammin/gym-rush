import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { continueCost, energyFor, maxWalls } from '../src/worker.js';

const root = new URL('..', import.meta.url);
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });

let mf, db;

before(async () => {
  mf = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    scriptPath: new URL('src/worker.js', root).pathname,
    compatibilityDate: '2026-10-01',
    d1Databases: ['DB'],
    // A stand-in for the CrazyGames key, in the same bare PKCS#1 form CrazyGames publishes, on one line.
    bindings: {
      CG_PUBLIC_KEY: keys.publicKey.export({ type: 'pkcs1', format: 'pem' }).replace(/\n/g, ''),
      ALLOWED_ORIGINS: 'https://justjammin.github.io,*.crazygames.com',
    },
  }));
  db = await mf.getD1Database('DB');
  const schema = readFileSync(new URL('migrations/0001_init.sql', root), 'utf8').replace(/--.*$/gm, '');
  for (const sql of schema.split(';').map(s => s.trim()).filter(Boolean)) await db.prepare(sql).run();
});

after(() => mf.dispose());

async function call(path, { token, body, method = body ? 'POST' : 'GET', headers = {} } = {}) {
  const res = await mf.dispatchFetch(`http://api.test${path}`, {
    method,
    headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(body && { 'Content-Type': 'application/json' }), ...headers },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json(), headers: res.headers };
}

let ipSeq = 0;
async function newPlayer(energy = 0) {
  const { body } = await call('/device', { method: 'POST', headers: { 'CF-Connecting-IP': `10.0.0.${++ipSeq}` } });
  const token = `dev:${body.device}`;
  assert.equal((await call('/wallet', { token })).status, 200);
  await db.prepare('UPDATE players SET energy = ? WHERE id = ?').bind(energy, `dev:${body.device.split('.')[0]}`).run();
  return token;
}

async function startRun(token, secondsAgo = 0) {
  const { body } = await call('/run', { token, body: {} });
  await db.prepare('UPDATE runs SET started = started - ? WHERE id = ?').bind(secondsAgo * 1000, body.run).run();
  return body.run;
}

const b64url = buf => Buffer.from(buf).toString('base64url');
function jwt(claims, privateKey = keys.privateKey) {
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })), payload = b64url(JSON.stringify(claims));
  return `${head}.${payload}.${b64url(sign('sha256', Buffer.from(`${head}.${payload}`), privateKey))}`;
}
const hourFromNow = () => Math.floor(Date.now() / 1000) + 3600;

describe('identity', () => {
  test('a CrazyGames token signed by CrazyGames opens that user\'s wallet', async () => {
    const res = await call('/wallet', { token: `cg:${jwt({ userId: 'u1', gameId: 'g', exp: hourFromNow() })}` });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { energy: 0 });
  });

  test('a token signed by any other key is refused', async () => {
    const res = await call('/wallet', { token: `cg:${jwt({ userId: 'u1', exp: hourFromNow() }, otherKeys.privateKey)}` });
    assert.deepEqual([res.status, res.body.error], [401, 'bad_token']);
  });

  test('an expired token is refused', async () => {
    const res = await call('/wallet', { token: `cg:${jwt({ userId: 'u1', exp: Math.floor(Date.now() / 1000) - 5 })}` });
    assert.deepEqual([res.status, res.body.error], [401, 'expired_token']);
  });

  test('a token with its claims edited is refused', async () => {
    const [h, , s] = jwt({ userId: 'u1', exp: hourFromNow() }).split('.');
    const res = await call('/wallet', { token: `cg:${h}.${b64url(JSON.stringify({ userId: 'admin', exp: hourFromNow() }))}.${s}` });
    assert.deepEqual([res.status, res.body.error], [401, 'bad_token']);
  });

  test('a device token with the wrong secret is refused', async () => {
    const token = await newPlayer();
    const res = await call('/wallet', { token: token.replace(/\.[^.]+$/, '.wrong') });
    assert.deepEqual([res.status, res.body.error], [401, 'bad_token']);
  });

  test('one address can make only 20 devices a day', async () => {
    const make = () => call('/device', { method: 'POST', headers: { 'CF-Connecting-IP': '192.0.2.9' } });
    for (let i = 0; i < 20; i++) assert.equal((await make()).status, 200);
    assert.deepEqual([(await make()).status], [429]);
  });
});

describe('earning', () => {
  test('a run cannot claim more walls than its elapsed time allows', async () => {
    const token = await newPlayer();
    const run = await startRun(token, 60);
    const cap = Math.floor(maxWalls(60) * 1.1) + 1;
    const res = await call(`/run/${run}/settle`, { token, body: { walls: 1000, perfects: 1000 } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { energy: energyFor(cap, cap), earned: energyFor(cap, cap) });
  });

  test('a run that just started can claim at most one wall', async () => {
    const token = await newPlayer();
    const run = await startRun(token);
    const res = await call(`/run/${run}/settle`, { token, body: { walls: 50, perfects: 0 } });
    assert.deepEqual(res.body, { energy: 1, earned: 1 });
  });

  test('re-sending or lowering the totals credits nothing more', async () => {
    const token = await newPlayer();
    const run = await startRun(token, 120);
    const first = await call(`/run/${run}/settle`, { token, body: { walls: 10, perfects: 4 } });
    assert.deepEqual(first.body, { energy: 18, earned: 18 });
    for (const body of [{ walls: 10, perfects: 4 }, { walls: 3, perfects: 0 }]) {
      assert.deepEqual((await call(`/run/${run}/settle`, { token, body })).body, { energy: 18, earned: 18 });
    }
  });

  test('settles racing on one run credit the gain once', async () => {
    const token = await newPlayer();
    const run = await startRun(token, 120);
    await Promise.all(Array.from({ length: 8 }, () => call(`/run/${run}/settle`, { token, body: { walls: 10, perfects: 0 } })));
    assert.deepEqual((await call('/wallet', { token })).body, { energy: 10 });
  });

  test('starting a new run closes the old one', async () => {
    const token = await newPlayer();
    const old = await startRun(token, 120);
    await startRun(token);
    const res = await call(`/run/${old}/settle`, { token, body: { walls: 10, perfects: 0 } });
    assert.deepEqual([res.status, res.body.error], [409, 'run_closed']);
  });

  test('a player cannot settle someone else\'s run', async () => {
    const run = await startRun(await newPlayer(), 120);
    const res = await call(`/run/${run}/settle`, { token: await newPlayer(), body: { walls: 10, perfects: 0 } });
    assert.deepEqual([res.status, res.body.error], [404, 'no_run']);
  });

  test('ending a run closes it', async () => {
    const token = await newPlayer();
    const run = await startRun(token, 120);
    assert.equal((await call(`/run/${run}/settle`, { token, body: { walls: 2, perfects: 0, end: true } })).status, 200);
    assert.equal((await call(`/run/${run}/settle`, { token, body: { walls: 3, perfects: 0 } })).status, 409);
  });
});

describe('continuing', () => {
  test('a continue the player cannot afford is refused and leaves the balance alone', async () => {
    const token = await newPlayer(10);
    const run = await startRun(token);
    const res = await call(`/run/${run}/continue`, { token, body: { method: 'energy', n: 1, walls: 0, perfects: 0 } });
    assert.deepEqual([res.status, res.body.error], [409, 'short']);
    assert.deepEqual((await call('/wallet', { token })).body, { energy: 10 });
    assert.equal(await db.prepare('SELECT 1 FROM continues WHERE run = ?').bind(run).first(), null);
  });

  test('energy continues cost 30, then double', async () => {
    const token = await newPlayer(100);
    const run = await startRun(token);
    const one = await call(`/run/${run}/continue`, { token, body: { method: 'energy', n: 1, walls: 0, perfects: 0 } });
    assert.deepEqual(one.body, { energy: 70, cost: 60 });
    const two = await call(`/run/${run}/continue`, { token, body: { method: 'energy', n: 2, walls: 0, perfects: 0 } });
    assert.deepEqual(two.body, { energy: 10, cost: 120 });
    assert.equal(continueCost(3), 120);
  });

  test('energy earned in the run so far counts toward the continue', async () => {
    const token = await newPlayer(25);
    const run = await startRun(token, 120);
    const res = await call(`/run/${run}/continue`, { token, body: { method: 'energy', n: 1, walls: 5, perfects: 0 } });
    assert.deepEqual(res.body, { energy: 0, cost: 60 });
  });

  test('a double-submitted continue is charged once', async () => {
    const token = await newPlayer(100);
    const run = await startRun(token);
    const body = { method: 'energy', n: 1, walls: 0, perfects: 0 };
    const [a, b] = await Promise.all([call(`/run/${run}/continue`, { token, body }), call(`/run/${run}/continue`, { token, body })]);
    assert.deepEqual([a.status, b.status], [200, 200]);
    const again = await call(`/run/${run}/continue`, { token, body });
    assert.equal(again.status, 200);
    assert.deepEqual((await call('/wallet', { token })).body, { energy: 70 });
  });

  test('an ad continue is free and allowed once per run', async () => {
    const token = await newPlayer(0);
    const run = await startRun(token);
    const first = await call(`/run/${run}/continue`, { token, body: { method: 'ad', n: 1, walls: 0, perfects: 0 } });
    assert.deepEqual([first.status, first.body], [200, { energy: 0, cost: 60 }]);
    const second = await call(`/run/${run}/continue`, { token, body: { method: 'ad', n: 2, walls: 0, perfects: 0 } });
    assert.deepEqual([second.status, second.body.error], [409, 'ad_used']);
  });

  test('a continue number already used another way is refused', async () => {
    const token = await newPlayer(100);
    const run = await startRun(token);
    await call(`/run/${run}/continue`, { token, body: { method: 'ad', n: 1, walls: 0, perfects: 0 } });
    const res = await call(`/run/${run}/continue`, { token, body: { method: 'energy', n: 1, walls: 0, perfects: 0 } });
    assert.deepEqual([res.status, res.body.error], [409, 'continue_taken']);
    assert.deepEqual((await call('/wallet', { token })).body, { energy: 100 });
  });

  test('malformed requests are refused', async () => {
    const token = await newPlayer(100);
    const run = await startRun(token);
    for (const body of [{ method: 'energy', n: 0, walls: 0, perfects: 0 }, { method: 'gold', n: 1, walls: 0, perfects: 0 }, { method: 'energy', n: 1, walls: -1, perfects: 0 }]) {
      assert.equal((await call(`/run/${run}/continue`, { token, body })).status, 400);
    }
  });
});

describe('browsers', () => {
  test('the game\'s origins get CORS headers and others do not', async () => {
    const allowed = ['https://justjammin.github.io', 'https://games.crazygames.com', 'http://localhost:4198'];
    for (const origin of allowed) {
      const res = await call('/device', { method: 'OPTIONS', headers: { Origin: origin } });
      assert.equal(res.headers.get('Access-Control-Allow-Origin'), origin, origin);
    }
    for (const origin of ['https://evil.example', 'https://crazygames.com.evil.example', 'http://games.crazygames.com']) {
      const res = await call('/device', { method: 'OPTIONS', headers: { Origin: origin } });
      assert.equal(res.headers.get('Access-Control-Allow-Origin'), null, origin);
    }
  });
});
