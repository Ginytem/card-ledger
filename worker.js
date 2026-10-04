// ============================================================
// 卡账记 CardLedger v1.0.0 — Cloudflare Worker 单文件应用
// 个人信用卡资产管理：卡片、账单、还款、额度、年费减免进度
// 安全：动态 HMAC 签名 token（7 天过期）+ 登录失败限流 + 可选 2FA
// ============================================================

const ADMIN_TOKEN = null; // 已废弃：改用动态 HMAC 签名 token（见 signToken/verifyToken）

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      // 前端页面
      if (url.pathname === '/' && request.method === 'GET') {
        return new Response(getHtml(env), {
          headers: {
            'Content-Type': 'text/html;charset=utf-8',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'Pragma': 'no-cache',
          },
        });
      }

      // PWA manifest（可安装到手机/桌面）
      if (url.pathname === '/manifest.webmanifest' && request.method === 'GET') {
        return new Response(JSON.stringify({
          name: '卡账记 CardLedger',
          short_name: '卡账记',
          description: '信用卡管理：账单、还款、额度、年费减免进度',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          background_color: '#eef1f6',
          theme_color: '#6366f1',
          icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
        }), { headers: { 'Content-Type': 'application/manifest+json;charset=utf-8' } });
      }

      // PWA 图标
      if (url.pathname === '/icon.svg' && request.method === 'GET') {
        return new Response('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="64" y2="64"><stop offset="0" stop-color="#6366f1"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#g)"/><rect x="10" y="22" width="44" height="26" rx="6" fill="#fff"/><rect x="10" y="28" width="44" height="7" fill="#c7d2fe"/><rect x="14" y="40" width="16" height="4" rx="2" fill="#e0e7ff"/><circle cx="46" cy="42" r="5" fill="#f6d365"/></svg>', {
          headers: { 'Content-Type': 'image/svg+xml;charset=utf-8', 'Cache-Control': 'public, max-age=86400' },
        });
      }

      // 登录
      if (url.pathname === '/api/login' && request.method === 'POST') {
        return handleLogin(request, env);
      }

      // 卡片
      if (url.pathname === '/api/cards' && request.method === 'GET') {
        if (!(await checkAuth(request, env))) return unauthorized();
        return getCards(request, env);
      }
      if (url.pathname === '/api/cards' && request.method === 'POST') {
        if (!(await checkAuth(request, env))) return unauthorized();
        return addCard(request, env);
      }

      let m = url.pathname.match(/^\/api\/cards\/(\d+)$/);
      if (m) {
        const id = m[1];
        if (request.method === 'GET') {
          if (!(await checkAuth(request, env))) return unauthorized();
          return getCardDetail(request, env, id);
        }
        if (request.method === 'PUT') {
          if (!(await checkAuth(request, env))) return unauthorized();
          return updateCard(request, env, id);
        }
        if (request.method === 'DELETE') {
          if (!(await checkAuth(request, env))) return unauthorized();
          return deleteCard(request, env, id);
        }
      }

      m = url.pathname.match(/^\/api\/cards\/(\d+)\/limit-change$/);
      if (m && request.method === 'POST') {
        if (!(await checkAuth(request, env))) return unauthorized();
        return addLimitChange(request, env, m[1]);
      }

      // 标记本期已还（列表快捷操作：记录已还到的还款日）
      m = url.pathname.match(/^\/api\/cards\/(\d+)\/paid$/);
      if (m && request.method === 'POST') {
        if (!(await checkAuth(request, env))) return unauthorized();
        const id = m[1];
        const body = await request.json().catch(() => ({}));
        await env.DB.prepare('UPDATE credit_cards SET paid_through = ? WHERE id = ?')
          .bind(String(body.paid_through || ''), id).run();
        return json({ success: true });
      }
      m = url.pathname.match(/^\/api\/cards\/(\d+)\/paid$/);
      if (m && request.method === 'DELETE') {
        if (!(await checkAuth(request, env))) return unauthorized();
        await env.DB.prepare("UPDATE credit_cards SET paid_through = '' WHERE id = ?").bind(m[1]).run();
        return json({ success: true });
      }

      // 账单
      if (url.pathname === '/api/bills' && request.method === 'GET') {
        if (!(await checkAuth(request, env))) return unauthorized();
        return getBills(request, env);
      }
      if (url.pathname === '/api/bills' && request.method === 'POST') {
        if (!(await checkAuth(request, env))) return unauthorized();
        return addBill(request, env);
      }
      m = url.pathname.match(/^\/api\/bills\/(\d+)$/);
      if (m) {
        if (request.method === 'PUT') {
          if (!(await checkAuth(request, env))) return unauthorized();
          return updateBill(request, env, m[1]);
        }
        if (request.method === 'DELETE') {
          if (!(await checkAuth(request, env))) return unauthorized();
          return deleteBill(request, env, m[1]);
        }
      }

      // 年费规则
      if (url.pathname === '/api/fee' && request.method === 'GET') {
        if (!(await checkAuth(request, env))) return unauthorized();
        return getFeeRules(request, env);
      }
      if (url.pathname === '/api/fee' && request.method === 'POST') {
        if (!(await checkAuth(request, env))) return unauthorized();
        return addFeeRule(request, env);
      }
      m = url.pathname.match(/^\/api\/fee\/(\d+)$/);
      if (m) {
        if (request.method === 'PUT') {
          if (!(await checkAuth(request, env))) return unauthorized();
          return updateFeeRule(request, env, m[1]);
        }
        if (request.method === 'DELETE') {
          if (!(await checkAuth(request, env))) return unauthorized();
          return deleteFeeRule(request, env, m[1]);
        }
      }

      // 设置
      if (url.pathname === '/api/settings' && request.method === 'GET') {
        if (!(await checkAuth(request, env))) return unauthorized();
        return getSettings(env);
      }
      if (url.pathname === '/api/settings' && request.method === 'PUT') {
        if (!(await checkAuth(request, env))) return unauthorized();
        return updateSettings(request, env);
      }

      // 两步验证（2FA）
      if (url.pathname === '/api/totp/status' && request.method === 'GET') {
        if (!(await checkAuth(request, env))) return unauthorized();
        return json({ success: true, enabled: await getTotpEnabled(env) });
      }
      if (url.pathname === '/api/totp/setup' && request.method === 'POST') {
        if (!(await checkAuth(request, env))) return unauthorized();
        return totpSetup(env);
      }
      if (url.pathname === '/api/totp/enable' && request.method === 'POST') {
        if (!(await checkAuth(request, env))) return unauthorized();
        return totpEnable(request, env);
      }
      if (url.pathname === '/api/totp/disable' && request.method === 'POST') {
        if (!(await checkAuth(request, env))) return unauthorized();
        return totpDisable(request, env);
      }

      // 导入导出
      if (url.pathname === '/api/export/json' && request.method === 'GET') {
        if (!(await checkAuth(request, env))) return unauthorized();
        return exportJson(env);
      }
      if (url.pathname === '/api/export/csv' && request.method === 'GET') {
        if (!(await checkAuth(request, env))) return unauthorized();
        return exportCsv(env);
      }
      if (url.pathname === '/api/import' && request.method === 'POST') {
        if (!(await checkAuth(request, env))) return unauthorized();
        return importData(request, env);
      }
      if (url.pathname === '/api/cards/import' && request.method === 'POST') {
        if (!(await checkAuth(request, env))) return unauthorized();
        const body = await request.json();
        const result = await importCards(env, (body && body.csv) || '');
        return json({ success: true, ...result });
      }
      if (url.pathname === '/api/test-push' && request.method === 'POST') {
        if (!(await checkAuth(request, env))) return unauthorized();
        return json(await testPush(env));
      }
      if (url.pathname === '/api/password' && request.method === 'POST') {
        if (!(await checkAuth(request, env))) return unauthorized();
        return changePassword(request, env);
      }

      return new Response('Not Found', { status: 404 });
    } catch (e) {
      console.error(e);
      return new Response(e.message, { status: 500 });
    }
  },

  // Cron 调度：还款提醒 + 年费提醒（免重复）
  async scheduled(event, env, ctx) {
    ctx.waitUntil(doScheduledPush(env));
  },
};

// ---------- 工具 ----------
// --- 动态 token（HMAC-SHA256 签名，7 天过期） ---
function b64u(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64uToBuf(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
async function hmacB64u(env, msg) {
  const enc = new TextEncoder();
  const secret = env.TOKEN_SECRET || 'dev-insecure-secret';
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return b64u(sig);
}
async function signToken(env, username) {
  const payload = JSON.stringify({ u: username, exp: Date.now() + 7 * 24 * 3600 * 1000 });
  const p = b64u(new TextEncoder().encode(payload));
  const sig = await hmacB64u(env, p);
  return p + '.' + sig;
}
async function sha256Hex(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('');
}
// 密码校验：设置页修改后存 DB（password_hash），未设置时回退 env.PASSWORD
async function checkPassword(env, password) {
  const h = await getSetting(env, 'password_hash').catch(() => null);
  if (h) {
    const salt = env.TOKEN_SECRET || 'dev-insecure-secret';
    return await sha256Hex(String(password) + '|' + salt) === h;
  }
  return String(password) === env.PASSWORD;
}
async function changePassword(request, env) {
  const body = await readJSON(request);
  if (!body || !body.old_password || !body.new_password) return json({ success: false, message: '请填写完整' }, 400);
  if (String(body.new_password).length < 6) return json({ success: false, message: '新密码至少 6 位' }, 400);
  if (!(await checkPassword(env, body.old_password))) return json({ success: false, message: '当前密码不正确' }, 401);
  const salt = env.TOKEN_SECRET || 'dev-insecure-secret';
  await setSetting(env, 'password_hash', await sha256Hex(String(body.new_password) + '|' + salt));
  return json({ success: true, message: '密码已修改，下次登录使用新密码' });
}
async function verifyToken(env, token) {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const p = token.slice(0, dot), sig = token.slice(dot + 1);
  const expect = await hmacB64u(env, p);
  if (sig !== expect) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64uToBuf(p)));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch (e) { return null; }
}
async function checkAuth(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return false;
  return !!(await verifyToken(env, authHeader.slice(7)));
}

// --- 两步验证（TOTP，RFC 6238） ---
const B32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32encode(bytes) {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32_CHARS[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32_CHARS[(value << (5 - bits)) & 31];
  return out;
}
function b32decode(s) {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0, out = [];
  for (const ch of clean) {
    value = (value << 5) | B32_CHARS.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}
async function totpCode(secretB32, tSec) {
  const key = await crypto.subtle.importKey('raw', b32decode(secretB32), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const counter = Math.floor(tSec / 30);
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setUint32(4, counter >>> 0); // counter 在 2^32 内（2106 年前）
  const sig = await crypto.subtle.sign('HMAC', key, buf);
  const h = new Uint8Array(sig);
  const off = h[h.length - 1] & 0x0f;
  const code = (((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3]) % 1000000;
  return String(code).padStart(6, '0');
}
async function verifyTotp(secretB32, code, tSec) {
  if (!/^\d{6}$/.test(code || '')) return false;
  for (let w = -1; w <= 1; w++) {
    if ((await totpCode(secretB32, tSec + w * 30)) === code) return true;
  }
  return false;
}
function genRecoveryCodes(n = 10) {
  const codes = [];
  for (let i = 0; i < n; i++) {
    const part = () => String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    codes.push(part() + '-' + part());
  }
  return codes;
}
function normalizeRecovery(code) {
  return String(code || '').replace(/\s+/g, '').toUpperCase();
}
async function getTotpEnabled(env) {
  const s = await env.DB.prepare("SELECT value FROM settings WHERE key = 'totp_enabled'").first().catch(() => null);
  return !!(s && s.value === '1');
}

async function setSetting(env, key, value) {
  await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, String(value)).run();
}

// 生成新密钥与恢复码（仅存 pending，验证通过后才启用）
async function totpSetup(env) {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const secret = b32encode(bytes);
  const recovery = genRecoveryCodes();
  await setSetting(env, 'totp_pending_secret', secret);
  await setSetting(env, 'totp_pending_recovery', JSON.stringify(recovery));
  const otpauth = 'otpauth://totp/CardLedger:' + encodeURIComponent(env.USERNAME || 'admin') + '?secret=' + secret + '&issuer=CardLedger';
  return json({ success: true, secret, otpauth, recovery_codes: recovery });
}

// 输入当前验证码（或恢复码）验证通过后启用
async function totpEnable(request, env) {
  const body = await readJSON(request);
  const code = (body && body.code || '').trim();
  const secret = await getSetting(env, 'totp_pending_secret');
  if (!secret) return json({ success: false, message: '请先点击「生成密钥」' }, 400);
  let recoveryJson = await getSetting(env, 'totp_pending_recovery');
  let recovery = [];
  try { recovery = JSON.parse(recoveryJson || '[]'); } catch (e) {}
  const ok = await verifyTotp(secret, code, Math.floor(Date.now() / 1000));
  const norm = normalizeRecovery(code);
  const idx = recovery.indexOf(norm);
  if (!ok && idx < 0) return json({ success: false, message: '验证码不正确' }, 400);
  if (idx >= 0) recovery.splice(idx, 1);
  await setSetting(env, 'totp_secret', secret);
  await setSetting(env, 'totp_recovery', JSON.stringify(recovery));
  await setSetting(env, 'totp_enabled', '1');
  await setSetting(env, 'totp_pending_secret', '');
  await setSetting(env, 'totp_pending_recovery', '');
  return json({ success: true, message: '两步验证已启用' });
}

// 停用：需要当前验证码或恢复码（防被盗 token 直接关闭 2FA）
async function totpDisable(request, env) {
  const body = await readJSON(request);
  const code = (body && body.code || '').trim();
  const secret = await getSetting(env, 'totp_secret');
  if (!secret) return json({ success: false, message: '两步验证未启用' }, 400);
  let recovery = [];
  try { recovery = JSON.parse(await getSetting(env, 'totp_recovery') || '[]'); } catch (e) {}
  const ok = await verifyTotp(secret, code, Math.floor(Date.now() / 1000));
  const norm = normalizeRecovery(code);
  const idx = recovery.indexOf(norm);
  if (!ok && idx < 0) return json({ success: false, message: '验证码不正确，无法停用' }, 400);
  if (idx >= 0) recovery.splice(idx, 1);
  await setSetting(env, 'totp_enabled', '0');
  await setSetting(env, 'totp_secret', '');
  await setSetting(env, 'totp_recovery', '');
  return json({ success: true, message: '两步验证已停用' });
}

function unauthorized() {
  return new Response('Unauthorized', { status: 401 });
}

function json(data, status = 200) {
  return Response.json(data, { status });
}

async function readJSON(request) {
  try {
    return await request.json();
  } catch (e) {
    return null;
  }
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function fmtYMD(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayStr() {
  return fmtYMD(new Date());
}

function nowStr() {
  const d = new Date();
  return fmtYMD(d) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
}

function num(v, fallback = 0) {
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

// ---------- 登录（动态 token + 失败限流） ----------
async function ensureLoginTable(env) {
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS login_attempts (ip TEXT PRIMARY KEY, count INTEGER DEFAULT 0, locked_until INTEGER DEFAULT 0)'
  ).run();
}

async function handleLogin(request, env) {
  const body = await readJSON(request);
  if (!body) return json({ success: false, message: '请求格式错误' }, 400);
  const { username, password } = body;
  try { await ensureLoginTable(env); } catch (e) { /* 表已存在或首次建表失败不阻塞 */ }
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const now = Date.now();
  const att = await env.DB.prepare('SELECT * FROM login_attempts WHERE ip = ?').bind(ip).first().catch(() => null);
  if (att && Number(att.locked_until) > now) {
    const mins = Math.ceil((Number(att.locked_until) - now) / 60000);
    return json({ success: false, message: '尝试次数过多，请 ' + mins + ' 分钟后重试' }, 429);
  }
  if (username === env.USERNAME && await checkPassword(env, password)) {
    // 两步验证：已启用则要求验证码或恢复码
    const totpOn = await getTotpEnabled(env).catch(() => false);
    if (totpOn) {
      const code = (body.totp || '').trim();
      const secret = await getSetting(env, 'totp_secret').catch(() => null);
      const ok = await verifyTotp(secret, code, Math.floor(Date.now() / 1000));
      let recovery = [];
      try { recovery = JSON.parse(await getSetting(env, 'totp_recovery') || '[]'); } catch (e) {}
      const norm = normalizeRecovery(code);
      const idx = recovery.indexOf(norm);
      if (!ok && idx < 0) {
        await env.DB.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run().catch(() => {});
        return json({ success: false, need_totp: true, message: '两步验证码不正确' }, 401);
      }
      if (idx >= 0) {
        recovery.splice(idx, 1);
        await setSetting(env, 'totp_recovery', JSON.stringify(recovery));
      }
    }
    await env.DB.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run().catch(() => {});
    const token = await signToken(env, username);
    return json({ success: true, token, username: env.USERNAME });
  }
  const count = (att ? Number(att.count) : 0) + 1;
  if (count >= 5) {
    await env.DB.prepare(
      'INSERT INTO login_attempts (ip, count, locked_until) VALUES (?, ?, ?) ON CONFLICT(ip) DO UPDATE SET count = excluded.count, locked_until = excluded.locked_until'
    ).bind(ip, count, now + 15 * 60 * 1000).run().catch(() => {});
    return json({ success: false, message: '连续 5 次失败，账号已锁定 15 分钟' }, 429);
  }
  await env.DB.prepare(
    'INSERT INTO login_attempts (ip, count, locked_until) VALUES (?, ?, 0) ON CONFLICT(ip) DO UPDATE SET count = excluded.count, locked_until = excluded.locked_until'
  ).bind(ip, count).run().catch(() => {});
  return json({ success: false, message: '用户名或密码错误' }, 401);
}

// ---------- 卡片 ----------
async function getCards(request, env) {
  const { results } = await env.DB.prepare('SELECT * FROM credit_cards ORDER BY id').all();
  return json({ success: true, cards: results });
}

async function getCardDetail(request, env, id) {
  const card = await env.DB.prepare('SELECT * FROM credit_cards WHERE id = ?').bind(id).first();
  if (!card) return json({ success: false, message: '卡片不存在' }, 404);

  const { results: limitChanges } = await env.DB.prepare(
    'SELECT * FROM limit_changes WHERE card_id = ? ORDER BY effective_date DESC, id DESC'
  ).bind(id).all();
  const { results: bills } = await env.DB.prepare(
    'SELECT * FROM bills WHERE card_id = ? ORDER BY bill_date DESC'
  ).bind(id).all();
  const { results: feeRules } = await env.DB.prepare(
    'SELECT * FROM fee_rules WHERE card_id = ? ORDER BY id'
  ).bind(id).all();

  return json({ success: true, card, limitChanges, bills, feeRules });
}

function validateCardFields(card) {
  if (!card || !card.bank_name || String(card.bank_name).trim() === '') {
    return '发卡银行不能为空';
  }
  const last4 = String(card.last_4_digits || '');
  if (last4.length !== 4 || isNaN(parseInt(last4, 10))) {
    return '卡号后4位必须是4位数字';
  }
  if (isNaN(num(card.billing_day)) || num(card.billing_day) < 1 || num(card.billing_day) > 31) {
    return '账单日必须是1-31之间的整数';
  }
  const pv = num(card.payment_value);
  if (!card.payment_type || isNaN(pv) || pv < 1 || pv > 31) {
    return '还款日/天数必须是1-31之间的整数';
  }
  return null;
}

function calcMaxGrace(card) {
  const billingDay = num(card.billing_day, 1);
  const pv = num(card.payment_value, 1);
  let period;
  if (card.payment_type === 'days_after_billing') {
    period = pv;
  } else {
    period = pv > billingDay ? (pv - billingDay) : (30 - billingDay) + pv;
  }
  return period + 30;
}

async function addCard(request, env) {
  const card = await readJSON(request);
  const err = validateCardFields(card);
  if (err) return json({ success: false, message: err }, 400);

  const res = await env.DB.prepare(
    `INSERT INTO credit_cards
      (bank_name, card_type, last_4_digits, status, card_limit, temp_limit, temp_limit_expiry,
       billing_day, payment_type, payment_value, grace_days, max_grace_period,
       annual_fee, annual_fee_start, annual_fee_end, used_amount, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    String(card.bank_name).trim(),
    String(card.card_type || '').trim(),
    String(card.last_4_digits).padStart(4, '0').slice(-4),
    card.status || 'normal',
    num(card.card_limit),
    num(card.temp_limit),
    card.temp_limit_expiry || '',
    num(card.billing_day),
    card.payment_type,
    num(card.payment_value),
    num(card.grace_days),
    calcMaxGrace(card),
    num(card.annual_fee),
    card.annual_fee_start || '',
    card.annual_fee_end || '',
    num(card.used_amount),
    String(card.notes || '').substring(0, 500)
  ).run();

  const newId = res.meta.last_row_id;
  // 若初始额度非0，记录一条额度变更
  const limit = num(card.card_limit);
  if (limit > 0) {
    await env.DB.prepare(
      `INSERT INTO limit_changes (card_id, old_limit, new_limit, change_type, effective_date, reason, created_at)
       VALUES (?, 0, ?, 'permanent', ?, ?, ?)`
    ).bind(newId, limit, card.annual_fee_start || todayStr(), '开卡初始额度', nowStr()).run();
  }
  return json({ success: true, message: '添加成功', id: newId });
}

async function updateCard(request, env, id) {
  const card = await readJSON(request);
  const err = validateCardFields(card);
  if (err) return json({ success: false, message: err }, 400);

  const old = await env.DB.prepare('SELECT * FROM credit_cards WHERE id = ?').bind(id).first();
  if (!old) return json({ success: false, message: '卡片不存在' }, 404);

  const newLimit = num(card.card_limit);
  const newTemp = num(card.temp_limit);

  await env.DB.prepare(
    `UPDATE credit_cards SET
       bank_name = ?, card_type = ?, last_4_digits = ?, status = ?,
       card_limit = ?, temp_limit = ?, temp_limit_expiry = ?,
       billing_day = ?, payment_type = ?, payment_value = ?, grace_days = ?,
       max_grace_period = ?, annual_fee = ?, annual_fee_start = ?, annual_fee_end = ?,
       used_amount = ?, notes = ?
     WHERE id = ?`
  ).bind(
    String(card.bank_name).trim(),
    String(card.card_type || '').trim(),
    String(card.last_4_digits).padStart(4, '0').slice(-4),
    card.status || 'normal',
    newLimit,
    newTemp,
    card.temp_limit_expiry || '',
    num(card.billing_day),
    card.payment_type,
    num(card.payment_value),
    num(card.grace_days),
    calcMaxGrace(card),
    num(card.annual_fee),
    card.annual_fee_start || '',
    card.annual_fee_end || '',
    num(card.used_amount),
    String(card.notes || '').substring(0, 500),
    id
  ).run();

  // 额度变化 → 自动记录历史
  const t = todayStr();
  if (num(old.card_limit) !== newLimit) {
    await env.DB.prepare(
      `INSERT INTO limit_changes (card_id, old_limit, new_limit, change_type, effective_date, reason, created_at)
       VALUES (?, ?, ?, 'permanent', ?, '编辑卡片额度', ?)`
    ).bind(id, num(old.card_limit), newLimit, t, nowStr()).run();
  }
  if (num(old.temp_limit) !== newTemp) {
    await env.DB.prepare(
      `INSERT INTO limit_changes (card_id, old_limit, new_limit, change_type, effective_date, reason, created_at)
       VALUES (?, ?, ?, 'temp', ?, '编辑临时额度', ?)`
    ).bind(id, num(old.temp_limit), newTemp, t, nowStr()).run();
  }

  return json({ success: true, message: '更新成功' });
}

async function deleteCard(request, env, id) {
  await env.DB.prepare('DELETE FROM credit_cards WHERE id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM limit_changes WHERE card_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM bills WHERE card_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM fee_rules WHERE card_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM push_log WHERE card_id = ?').bind(id).run();
  return json({ success: true, message: '删除成功' });
}

// ---------- 额度变更 ----------
async function addLimitChange(request, env, cardId) {
  const body = await readJSON(request);
  const card = await env.DB.prepare('SELECT * FROM credit_cards WHERE id = ?').bind(cardId).first();
  if (!card) return json({ success: false, message: '卡片不存在' }, 404);

  const changeType = body.change_type === 'temp' ? 'temp' : 'permanent';
  const newLimit = num(body.new_limit);
  const effectiveDate = body.effective_date || todayStr();

  const oldLimit = changeType === 'temp' ? num(card.temp_limit) : num(card.card_limit);

  // 更新卡片当前额度
  if (changeType === 'temp') {
    await env.DB.prepare('UPDATE credit_cards SET temp_limit = ?, temp_limit_expiry = ? WHERE id = ?')
      .bind(newLimit, body.expiry || '', cardId).run();
  } else {
    await env.DB.prepare('UPDATE credit_cards SET card_limit = ? WHERE id = ?')
      .bind(newLimit, cardId).run();
  }

  await env.DB.prepare(
    `INSERT INTO limit_changes (card_id, old_limit, new_limit, change_type, effective_date, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(cardId, oldLimit, newLimit, changeType, effectiveDate, String(body.reason || '').substring(0, 200), nowStr()).run();

  return json({ success: true, message: '额度变更已记录' });
}

// ---------- 账单 ----------
async function getBills(request, env) {
  const url = new URL(request.url);
  const cardId = url.searchParams.get('card_id');
  let sql = 'SELECT * FROM bills';
  const params = [];
  if (cardId) {
    sql += ' WHERE card_id = ?';
    params.push(cardId);
  }
  sql += ' ORDER BY bill_date DESC, id DESC';
  const { results } = await env.DB.prepare(sql).bind(...params).all();
  return json({ success: true, bills: results });
}

async function addBill(request, env) {
  const b = await readJSON(request);
  if (!b || !b.card_id || !b.bill_date) return json({ success: false, message: '缺少卡片或账单日期' }, 400);
  await env.DB.prepare(
    `INSERT INTO bills (card_id, bill_date, amount, min_payment, due_date, paid, paid_date, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    num(b.card_id), b.bill_date, num(b.amount), num(b.min_payment),
    b.due_date || '', b.paid ? 1 : 0, b.paid ? (b.paid_date || todayStr()) : '', String(b.notes || '')
  ).run();
  return json({ success: true, message: '账单已添加' });
}

async function updateBill(request, env, id) {
  const b = await readJSON(request);
  if (!b) return json({ success: false, message: '请求格式错误' }, 400);
  await env.DB.prepare(
    `UPDATE bills SET bill_date = ?, amount = ?, min_payment = ?, due_date = ?, paid = ?, paid_date = ?, notes = ?
     WHERE id = ?`
  ).bind(
    b.bill_date, num(b.amount), num(b.min_payment), b.due_date || '',
    b.paid ? 1 : 0, b.paid ? (b.paid_date || todayStr()) : '', String(b.notes || ''), id
  ).run();
  return json({ success: true, message: '账单已更新' });
}

async function deleteBill(request, env, id) {
  await env.DB.prepare('DELETE FROM bills WHERE id = ?').bind(id).run();
  return json({ success: true, message: '账单已删除' });
}

// ---------- 年费规则 ----------
async function getFeeRules(request, env) {
  const url = new URL(request.url);
  const cardId = url.searchParams.get('card_id');
  let sql = 'SELECT * FROM fee_rules';
  const params = [];
  if (cardId) {
    sql += ' WHERE card_id = ?';
    params.push(cardId);
  }
  sql += ' ORDER BY id';
  const { results } = await env.DB.prepare(sql).bind(...params).all();
  return json({ success: true, feeRules: results });
}

async function addFeeRule(request, env) {
  const f = await readJSON(request);
  if (!f || !f.card_id || !f.condition_type || isNaN(num(f.target_value)) || num(f.target_value) <= 0) {
    return json({ success: false, message: '缺少卡片或减免条件参数' }, 400);
  }
  await env.DB.prepare(
    `INSERT INTO fee_rules (card_id, condition_type, target_value, current_value, cycle_start, cycle_end, annual_fee, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    num(f.card_id), f.condition_type, num(f.target_value), num(f.current_value),
    f.cycle_start || '', f.cycle_end || '', num(f.annual_fee), f.status || 'active'
  ).run();
  return json({ success: true, message: '年费规则已添加' });
}

async function updateFeeRule(request, env, id) {
  const f = await readJSON(request);
  if (!f) return json({ success: false, message: '请求格式错误' }, 400);
  await env.DB.prepare(
    `UPDATE fee_rules SET condition_type = ?, target_value = ?, current_value = ?,
       cycle_start = ?, cycle_end = ?, annual_fee = ?, status = ?
     WHERE id = ?`
  ).bind(
    f.condition_type, num(f.target_value), num(f.current_value),
    f.cycle_start || '', f.cycle_end || '', num(f.annual_fee), f.status || 'active', id
  ).run();
  return json({ success: true, message: '年费规则已更新' });
}

async function deleteFeeRule(request, env, id) {
  await env.DB.prepare('DELETE FROM fee_rules WHERE id = ?').bind(id).run();
  return json({ success: true, message: '年费规则已删除' });
}

// ---------- 设置 ----------
const SENSITIVE_SETTINGS = ['password_hash', 'totp_secret', 'totp_recovery', 'totp_pending_secret', 'totp_pending_recovery'];
async function getSettings(env) {
  const { results } = await env.DB.prepare('SELECT * FROM settings').all();
  const s = {};
  (results || []).forEach(r => { if (!SENSITIVE_SETTINGS.includes(r.key)) s[r.key] = r.value; });
  return json({ success: true, settings: s });
}

async function updateSettings(request, env) {
  const body = await readJSON(request);
  if (!body || typeof body !== 'object') return json({ success: false, message: '请求格式错误' }, 400);
  for (const [k, v] of Object.entries(body)) {
    await env.DB.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).bind(k, String(v)).run();
  }
  return json({ success: true, message: '设置已保存' });
}

// ---------- 导出 / 导入 ----------
async function exportJson(env) {
  const get = async (sql) => {
    const { results } = await env.DB.prepare(sql).all();
    return results;
  };
  const dump = {
    exported_at: nowStr(),
    cards: await get('SELECT * FROM credit_cards ORDER BY id'),
    limit_changes: await get('SELECT * FROM limit_changes ORDER BY id'),
    bills: await get('SELECT * FROM bills ORDER BY id'),
    fee_rules: await get('SELECT * FROM fee_rules ORDER BY id'),
    settings: await get('SELECT * FROM settings'),
  };
  const filename = 'cardledger_backup_' + todayStr() + '.json';
  return new Response(JSON.stringify(dump, null, 2), {
    headers: {
      'Content-Type': 'application/json;charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

async function exportCsv(env) {
  const { results } = await env.DB.prepare('SELECT * FROM credit_cards ORDER BY id').all();
  const headers = ['ID', '银行', '卡种', '尾号', '状态', '永久额度', '临时额度', '临时额度到期日', '账单日', '还款类型', '还款值', '宽限期', '最长免息期', '年费', '年费周期起始', '年费周期结束', '已用额度', '备注'];
  const rows = [headers.join(',')];
  (results || []).forEach(c => {
    const vals = [c.id, c.bank_name, c.card_type, c.last_4_digits, c.status, c.card_limit, c.temp_limit,
      c.temp_limit_expiry, c.billing_day, c.payment_type, c.payment_value, c.grace_days,
      c.max_grace_period, c.annual_fee, c.annual_fee_start, c.annual_fee_end, c.used_amount, (c.notes || '')];
    rows.push(vals.map(v => {
      const s = String(v == null ? '' : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(','));
  });
  const filename = 'cardledger_' + todayStr() + '.csv';
  return new Response('\uFEFF' + rows.join('\r\n'), {
    headers: {
      'Content-Type': 'text/csv;charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

async function importData(request, env) {
  const body = await readJSON(request);
  if (!body || !Array.isArray(body.cards)) {
    return json({ success: false, message: '备份文件格式不正确（缺少 cards 数组）' }, 400);
  }
  const tables = ['push_log', 'fee_rules', 'bills', 'limit_changes', 'credit_cards'];
  for (const t of tables) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  // 重置自增
  for (const t of tables) {
    await env.DB.prepare(`DELETE FROM sqlite_sequence WHERE name = ?`).bind(t).run().catch(() => {});
  }

  for (const c of body.cards || []) {
    try {
      await env.DB.prepare(
        `INSERT INTO credit_cards (id, bank_name, card_type, last_4_digits, status, card_limit, temp_limit, temp_limit_expiry,
           billing_day, payment_type, payment_value, grace_days, max_grace_period,
           annual_fee, annual_fee_start, annual_fee_end, used_amount, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        c.id, c.bank_name, c.card_type || '', c.last_4_digits, c.status || 'normal',
        num(c.card_limit), num(c.temp_limit), c.temp_limit_expiry || '',
        num(c.billing_day), c.payment_type, num(c.payment_value), num(c.grace_days), num(c.max_grace_period),
        num(c.annual_fee), c.annual_fee_start || '', c.annual_fee_end || '', num(c.used_amount), c.notes || ''
      ).run();
    } catch (e) { /* 跳过损坏行 */ }
  }
  for (const l of body.limit_changes || []) {
    try {
      await env.DB.prepare(
        `INSERT INTO limit_changes (id, card_id, old_limit, new_limit, change_type, effective_date, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(l.id, l.card_id, num(l.old_limit), num(l.new_limit), l.change_type, l.effective_date || '', l.reason || '', l.created_at || '').run();
    } catch (e) {}
  }
  for (const b of body.bills || []) {
    try {
      await env.DB.prepare(
        `INSERT INTO bills (id, card_id, bill_date, amount, min_payment, due_date, paid, paid_date, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(b.id, b.card_id, b.bill_date || '', num(b.amount), num(b.min_payment), b.due_date || '', b.paid ? 1 : 0, b.paid_date || '', b.notes || '').run();
    } catch (e) {}
  }
  for (const f of body.fee_rules || []) {
    try {
      await env.DB.prepare(
        `INSERT INTO fee_rules (id, card_id, condition_type, target_value, current_value, cycle_start, cycle_end, annual_fee, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(f.id, f.card_id, f.condition_type, num(f.target_value), num(f.current_value), f.cycle_start || '', f.cycle_end || '', num(f.annual_fee), f.status || 'active').run();
    } catch (e) {}
  }
  return json({ success: true, message: '导入完成' });
}

// ---------- 卡片批量导入（CSV，中文表头） ----------
function parseCSV(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim() !== '');
  if (!lines.length) return [];
  const parseLine = (line) => {
    const cells = []; let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else inQ = false;
        } else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ',') { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    return cells;
  };
  return lines.map(parseLine); // 含表头行
}

const CARD_CSV_HEADER = ['bank_name', 'card_type', 'last_4_digits', 'status', 'card_limit', 'temp_limit', 'temp_limit_expiry', 'billing_day', 'payment_type', 'payment_value', 'annual_fee', 'annual_fee_start', 'annual_fee_end', 'used_amount', 'notes'];

const CARD_CSV_ALIAS = {
  '银行': 'bank_name', '卡种': 'card_type', '尾号': 'last_4_digits', '状态': 'status',
  '永久额度': 'card_limit', '临时额度': 'temp_limit', '临时额度到期日': 'temp_limit_expiry',
  '账单日': 'billing_day', '还款方式': 'payment_type', '还款日/天数': 'payment_value', '还款日或天数': 'payment_value',
  '年费金额': 'annual_fee', '年费周期起始': 'annual_fee_start', '年费周期结束': 'annual_fee_end',
  '已用额度': 'used_amount', '备注': 'notes',
  'bank_name': 'bank_name', 'card_type': 'card_type', 'last_4_digits': 'last_4_digits', 'status': 'status',
  'card_limit': 'card_limit', 'temp_limit': 'temp_limit', 'temp_limit_expiry': 'temp_limit_expiry',
  'billing_day': 'billing_day', 'payment_type': 'payment_type', 'payment_value': 'payment_value',
  'annual_fee': 'annual_fee', 'annual_fee_start': 'annual_fee_start', 'annual_fee_end': 'annual_fee_end',
  'used_amount': 'used_amount', 'notes': 'notes'
};

async function importCards(env, csvText) {
  const allRows = parseCSV(csvText);
  if (allRows.length < 2) return { inserted: 0, skipped: 0, errors: ['CSV 为空或缺少数据行（第一行为表头）'] };
  const headCells = allRows[0].map(h => String(h == null ? '' : h).trim());
  const colIdx = {};
  headCells.forEach((h, i) => { const k = CARD_CSV_ALIAS[h] || CARD_CSV_ALIAS[h.toLowerCase()]; if (k) colIdx[k] = i; });
  if (colIdx['bank_name'] === undefined || colIdx['last_4_digits'] === undefined) {
    return { inserted: 0, skipped: 0, errors: ['表头需包含「银行」和「尾号」列（中文表头：银行,卡种,尾号,…）'] };
  }
  const { results: exist } = await env.DB.prepare('SELECT bank_name, last_4_digits FROM credit_cards').all();
  const seen = new Set((exist || []).map(r => String(r.bank_name).trim() + '|' + String(r.last_4_digits).trim()));
  let inserted = 0, skipped = 0;
  const errors = [];
  for (let i = 1; i < allRows.length; i++) {
    const cells = allRows[i];
    const r = {};
    CARD_CSV_HEADER.forEach(k => {
      const idx = colIdx[k];
      r[k] = idx === undefined ? '' : String(cells[idx] == null ? '' : cells[idx]).trim();
    });
    const errs = [];
    if (!r.bank_name) errs.push('银行为空');
    if (!r.last_4_digits) errs.push('尾号为空');
    else if (!/^\d{4}$/.test(r.last_4_digits)) errs.push('尾号需为 4 位数字；若以 0 开头（如 0567），Excel 会吞掉前导 0 显示成 567——请将该列设为文本格式后重填');
    const key = String(r.bank_name).trim() + '|' + String(r.last_4_digits).trim();
    if (seen.has(key)) { skipped++; errors.push('第 ' + i + ' 行：' + r.bank_name + '/' + r.last_4_digits + ' 已存在，跳过'); continue; }
    if (errs.length) { errors.push('第 ' + i + ' 行：' + errs.join('、')); continue; }
    try {
      const billing_day = Math.min(31, Math.max(1, parseInt(r.billing_day) || 1));
      const pt = r.payment_type;
      const payment_type = (pt === 'days_after_billing' || pt === '账单后' || pt === '账单后N天') ? 'days_after_billing' : 'fixed_day';
      const payment_value = parseInt(r.payment_value) || (payment_type === 'days_after_billing' ? 20 : 5);
      const st = r.status;
      const status = (st === 'closed' || st === '已注销' || st === '注销') ? 'closed' : 'normal';
      await env.DB.prepare(
        `INSERT INTO credit_cards (bank_name, card_type, last_4_digits, status, card_limit, temp_limit, temp_limit_expiry,
           billing_day, payment_type, payment_value, annual_fee, annual_fee_start, annual_fee_end, used_amount, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        r.bank_name, r.card_type, String(r.last_4_digits).slice(-4), status,
        parseFloat(r.card_limit) || 0, parseFloat(r.temp_limit) || 0, r.temp_limit_expiry || '',
        billing_day, payment_type, payment_value, parseFloat(r.annual_fee) || 0,
        r.annual_fee_start || '', r.annual_fee_end || '', parseFloat(r.used_amount) || 0, r.notes || ''
      ).run();
      inserted++;
      seen.add(key);
    } catch (e) {
      errors.push('第 ' + i + ' 行：写入失败（' + e.message + '）');
    }
  }
  return { inserted, skipped, errors };
}

// 测试提醒通道（本地即可验证，不依赖定时任务；按设置渠道路由：Bark → PushPlus）
async function sendBark(env, title, body) {
  const key = await getSetting(env, 'bark_key', '').catch(() => '');
  if (!key) return { ok: false, message: '未配置 Bark 设备 Key（设置页填写后保存）' };
  const url = /^https?:\/\//i.test(key) ? key : ('https://api.day.app/' + key);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body }),
    });
    const txt = await resp.text();
    let ok = false, message = txt;
    try { const j = JSON.parse(txt); ok = j.code === 200 || !!j.success || resp.status === 200; message = j.message || j.msg || txt; } catch (e) {}
    return { ok, message };
  } catch (e) {
    return { ok: false, message: '请求失败：' + e.message };
  }
}
async function testPush(env) {
  const barkOn = await getSetting(env, 'enable_bark', '0').catch(() => '0') === '1';
  if (barkOn) {
    const r = await sendBark(env, '卡账记 · 测试提醒', '这是一条测试消息（Bark 通道），说明提醒已生效。');
    if (r.ok) return { ok: true, message: 'Bark · ' + (r.message || '已发送') };
    return r;
  }
  const token = env.PUSHPLUS_TOKEN;
  if (!token || token === 'your-pushplus-token') {
    return { ok: false, message: '未配置有效的 PUSHPLUS_TOKEN（打开 E:\\card-ledger\\wrangler.toml 填入真实 token 后重启服务）' };
  }
  const pushplusApi = env.PUSHPLUS_API || 'https://www.pushplus.plus/send';
  try {
    const resp = await fetch(pushplusApi, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token, title: '卡账记 · 测试提醒', content: '这是一条测试消息，说明提醒通道已生效。', template: 'html'
      })
    });
    const txt = await resp.text();
    let ok = false, message = txt;
    try { const j = JSON.parse(txt); ok = j.code === 200; message = j.msg || j.message || txt; } catch (e) {}
    return { ok, message };
  } catch (e) {
    return { ok: false, message: '请求失败：' + e.message };
  }
}

// ---------- 日期计算 ----------
function calculatePaymentDeadlineServer(billingDate, paymentType, paymentValue, graceDays) {
  const paymentDate = new Date(billingDate.getTime());
  const pv = Number(paymentValue || 0);
  if (paymentType === 'days_after_billing') {
    paymentDate.setDate(paymentDate.getDate() + pv);
  } else {
    const billingDay = paymentDate.getDate();
    if (pv > billingDay) {
      paymentDate.setDate(pv);
    } else {
      paymentDate.setMonth(paymentDate.getMonth() + 1);
      paymentDate.setDate(pv);
    }
  }
  return paymentDate;
}

function getCardDatesServer(card, refDate) {
  const today = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate());
  const todayDay = today.getDate();
  const billingDay = Number(card.billing_day);
  const paymentType = card.payment_type;
  const paymentValue = Number(card.payment_value);

  let thisMonthBillingDate = new Date(today.getFullYear(), today.getMonth(), billingDay);
  let prevBillingDate, nextBillingDate;

  if (todayDay <= billingDay) {
    prevBillingDate = new Date(today.getFullYear(), today.getMonth() - 1, billingDay);
    nextBillingDate = thisMonthBillingDate;
  } else {
    prevBillingDate = thisMonthBillingDate;
    nextBillingDate = new Date(today.getFullYear(), today.getMonth() + 1, billingDay);
  }

  const deadlineForPrevBill = calculatePaymentDeadlineServer(prevBillingDate, paymentType, paymentValue, 0);
  if (today > deadlineForPrevBill) {
    const deadlineForNextBill = calculatePaymentDeadlineServer(nextBillingDate, paymentType, paymentValue, 0);
    const daysUntil = (deadlineForNextBill.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
    return { nextBillingDate, nextPaymentDeadline: deadlineForNextBill, daysUntilPayment: Math.ceil(daysUntil) };
  } else {
    const daysUntil = (deadlineForPrevBill.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
    return { nextBillingDate: prevBillingDate, nextPaymentDeadline: deadlineForPrevBill, daysUntilPayment: Math.ceil(daysUntil) };
  }
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((d.getTime() - t0.getTime()) / (1000 * 60 * 60 * 24));
}

// ---------- 定时提醒 ----------
async function getSetting(env, key, fallback) {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return row ? row.value : fallback;
}

async function alreadySent(env, cardId, type, dateStr) {
  // fee_cycle 按周期去重（一个年费周期只提醒一次，避免每天重复推）
  if (type === 'fee_cycle') {
    const row = await env.DB.prepare(
      'SELECT id FROM push_log WHERE card_id = ? AND type = ? LIMIT 1'
    ).bind(cardId, type).first();
    return !!row;
  }
  const row = await env.DB.prepare(
    'SELECT id FROM push_log WHERE card_id = ? AND type = ? AND sent_date = ?'
  ).bind(cardId, type, dateStr).first();
  return !!row;
}

async function markSent(env, cardId, type, dateStr) {
  await env.DB.prepare(
    'INSERT INTO push_log (card_id, type, sent_date, channel) VALUES (?, ?, ?, ?)'
  ).bind(cardId, type, dateStr, 'pushplus').run();
}

async function doScheduledPush(env) {
  try {
    const barkOn = await getSetting(env, 'enable_bark', '0').catch(() => '0') === '1';
    const token = env.PUSHPLUS_TOKEN;
    if (!barkOn && !token) {
      console.log('[scheduled] 未启用任何推送渠道（Bark 未开且 PUSHPLUS_TOKEN 未配置），skip');
      return;
    }
    const pushplusApi = env.PUSHPLUS_API || 'https://www.pushplus.plus/send';
    const advanceDays = num(await getSetting(env, 'payment_advance_days', '1'), 1);
    const t = todayStr();
    const today = new Date();

    const { results } = await env.DB.prepare('SELECT * FROM credit_cards').all();
    const cards = results || [];

    const paymentDue = [];
    const feeDue = [];

    for (const c of cards) {
      if (!c || c.status === 'closed') continue;
      if (typeof c.billing_day !== 'undefined' && c.payment_type && c.payment_value) {
        const info = getCardDatesServer(c, today);
        if (info && Number(info.daysUntilPayment) === advanceDays) {
          // 本期已还 → 不再发送还款提醒
          const paidThrough = c.paid_through;
          const skipPaid = paidThrough && info.nextPaymentDeadline && info.nextPaymentDeadline.getTime() <= new Date(paidThrough + 'T00:00:00').getTime();
          if (!skipPaid && !(await alreadySent(env, c.id, 'payment', t))) {
            paymentDue.push({ card: c, info });
          }
        }
      }
      // 年费周期临近结束（提前约2个月）且未减免 → 提醒
      if (c.annual_fee_end) {
        const du = daysUntil(c.annual_fee_end);
        if (du !== null && du >= 0 && du <= 60) {
          const fee = await env.DB.prepare(
            'SELECT * FROM fee_rules WHERE card_id = ? ORDER BY id LIMIT 1'
          ).bind(c.id).first();
          const waived = fee && fee.status === 'waived';
          if (!waived && !(await alreadySent(env, c.id, 'fee_cycle', t))) {
            feeDue.push({ card: c, fee });
          }
        }
      }
    }

    if (paymentDue.length === 0 && feeDue.length === 0) {
      console.log('[scheduled] nothing to push today');
      return;
    }

    const esc = escapeHtml;
    let html = '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;max-width:600px">';
    let plainLines = [];
    if (paymentDue.length) {
      html += '<h2 style="font-size:16px;margin:0 0 8px">💳 信用卡还款提醒（剩余 ' + advanceDays + ' 天）</h2>';
      paymentDue.forEach(item => {
        const c = item.card;
        const ds = fmtYMD(item.info.nextPaymentDeadline);
        const amount = num(c.used_amount);
        const amountText = amount > 0 ? '，已用约 ' + amount + ' 元' : '';
        html += '<p style="margin:6px 0;font-size:14px">· <b>' + esc(c.bank_name) + '</b>（尾号' + esc(c.last_4_digits) + '）：到期日 <span style="color:#e11d48;font-weight:bold">' + ds + '</span>' + amountText + '</p>';
        plainLines.push('💳 ' + c.bank_name + '（尾号' + c.last_4_digits + '）：还款日 ' + ds + amountText);
      });
    }
    if (feeDue.length) {
      html += '<h2 style="font-size:16px;margin:12px 0 8px">📅 年费减免进度提醒</h2>';
      feeDue.forEach(item => {
        const c = item.card;
        const f = item.fee;
        let prog = '';
        if (f && num(f.target_value) > 0) {
          const pct = Math.min(100, Math.round(num(f.current_value) / num(f.target_value) * 100));
          prog = '，减免进度 ' + pct + '%';
        }
        html += '<p style="margin:6px 0;font-size:14px">· <b>' + esc(c.bank_name) + '</b>（尾号' + esc(c.last_4_digits) + '）：年费周期至 <span style="color:#d97706;font-weight:bold">' + esc(c.annual_fee_end) + '</span> 结束' + prog + '</p>';
        plainLines.push('📅 ' + c.bank_name + '（尾号' + c.last_4_digits + '）：年费周期至 ' + c.annual_fee_end + ' 结束' + prog);
      });
    }
    html += '</div>';

    if (barkOn) {
      const r = await sendBark(env, '卡账记提醒', plainLines.join('\n'));
      console.log('[scheduled] bark status=', r.ok, r.message);
    } else {
      const resp = await fetch(pushplusApi, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          title: '卡账记提醒',
          content: html,
          template: 'html',
        }),
      });
      const respText = await resp.text().catch(() => '');
      console.log('[scheduled] push status=', resp.status, respText);
    }

    paymentDue.forEach(item => markSent(env, item.card.id, 'payment', t));
    feeDue.forEach(item => markSent(env, item.card.id, 'fee_cycle', t));
  } catch (err) {
    console.error('[scheduled] error:', err);
  }
}

// ============================================================
// 前端 SPA（暗色毛玻璃 · Apple Wallet 卡片视觉 · 无外部依赖）
// ============================================================
function getHtml(env) {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="theme-color" content="#6366f1">
<script src="https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js"></script>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='64' y2='64'%3E%3Cstop offset='0' stop-color='%236366f1'/%3E%3Cstop offset='1' stop-color='%238b5cf6'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='64' height='64' rx='14' fill='url(%23g)'/%3E%3Crect x='10' y='22' width='44' height='26' rx='6' fill='%23fff'/%3E%3Crect x='10' y='28' width='44' height='7' fill='%23c7d2fe'/%3E%3Crect x='14' y='40' width='16' height='4' rx='2' fill='%23e0e7ff'/%3E%3Ccircle cx='46' cy='42' r='5' fill='%23f6d365'/%3E%3C/svg%3E">
<title>卡账记</title>
<style>
:root{
  --bg:#0b1220; --bg2:#0f1a2c; --card:rgba(255,255,255,0.055);
  --card2:rgba(255,255,255,0.09); --line:rgba(255,255,255,0.08);
  --txt:#e8edf5; --sub:#8b98b0; --blue:#3b82f6; --green:#10b981;
  --yellow:#f59e0b; --red:#ef4444; --gray:#64748b;
  --txt2:#c9d4e6; --muted:#5e6d89;
  --header-bg:rgba(11,18,32,0.82); --nav-bg:rgba(11,18,32,0.92);
  --bar-bg:rgba(255,255,255,0.09); --hover-bg:rgba(255,255,255,0.15);
  --overlay:rgba(5,10,20,0.6);
}
body.light{
  --bg:#eef1f6; --bg2:#e3e8f0; --card:#ffffff;
  --card2:#f1f4f9; --line:rgba(15,23,42,0.10);
  --txt:#18213a; --sub:#66708a; --blue:#2563eb; --green:#059669;
  --yellow:#d97706; --red:#dc2626; --gray:#94a3b8;
  --txt2:#39435f; --muted:#9aa4ba;
  --header-bg:rgba(255,255,255,0.88); --nav-bg:rgba(255,255,255,0.92);
  --bar-bg:rgba(15,23,42,0.08); --hover-bg:rgba(15,23,42,0.06);
  --overlay:rgba(15,23,42,0.35);
}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--txt);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;min-height:100vh;-webkit-tap-highlight-color:transparent}
#app{max-width:640px;margin:0 auto;padding:0 0 72px;position:relative}
.hidden{display:none!important}
.header{position:sticky;top:0;z-index:20;display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:var(--header-bg);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
.header .title{font-size:21px;font-weight:800;letter-spacing:1.5px;background:linear-gradient(135deg,#6366f1,#8b5cf6);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.header .sub{font-size:11px;color:var(--sub);margin-top:2px}
.brand-ico{width:30px;height:30px;flex:none;filter:drop-shadow(0 2px 6px rgba(99,102,241,0.35))}
.icon-btn{background:var(--card2);border:1px solid var(--line);color:var(--txt);width:38px;height:38px;border-radius:12px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:16px;transition:all .15s}
.icon-btn:hover{background:var(--hover-bg)}
.icon-btn svg{width:19px;height:19px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.kpi-row{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;padding:14px 16px 4px}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px;backdrop-filter:blur(10px)}
.kpi .k-label{font-size:11.5px;color:var(--sub)}
.kpi .k-value{font-size:24px;font-weight:800;margin-top:4px;font-variant-numeric:tabular-nums}
.kpi .k-note{font-size:10.5px;color:var(--sub);margin-top:2px}
.kpi .k-value.c-blue{color:var(--blue)}
.kpi .k-value.c-yellow{color:var(--yellow)}
.kpi .k-value.c-green{color:var(--green)}
.kpi .k-value.c-red{color:var(--red)}
.kpi.wide{grid-column:span 2}
.section{padding:10px 16px 0}
.section-title{font-size:14px;font-weight:800;color:var(--txt);margin:14px 2px 10px;display:flex;align-items:center;justify-content:space-between;gap:8px;letter-spacing:0.2px}
.section-title::before{content:'';width:4px;height:14px;border-radius:2px;background:linear-gradient(180deg,var(--blue),var(--green));margin-right:7px;flex:none}
.cal-toggle-bar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--card);cursor:pointer;font-size:14.5px;font-weight:800;color:var(--txt);margin:14px 0 10px;transition:background .15s}
.cal-toggle-bar:hover{background:var(--card2)}
.cal-toggle-bar .cal-arrow{font-size:15px;color:var(--sub);transition:transform .22s;flex:none}
.cal-toggle-bar.collapsed .cal-arrow{transform:rotate(-90deg)}
.cl-cell .val{font-weight:700;color:var(--txt2);font-variant-numeric:tabular-nums}
.card-v{background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:18px;padding:18px;margin:12px 16px;color:#fff;box-shadow:0 8px 24px rgba(99,102,241,0.25);position:relative;overflow:hidden}
.card-v::after{content:'';position:absolute;right:-40px;top:-40px;width:160px;height:160px;border-radius:50%;background:rgba(255,255,255,0.14)}
.card-v::before{content:'';position:absolute;right:30px;bottom:-60px;width:120px;height:120px;border-radius:50%;background:rgba(255,255,255,0.08)}
.card-v .bank{font-size:16px;font-weight:800;letter-spacing:0.5px}
.card-v .type{font-size:12px;opacity:0.85;margin-top:2px}
.card-v .chip{position:absolute;right:16px;top:16px;width:44px;height:32px;border-radius:7px;background:linear-gradient(135deg,#f6d365,#fda085);opacity:0.9}
.card-v .num{margin-top:18px;font-size:15px;letter-spacing:2px;font-weight:600;font-family:ui-monospace,monospace}
.card-v .row{display:flex;justify-content:space-between;margin-top:14px;font-size:11px;opacity:0.9}
.card-v .row b{font-size:14px;font-weight:800;display:block;margin-top:2px}
.list-card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px;margin:0 16px 10px;backdrop-filter:blur(10px);cursor:pointer;transition:all .15s}
.list-card:hover{background:var(--card2)}
.list-card .top{display:flex;justify-content:space-between;align-items:center}
.list-card .bank{font-weight:700;font-size:14.5px}
.list-card .tail{font-size:11.5px;color:var(--sub);margin-top:2px}
.list-card .due{font-size:12px;font-weight:700}
.bar{height:7px;border-radius:4px;background:var(--bar-bg);margin-top:10px;overflow:hidden}
.bar>div{height:100%;border-radius:4px;transition:width .4s}
.fee-mini{display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--sub);margin-top:8px}
/* 年费概览 */
.fo-row{padding:11px 0;border-bottom:1px solid var(--line)}
.fo-row:last-child{border-bottom:none}
.fo-name{font-size:13px;font-weight:700}
.fo-bar{height:7px;border-radius:4px;background:var(--bar-bg);margin-top:8px;overflow:hidden}
.fo-bar>div{height:100%;border-radius:4px;transition:width .4s}
.fo-meta{display:flex;justify-content:space-between;align-items:center;font-size:11.5px;color:var(--sub);margin-top:6px}
.pill{display:inline-block;padding:2px 9px;border-radius:99px;font-size:10.5px;font-weight:700;line-height:1.5}
.pill.green{background:rgba(16,185,129,0.18);color:#34d399}
.pill.yellow{background:rgba(245,158,11,0.18);color:#fbbf24}
.pill.red{background:rgba(239,68,68,0.18);color:#f87171}
.pill.blue{background:rgba(59,130,246,0.18);color:#60a5fa}
.pill.gray{background:rgba(100,116,139,0.22);color:#94a3b8}
.nav{position:fixed;bottom:0;left:0;right:0;max-width:640px;margin:0 auto;display:flex;background:var(--nav-bg);backdrop-filter:blur(16px);border-top:1px solid var(--line);z-index:30;padding-bottom:env(safe-area-inset-bottom)}
.nav button{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:9px 0 8px;background:none;border:none;color:var(--sub);font-size:10.5px;cursor:pointer}
.nav button.active{color:var(--txt)}
.nav button svg{width:21px;height:21px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
/* 表单 */
.form-card{background:var(--bg2);border:1px solid var(--line);border-radius:18px;padding:16px;margin:0 16px 12px}
.f-label{display:block;font-size:11.5px;color:var(--sub);margin:10px 0 4px}
.f-input,.f-select,.f-textarea{width:100%;background:var(--card);border:1px solid var(--line);border-radius:10px;color:var(--txt);padding:9px 11px;font-size:14px;outline:none;transition:border .15s}
.f-input:focus,.f-select:focus,.f-textarea:focus{border-color:var(--blue)}
.f-textarea{resize:vertical;min-height:52px}
.f-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.f-row3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:none;border-radius:12px;padding:11px 14px;font-size:14px;font-weight:700;cursor:pointer;transition:all .15s}
.btn.primary{background:var(--blue);color:#fff}
.btn.green{background:var(--green);color:#fff}
.btn.red{background:rgba(239,68,68,0.15);color:#f87171;border:1px solid rgba(239,68,68,0.3)}
.btn.ghost{background:var(--card2);color:var(--txt);border:1px solid var(--line)}
.btn.block{width:100%}
.btn:disabled{opacity:0.5;cursor:not-allowed}
/* 弹窗 */
.overlay{position:fixed;inset:0;background:var(--overlay);backdrop-filter:blur(4px);z-index:40;display:flex;align-items:flex-end;justify-content:center}
.modal{background:var(--bg2);border:1px solid var(--line);border-radius:20px 20px 0 0;width:100%;max-width:640px;max-height:88vh;overflow-y:auto;padding:18px 16px 24px;animation:slideup .22s ease}
@keyframes slideup{from{transform:translateY(30px);opacity:0}to{transform:translateY(0);opacity:1}}
.modal .m-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
.modal .m-title{font-size:16px;font-weight:800}
/* 详情 */
.detail-block{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px;margin:0 16px 10px;backdrop-filter:blur(10px)}
.d-block-title{font-size:12px;font-weight:700;color:var(--sub);margin-bottom:10px;display:flex;justify-content:space-between;align-items:center}
.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.metric{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px}
.metric .m-label{font-size:11px;color:var(--sub)}
.metric .m-value{font-size:20px;font-weight:800;margin-top:3px}
.metric .m-sub{font-size:10.5px;color:var(--sub);margin-top:2px}
/* 时间轴 */
.tl{position:relative;padding-left:18px}
.tl::before{content:'';position:absolute;left:5px;top:6px;bottom:6px;width:1.5px;background:var(--line)}
.tl-item{position:relative;padding:0 0 14px 14px}
.tl-item::before{content:'';position:absolute;left:-16.5px;top:5px;width:9px;height:9px;border-radius:50%;background:var(--blue);box-shadow:0 0 0 3px rgba(59,130,246,0.2)}
.tl-item .d{font-size:11px;color:var(--sub)}
.tl-item .c{font-size:13px;font-weight:600;margin-top:2px}
.tl-item .r{font-size:11.5px;color:var(--sub);margin-top:2px}
/* 账单行 */
.bill-row{display:flex;justify-content:space-between;align-items:center;padding:11px 2px;border-bottom:1px solid var(--line);font-size:13px}
.bill-row:last-child{border-bottom:none}
.bill-row .amt{font-weight:800}
.bill-row .date{font-size:11px;color:var(--sub);margin-top:2px}
/* 日历 */
.cal{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px;margin:0 0 10px}
.cal-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.cal-title-wrap{text-align:center;cursor:pointer}
.cal-mode{font-size:9.5px;color:var(--sub);margin-top:2px;letter-spacing:0.5px}
.cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;text-align:center}
.cal-dow{font-size:10.5px;color:var(--muted);padding:4px 0;font-weight:600}
.cal-day{height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:13.5px;color:var(--txt);position:relative;cursor:default;transition:background .12s}
.cal-day .num{line-height:1;font-variant-numeric:tabular-nums}
.cal-day:hover{background:var(--card2)}
.cal-day.other{color:var(--muted)}
.cal-day.bill{background:rgba(16,185,129,.16);color:var(--green);font-weight:700}
.cal-day.pay{background:rgba(239,68,68,.16);color:var(--red);font-weight:700}
.cal-day.today{background:var(--blue);color:#fff;font-weight:800;box-shadow:0 2px 8px rgba(59,130,246,0.35)}
.cal-day.today.bill,.cal-day.today.pay{color:#fff;box-shadow:none}
.cal-day.bill.pay{background:linear-gradient(135deg,rgba(239,68,68,.6),rgba(16,185,129,.5));color:#fff;font-weight:800;box-shadow:0 1px 4px rgba(0,0,0,0.18)}
.cal-hint{font-size:10px;color:var(--sub);text-align:center;margin:4px 0 2px}
.cal-day.other-month{opacity:0}
.cal-legend{display:flex;gap:14px;justify-content:center;margin-top:10px;font-size:10.5px;color:var(--sub)}
.lg-dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:4px;vertical-align:middle}
.toast{position:fixed;top:60px;left:50%;transform:translateX(-50%);background:var(--nav-bg);border:1px solid var(--line);color:var(--txt);padding:9px 16px;border-radius:99px;font-size:13px;z-index:60;opacity:0;transition:opacity .25s;pointer-events:none;max-width:80vw;text-align:center;backdrop-filter:blur(12px)}
.toast.show{opacity:1}
.toast.err{background:rgba(127,29,29,0.95)}
.empty{padding:30px 0;text-align:center;color:var(--sub);font-size:13px}
.link{color:var(--blue);cursor:pointer;font-size:12.5px}
.link.danger{color:var(--red)}
.seg{display:flex;gap:6px;margin:0 16px 10px}
.seg button{flex:1;background:var(--card);border:1px solid var(--line);color:var(--sub);border-radius:10px;padding:8px;font-size:12.5px;cursor:pointer}
.seg button.active{background:var(--card2);color:var(--txt);border-color:var(--blue)}
input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
input[type=number]{-moz-appearance:textfield}
.grad-0{background:linear-gradient(135deg,#6366f1,#8b5cf6)}
.grad-1{background:linear-gradient(135deg,#0ea5e9,#22d3ee)}
.grad-2{background:linear-gradient(135deg,#f59e0b,#ef4444)}
.grad-3{background:linear-gradient(135deg,#10b981,#14b8a6)}
.grad-4{background:linear-gradient(135deg,#ec4899,#f43f5e)}
.grad-5{background:linear-gradient(135deg,#475569,#1e293b)}
/* 列表增强 */
.lc-top{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
.cl-table{display:flex;flex-direction:column;margin:0 0 10px;overflow:hidden;border:1px solid var(--line);border-radius:16px;background:var(--card);backdrop-filter:blur(10px)}
.cl-head{display:grid;grid-template-columns:2.2fr 1fr 1.2fr 1.5fr;gap:4px;padding:9px 12px;font-size:11px;color:var(--sub);border-bottom:1px solid var(--line)}
.cl-row{display:grid;grid-template-columns:2.2fr 1fr 1.2fr 1.5fr;gap:4px;padding:10px 12px;font-size:12.5px;border-bottom:1px solid var(--line);cursor:pointer;transition:background .15s}
.cl-row:last-child{border-bottom:none}
.cl-row:hover{background:var(--card2)}
.cl-bank{font-weight:700;line-height:1.3}
.cl-bank .ct{display:block;font-size:10.5px;font-weight:400;color:var(--sub);margin-top:1px}
.cl-cell{line-height:1.35}
.cl-cell .sub{display:block;font-size:10px;color:var(--sub);margin-top:2px}
.cl-cell .red{color:#f87171;font-weight:600}
.cl-cell .yellow{color:#fbbf24;font-weight:600}
.cl-cell .green{color:#34d399;font-weight:600}
.cl-col-lim,.cl-col-used,.cl-col-rate{display:none}
.fee-wide{display:none}
.fee-narrow{font-weight:600}
/* PC 端列表展示更多列 */
@media(min-width:900px){
  .cl-head{grid-template-columns:2.2fr .9fr 1.2fr 1fr 1fr 1.1fr 1.6fr}
  .cl-row{grid-template-columns:2.2fr .9fr 1.2fr 1fr 1fr 1.1fr 1.6fr}
  .cl-col-lim,.cl-col-used,.cl-col-rate{display:block}
  .cl-mini{display:none}
  .fee-wide{display:block}
  .fee-narrow{display:none}
}
.cl-rate-bar{height:5px;background:var(--bar-bg);border-radius:3px;overflow:hidden;margin-top:4px}
.cl-rate-bar>div{height:100%;border-radius:3px}
.bill-paid-btn{background:rgba(16,185,129,0.15);color:#34d399;border:1px solid rgba(16,185,129,0.4);padding:4px 10px;border-radius:8px;font-size:11.5px;cursor:pointer;white-space:nowrap;transition:background .15s}
.bill-paid-btn:hover{background:rgba(16,185,129,0.28)}
.mini-paid{display:inline-block;margin-top:3px;padding:2px 9px;border-radius:6px;font-size:10.5px;cursor:pointer;background:rgba(16,185,129,0.15);color:#34d399;border:1px solid rgba(16,185,129,0.4);white-space:nowrap}
.mini-paid.undo{background:rgba(239,68,68,0.12);color:#f87171;border:1px solid rgba(239,68,68,0.35)}
#dash-reminders{max-height:150px;overflow-y:auto}
#dash-reminders::-webkit-scrollbar{width:3px}
#dash-reminders::-webkit-scrollbar-thumb{background:var(--muted);border-radius:3px}
.lc-type{font-size:11px;color:var(--sub);font-weight:400}
.lc-amt{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:10px;padding-top:10px;border-top:1px solid var(--line)}
@media(max-width:767px){
  .lc-amt{grid-template-columns:repeat(2,1fr);gap:8px 12px}
  .lc-amt .a-val{font-size:15px}
}
.lc-amt .a-label{display:block;font-size:10.5px;color:var(--sub)}
.lc-amt .a-val{display:block;font-size:13.5px;font-weight:700;margin-top:2px;font-variant-numeric:tabular-nums}
.lc-meta{display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--sub);margin-top:6px}
/* 确认弹窗 */
.confirm-msg{font-size:14px;line-height:1.7;margin:6px 0 18px;text-align:left}
/* PC 端适配：桌面端双列/三列 */
@media(min-width:768px){
  #app{max-width:1080px;padding:0 20px 80px}
  .kpi-row{grid-template-columns:repeat(5,1fr);padding:14px 0 4px}
  .kpi.wide{grid-column:auto}
  .section{padding:10px 0 0}
  #dash-cards{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
  #dash-cards .cl-table{grid-column:1/-1}
  .list-card{margin:0 0 0}
  .card-v{margin:12px 0}
  .detail-block{margin:0 0 10px}
  #detail-body{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;padding:0}
  #detail-body .card-v{grid-column:1/-1}
  #detail-body .kpi-row{grid-column:1/-1;padding:8px 0 4px}
  #detail-body .detail-actions{grid-column:1/-1;margin:4px 0 12px}
  #detail-body .cal{margin:0}
  .cal{margin:0 0 10px}
  .seg{margin:0 0 10px}
  .modal{max-width:560px;border-radius:20px}
  .overlay{align-items:center}
  .nav{max-width:1080px}
  .nav button{padding:10px 0 9px}
  .form-card{margin:0 0 12px}
  .toast{top:80px}
}
@media(min-width:1200px){
  #dash-cards{grid-template-columns:repeat(3,1fr)}
}
</style>
</head>
<body>
<div id="app">
  <div class="header">
    <div style="display:flex;align-items:center;gap:10px">
      <svg class="brand-ico" viewBox="0 0 24 24"><defs><linearGradient id="brandg" x1="0" y1="0" x2="24" y2="24"><stop offset="0" stop-color="#6366f1"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs><rect x="2" y="4.5" width="20" height="15" rx="3.5" fill="url(#brandg)"/><rect x="2" y="9" width="20" height="3" fill="rgba(255,255,255,0.35)"/><rect x="5.5" y="15.5" width="5" height="1.6" rx="0.8" fill="rgba(255,255,255,0.75)"/><circle cx="17.5" cy="16" r="2.4" fill="#f6d365"/></svg>
      <div>
        <div class="title">卡账记</div>
        <div class="sub" id="hdr-sub"></div>
      </div>
    </div>
    <div style="display:flex;gap:8px">
      <button class="icon-btn" id="theme-btn" title="切换深色/浅色">
        <svg viewBox="0 0 24 24" id="theme-ico-dark"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
        <svg viewBox="0 0 24 24" id="theme-ico-light" class="hidden"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
      </button>
      <button class="icon-btn" id="login-btn" title="登录">
        <svg viewBox="0 0 24 24"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
      </button>
      <button class="icon-btn hidden" id="logout-btn" title="退出登录">
        <svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
      </button>
    </div>
  </div>

  <!-- ===== 仪表盘 ===== -->
  <div id="page-dash">
    <div class="section">
      <div class="cal-toggle-bar" id="cal-toggle">
        <span>📅 账单/还款日历</span>
        <span class="cal-arrow" id="cal-arrow">▾</span>
      </div>
      <div id="cal-wrap">
        <div class="cal">
          <div class="cal-head">
            <button class="icon-btn" id="cal-prev" style="width:30px;height:30px"><svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg></button>
            <div class="cal-title-wrap" id="cal-title-box">
              <div style="font-size:14px;font-weight:700" id="cal-title"></div>
              <div class="cal-mode" id="cal-mode-label">账单+还款</div>
            </div>
            <button class="icon-btn" id="cal-next" style="width:30px;height:30px"><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg></button>
          </div>
          <div class="cal-grid" id="cal-dow"></div>
          <div class="cal-grid" id="cal-body"></div>
          <div class="cal-legend"><span><span class="lg-dot" style="background:var(--blue)"></span>今日</span><span><span class="lg-dot" style="background:var(--green)"></span>账单日</span><span><span class="lg-dot" style="background:var(--red)"></span>还款日</span></div>
        </div>
      </div>
    </div>

    <div class="kpi-row">
      <div class="kpi"><div class="k-label">总授信额度</div><div class="k-value c-blue" id="k-total">0</div><div class="k-note" id="k-total-note">同银行按最高额度合并</div></div>
      <div class="kpi"><div class="k-label">已用额度</div><div class="k-value c-yellow" id="k-used">0</div><div class="k-note">手动录入合计</div></div>
      <div class="kpi"><div class="k-label">可用额度</div><div class="k-value c-green" id="k-avail">0</div><div class="k-note">含临时额度</div></div>
      <div class="kpi"><div class="k-label">未来 7 天待还</div><div class="k-value c-red" id="k-due7">0</div><div class="k-note" id="k-due7-note">张卡待还款</div></div>
      <div class="kpi wide"><div class="k-label">年费进度概览</div><div class="k-value" style="font-size:15px;font-weight:600" id="k-fee">—</div></div>
    </div>

    <div class="section">
      <div class="section-title">信用卡列表
        <span style="display:flex;gap:6px;align-items:center">
          <input class="f-input" id="search-bar" placeholder="搜索银行/卡种" style="width:130px;padding:6px 9px;font-size:12px">
          <button class="btn primary" style="padding:7px 12px;font-size:12.5px" onclick="openCardForm(0)">+ 添加</button>
        </span>
      </div>
      <div style="margin:0 0 10px">
        <button id="dash-sort-btn" style="display:flex;align-items:center;justify-content:center;gap:6px;width:100%;padding:8px 10px;font-size:12.5px;background:var(--card);border:1px solid var(--line);border-radius:10px;color:var(--txt);cursor:pointer;transition:background .15s">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 10 12 5 17 10"/><polyline points="7 14 12 19 17 14"/></svg>
          <span id="dash-sort-label">按还款日</span>
        </button>
      </div>
      <div id="dash-cards"></div>
    </div>

    <div class="section">
      <div class="section-title">近期提醒</div>
      <div id="dash-reminders"></div>
    </div>

    <div class="section">
      <div class="section-title">年费概览</div>
      <div id="fee-overview"></div>
    </div>
  </div>

  <!-- ===== 卡片详情 ===== -->
  <div id="page-detail" class="hidden">
    <div id="detail-body"></div>
  </div>

  <!-- ===== 账单与还款记录 ===== -->
  <div id="page-bills" class="hidden">
    <div class="section">
      <div class="section-title">账单与还款记录
        <button class="btn primary" style="padding:7px 12px;font-size:12.5px" id="bill-add-top">+ 添加账单</button>
      </div>
      <div class="seg" style="margin:0 0 10px">
        <button data-f="all" class="active">全部</button>
        <button data-f="unpaid">未还</button>
        <button data-f="paid">已还</button>
      </div>
      <div id="bills-list"></div>
    </div>
  </div>

  <!-- ===== 设置 ===== -->
  <div id="page-settings" class="hidden">
    <div class="section">
      <div class="section-title">提醒设置</div>
      <div class="form-card">
        <label class="f-label">还款提醒提前天数（0 = 当天，1 = 提前1天…）</label>
        <input class="f-input" id="set-advance" type="number" min="0" max="30" value="1">
        <label class="f-label" style="margin-top:14px">推送渠道</label>
        <div style="display:flex;gap:8px;margin-top:6px">
          <button class="btn ghost" id="set-pushplus" style="flex:1">PushPlus 微信</button>
          <button class="btn ghost" id="set-bark" style="flex:1">Bark</button>
          <button class="btn ghost" id="set-email" style="flex:1">邮件提醒</button>
        </div>
        <div id="bark-config" class="hidden" style="margin-top:12px">
          <label class="f-label">Bark 设备 Key</label>
          <input class="f-input" id="set-bark-key" placeholder="iPhone 安装 Bark 后复制的 Key，如 i3nDk..." >
          <div style="font-size:11px;color:var(--sub);margin-top:4px">也可填自建 Bark 服务器完整地址（http(s):// 开头）。启用 Bark 后提醒改走 Bark，PushPlus 不再发送。</div>
        </div>
        <div style="font-size:11px;color:var(--sub);margin-top:10px;line-height:1.6">
          邮件提醒通过将推送接口指向邮件通道实现（见 README 特殊步骤）。<br>
          提醒每日由定时任务触发，同一提醒同一天不会重复发送。<br>
          <b style="color:var(--yellow)">本地调试不跑定时任务，可用下方按钮手动验证推送通道。</b>
        </div>
        <button class="btn ghost block" id="test-push" style="margin-top:12px">发送测试提醒</button>
        <div id="test-push-result" style="font-size:11.5px;color:var(--sub);margin-top:8px"></div>
        <button class="btn green block" id="set-save" style="margin-top:14px">保存设置</button>
      </div>
    </div>
    <div class="section">
      <div class="section-title">账号安全</div>
      <div class="form-card">
        <div style="font-size:11.5px;color:var(--sub);line-height:1.7;margin-bottom:10px">
          当前账号：<b><span id="sec-user" style="color:var(--txt)">-</span></b> · 登录密码在下方功能中修改（新密码至少 6 位，修改后下次登录生效）
        </div>
        <button class="btn ghost block" id="pw-toggle" style="margin-top:4px">修改登录密码</button>
        <div id="pw-form" class="hidden" style="margin-top:12px">
          <label class="f-label">当前密码</label>
          <input class="f-input" id="pw-old" type="password" autocomplete="current-password">
          <label class="f-label" style="margin-top:12px">新密码</label>
          <input class="f-input" id="pw-new" type="password" autocomplete="new-password">
          <label class="f-label" style="margin-top:12px">确认新密码</label>
          <input class="f-input" id="pw-new2" type="password" autocomplete="new-password">
          <button class="btn green block" id="pw-change" style="margin-top:12px">确认修改密码</button>
          <div id="pw-msg" style="font-size:11.5px;color:var(--sub);margin-top:8px;min-height:14px"></div>
        </div>
      </div>
    </div>
    <div class="section">
      <div class="section-title">两步验证（2FA）</div>
      <div class="form-card">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <span style="font-size:12.5px">状态：</span>
          <span id="totp-status" style="font-size:12.5px;font-weight:600">…</span>
        </div>
        <div id="totp-setup" class="hidden">
          <div style="font-size:11.5px;color:var(--sub);line-height:1.7;margin-bottom:10px">
            用 Google Authenticator 等认证器手动输入密钥（或扫码）。<br>
            密钥仅显示一次，请妥善保存；恢复码用于丢失认证器时登录，用后作废。
          </div>
          <div id="totp-secret-box" class="hidden" style="margin-bottom:10px">
            <div style="font-size:11px;color:var(--sub);margin-bottom:4px">密钥（Base32）：</div>
            <div id="totp-qr" style="display:none;background:#fff;border-radius:12px;padding:10px;width:max-content;max-width:100%;margin-bottom:8px"></div>
            <div id="totp-secret" style="font-family:ui-monospace,monospace;font-size:13px;letter-spacing:1px;background:var(--bar-bg);border-radius:8px;padding:10px;word-break:break-all"></div>
            <button class="btn ghost" id="totp-copy" style="margin-top:8px;font-size:12px;padding:6px 14px">复制密钥</button>
            <div style="font-size:11px;color:var(--sub);margin-top:6px">认证器添加方式：桌面端可扫码，或选择「手动输入」，账号名随意，密钥填上面的字符串（无空格）。</div>
          </div>
          <div id="totp-recovery-box" class="hidden" style="margin-bottom:10px">
            <div style="font-size:11px;color:var(--sub);margin-bottom:4px">恢复码（请抄下保存，登录时可直接代替验证码）：</div>
            <div id="totp-recovery" style="font-family:ui-monospace,monospace;font-size:12px;background:var(--bar-bg);border-radius:8px;padding:10px;line-height:1.9"></div>
          </div>
          <button class="btn ghost block" id="totp-gen" style="margin-bottom:10px">生成密钥</button>
          <div class="hidden" id="totp-verify-box">
            <label class="f-label">输入认证器当前 6 位验证码</label>
            <input class="f-input" id="totp-code" inputmode="numeric" maxlength="6" placeholder="6 位动态码">
            <button class="btn green block" id="totp-enable" style="margin-top:10px">验证并启用</button>
          </div>
        </div>
        <div id="totp-active" class="hidden">
          <div style="font-size:11.5px;color:var(--sub);line-height:1.7;margin-bottom:10px">
            登录时除密码外还需输入认证器动态码（或恢复码）。<br>
            停用需输入当前动态码或恢复码。
          </div>
          <input class="f-input" id="totp-disable-code" inputmode="numeric" placeholder="当前动态码或恢复码">
          <button class="btn ghost block" id="totp-disable" style="margin-top:10px">停用两步验证</button>
          <div id="totp-msg" style="font-size:11.5px;color:var(--sub);margin-top:8px;min-height:14px"></div>
        </div>
      </div>
    </div>
    <div class="section" id="deploy-info">
      <div class="section-title">部署与配置说明</div>
      <div class="form-card" style="font-size:12px;color:var(--txt);line-height:1.9">
        <div><b>1. 登录账号密码</b><br>
        首次部署：在 <code style="font-family:ui-monospace,monospace;font-size:11px;background:var(--bar-bg);padding:1px 5px;border-radius:4px">wrangler.toml</code> 配置 <code style="font-family:ui-monospace,monospace;font-size:11px;background:var(--bar-bg);padding:1px 5px;border-radius:4px">USERNAME</code>，并用 <code style="font-family:ui-monospace,monospace;font-size:11px;background:var(--bar-bg);padding:1px 5px;border-radius:4px">wrangler secret put PASSWORD</code> 设置初始密码。登录后可在本页「账号安全」直接修改密码，无需再碰命令行。</div>
        <div style="margin-top:8px"><b>2. 推送渠道</b><br>
        <b>PushPlus 微信</b>：到 pushplus.plus 注册，复制 token 填入 <code style="font-family:ui-monospace,monospace;font-size:11px;background:var(--bar-bg);padding:1px 5px;border-radius:4px">wrangler.toml</code> 的 <code style="font-family:ui-monospace,monospace;font-size:11px;background:var(--bar-bg);padding:1px 5px;border-radius:4px">PUSHPLUS_TOKEN</code> 后重启。<br>
        <b>Bark（iOS）</b>：iPhone 安装 Bark，复制设备 Key 填到本页「提醒设置」，启用 Bark 后提醒直接走 Bark（无需部署配置）。<br>
        <b>邮件</b>：将 <code style="font-family:ui-monospace,monospace;font-size:11px;background:var(--bar-bg);padding:1px 5px;border-radius:4px">PUSHPLUS_API</code> 改为邮件/通知接口地址（支持 JSON：token, title, content）。</div>
        <div style="margin-top:8px"><b>3. 每日自动提醒（上线后）</b><br>
        <code style="font-family:ui-monospace,monospace;font-size:11px;background:var(--bar-bg);padding:1px 5px;border-radius:4px">wrangler.toml</code> 内置 <code style="font-family:ui-monospace,monospace;font-size:11px;background:var(--bar-bg);padding:1px 5px;border-radius:4px">[triggers] crons = ["0 1 * * *"]</code>（北京时间每天 9 点），deploy 时自动创建。还款提醒提前天数、年费提前 60 天提醒每天检查，同一提醒不重复发送。<br>
        本地调试不跑定时任务，用上方「发送测试提醒」验证通道。</div>
        <div style="margin-top:8px"><b>4. 数据备份</b><br>
        「数据」页可导出 JSON / CSV 备份，防止数据丢失。</div>
      </div>
    </div>
  </div>

  <!-- ===== 数据导入导出 ===== -->
  <div id="page-data" class="hidden">
    <div class="section">
      <div class="section-title">备份与恢复</div>
      <div class="form-card">
        <div class="f-label">导出备份（JSON 全量 / CSV 卡片表）</div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn primary" style="flex:1" id="exp-json">导出 JSON</button>
          <button class="btn ghost" style="flex:1" id="exp-csv">导出 CSV</button>
        </div>
        <div class="f-label" style="margin-top:14px">导入恢复（JSON，将覆盖当前全部数据）</div>
        <label class="btn primary block" for="import-file" id="import-pick" style="margin-top:8px">选择备份文件（JSON）</label>
        <input type="file" id="import-file" accept=".json,application/json" style="display:none">
        <div id="import-fname" style="font-size:12px;color:var(--sub);margin-top:8px"></div>
        <button class="btn red block" id="import-btn" style="margin-top:12px" disabled>开始导入（覆盖）</button>
        <div style="font-size:11px;color:var(--sub);margin-top:10px">用于防止免费平台数据丢失。导入前建议先导出一份备份。</div>
      </div>
    </div>
    <div class="section">
      <div class="section-title">批量导入卡片（CSV 表格）</div>
      <div class="form-card">
        <div class="f-label">选择填好的 CSV 表格，一次导入多张卡片（同银行+尾号已存在自动跳过）</div>
        <label class="btn primary block" for="card-import-file" id="card-import-pick" style="margin-top:8px">选择 CSV 文件</label>
        <input type="file" id="card-import-file" accept=".csv,text/csv" style="display:none">
        <div id="card-import-fname" style="font-size:12px;color:var(--sub);margin-top:8px"></div>
        <button class="btn primary block" id="card-import-btn" style="margin-top:12px" disabled>导入卡片</button>
        <div style="font-size:11.5px;color:var(--sub);margin-top:10px">还没有表格？<a id="dl-tpl" style="color:var(--accent);cursor:pointer;text-decoration:underline">下载导入模板</a>，按格式填写后另存为 CSV 再导入</div>
        <div id="card-import-result" style="font-size:11.5px;color:var(--sub);margin-top:10px"></div>
      </div>
    </div>
  </div>

  <!-- 底部导航 -->
  <div class="nav">
    <button data-page="dash" class="active">
      <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>
      仪表盘
    </button>
    <button data-page="bills">
      <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      账单
    </button>
    <button data-page="settings">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      设置
    </button>
    <button data-page="data">
      <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      数据
    </button>
  </div>
</div>

<div id="modal-root"></div>
<div id="toast" class="toast"></div>
<div id="confirm-root" class="hidden"></div>

<script>
// ---------- 全局状态 ----------
let allCards = [];
let allBills = [];
let allFees = [];
let settings = {};
let cardSort = 'repay';
let adminToken = sessionStorage.getItem('ccToken') || null;
let adminUsername = sessionStorage.getItem('ccUser') || null;
let currentCard = null;      // 详情页当前卡片
let currentEditing = null;   // 当前编辑对象
let billFilter = 'all';
let calDate = new Date();
let calMode = 'both';

const $ = id => document.getElementById(id);
const GRADS = ['grad-0','grad-1','grad-2','grad-3','grad-4','grad-5'];

function esc(s){ if(s==null) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); }
function fmt(n){ return Number(n||0).toLocaleString('zh-CN'); }
function fmtY(d){ if(!d) return ''; const x=new Date(d); return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0'); }
function todayStr(){ const d=new Date(); return fmtY(d); }
function daysUntil(dateStr){ if(!dateStr) return null; const d=new Date(dateStr+'T00:00:00'); const t0=new Date(); const a=new Date(t0.getFullYear(),t0.getMonth(),t0.getDate()); return Math.round((d-a)/86400000); }
function usageRate(c){ const lim=Number(c.card_limit)||0; if(lim<=0) return 0; return (Number(c.used_amount)||0)/lim; }
function usageColor(r){ if(r<0.4) return {cls:'green',txt:'低使用率'}; if(r<=0.7) return {cls:'yellow',txt:'中等使用率'}; return {cls:'red',txt:'高使用率'}; }
function gradOf(id){ return GRADS[Number(id)%GRADS.length]; }
function condText(t){ return t==='times'?'刷次数':(t==='amount'?'刷金额':(t==='points'?'积分兑换':'刷次数')); }
function feeInfo(f){
  if(!f) return {pct:0,status:'active',label:'未配置'};
  const tv=Number(f.target_value)||1; const cv=Number(f.current_value)||0;
  const pct=Math.min(100,Math.round(cv/tv*100));
  let status=f.status||'active', label='进行中';
  if(status==='waived'){label='已减免';}
  else if(status==='failed'){label='未达标';}
  else if(pct>=100){label='已达标';status='active';}
  else if(pct>=80){label='接近达标';status='near';}
  return {pct,status,label};
}
function feePill(info){
  const map={waived:'green',failed:'red',near:'yellow',active:'blue'};
  return '<span class="pill '+map[info.status]+'">'+info.label+'</span>';
}

// ---------- API ----------
async function api(path, method='GET', body){
  const opt={method,headers:{}};
  if(body!==undefined){ opt.headers['Content-Type']='application/json'; opt.body=JSON.stringify(body); }
  if(adminToken) opt.headers['Authorization']='Bearer '+adminToken;
  const r=await fetch(path,opt);
  const data=await r.json().catch(()=>({success:false,message:r.status===401?'请先登录':(r.status===500?'服务器错误，请重试':'响应异常')}));
  // 401：未登录访问静默（仪表盘公开展示空数据）；已登录但 token 失效才弹登录窗
  if(!data.success && data.message==='请先登录' && adminToken && typeof openLogin==='function') openLogin();
  return data;
}

// ---------- Toast ----------
let toastTimer;
function toast(msg,isErr=false){
  const t=$('toast'); t.textContent=msg; t.className='toast show'+(isErr?' err':'');
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>{ t.className='toast'; },2600);
}

// ---------- 确认弹窗（替代原生 confirm，兼容客户端内嵌浏览器） ----------
let confirmCb=null;
function confirmModal(msg,onYes){
  confirmCb=onYes||null;
  const root=$('confirm-root');
  root.className='';
  root.innerHTML='<div class="overlay" style="align-items:center" onclick="if(event.target===this)closeConfirm()">'+
    '<div class="modal" style="max-width:420px;border-radius:20px;text-align:left">'+
    '<div class="m-head"><div class="m-title">确认操作</div><button class="icon-btn" onclick="closeConfirm()"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>'+
    '<div class="confirm-msg">'+msg+'</div>'+
    '<div style="display:flex;gap:10px"><button class="btn ghost" style="flex:1" onclick="closeConfirm()">取消</button>'+
    '<button class="btn red" style="flex:1" onclick="confirmYes()">确定</button></div></div></div>';
}
function confirmYes(){
  const cb=confirmCb; confirmCb=null; $('confirm-root').className='hidden';
  if(cb) cb();
}
function closeConfirm(){ confirmCb=null; $('confirm-root').className='hidden'; }

// ---------- 页面切换 ----------
const PAGES=['dash','bills','settings','data','detail'];
function showPage(p){
  // 未登录仅开放仪表盘；账单 / 设置 / 数据直接弹出登录
  if(!adminToken && p!=='dash'){ openLogin(); return; }
  PAGES.forEach(x=>{ $('page-'+x).classList.toggle('hidden',x!==p); });
  document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===p));
  window.scrollTo(0,0);
  if(p==='dash') renderDash();
  if(p==='bills') renderBills();
  if(p==='settings') renderSettings();
}

// ---------- 数据加载 ----------
async function loadAll(){
  const [c,b,f,s] = await Promise.all([api('/api/cards'),api('/api/bills'),api('/api/fee'),api('/api/settings')]);
  allCards=c.success?c.cards:[];
  allBills=b.success?b.bills:[];
  allFees=f.success?f.feeRules:[];
  settings=s.success?s.settings:{};
  renderDash();
  updateAuth();
}

function feeOf(cardId){ return allFees.find(x=>Number(x.card_id)===Number(cardId)) || null; }
function billsOf(cardId){ return allBills.filter(x=>Number(x.card_id)===Number(cardId)); }
function unpaidOf(cardId){ return billsOf(cardId).filter(x=>!x.paid); }
function usedOf(card){ return Number(card.used_amount)||0; }

// ---------- 仪表盘 ----------
function renderDash(){
  // KPI：同银行多张卡共享额度时按银行合并（每银行取最高额度），避免重复累计
  const bankMax = {};
  const tempBankMax = {};
  allCards.forEach(c => {
    const lim = Number(c.card_limit) || 0;
    const tl = Number(c.temp_limit) || 0;
    bankMax[c.bank_name] = Math.max(bankMax[c.bank_name] || 0, lim);
    tempBankMax[c.bank_name] = Math.max(tempBankMax[c.bank_name] || 0, tl);
  });
  const total = Object.values(bankMax).reduce((s, v) => s + v, 0);
  const temp = Object.values(tempBankMax).reduce((s, v) => s + v, 0);
  const used = allCards.reduce((s, c) => s + usedOf(c), 0);
  const avail = total + temp - used;
  $('k-total').textContent=fmt(total);
  const activeCards = allCards.filter(c=>c.status!=='closed');
  const bankCount = new Set(activeCards.map(c=>c.bank_name)).size;
  $('k-total-note').textContent = bankCount+' 家银行 · '+activeCards.length+' 张卡';
  $('k-used').textContent=fmt(used);
  $('k-avail').textContent=fmt(avail);

  const today=new Date();
  const due7=[];
  allCards.forEach(c=>{
    if(c.status==='closed') return;
    const bd=Number(c.billing_day); const pv=Number(c.payment_value);
    if(!bd||!pv) return;
    // 简化：按账单日+还款值推算下一还款日
    const payDate=nextPaymentDate(c,today);
    if(c.paid_through && payDate.getTime()<=new Date(c.paid_through+'T00:00:00').getTime()) return; // 本期已还
    const du=Math.round((payDate-today)/86400000);
    if(du>=0&&du<=7) due7.push({card:c,du,date:payDate});
  });
  due7.sort((a,b)=>a.du-b.du);
  $('k-due7').textContent=due7.length;
  $('k-due7-note').textContent=due7.length? (due7.map(x=>x.card.bank_name).join('、')+' 待还款') : '无近期还款';

  // 年费概览
  const feeCards=allCards.filter(c=>feeOf(c.id));
  if(feeCards.length){
    const wav=feeCards.filter(c=>feeInfo(feeOf(c.id)).status==='waived').length;
    const near=feeCards.filter(c=>['near','failed'].includes(feeInfo(feeOf(c.id)).status)).length;
    $('k-fee').textContent=feeCards.length+' 张卡配置减免，已减免 '+wav+' 张'+(near?'，'+near+' 张需关注':'');
  } else {
    $('k-fee').textContent='暂无年费减免规则';
  }

  // 卡片列表
  const q=($('search-bar').value||'').toLowerCase().trim();
  let list=allCards.filter(c=>{
    if(q){ return (c.bank_name||'').toLowerCase().includes(q)||(c.card_type||'').toLowerCase().includes(q); }
    return true;
  });
  // 已还本期 → 排序沉底
  const isPaidNow = c => {
    const p=nextPaymentDate(c,today);
    return c.paid_through && p.getTime()<=new Date(c.paid_through+'T00:00:00').getTime();
  };
  if(cardSort==='repay') list.sort((a,b)=>(isPaidNow(a)?1:0)-(isPaidNow(b)?1:0) || nextPaymentDate(a,today)-nextPaymentDate(b,today));
  else if(cardSort==='bill') list.sort((a,b)=>nextBillDate(a,today)-nextBillDate(b,today));
  else if(cardSort==='fee') list.sort((a,b)=>(feeOf(a.id)?feeInfo(feeOf(a.id)).pct:9999)-(feeOf(b.id)?feeInfo(feeOf(b.id)).pct:9999));
  else list.sort((a,b)=>a.id-b.id);
  const box=$('dash-cards');
  if(!list.length){ box.innerHTML='<div class="empty">没有卡片，点击上方「+ 添加」创建</div>'; return; }
  box.innerHTML='<div class="cl-table"><div class="cl-head"><span>卡片</span><span>账单日</span><span>还款日</span><span class="cl-col-lim">永久额度</span><span class="cl-col-used">已用额度</span><span class="cl-col-rate">使用率</span><span>年费进度</span></div>'+list.map(c=>{
    const r=usageRate(c), uc=usageColor(r);
    const ucHex=uc.cls==='green'?'var(--green)':uc.cls==='yellow'?'var(--yellow)':'var(--red)';
    const lim=Number(c.card_limit)||0, temp=Number(c.temp_limit)||0, used=usedOf(c);
    const f=feeOf(c.id), fi=feeInfo(f);
    const payDate=nextPaymentDate(c,today);
    const du=Math.round((payDate-today)/86400000);
    let dueTxt='',dueCls='';
    if(du<0){dueTxt='已逾期 '+(0-du)+' 天';dueCls='red';}
    else if(du<=3){dueTxt=du===0?'今天到期':'剩 '+du+' 天';dueCls='red';}
    else if(du<=7){dueTxt='剩 '+du+' 天';dueCls='yellow';}
    else {dueTxt='还款日 '+fmtY(payDate).slice(5);}
    const fiCls=fi.status==='waived'?'green':fi.status==='failed'?'red':fi.status==='near'?'yellow':'';
    const paid = c.paid_through && payDate.getTime() <= new Date(c.paid_through+'T00:00:00').getTime();
    const feeCell=f? ('<span class="fee-wide"><span class="fee-num">'+f.current_value+'/'+f.target_value+(f.condition_type==='amount'?' 元':'')+'</span><span class="sub '+fiCls+'">'+condText(f.condition_type)+' · '+fi.label+'</span></span><span class="fee-narrow '+fiCls+'">'+condText(f.condition_type)+' · '+fi.label+'</span>') : '<span class="sub">未配置</span>';
    return '<div class="cl-row" onclick="openDetail('+c.id+')">'+
      '<span class="cl-bank">'+esc(c.bank_name)+(c.card_type?' <span class="ct">'+esc(c.card_type)+' · 尾号'+esc(c.last_4_digits)+'</span>':'<span class="ct">尾号'+esc(c.last_4_digits)+'</span>')+'</span>'+
      '<span class="cl-cell">'+c.billing_day+' 日</span>'+
      '<span class="cl-cell" style="cursor:pointer" title="点击标记本期已还" onclick="event.stopPropagation();onPaidCellClick('+c.id+',\\''+esc(c.paid_through||'')+'\\',event)">'+
        (c.payment_type==='days_after_billing'?'账单后'+c.payment_value+'天':c.payment_value+' 日')+
        (paid?'<span class="sub green">已还 ✓</span>':'<span class="sub '+dueCls+'">'+dueTxt+'</span>')+
      '</span>'+
      '<span class="cl-cell cl-col-lim"><span class="val">'+fmt(lim)+'</span>'+(temp>0?'<span class="sub">临时 '+fmt(temp)+'</span>':'')+'</span>'+
      '<span class="cl-cell cl-col-used"><span class="val">'+fmt(used)+'</span></span>'+
      '<span class="cl-cell cl-col-rate">'+(r*100).toFixed(0)+'%<div class="cl-rate-bar"><div style="width:'+Math.min(100,(r*100).toFixed(1))+'%;background:'+ucHex+'"></div></div></span>'+
      '<span class="cl-cell">'+feeCell+'</span>'+
      '</div>';
  }).join('')+'</div>';

  renderReminders();
  renderFeeOverview();
  renderCalendar();
}

function renderFeeOverview(){
  const box=$('fee-overview');
  if(!box) return;
  const fs=allCards.filter(c=>feeOf(c.id));
  if(!fs.length){ box.innerHTML='<div class="empty">未配置年费减免规则（卡片详情页可配置）</div>'; return; }
  box.innerHTML=fs.map(c=>{
    const f=feeOf(c.id), fi=feeInfo(f), pct=Math.min(100,fi.pct);
    const color=fi.status==='waived'?'var(--green)':fi.status==='failed'?'var(--red)':fi.status==='near'?'var(--yellow)':'var(--blue)';
    return '<div class="fo-row">'+
      '<div class="fo-name">'+esc(c.bank_name)+(c.card_type?' · '+esc(c.card_type):'')+' 尾号'+esc(c.last_4_digits)+'</div>'+
      '<div class="fo-bar"><div style="width:'+pct+'%;background:'+color+'"></div></div>'+
      '<div class="fo-meta"><span>'+condText(f.condition_type)+' '+esc(f.current_value)+'/'+esc(f.target_value)+(f.condition_type==='amount'?' 元':'')+'</span>'+feePill(fi)+'</div>'+
    '</div>';
  }).join('');
}

function nextPaymentDate(c,ref){
  const bd=Number(c.billing_day); const pv=Number(c.payment_value);
  const today=new Date(ref.getFullYear(),ref.getMonth(),ref.getDate());
  const prevBilling=new Date(today.getFullYear(),today.getMonth()-1,bd);
  const thisBilling=new Date(today.getFullYear(),today.getMonth(),bd);
  const nextBilling=new Date(today.getFullYear(),today.getMonth()+1,bd);
  const payFor=b=>{
    const p=new Date(b);
    if(c.payment_type==='days_after_billing'){ p.setDate(p.getDate()+pv); }
    else { if(pv>b.getDate()) p.setDate(pv); else { p.setMonth(p.getMonth()+1); p.setDate(pv); } }
    return p;
  };
  const dPrev=payFor(prevBilling), dThis=payFor(thisBilling), dNext=payFor(nextBilling);
  if(today>dPrev) return today<=dThis?dThis:dNext;
  return dPrev;
}

function nextBillDate(c,ref){
  const bd=Number(c.billing_day)||1;
  const today=new Date(ref.getFullYear(),ref.getMonth(),ref.getDate());
  let d=new Date(today.getFullYear(),today.getMonth(),Math.min(bd,28));
  if(d<today) d=new Date(today.getFullYear(),today.getMonth()+1,Math.min(bd,28));
  return d;
}

function renderReminders(){
  const box=$('dash-reminders');
  const items=[];
  const today=new Date();
  allCards.forEach(c=>{
    if(c.status==='closed') return;
    const pay=nextPaymentDate(c,today);
    const du=Math.round((pay-today)/86400000);
    if(du>=0&&du<=7){
      if(c.paid_through && pay.getTime()<=new Date(c.paid_through+'T00:00:00').getTime()) return; // 本期已还
      const bills=unpaidOf(c.id);
      const amt=bills.reduce((s,b)=>s+(Number(b.amount)||0),0);
      items.push({t:'payment',due:du,html:'<b>'+esc(c.bank_name)+'</b>'+(amt>0?' 待还约 '+fmt(amt)+' 元':'')+' · 还款日 '+fmtY(pay)+'（剩 '+du+' 天）'});
    }
    // 年费周期临近结束（提前约2个月）且未达标 → 提醒
    if(c.annual_fee_end){
      const f=feeOf(c.id); const fi=feeInfo(f);
      if(fi.status!=='waived'){
        const d=daysUntil(c.annual_fee_end);
        if(d!==null&&d>=0&&d<=60){
          items.push({t:'fee',due:d,html:'<b>'+esc(c.bank_name)+'</b> 年费周期 '+c.annual_fee_end+' 结束 · 进度 '+fi.pct+'% 未达标'});
        }
      }
    }
  });
  items.sort((a,b)=>a.due-b.due);
  if(!items.length){ box.innerHTML='<div class="empty">暂无近期提醒</div>'; return; }
  box.innerHTML=items.map(x=>'<div class="list-card" style="margin:0 0 8px"><div style="font-size:13px">'+x.html+'</div></div>').join('');
}

// ---------- 日历 ----------
function renderCalendar(){
  const d=calDate, y=d.getFullYear(), m=d.getMonth();
  $('cal-title').textContent=y+' 年 '+(m+1)+' 月';
  const dow=['日','一','二','三','四','五','六'];
  $('cal-dow').innerHTML=dow.map(x=>'<div class="cal-dow">'+x+'</div>').join('');
  const first=new Date(y,m,1).getDay();
  const dim=new Date(y,m+1,0).getDate();
  const billDays={}, payDays={};
  allCards.forEach(c=>{
    const bd=Number(c.billing_day); if(!bd) return;
    const cb=Math.min(Math.max(1,bd),dim);
    billDays[cb]=1;
    // 本月还款日：上月账单 + 本月账单 对应的还款日
    const prevB=new Date(y,m-1,Math.min(bd,new Date(y,m,0).getDate()));
    const thisB=new Date(y,m,cb);
    [prevB,thisB].forEach(b=>{
      const p=new Date(b);
      const pv=Number(c.payment_value);
      if(c.payment_type==='days_after_billing'){ p.setDate(p.getDate()+pv); }
      else { if(pv>b.getDate()) p.setDate(pv); else { p.setMonth(p.getMonth()+1); p.setDate(pv); } }
      if(p.getFullYear()===y&&p.getMonth()===m) payDays[p.getDate()]=1;
    });
  });
  let html='';
  for(let i=0;i<first;i++) html+='<div class="cal-day other-month"></div>';
  const t=new Date();
  const modeLabel={both:'账单+还款',bill:'仅账单日',pay:'仅还款日'};
  $('cal-mode-label').textContent=modeLabel[calMode]||'账单+还款';
  for(let day=1;day<=dim;day++){
    let cls='cal-day';
    if(day===t.getDate()&&m===t.getMonth()&&y===t.getFullYear()) cls+=' today';
    if(calMode==='bill'){ if(billDays[day]) cls+=' bill'; }
    else if(calMode==='pay'){ if(payDays[day]) cls+=' pay'; }
    else { if(payDays[day]&&billDays[day]) cls+=' bill pay'; else if(payDays[day]) cls+=' pay'; else if(billDays[day]) cls+=' bill'; }
    html+='<div class="'+cls+'"'+(cls.indexOf('bill pay')>-1?' title="账单日 + 还款日"':'')+'><span class="num">'+day+'</span></div>';
  }
  $('cal-body').innerHTML=html;
}

// ---------- 详情页 ----------
async function openDetail(id){
  const data=await api('/api/cards/'+id);
  if(!data.success){ toast(data.message,true); return; }
  const {card,limitChanges,bills,feeRules}=data;
  currentCard=card;
  allFees=allFees.filter(f=>Number(f.card_id)!==Number(id)).concat(feeRules||[]);
  allBills=allBills.filter(b=>Number(b.card_id)!==Number(id)).concat(bills||[]);
  renderDetail(card,limitChanges,bills,feeRules);
  showPage('detail');
}

function renderDetail(card,limitChanges,bills,feeRules){
  const f=feeRules&&feeRules[0]?feeRules[0]:null;
  const fi=feeInfo(f);
  const r=usageRate(card), uc=usageColor(r);
  const lim=Number(card.card_limit)||0, temp=Number(card.temp_limit)||0, used=usedOf(card);
  const avail=lim+temp-used;

  const feeBlock=f?('<div class="detail-block"><div class="d-block-title">年费减免进度 '+feePill(fi)+'</div>'+
    '<div style="font-size:13px;margin-bottom:8px">'+condText(f.condition_type)+' '+f.target_value+' · 当前 '+f.current_value+'（'+fi.pct+'%）</div>'+
    '<div class="bar"><div style="width:'+fi.pct+'%;background:'+(fi.status==='waived'?'var(--green)':fi.status==='near'?'var(--yellow)':'var(--blue)')+'"></div></div>'+
    '<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--sub);margin-top:6px"><span>周期 '+f.cycle_start+' ~ '+f.cycle_end+'</span><span>年费 '+fmt(f.annual_fee)+' 元</span></div>'+
    '<div style="display:flex;gap:8px;margin-top:12px"><button class="btn ghost" style="flex:1;padding:8px" onclick="openFeeForm('+f.id+','+card.id+')">更新进度</button>'+
    '<button class="btn ghost" style="flex:1;padding:8px" onclick="openFeeForm(0,'+card.id+')">添加规则</button></div></div>') :
    ('<div class="detail-block"><div class="d-block-title">年费减免进度</div><div class="empty" style="padding:12px 0">未配置减免规则</div>'+
    '<button class="btn primary block" style="padding:9px" onclick="openFeeForm(0,'+card.id+')">+ 配置年费减免</button></div>');

  const tl=(limitChanges||[]).length?('<div class="detail-block"><div class="d-block-title">额度变更历史</div><div class="tl">'+
    limitChanges.map(l=>'<div class="tl-item"><div class="d">'+esc(l.effective_date)+' · '+ (l.change_type==='temp'?'临时':'永久') +'</div>'+
    '<div class="c">'+fmt(l.old_limit)+' → '+fmt(l.new_limit)+' 元</div>'+
    '<div class="r">'+esc(l.reason||'')+(l.created_at?' · '+esc(l.created_at.slice(0,16)):'')+'</div></div>').join('')+
    '</div><button class="btn primary block" style="padding:9px;margin-top:10px" onclick="openLimitForm('+card.id+')">+ 记录额度变更</button></div>') :
    ('<div class="detail-block"><div class="d-block-title">额度变更历史</div><div class="empty" style="padding:12px 0">暂无记录</div>'+
    '<button class="btn primary block" style="padding:9px" onclick="openLimitForm('+card.id+')">+ 记录额度变更</button></div>');

  const billRows=(bills||[]).length?bills.map(b=>{
    const st=b.paid?'<span class="pill gray">已还</span>':(daysUntil(b.due_date)!==null&&daysUntil(b.due_date)<0?'<span class="pill red">逾期</span>':'<span class="pill blue">未还</span>');
    return '<div class="bill-row"><div><div class="amt">'+fmt(b.amount)+' 元</div><div class="date">账单 '+esc(b.bill_date)+(b.due_date?' · 截止 '+esc(b.due_date):'')+'</div></div>'+
    '<div style="display:flex;align-items:center;gap:8px">'+st+
    (b.paid?'':'<button class="bill-paid-btn" onclick="markBillPaid('+b.id+')">✓ 已还</button>')+
    '<span class="link danger" onclick="delBill('+b.id+')">删除</span></div></div>';
  }).join(''):'<div class="empty" style="padding:10px 0">暂无账单</div>';

  $('detail-body').innerHTML=
    '<div class="card-v '+gradOf(card.id)+'"><div class="bank">'+esc(card.bank_name)+'</div>'+
    '<div class="type">'+esc(card.card_type||'信用卡')+(card.status==='closed'?' · 已注销':'')+'</div>'+
    '<div class="chip"></div>'+
    '<div class="num">•••• •••• •••• '+esc(card.last_4_digits)+'</div>'+
    '<div class="row"><div>账单日<b>'+card.billing_day+' 日</b></div><div>还款日<b>'+(card.payment_type==='fixed_day'?card.payment_value+' 日':'账单日后 '+card.payment_value+' 天')+'</b></div><div>免息期<b>'+card.max_grace_period+' 天</b></div></div></div>'+
    '<div class="kpi-row" style="padding:8px 16px 4px">'+
    '<div class="kpi"><div class="k-label">永久额度</div><div class="k-value" style="font-size:19px">'+fmt(lim)+'</div></div>'+
    '<div class="kpi"><div class="k-label">临时额度'+(card.temp_limit_expiry?' · 至 '+esc(card.temp_limit_expiry):'')+'</div><div class="k-value" style="font-size:19px">'+fmt(temp)+'</div></div>'+
    '<div class="kpi"><div class="k-label">已用额度</div><div class="k-value" style="font-size:19px">'+fmt(used)+'</div></div>'+
    '<div class="kpi"><div class="k-label">可用额度</div><div class="k-value" style="font-size:19px">'+fmt(avail)+'</div></div></div>'+
    '<div class="detail-block"><div class="d-block-title">额度使用率</div>'+
    '<div class="bar"><div style="width:'+(r*100).toFixed(1)+'%;background:'+(uc.cls==='green'?'var(--green)':uc.cls==='yellow'?'var(--yellow)':'var(--red)')+'"></div></div>'+
    '<div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--sub);margin-top:6px"><span>已用 '+fmt(used)+' / 永久 '+fmt(lim)+'（'+(r*100).toFixed(0)+'%）</span><span class="pill '+uc.cls+'">'+uc.txt+'</span></div></div>'+
    feeBlock+tl+
    '<div class="detail-block"><div class="d-block-title">账单列表 <button class="btn primary" style="padding:5px 10px;font-size:11.5px" onclick="openBillForm(0,'+card.id+')">+ 添加</button></div>'+billRows+'</div>'+
    '<div class="detail-actions" style="display:flex;gap:8px;margin:4px 16px 12px">'+
    '<button class="btn ghost" style="flex:1" onclick="openCardForm('+card.id+')">编辑卡片</button>'+
    '<button class="btn red" style="flex:1" onclick="delCard('+card.id+')">删除卡片</button></div>';
}

// ---------- 账单页 ----------
function renderBills(){
  const rows=allBills.filter(b=>billFilter==='all'||(billFilter==='paid'?b.paid:!b.paid));
  const nameOf=id=>{ const c=allCards.find(x=>Number(x.id)===Number(id)); return c?c.bank_name+'（'+c.last_4_digits+'）':'卡'+id; };
  const box=$('bills-list');
  if(!rows.length){ box.innerHTML='<div class="empty">'+ (allBills.length?'没有匹配的账单':'暂无账单记录') +'</div>'; return; }
  box.innerHTML=rows.map(b=>{
    const st=b.paid?'<span class="pill gray">已还</span>':(b.due_date&&daysUntil(b.due_date)<0?'<span class="pill red">逾期</span>':'<span class="pill blue">未还</span>');
    return '<div class="form-card" style="margin:0 0 10px">'+
    '<div style="display:flex;justify-content:space-between;align-items:center"><div><div style="font-weight:700;font-size:14px">'+esc(nameOf(b.card_id))+'</div>'+
    '<div class="date" style="font-size:11.5px;color:var(--sub);margin-top:3px">账单日 '+esc(b.bill_date)+(b.due_date?' · 还款截止 '+esc(b.due_date):'')+'</div></div>'+st+'</div>'+
    '<div style="display:flex;gap:14px;margin-top:10px;align-items:center"><div style="font-size:16px;font-weight:800">'+fmt(b.amount)+' 元</div>'+
    (b.min_payment?('<div style="font-size:11.5px;color:var(--sub)">最低还款 '+fmt(b.min_payment)+'</div>'):'')+
    '<div style="margin-left:auto;display:flex;gap:8px">'+
    (b.paid?'':'<button class="bill-paid-btn" onclick="markBillPaid('+b.id+')">✓ 已还</button>')+
    '<span class="link" onclick="openBillForm('+b.id+','+b.card_id+')">编辑</span>'+
    '<span class="link danger" onclick="delBill('+b.id+')">删除</span></div></div></div>';
  }).join('');
}

// ---------- 设置页 ----------
function renderSettings(){
  $('set-advance').value=settings.payment_advance_days||'1';
  const p=settings.enable_pushplus!=='0', b=settings.enable_bark==='1', e=settings.enable_email==='1';
  const pb=$('set-pushplus'), bb=$('set-bark'), eb=$('set-email');
  pb.style.background=p&&!b?'rgba(16,185,129,0.18)':'var(--card)';
  pb.style.color=p&&!b?'#34d399':'var(--sub)';
  bb.style.background=b?'rgba(16,185,129,0.18)':'var(--card)';
  bb.style.color=b?'#34d399':'var(--sub)';
  eb.style.background=e?'rgba(16,185,129,0.18)':'var(--card)';
  eb.style.color=e?'#34d399':'var(--sub)';
  const bk=$('bark-config');
  if(bk) bk.classList.toggle('hidden',!b);
  if($('set-bark-key')) $('set-bark-key').value=settings.bark_key||'';
  if($('sec-user')) $('sec-user').textContent=adminUsername||'-';
  loadTotpState();
}

// ---------- 两步验证（2FA） ----------
let totpState={enabled:false};
async function loadTotpState(){
  try{ const r=await api('/api/totp/status','GET'); totpState.enabled=!!r.enabled; }catch(e){}
  const st=$('totp-status');
  if(st){
    if(totpState.enabled){ st.textContent='已启用'; st.style.color='var(--green)'; }
    else { st.textContent='未启用'; st.style.color='var(--sub)'; }
    $('totp-setup').classList.toggle('hidden',totpState.enabled);
    $('totp-active').classList.toggle('hidden',!totpState.enabled);
  }
}

// ---------- 弹窗 ----------
function openModal(html){
  $('modal-root').innerHTML='<div class="overlay" onclick="if(event.target===this)closeModal()"><div class="modal">'+html+'</div></div>';
}
function closeModal(){ $('modal-root').innerHTML=''; }

// 登录（支持两步验证：密码 → 验证码）
function openLogin(){
  openModal('<div class="m-head"><div class="m-title">管理员登录</div><button class="icon-btn" onclick="closeModal()"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>'+
  '<label class="f-label">用户名</label><input class="f-input" id="lg-user">'+
  '<label class="f-label">密码</label><input class="f-input" id="lg-pass" type="password">'+
  '<div id="lg-totp-wrap" class="hidden"><label class="f-label">两步验证码（6 位动态码或恢复码）</label><input class="f-input" id="lg-totp" inputmode="numeric"></div>'+
  '<div id="lg-err" style="font-size:11.5px;color:var(--yellow);margin-top:8px;min-height:14px"></div>'+
  '<button class="btn primary block" style="margin-top:12px" onclick="doLogin()">登录</button>');
}
async function doLogin(){
  const payload={username:$('lg-user').value,password:$('lg-pass').value};
  const totpBox=$('lg-totp');
  if(totpBox&&!totpBox.classList.contains('hidden')&&totpBox.value) payload.totp=totpBox.value;
  const r=await api('/api/login','POST',payload);
  if(r.success){ adminToken=r.token; adminUsername=r.username; sessionStorage.setItem('ccToken',r.token); sessionStorage.setItem('ccUser',r.username); toast('登录成功'); closeModal(); updateAuth(); loadAll(); }
  else if(r.need_totp){
    // 密码已通过，展示第二步
    const u=$('lg-user').value, p=$('lg-pass').value;
    openModal('<div class="m-head"><div class="m-title">两步验证</div><button class="icon-btn" onclick="closeModal()"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>'+
    '<div style="font-size:12px;color:var(--sub);margin-bottom:10px">已开启两步验证，请输入认证器中的 6 位动态码（或恢复码）</div>'+
    '<input class="f-input" id="lg-user" type="hidden" value="'+esc(u)+'">'+
    '<input class="f-input" id="lg-pass" type="hidden" value="'+esc(p)+'">'+
    '<input class="f-input" id="lg-totp" inputmode="numeric" placeholder="6 位验证码">'+
    '<div id="lg-err" style="font-size:11.5px;color:var(--yellow);margin-top:8px;min-height:14px"></div>'+
    '<button class="btn primary block" style="margin-top:12px" onclick="doLogin()">验证并登录</button>');
  }
  else { const e=$('lg-err'); if(e)e.textContent=r.message||'登录失败'; else toast(r.message||'登录失败',true); }
}
function updateAuth(){
  $('login-btn').classList.toggle('hidden',!!adminToken);
  $('logout-btn').classList.toggle('hidden',!adminToken);
  $('hdr-sub').textContent=adminToken?('已登录 · '+esc(adminUsername||'')):'';
}
function doLogout(){ adminToken=null; adminUsername=null; sessionStorage.removeItem('ccToken'); sessionStorage.removeItem('ccUser'); toast('已退出'); updateAuth(); showPage('dash'); }

// 卡片表单
function openCardForm(id){
  const c=id?allCards.find(x=>Number(x.id)===Number(id)):null;
  currentEditing=c||null;
  openModal('<div class="m-head"><div class="m-title">'+(c?'编辑卡片':'添加卡片')+'</div><button class="icon-btn" onclick="closeModal()"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>'+
  '<div class="f-row3"><div><label class="f-label">银行 *</label><input class="f-input" id="cf-bank" value="'+esc(c?c.bank_name:'')+'"></div>'+
  '<div><label class="f-label">卡种</label><input class="f-input" id="cf-type" value="'+esc(c?c.card_type:'')+'"></div>'+
  '<div><label class="f-label">尾号 *</label><input class="f-input" id="cf-tail" value="'+esc(c?c.last_4_digits:'')+'" maxlength="4"></div></div>'+
  '<div class="f-row3"><div><label class="f-label">永久额度</label><input class="f-input" id="cf-limit" type="number" value="'+(c?c.card_limit:'')+'"></div>'+
  '<div><label class="f-label">临时额度</label><input class="f-input" id="cf-temp" type="number" value="'+(c?c.temp_limit:0)+'"></div>'+
  '<div><label class="f-label">临时额度到期</label><input class="f-input" id="cf-tempexp" type="date" value="'+esc(c?c.temp_limit_expiry:'')+'"></div></div>'+
  '<div class="f-row"><div><label class="f-label">账单日 *</label><input class="f-input" id="cf-bill" type="number" min="1" max="31" value="'+(c?c.billing_day:'')+'"></div>'+
  '<div><label class="f-label">状态</label><select class="f-select" id="cf-status"><option value="normal" '+(c&&c.status==='closed'?'':'selected')+'>正常</option><option value="closed" '+(c&&c.status==='closed'?'selected':'')+'>已注销</option></select></div></div>'+
  '<label class="f-label">还款方式</label><select class="f-select" id="cf-ptype"><option value="days_after_billing" '+(c&&c.payment_type==='fixed_day'?'':'selected')+'>账单日后 N 天</option><option value="fixed_day" '+(c&&c.payment_type==='fixed_day'?'selected':'')+'>每月固定 N 日</option></select>'+
  '<div class="f-row"><div><label class="f-label">还款值（天数或日）*</label><input class="f-input" id="cf-pval" type="number" min="1" max="31" value="'+(c?c.payment_value:'')+'"></div>'+
  '<div><label class="f-label">宽限期</label><input class="f-input" id="cf-grace" type="number" min="0" max="31" value="'+(c?c.grace_days:0)+'"></div></div>'+
  '<div class="f-row3"><div><label class="f-label">年费（元）</label><input class="f-input" id="cf-fee" type="number" value="'+(c?c.annual_fee:0)+'"></div>'+
  '<div><label class="f-label">年费周期起始</label><input class="f-input" id="cf-fstart" type="date" value="'+esc(c?c.annual_fee_start:'')+'"></div>'+
  '<div><label class="f-label">年费周期结束</label><input class="f-input" id="cf-fend" type="date" value="'+esc(c?c.annual_fee_end:'')+'"></div></div>'+
  '<label class="f-label">已用额度（手动录入）</label><input class="f-input" id="cf-used" type="number" value="'+(c?c.used_amount:0)+'">'+
  '<label class="f-label">备注</label><textarea class="f-textarea" id="cf-notes">'+esc(c?c.notes:'')+'</textarea>'+
  '<div style="display:flex;gap:8px;margin-top:16px">'+
  '<button class="btn ghost" style="flex:1" onclick="closeModal()">取消</button>'+
  '<button class="btn green" style="flex:1" onclick="saveCardForm()">'+(c?'保存修改':'添加卡片')+'</button></div>');
}
async function saveCardForm(){
  const body={
    bank_name:$('cf-bank').value.trim(), card_type:$('cf-type').value.trim(), last_4_digits:$('cf-tail').value.trim(),
    status:$('cf-status').value, card_limit:Number($('cf-limit').value)||0, temp_limit:Number($('cf-temp').value)||0,
    temp_limit_expiry:$('cf-tempexp').value, billing_day:Number($('cf-bill').value), payment_type:$('cf-ptype').value,
    payment_value:Number($('cf-pval').value), grace_days:Number($('cf-grace').value)||0,
    annual_fee:Number($('cf-fee').value)||0, annual_fee_start:$('cf-fstart').value, annual_fee_end:$('cf-fend').value,
    used_amount:Number($('cf-used').value)||0, notes:$('cf-notes').value
  };
  if(!body.bank_name){toast('银行不能为空',true);return;}
  if(!/^\\d{4}$/.test(body.last_4_digits)){toast('尾号必须是4位数字',true);return;}
  const r=currentEditing?await api('/api/cards/'+currentEditing.id,'PUT',body):await api('/api/cards','POST',body);
  if(r.success){ toast(r.message); closeModal(); await loadAll(); if(currentEditing) openDetail(currentEditing.id); }
  else toast(r.message||'操作失败',true);
}

// 额度变更
function openLimitForm(cardId){
  openModal('<div class="m-head"><div class="m-title">记录额度变更</div><button class="icon-btn" onclick="closeModal()"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>'+
  '<div class="f-row"><div><label class="f-label">变更类型</label><select class="f-select" id="lf-type"><option value="permanent">永久额度</option><option value="temp">临时额度</option></select></div>'+
  '<div><label class="f-label">新额度（元）*</label><input class="f-input" id="lf-new" type="number"></div></div>'+
  '<div class="f-row"><div><label class="f-label">生效日期</label><input class="f-input" id="lf-date" type="date" value="'+todayStr()+'"></div>'+
  '<div><label class="f-label">临时到期日</label><input class="f-input" id="lf-exp" type="date"></div></div>'+
  '<label class="f-label">变更原因</label><input class="f-input" id="lf-reason" placeholder="如：银行提额、临时额度">'+
  '<div style="display:flex;gap:8px;margin-top:16px"><button class="btn ghost" style="flex:1" onclick="closeModal()">取消</button>'+
  '<button class="btn green" style="flex:1" onclick="saveLimitForm('+cardId+')">提交记录</button></div>');
}
async function saveLimitForm(cardId){
  const body={new_limit:Number($('lf-new').value),change_type:$('lf-type').value,effective_date:$('lf-date').value,reason:$('lf-reason').value,expiry:$('lf-exp').value};
  if(isNaN(body.new_limit)){toast('新额度不能为空',true);return;}
  const r=await api('/api/cards/'+cardId+'/limit-change','POST',body);
  if(r.success){ toast('额度变更已记录'); closeModal(); await loadAll(); openDetail(cardId); }
  else toast(r.message||'操作失败',true);
}

// 年费规则
function openFeeForm(id,cardId){
  const f=id?allFees.find(x=>Number(x.id)===Number(id)):null;
  openModal('<div class="m-head"><div class="m-title">'+(f?'更新年费进度':'配置年费减免')+'</div><button class="icon-btn" onclick="closeModal()"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>'+
  '<label class="f-label">条件类型</label><select class="f-select" id="ff-type"><option value="times" '+(f&&f.condition_type==='times'?'selected':'')+'>刷次数（次）</option><option value="amount" '+(f&&f.condition_type==='amount'?'selected':'')+'>刷金额（元）</option><option value="points" '+(f&&f.condition_type==='points'?'selected':'')+'>积分兑换</option></select>'+
  '<div class="f-row"><div><label class="f-label">目标值 *</label><input class="f-input" id="ff-target" type="number" value="'+(f?f.target_value:'')+'"></div>'+
  '<div><label class="f-label">当前进度</label><input class="f-input" id="ff-current" type="number" value="'+(f?f.current_value:0)+'"></div></div>'+
  '<div class="f-row"><div><label class="f-label">周期起始</label><input class="f-input" id="ff-start" type="date" value="'+esc(f?f.cycle_start:'')+'"></div>'+
  '<div><label class="f-label">周期结束</label><input class="f-input" id="ff-end" type="date" value="'+esc(f?f.cycle_end:'')+'"></div></div>'+
  '<div class="f-row"><div><label class="f-label">年费（元）</label><input class="f-input" id="ff-fee" type="number" value="'+(f?f.annual_fee:0)+'"></div>'+
  '<div><label class="f-label">状态</label><select class="f-select" id="ff-status"><option value="active" '+(f&&f.status==='active'?'selected':'')+'>进行中</option><option value="waived" '+(f&&f.status==='waived'?'selected':'')+'>已减免</option><option value="failed" '+(f&&f.status==='failed'?'selected':'')+'>未达标</option></select></div></div>'+
  '<div style="display:flex;gap:8px;margin-top:16px">'+
  (f?'<button class="btn red" onclick="delFee('+f.id+','+cardId+')">删除</button>':'')+
  '<button class="btn ghost" style="flex:1" onclick="closeModal()">取消</button>'+
  '<button class="btn green" style="flex:1" onclick="saveFeeForm('+(f?f.id:0)+','+cardId+')">保存</button></div>');
}
async function saveFeeForm(id,cardId){
  const body={card_id:cardId,condition_type:$('ff-type').value,target_value:Number($('ff-target').value),current_value:Number($('ff-current').value)||0,cycle_start:$('ff-start').value,cycle_end:$('ff-end').value,annual_fee:Number($('ff-fee').value)||0,status:$('ff-status').value};
  if(!body.target_value){toast('目标值不能为空',true);return;}
  const r=id?await api('/api/fee/'+id,'PUT',body):await api('/api/fee','POST',body);
  if(r.success){ toast('已保存'); closeModal(); await loadAll(); openDetail(cardId); }
  else toast(r.message||'操作失败',true);
}
async function delFee(id,cardId){
  confirmModal('确定删除该年费规则？', async()=>{
    const r=await api('/api/fee/'+id,'DELETE');
    if(r.success){ toast('已删除'); closeModal(); await loadAll(); openDetail(cardId); }
    else toast(r.message||'操作失败',true);
  });
}

// 账单表单
function defaultBillDates(card){
  if(!card||!Number(card.billing_day)) return null;
  const today=new Date(); today.setHours(0,0,0,0);
  const bd=Number(card.billing_day);
  let billDate=new Date(today.getFullYear(), today.getMonth(), Math.min(bd,28));
  if(billDate>today) billDate=new Date(today.getFullYear(), today.getMonth()-1, Math.min(bd,28));
  const pv=Number(card.payment_value)||20;
  const due=new Date(billDate);
  if(card.payment_type==='days_after_billing'){ due.setDate(due.getDate()+pv); }
  else{ if(pv>billDate.getDate()){ due.setDate(pv); } else { due.setMonth(due.getMonth()+1); due.setDate(pv); } }
  return {billDate:fmtY(billDate), dueDate:fmtY(due)};
}
function openBillForm(id,cardId){
  const b=id?allBills.find(x=>Number(x.id)===Number(id)):null;
  const opts=allCards.map(c=>'<option value="'+c.id+'" '+(Number(c.id)===Number(cardId)?'selected':'')+'>'+esc(c.bank_name)+'（'+c.last_4_digits+'）</option>').join('');
  openModal('<div class="m-head"><div class="m-title">'+(b?'编辑账单':'添加账单')+'</div><button class="icon-btn" onclick="closeModal()"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>'+
  '<label class="f-label">卡片</label><select class="f-select" id="bf-card">'+opts+'</select>'+
  '<div class="f-row"><div><label class="f-label">账单日期 *</label><input class="f-input" id="bf-date" type="date" value="'+esc(b?b.bill_date:'')+'"></div>'+
  '<div><label class="f-label">账单金额（元）</label><input class="f-input" id="bf-amt" type="number" value="'+(b?b.amount:'')+'"></div></div>'+
  '<div class="f-row"><div><label class="f-label">最低还款</label><input class="f-input" id="bf-min" type="number" value="'+(b?b.min_payment:0)+'"></div>'+
  '<div><label class="f-label">还款截止日</label><input class="f-input" id="bf-due" type="date" value="'+esc(b?b.due_date:'')+'"></div></div>'+
  '<div style="font-size:12px;color:var(--sub);margin:2px 0 8px">账单日/还款截止日已按卡片自动填入，可手动修改</div>'+
  '<label class="f-label">备注</label><input class="f-input" id="bf-notes" value="'+esc(b?b.notes:'')+'">'+
  '<div style="display:flex;gap:8px;margin-top:16px"><button class="btn ghost" style="flex:1" onclick="closeModal()">取消</button>'+
  '<button class="btn green" style="flex:1" onclick="saveBillForm('+(b?b.id:0)+')">保存</button></div>');
  $('bf-card').onchange=function(){ const d=defaultBillDates(allCards.find(x=>Number(x.id)===Number(this.value))); if(d){ $('bf-date').value=d.billDate; $('bf-due').value=d.dueDate; } };
  if(!b){ const d=defaultBillDates(allCards.find(x=>Number(x.id)===Number(cardId))); if(d){ $('bf-date').value=d.billDate; $('bf-due').value=d.dueDate; } }
}
async function saveBillForm(id){
  const body={card_id:Number($('bf-card').value),bill_date:$('bf-date').value,amount:Number($('bf-amt').value)||0,min_payment:Number($('bf-min').value)||0,due_date:$('bf-due').value,notes:$('bf-notes').value,paid:id?((allBills.find(x=>Number(x.id)===Number(id))||{}).paid||false):false};
  if(!body.bill_date){toast('账单日期不能为空',true);return;}
  const r=id?await api('/api/bills/'+id,'PUT',body):await api('/api/bills','POST',body);
  if(r.success){ toast('已保存'); closeModal(); await loadAll(); if(currentCard) openDetail(currentCard.id); renderBills(); }
  else toast(r.message||'操作失败',true);
}
async function markBillPaid(id){
  const b=allBills.find(x=>Number(x.id)===Number(id)); if(!b) return;
  const r=await api('/api/bills/'+id,'PUT',{...b,paid:1,paid_date:todayStr()});
  if(r.success){ toast('已标记还款'); await loadAll(); if(currentCard) openDetail(currentCard.id); renderBills(); }
}
// 列表快捷标记本期已还 / 撤销（单元格内两段式：第一击显示小按钮，第二击执行）
async function onPaidCellClick(id, paidThrough, ev){
  ev.stopPropagation();
  const card=allCards.find(x=>Number(x.id)===Number(id)); if(!card) return;
  const payDate=nextPaymentDate(card,new Date());
  const isPaid = paidThrough && payDate.getTime()<=new Date(paidThrough+'T00:00:00').getTime();
  const cell=ev.currentTarget;
  if(cell.dataset.paidConfirm==='1'){
    delete cell.dataset.paidConfirm;
    const done=r=>{ if(r.success){ toast(isPaid?'已撤销':'已标记本期已还'); loadAll(); } else toast(r.message||'操作失败',true); };
    if(isPaid) api('/api/cards/'+id+'/paid','DELETE').then(done);
    else api('/api/cards/'+id+'/paid','POST',{paid_through:fmtY(payDate)}).then(done);
    return;
  }
  cell.dataset.paidConfirm='1';
  const old=cell.querySelector('.sub, .mini-paid');
  if(old) old.remove();
  const btn=document.createElement('span');
  btn.className='mini-paid'+(isPaid?' undo':'');
  btn.textContent=isPaid?'撤销已还？':'确认已还？';
  cell.appendChild(btn);
}
async function delBill(id){
  confirmModal('确定删除该账单？', async()=>{
    const r=await api('/api/bills/'+id,'DELETE');
    if(r.success){ toast('已删除'); await loadAll(); if(currentCard) openDetail(currentCard.id); renderBills(); }
    else toast(r.message||'操作失败',true);
  });
}
async function delCard(id){
  confirmModal('确定删除该卡片？关联的账单、额度记录、年费规则将一并删除。', async()=>{
    const r=await api('/api/cards/'+id,'DELETE');
    if(r.success){ toast('已删除'); currentCard=null; await loadAll(); showPage('dash'); }
    else toast(r.message||'操作失败',true);
  });
}

// ---------- 设置 ----------
async function saveSettings(){
  const body={payment_advance_days:String(Number($('set-advance').value)||1)};
  body.enable_pushplus=settings.enable_pushplus!=='0'?'1':'0';
  body.enable_bark=settings.enable_bark==='1'?'1':'0';
  body.enable_email=settings.enable_email==='1'?'1':'0';
  body.bark_key=($('set-bark-key')?$('set-bark-key').value.trim():'');
  const r=await api('/api/settings','PUT',body);
  if(r.success){ toast('设置已保存'); await loadAll(); }
}

// ---------- 导入导出 ----------
async function exportJson(){
  confirmModal('导出全部数据备份（JSON）？', async()=>{
    const r=await fetch('/api/export/json',{headers:{Authorization:'Bearer '+(adminToken||'')}});
    if(!r.ok){ toast('导出失败，请先登录',true); return; }
    const blob=await r.blob();
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
    a.download='cardledger_backup_'+todayStr()+'.json'; a.click(); URL.revokeObjectURL(a.href);
    toast('已导出 JSON 备份');
  });
}
async function exportCsv(){
  const r=await fetch('/api/export/csv',{headers:{Authorization:'Bearer '+(adminToken||'')}});
  if(!r.ok){ toast('导出失败，请先登录',true); return; }
  const blob=await r.blob();
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download='cardledger_'+todayStr()+'.csv'; a.click(); URL.revokeObjectURL(a.href);
  toast('已导出 CSV');
}

// ---------- 主题切换 ----------
function applyTheme(t){
  const light=t==='light';
  document.body.classList.toggle('light',light);
  const d=$('theme-ico-dark'),l=$('theme-ico-light');
  if(d)d.classList.toggle('hidden',light);
  if(l)l.classList.toggle('hidden',!light);
  try{ localStorage.setItem('cl-theme',t); }catch(e){}
}
function toggleTheme(){ applyTheme(document.body.classList.contains('light')?'dark':'light'); }
// ---------- 事件绑定 ----------
document.addEventListener('DOMContentLoaded',()=>{
  applyTheme(localStorage.getItem('cl-theme')||'light');
  $('theme-btn').onclick=toggleTheme;
  document.querySelectorAll('.nav button').forEach(b=>b.onclick=()=>showPage(b.dataset.page));
  $('login-btn').onclick=openLogin;
  $('logout-btn').onclick=doLogout;
  $('search-bar').oninput=renderDash;
  $('cal-toggle').onclick=()=>{ const w=$('cal-wrap'); const c=w.classList.toggle('hidden'); $('cal-toggle').classList.toggle('collapsed',c); $('cal-arrow').textContent=c?'▸':'▾'; };
  $('cal-prev').onclick=()=>{ calDate.setMonth(calDate.getMonth()-1); renderCalendar(); };
  $('cal-next').onclick=()=>{ calDate.setMonth(calDate.getMonth()+1); renderCalendar(); };
  $('cal-title-box').onclick=()=>{ calMode=calMode==='both'?'bill':calMode==='bill'?'pay':'both'; renderCalendar(); };
  $('bill-add-top').onclick=()=>openBillForm(0,allCards.length?allCards[0].id:0);
  const SORT_CYCLE=['repay','bill','fee','default'];
  const SORT_LABEL={repay:'按还款日',bill:'按账单日',fee:'按年费进度',default:'默认顺序'};
  $('dash-sort-btn').onclick=()=>{
    const idx=SORT_CYCLE.indexOf(cardSort);
    cardSort=SORT_CYCLE[(idx+1)%SORT_CYCLE.length];
    $('dash-sort-label').textContent=SORT_LABEL[cardSort];
    renderDash();
  };
  document.querySelectorAll('#page-bills .seg button').forEach(b=>b.onclick=()=>{
    document.querySelectorAll('#page-bills .seg button').forEach(x=>x.classList.remove('active'));
    b.classList.add('active'); billFilter=b.dataset.f; renderBills();
  });
  $('set-save').onclick=saveSettings;
  $('set-pushplus').onclick=async()=>{ settings.enable_pushplus=(settings.enable_pushplus!=='0')?'0':'1'; settings.enable_bark='0'; renderSettings(); };
  $('set-bark').onclick=async()=>{ settings.enable_bark=settings.enable_bark==='1'?'0':'1'; if(settings.enable_bark==='1')settings.enable_pushplus='0'; renderSettings(); };
  $('set-email').onclick=async()=>{ settings.enable_email=settings.enable_email==='1'?'0':'1'; renderSettings(); };
  $('pw-toggle').onclick=()=>{
    const f=$('pw-form');
    const opened=!f.classList.toggle('hidden');
    $('pw-toggle').textContent=opened?'收起':'修改登录密码';
    if(!opened){ $('pw-old').value=''; $('pw-new').value=''; $('pw-new2').value=''; $('pw-msg').textContent=''; }
  };
  $('pw-change').onclick=async()=>{
    const msg=$('pw-msg');
    const oldP=$('pw-old').value, np=$('pw-new').value, np2=$('pw-new2').value;
    if(!oldP||!np){ msg.textContent='请填写完整'; msg.style.color='var(--yellow)'; return; }
    if(np.length<6){ msg.textContent='新密码至少 6 位'; msg.style.color='var(--yellow)'; return; }
    if(np!==np2){ msg.textContent='两次输入的新密码不一致'; msg.style.color='var(--yellow)'; return; }
    msg.textContent='提交中…'; msg.style.color='var(--sub)';
    const r=await api('/api/password','POST',{old_password:oldP,new_password:np});
    if(r.success){ msg.textContent='✅ '+r.message; msg.style.color='var(--green)'; $('pw-old').value=''; $('pw-new').value=''; $('pw-new2').value=''; }
    else { msg.textContent=r.message||'修改失败'; msg.style.color='var(--yellow)'; }
  };
  $('test-push').onclick=async()=>{
    const box=$('test-push-result');
    box.innerHTML='发送中…'; box.style.color='var(--sub)';
    const r=await api('/api/test-push','POST',{});
    if(r.ok){ box.innerHTML='✅ 推送成功（'+escapeHtml(r.message||'')+'）'; box.style.color='var(--green)'; }
    else { box.innerHTML='❌ '+(r.message||'推送失败'); box.style.color='var(--yellow)'; }
  };
  // 两步验证
  $('totp-gen').onclick=async()=>{
    const r=await api('/api/totp/setup','POST',{});
    if(r.success){
      $('totp-secret-box').classList.remove('hidden');
      $('totp-secret').textContent=r.secret;
      $('totp-recovery-box').classList.remove('hidden');
      $('totp-recovery').textContent=(r.recovery_codes||[]).join('&nbsp;&nbsp;&nbsp;&nbsp;');
      $('totp-verify-box').classList.remove('hidden');
      $('totp-gen').classList.add('hidden');
      // 桌面端生成二维码（otpauth URI），移动端保留字符串
      const uri='otpauth://totp/'+encodeURIComponent('卡账记')+':'+encodeURIComponent(adminUsername||'S')+'?secret='+encodeURIComponent(r.secret)+'&issuer='+encodeURIComponent('卡账记')+'&algorithm=SHA1&digits=6&period=30';
      const qrBox=$('totp-qr');
      if(window.matchMedia&&matchMedia('(min-width:768px)').matches){
        qrBox.style.display='block';
        $('totp-secret').style.display='none';
        try{
          if(typeof qrcode!=='undefined'){
            const qr=qrcode(0,'M'); qr.addData(uri); qr.make();
            qrBox.innerHTML=qr.createSvgTag({cellSize:5,margin:0});
          } else { qrBox.innerHTML='<div style="font-size:11px;color:#dc2626">二维码库加载失败，请复制下方密钥手动输入</div>'; }
        }catch(e){ qrBox.innerHTML='<div style="font-size:11px;color:#dc2626">二维码生成失败，请复制下方密钥手动输入</div>'; }
      } else { qrBox.style.display='none'; $('totp-secret').style.display='block'; }
      toast('密钥已生成，请添加到认证器');
    } else toast(r.message||'生成失败',true);
  };
  $('totp-copy').onclick=async()=>{
    try{ await navigator.clipboard.writeText($('totp-secret').textContent); toast('密钥已复制'); }
    catch(e){ const t=document.createElement('textarea'); t.value=$('totp-secret').textContent; document.body.appendChild(t); t.select(); document.execCommand('copy'); document.body.removeChild(t); toast('密钥已复制'); }
  };
  $('totp-enable').onclick=async()=>{
    const code=$('totp-code').value.trim();
    if(code.length<6){ toast('请输入 6 位验证码',true); return; }
    const r=await api('/api/totp/enable','POST',{code});
    if(r.success){ toast('两步验证已启用'); await loadTotpState(); }
    else toast(r.message||'启用失败',true);
  };
  $('totp-disable').onclick=async()=>{
    const code=$('totp-disable-code').value.trim();
    if(!code){ toast('请输入当前动态码或恢复码',true); return; }
    const r=await api('/api/totp/disable','POST',{code});
    const msg=$('totp-msg');
    if(r.success){ msg.textContent=''; toast('已停用两步验证'); await loadTotpState(); }
    else { msg.textContent=r.message||'停用失败'; msg.style.color='var(--yellow)'; }
  };
  $('exp-json').onclick=exportJson;
  $('exp-csv').onclick=exportCsv;
  $('import-file').onchange=e=>{ const f=e.target.files[0]; $('import-fname').textContent=f?('已选择：'+f.name):''; $('import-btn').disabled=!f; };
  $('import-btn').onclick=()=>{
    const file=$('import-file').files[0]; if(!file){toast('请选择文件',true);return;}
    confirmModal('导入将覆盖当前全部数据，确定继续？', async()=>{
      try{
        const text=await file.text(); const data=JSON.parse(text);
        if(!Array.isArray(data.cards)){ toast('备份文件格式不正确',true); return; }
        const r=await api('/api/import','POST',data);
        if(r.success){ toast('导入完成'); $('import-file').value=''; $('import-btn').disabled=true; await loadAll(); }
        else toast(r.message||'导入失败',true);
      }catch(e){ toast('文件解析失败',true); }
    });
  };
  // 批量导入卡片（CSV）
  $('dl-tpl').onclick=()=>{
    const head=['银行','卡种','尾号','状态','永久额度','临时额度','临时额度到期日','账单日','还款方式','还款日/天数','年费金额','年费周期起始','年费周期结束','已用额度','备注'];
    const rows=[
      head.join(','),
      ['招商银行','经典白金卡','1234','正常','60000','0','','10','固定日','5','200','2026-01-01','2026-12-31','15000','示例：刷6次免年费'].join(','),
      ['中信银行','i白金','5678','正常','50000','20000','2026-12-31','8','账单后','20','0','','','0',''].join(',')
    ];
    const csv='\\uFEFF'+rows.join('\\n')+'\\n';
    const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    a.download='卡账记_卡片导入模板.csv'; a.click(); URL.revokeObjectURL(a.href);
  };
  $('card-import-file').onchange=e=>{ const f=e.target.files[0]; $('card-import-fname').textContent=f?('已选择：'+f.name):''; $('card-import-btn').disabled=!f; };
  $('card-import-btn').onclick=async()=>{
    const file=$('card-import-file').files[0];
    if(!file){ toast('请先选择 CSV 文件',true); return; }
    try{
      const text=await file.text();
      const r=await api('/api/cards/import','POST',{csv:text});
      if(r.success){
        const res=$('card-import-result');
        res.innerHTML='导入完成：新增 <b style="color:var(--green)">'+r.inserted+'</b> 张，跳过重复 '+r.skipped+' 张'+
          (r.errors&&r.errors.length?('<div style="margin-top:6px;color:var(--yellow)">'+r.errors.slice(0,8).join('<br>')+(r.errors.length>8?'<br>…共 '+r.errors.length+' 条提示':'')+'</div>'):'');
        $('card-import-file').value=''; $('card-import-btn').disabled=true;
        await loadAll(); showPage('dash');
      } else toast(r.message||'导入失败',true);
    }catch(e){ toast('文件解析失败',true); }
  };
  updateAuth();
  loadAll();
});
</script>
</body>
</html>
  `;
}
