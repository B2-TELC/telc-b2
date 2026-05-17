// ================================================================
// Cloudflare Worker — b2-telc API proxy
// يعمل كوسيط بين الموقع و Firebase
// البيانات لا تصل للمتصفح أبداً بشكل مباشر
// ================================================================

// ضع هذه القيم في Cloudflare Worker → Settings → Variables (Secrets)
// FIREBASE_URL  = https://b2-telc-default-rtdb.europe-west1.firebasedatabase.app
// FIREBASE_SECRET = مفتاح الـ Service Account أو Database Secret من Firebase
// ADMIN_PASSWORD = كلمة سر الأدمن
// MYMEMORY_EMAIL = بريدك الإلكتروني (يرفع الحد من 5000 إلى 10000 كلمة/يوم)

const ALLOWED_ORIGINS = [
  'https://b2-telc.github.io',
  'https://b2-telc-tunisie.netlify.app'
];

// الأقسام المسموح بجلبها من المستخدمين العاديين
const PUBLIC_SECTIONS = [
  'exams','t1data','t2data','t3data','t3lvdata',
  'hv1data','hv2data','hv3data',
  'sb1data','sb2data',
  'mundlichdata','mdt2exams','mdt3exams','swdata','codes'
];

// ================================================================
// ✅ مُستورد من sw.js — سياسة التخزين الذكي
// ================================================================

// الأصول الثابتة التي يُسمح بتخزينها في Cloudflare Cache
const STATIC_ORIGINS = [
  'https://www.gstatic.com/firebasejs/',
  'https://fonts.gstatic.com',
  'https://fonts.googleapis.com',
];

// هذه الطلبات لا تُخزن أبداً — تمر مباشرة للشبكة
const NEVER_CACHE = [
  'workers.dev',             // Cloudflare Worker — التحقق من الأكواد
  'firebasedatabase.app',    // Firebase Realtime DB — بيانات الاختبارات
  'firebaseio.com',          // Firebase
  'firebaseapp.com',         // Firebase Auth
  'translate.googleapis.com',// ترجمة
  'mymemory.translated.net', // ترجمة fallback
  '/api/',                   // أي API داخلي
];

/**
 * هل يجب منع تخزين هذا الـ URL؟
 */
function shouldNeverCache(url) {
  return NEVER_CACHE.some(blocked => url.includes(blocked));
}

/**
 * هل هذا الـ URL مورد ثابت قابل للتخزين؟
 */
function isStaticAsset(url) {
  return STATIC_ORIGINS.some(origin => url.startsWith(origin));
}

/**
 * جلب مورد ثابت مع Cloudflare Cache (Cache First)
 * يُستخدم لملفات Firebase JS والخطوط فقط
 */
async function fetchWithCache(request, ctx) {
  const cache = caches.default;
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);

  // خزّن فقط الردود الصحيحة (200 وليست opaque)
  if (response && response.status === 200 && response.type !== 'opaque') {
    const toCache = response.clone();
    ctx.waitUntil(cache.put(request, toCache));
  }

  return response;
}

// ================================================================
export default {
  async fetch(request, env, ctx) {
    // CORS headers
    const requestOrigin = request.headers.get('Origin') || '';
    const allowedOrigin = ALLOWED_ORIGINS.includes(requestOrigin) ? requestOrigin : ALLOWED_ORIGINS[0];
    const corsHeaders = {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Session-Token',
      'Access-Control-Max-Age': '86400',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const fullUrl = request.url;

    // ================================================================
    // ✅ منطق التخزين الذكي — مُستورد من sw.js
    // ================================================================

    // ❌ POST وغيره لا يُخزن أبداً
    if (request.method === 'GET') {

      // ❌ القائمة السوداء — تمر مباشرة بدون تخزين
      if (shouldNeverCache(fullUrl)) {
        // لا شيء، نكمل للراوتر الطبيعي أدناه
      }

      // ✅ موارد ثابتة (Firebase JS + Fonts) — Cache First
      else if (isStaticAsset(fullUrl)) {
        return fetchWithCache(request, ctx);
      }

      // 🔄 كل شيء آخر — Network First بدون تخزين
      // (HTML، بيانات الموقع، أي شيء غير محدد)
    }

    // ================================================================
    // راوتر الـ API الأصلي
    // ================================================================
    try {
      // ── POST /api/verify-code ─────────────────────────────────
      if (path === '/api/verify-code' && request.method === 'POST') {
        return await handleVerifyCode(request, env, corsHeaders);
      }

      // ── GET /api/section/:name ────────────────────────────────
      if (path.startsWith('/api/section/') && request.method === 'GET') {
        return await handleGetSection(request, env, corsHeaders, url);
      }

      // ── POST /api/admin/section/:name ─────────────────────────
      // جلب بيانات للأدمن باستخدام كلمة السر بدل session token
      if (path.startsWith('/api/admin/section/') && request.method === 'POST') {
        return await handleAdminGetSection(request, env, corsHeaders, url);
      }

      // ── POST /api/admin/save ──────────────────────────────────
      if (path === '/api/admin/save' && request.method === 'POST') {
        return await handleAdminSave(request, env, corsHeaders);
      }

      // ── POST /api/admin/codes ─────────────────────────────────
      if (path === '/api/admin/codes' && request.method === 'POST') {
        return await handleAdminCodes(request, env, corsHeaders);
      }

      // ── POST /api/admin/login ─────────────────────────────────
      if (path === '/api/admin/login' && request.method === 'POST') {
        return await handleAdminLogin(request, env, corsHeaders);
      }

      // ── POST /api/session/write ───────────────────────────────
      if (path === '/api/session/write' && request.method === 'POST') {
        return await handleSessionWrite(request, env, corsHeaders);
      }

      // ── POST /api/session/read ────────────────────────────────
      if (path === '/api/session/read' && request.method === 'POST') {
        return await handleSessionRead(request, env, corsHeaders);
      }

      // ── POST /api/session/delete ──────────────────────────────
      if (path === '/api/session/delete' && request.method === 'POST') {
        return await handleSessionDelete(request, env, corsHeaders);
      }

      // ── POST /api/translate ───────────────────────────────────
      // ✅ جديد: الترجمة عبر MyMemory مع كاش Firebase
      if (path === '/api/translate' && request.method === 'POST') {
        return await handleTranslate(request, env, corsHeaders);
      }

      return json({ error: 'Not found' }, 404, corsHeaders);
    } catch (e) {
      return json({ error: 'Server error', detail: e.message }, 500, corsHeaders);
    }
  }
};

// ================================================================
// ✅ الترجمة — MyMemory مجاناً + كاش Firebase
// ================================================================
async function handleTranslate(request, env, corsHeaders) {
  const body = await request.json();
  const { text, target, source } = body;

  if (!text || !target) {
    return json({ error: 'missing params' }, 400, corsHeaders);
  }

  const trimmedText = text.trim();
  if (!trimmedText) {
    return json({ error: 'empty text' }, 400, corsHeaders);
  }

  // مفتاح الكاش في Firebase — نحوّل النص لـ hash قصير
  const cacheKey = await shortHash(`${source || 'de'}_${target}_${trimmedText}`);
  const cachePath = `translations_cache/${cacheKey}`;

  // 1️⃣ تحقق من الكاش في Firebase أولاً
  const cached = await firebaseGet(env, cachePath);
  if (cached && cached.translated) {
    return json({ translated: cached.translated, fromCache: true }, 200, corsHeaders);
  }

  // 2️⃣ جرّب Google Translate أولاً (أفضل جودة، بدون حد يومي)
  let translated = null;
  try {
    const gUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${source || 'de'}&tl=${target}&dt=t&q=${encodeURIComponent(trimmedText)}`;
    const gRes = await fetch(gUrl);
    if (gRes.ok) {
      const gData = await gRes.json();
      if (gData && gData[0]) {
        const gText = gData[0].filter(Boolean).map(s => s[0] || '').join('').trim();
        if (gText) translated = gText;
      }
    }
  } catch(e) {}

  // 3️⃣ fallback: MyMemory إذا فشل Google
  if (!translated) {
    const langpair = `${source || 'de'}|${target}`;
    const email = env.MYMEMORY_EMAIL || '';
    const mmUrl = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(trimmedText) + '&langpair=' + encodeURIComponent(langpair) + (email ? '&de=' + encodeURIComponent(email) : '');
    try {
      const res = await fetch(mmUrl);
      if (res.ok) {
        const data = await res.json();
        if (data.responseStatus === 200 && data.responseData && data.responseData.translatedText &&
            !data.responseData.translatedText.includes('MYMEMORY WARNING')) {
          translated = data.responseData.translatedText;
        }
      }
    } catch(e) {}
  }

  if (!translated) {
    return json({ error: 'translation service unavailable' }, 502, corsHeaders);
  }

  // 3️⃣ خزّن في Firebase للمستخدمين القادمين (بدون await — لا نُبطئ الرد)
  // نخزن فقط النصوص القصيرة والمتوسطة (أقل من 500 حرف) لتوفير مساحة Firebase
  if (trimmedText.length < 500) {
    firebasePut(env, cachePath, {
      translated,
      source: source || 'de',
      target,
      original: trimmedText,
      cached_at: new Date().toISOString()
    }).catch(() => {}); // تجاهل أخطاء الكاش
  }

  return json({ translated, fromCache: false }, 200, corsHeaders);
}

/**
 * توليد hash قصير من النص لاستخدامه كمفتاح في Firebase
 * يُنتج سلسلة آمنة لمسارات Firebase (بدون أحرف خاصة)
 */
async function shortHash(text) {
  const encoded = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  // أول 16 بايت كـ hex = 32 حرف — كافٍ لتفادي التصادم
  return hashArray.slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ================================================================
// التحقق من كود المستخدم
// ================================================================
async function handleVerifyCode(request, env, corsHeaders) {
  const body = await request.json();
  const code = (body.code || '').trim().toUpperCase();

  if (!code) return json({ error: 'invalid' }, 400, corsHeaders);

  const safeCode = code.replace(/[^a-zA-Z0-9]/g, '_');

  const fbRes = await firebaseGet(env, `codes_index/${safeCode}`);

  if (!fbRes) return json({ error: 'invalid' }, 401, corsHeaders);
  if (!fbRes.active) return json({ error: 'inactive' }, 401, corsHeaders);

  const w = fbRes.weeks || 1;
  const expires = new Date(new Date(fbRes.created_at).getTime() + w * 7 * 24 * 60 * 60 * 1000);
  const now = new Date();
  if (now > expires) return json({ error: 'expired' }, 401, corsHeaders);

  const usageRef = `sessions/usage/${safeCode}`;
  const prev = await firebaseGet(env, usageRef) || { count: 0 };
  await firebasePut(env, usageRef, {
    count: (prev.count || 0) + 1,
    last_used_at: now.toISOString(),
    code: code
  });

  const sessionToken = await generateSessionToken(env, code, expires.toISOString());

  return json({
    ok: true,
    expires: expires.toISOString(),
    token: sessionToken,
    type: fbRes.type || 'single'
  }, 200, corsHeaders);
}

// ================================================================
// جلب قسم من البيانات (مستخدم عادي)
// ================================================================
async function handleGetSection(request, env, corsHeaders, url) {
  const token = request.headers.get('X-Session-Token');
  const valid = await verifySessionToken(env, token);
  if (!valid) return json({ error: 'unauthorized' }, 401, corsHeaders);

  const section = url.pathname.replace('/api/section/', '').split('/')[0];

  if (!PUBLIC_SECTIONS.includes(section)) {
    return json({ error: 'forbidden' }, 403, corsHeaders);
  }

  const data = await firebaseGet(env, `data/${section}`);

  return json({ ok: true, data: data }, 200, corsHeaders);
}

// ================================================================
// جلب بيانات قسم — للأدمن فقط (بكلمة السر)
// ================================================================
async function handleAdminGetSection(request, env, corsHeaders, url) {
  const body = await request.json();

  if (!body.adminPassword || body.adminPassword !== env.ADMIN_PASSWORD) {
    return json({ error: 'forbidden' }, 403, corsHeaders);
  }

  const section = url.pathname.replace('/api/admin/section/', '').split('/')[0];

  if (!PUBLIC_SECTIONS.includes(section)) {
    return json({ error: 'forbidden section' }, 403, corsHeaders);
  }

  const data = await firebaseGet(env, `data/${section}`);
  return json({ ok: true, data: data }, 200, corsHeaders);
}

// ================================================================
// حفظ بيانات (أدمن فقط)
// ================================================================
async function handleAdminSave(request, env, corsHeaders) {
  const body = await request.json();

  if (body.adminPassword !== env.ADMIN_PASSWORD) {
    return json({ error: 'forbidden' }, 403, corsHeaders);
  }

  const { section, payload } = body;
  if (!section || !PUBLIC_SECTIONS.includes(section)) {
    return json({ error: 'invalid section' }, 400, corsHeaders);
  }

  await firebasePut(env, `data/${section}`, payload);
  return json({ ok: true }, 200, corsHeaders);
}

// ================================================================
// إدارة الأكواد (أدمن فقط)
// ================================================================
async function handleAdminCodes(request, env, corsHeaders) {
  const body = await request.json();

  if (body.adminPassword !== env.ADMIN_PASSWORD) {
    return json({ error: 'forbidden' }, 403, corsHeaders);
  }

  const { action, code, weeks, type } = body;

  if (action === 'add') {
    const safeCode = code.replace(/[^a-zA-Z0-9]/g, '_');
    await firebasePut(env, `codes_index/${safeCode}`, {
      code: code,
      active: true,
      weeks: weeks || 1,
      type: type || 'single',
      created_at: new Date().toISOString()
    });
    return json({ ok: true }, 200, corsHeaders);
  }

  if (action === 'delete') {
    const safeCode = code.replace(/[^a-zA-Z0-9]/g, '_');
    await firebaseDelete(env, `codes_index/${safeCode}`);
    return json({ ok: true }, 200, corsHeaders);
  }

  if (action === 'list') {
    const codes = await firebaseGet(env, 'codes_index');
    return json({ ok: true, data: codes }, 200, corsHeaders);
  }

  return json({ error: 'unknown action' }, 400, corsHeaders);
}

// ================================================================
// Session Token — HMAC-SHA256
// ================================================================
async function generateSessionToken(env, code, expires) {
  const payload = JSON.stringify({ code, expires, ts: Date.now() });
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.FIREBASE_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return btoa(payload) + '.' + sigB64;
}

async function verifySessionToken(env, token) {
  if (!token) return false;
  try {
    const [payloadB64, sigB64] = token.split('.');
    const payload = atob(payloadB64);
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(env.FIREBASE_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false, ['verify']
    );
    const sig = Uint8Array.from(atob(sigB64), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(payload));
    if (!valid) return false;
    const data = JSON.parse(payload);
    if (new Date() > new Date(data.expires)) return false;
    return true;
  } catch (e) {
    return false;
  }
}

// ================================================================
// Session Management
// ================================================================
async function handleSessionWrite(request, env, corsHeaders) {
  const token = request.headers.get('X-Session-Token');
  const valid = await verifySessionToken(env, token);
  if (!valid) return json({ error: 'unauthorized' }, 401, corsHeaders);

  const body = await request.json();
  const { code, sid } = body;
  if (!code || !sid) return json({ error: 'missing params' }, 400, corsHeaders);

  const safeCode = code.replace(/[^a-zA-Z0-9]/g, '_');

  const codeData = await firebaseGet(env, `codes_index/${safeCode}`);
  if (!codeData) return json({ error: 'invalid code' }, 401, corsHeaders);

  const isMulti = codeData.type === 'multi';
  if (isMulti) {
    await firebasePut(env, `sessions/multi/${safeCode}/${sid}`, { ts: Date.now() });
    return json({ ok: true, type: 'multi' }, 200, corsHeaders);
  }

  await firebasePut(env, `sessions/single/${safeCode}`, { sid, ts: Date.now() });
  return json({ ok: true, type: 'single' }, 200, corsHeaders);
}

async function handleSessionRead(request, env, corsHeaders) {
  const token = request.headers.get('X-Session-Token');
  const valid = await verifySessionToken(env, token);
  if (!valid) return json({ error: 'unauthorized' }, 401, corsHeaders);

  const body = await request.json();
  const { code, sid } = body;
  if (!code || !sid) return json({ error: 'missing params' }, 400, corsHeaders);

  const safeCode = code.replace(/[^a-zA-Z0-9]/g, '_');
  const current = await firebaseGet(env, `sessions/single/${safeCode}`);

  if (!current) return json({ ok: true, status: 'no_session' }, 200, corsHeaders);

  if (current.sid !== sid) {
    return json({ ok: true, status: 'kicked', activeSid: current.sid }, 200, corsHeaders);
  }

  await firebasePut(env, `sessions/single/${safeCode}`, { sid, ts: Date.now() });
  return json({ ok: true, status: 'active' }, 200, corsHeaders);
}

async function handleSessionDelete(request, env, corsHeaders) {
  const token = request.headers.get('X-Session-Token');
  const valid = await verifySessionToken(env, token);
  if (!valid) return json({ error: 'unauthorized' }, 401, corsHeaders);

  const body = await request.json();
  const { code, sid } = body;
  if (!code || !sid) return json({ error: 'missing params' }, 400, corsHeaders);

  const safeCode = code.replace(/[^a-zA-Z0-9]/g, '_');
  const current = await firebaseGet(env, `sessions/single/${safeCode}`);

  if (current && current.sid === sid) {
    await firebaseDelete(env, `sessions/single/${safeCode}`);
  }

  return json({ ok: true }, 200, corsHeaders);
}

// ================================================================
// Firebase REST API helpers
// ================================================================
async function firebaseGet(env, path) {
  const res = await fetch(
    `${env.FIREBASE_URL}/${path}.json?auth=${env.FIREBASE_SECRET}`,
    { method: 'GET' }
  );
  if (!res.ok) return null;
  return await res.json();
}

async function firebasePut(env, path, data) {
  await fetch(
    `${env.FIREBASE_URL}/${path}.json?auth=${env.FIREBASE_SECRET}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }
  );
}

async function firebaseDelete(env, path) {
  await fetch(
    `${env.FIREBASE_URL}/${path}.json?auth=${env.FIREBASE_SECRET}`,
    { method: 'DELETE' }
  );
}

// ================================================================
// تسجيل دخول الأدمن عبر Worker
// ================================================================
async function handleAdminLogin(request, env, corsHeaders) {
  const body = await request.json();
  const password = (body.password || '').trim();

  if (!password) {
    return json({ error: 'no_password' }, 400, corsHeaders);
  }

  if (password !== env.ADMIN_PASSWORD) {
    return json({ error: 'wrong_password' }, 401, corsHeaders);
  }

  const expires = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
  const token = await generateSessionToken(env, 'ADMIN', expires);

  return json({ ok: true, token, expires }, 200, corsHeaders);
}

// ================================================================
// Helper
// ================================================================
function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}
