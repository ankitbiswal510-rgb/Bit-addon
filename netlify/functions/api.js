/*
 * Waddon Hi-Fi — BitChord lossless / Hi-Res FLAC stream provider.
 *
 * BitChord never plays audio from this server. It only asks for a playable
 * URL, then streams the file itself. This function resolves that URL from:
 *
 *   1. Qobuz  – true Hi-Res FLAC (24-bit up to 192 kHz) when your own Qobuz
 *               account credentials are provided.
 *   2. TIDAL  – credential-free fallback using public hi-res API instances.
 *
 * Endpoints (all under /api):
 *   /api                                  → service info + setup status
 *   /api?trackId=<qobuz id>               → FLAC stream (default: Qobuz)
 *   /api/stream/<trackId>                 → same, path-style for BitChord
 *   /api?provider=tidal&tidalId=<id>      → force TIDAL backend
 *   /api?provider=deezer&deezerId=<id>    → Deezer metadata/preview
 *   /api/meta/<trackId>                   → track metadata
 *   /api/search?q=...                     → search (Deezer catalog)
 */

const crypto = require('crypto');
const axios = require('axios');

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

// Qobuz format ids: 5 = 320k MP3, 6 = 16-bit FLAC, 7 = 24-bit ≤96kHz FLAC,
// 27 = 24-bit ≤192kHz Hi-Res FLAC.
const DEFAULT_FORMAT_ID = 27;

// Public community TIDAL hi-res API instances. Override or extend with the
// TIDAL_INSTANCES env var (comma-separated list).
const DEFAULT_TIDAL_INSTANCES = [
  'https://triton.squid.wtf',
  'https://wolf.qqdl.site',
  'https://maus.qqdl.site',
  'https://vogel.qqdl.site',
  'https://katze.qqdl.site',
];

const REQUEST_TIMEOUT = 12000;

const tidalInstances = () => {
  const extra = (process.env.TIDAL_INSTANCES || '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return extra.length ? extra : DEFAULT_TIDAL_INSTANCES;
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const json = (statusCode, body, extraHeaders = {}) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    ...extraHeaders,
  },
  body: JSON.stringify(body),
});

const fail = (statusCode, message, extra = {}) =>
  json(statusCode, { status: 'error', error: message, ...extra });

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

/* ------------------------------------------------------------------ */
/* Qobuz                                                               */
/* ------------------------------------------------------------------ */

async function qobuzLogin(appId, secret) {
  const email = process.env.QOBUZ_EMAIL;
  const password = process.env.QOBUZ_PASSWORD;
  if (!email || !password) return null;

  const res = await axios.post(
    'https://www.qobuz.com/api.json/0.2/user/login',
    null,
    {
      params: {
        app_id: appId,
        email,
        password: md5(password),
      },
      timeout: REQUEST_TIMEOUT,
    }
  );
  const token = res.data && res.data.user_auth_token;
  if (!token) throw new Error('Qobuz login succeeded but returned no token');
  return token;
}

async function qobuzStreamUrl(trackId, formatId) {
  const appId = process.env.QOBUZ_APP_ID;
  const secret = process.env.QOBUZ_APP_SECRET;
  if (!appId || !secret) {
    const err = new Error(
      'QOBUZ_APP_ID / QOBUZ_APP_SECRET are not configured on this site'
    );
    err.code = 'QOBUZ_NOT_CONFIGURED';
    throw err;
  }

  const userToken =
    process.env.QOBUZ_USER_TOKEN || (await qobuzLogin(appId, secret));
  if (!userToken) {
    const err = new Error(
      'No Qobuz auth available: set QOBUZ_USER_TOKEN or QOBUZ_EMAIL + QOBUZ_PASSWORD'
    );
    err.code = 'QOBUZ_NOT_CONFIGURED';
    throw err;
  }

  const ts = Math.floor(Date.now() / 1000);
  const sig = md5(
    `trackgetFileUrlformat_id${formatId}intentstreamtrack_id${trackId}${ts}${secret}`
  );

  const res = await axios.get(
    'https://www.qobuz.com/api.json/0.2/track/getFileUrl',
    {
      params: {
        app_id: appId,
        track_id: trackId,
        format_id: formatId,
        intent: 'stream',
        request_ts: ts,
        request_sig: sig,
        user_auth_token: userToken,
      },
      timeout: REQUEST_TIMEOUT,
    }
  );

  const url = res.data && res.data.url;
  if (!url) {
    throw new Error(
      (res.data && (res.data.message || res.data.error)) ||
        'Qobuz returned no stream URL (track unavailable in this quality?)'
    );
  }

  const info = res.data;
  return {
    provider: 'Qobuz',
    url,
    mimeType: info.mime_type || 'audio/flac',
    bitDepth: info.bit_depth || null,
    sampleRate: info.sampling_rate ? info.sampling_rate * 1000 : null,
  };
}

/* ------------------------------------------------------------------ */
/* TIDAL (credential-free fallback)                                    */
/* ------------------------------------------------------------------ */

async function tidalStreamUrl(tidalId) {
  const errors = [];
  for (const base of tidalInstances()) {
    try {
      const res = await axios.get(`${base}/track/`, {
        params: { id: tidalId, quality: 'HI_RES_LOSSLESS' },
        headers: { 'User-Agent': 'Waddon-HiFi/1.0' },
        timeout: REQUEST_TIMEOUT,
      });
      const data = res.data && res.data.data ? res.data.data : res.data;
      const url =
        data && (data.url || data.streamUrl || data.audioUrl || data.link);
      if (url) {
        return {
          provider: `TIDAL (${new URL(base).hostname})`,
          url,
          mimeType: data.mimeType || 'audio/flac',
          bitDepth: data.bitDepth || null,
          sampleRate: data.sampleRate || null,
        };
      }
      errors.push(`${base}: unexpected response shape`);
    } catch (e) {
      errors.push(`${base}: ${e.response ? `HTTP ${e.response.status}` : e.message}`);
    }
  }
  const err = new Error(
    'No TIDAL hi-res instance could resolve this track. ' + errors.join(' | ')
  );
  err.code = 'TIDAL_UNAVAILABLE';
  throw err;
}

/* ------------------------------------------------------------------ */
/* Deezer (metadata / 30s preview)                                     */
/* ------------------------------------------------------------------ */

async function deezerTrack(deezerId) {
  const res = await axios.get(`https://api.deezer.com/track/${deezerId}`, {
    timeout: REQUEST_TIMEOUT,
  });
  if (res.data && res.data.error) throw new Error(res.data.error.message);
  return res.data;
}

async function deezerSearch(q) {
  const res = await axios.get('https://api.deezer.com/search', {
    params: { q, limit: 15 },
    timeout: REQUEST_TIMEOUT,
  });
  return (res.data.data || []).map((t) => ({
    id: t.id,
    title: t.title,
    artist: t.artist && t.artist.name,
    album: t.album && t.album.title,
    cover: t.album && t.album.cover_medium,
    preview: t.preview,
  }));
}

/* ------------------------------------------------------------------ */
/* Handler                                                             */
/* ------------------------------------------------------------------ */

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: json(204, {}).headers, body: '' };
  }

  try {
    const q = event.queryStringParameters || {};

    // BitChord-style path params: /api/stream/123, /api/meta/123
    const pathMatch = (event.path || '').match(
      /\/api\/(stream|meta|search)(?:\/([^/?]+))?/i
    );
    const action = pathMatch ? pathMatch[1].toLowerCase() : null;
    const pathId = pathMatch && pathMatch[2] ? pathMatch[2] : null;

    const provider = (q.provider || 'qobuz').toLowerCase();
    const trackId = q.trackId || q.track_id || pathId || null;
    const formatId = parseInt(q.format || q.format_id, 10) || DEFAULT_FORMAT_ID;

    /* --- service info / status ------------------------------------ */
    if (!action && !trackId && !q.q) {
      const qobuzReady = Boolean(
        process.env.QOBUZ_APP_ID &&
          process.env.QOBUZ_APP_SECRET &&
          (process.env.QOBUZ_USER_TOKEN ||
            (process.env.QOBUZ_EMAIL && process.env.QOBUZ_PASSWORD))
      );
      return json(200, {
        status: 'ok',
        addon: 'Waddon Hi-Fi',
        version: '1.0.0',
        backends: {
          qobuz: qobuzReady
            ? 'ready (Hi-Res FLAC via your Qobuz account)'
            : 'not configured — set QOBUZ_APP_ID, QOBUZ_APP_SECRET and QOBUZ_EMAIL/QOBUZ_PASSWORD (or QOBUZ_USER_TOKEN)',
          tidal: `fallback via ${tidalInstances().length} public hi-res instances`,
          deezer: 'metadata + 30s previews',
        },
        usage: {
          stream: '/api?trackId=<qobuzTrackId>',
          streamTidal: '/api?provider=tidal&tidalId=<tidalTrackId>',
          bitchordPath: '/api/stream/<trackId>',
          search: '/api/search?q=<query>',
        },
      });
    }

    /* --- search ---------------------------------------------------- */
    if (action === 'search' || q.q) {
      const term = q.q || pathId || '';
      if (!term) return fail(400, 'Missing search query: /api/search?q=...');
      return json(200, {
        status: 'success',
        provider: 'Deezer',
        results: await deezerSearch(term),
      });
    }

    /* --- metadata -------------------------------------------------- */
    if (action === 'meta' && trackId) {
      const t = await deezerTrack(trackId);
      return json(200, {
        status: 'success',
        provider: 'Deezer',
        id: t.id,
        title: t.title,
        artist: t.artist && t.artist.name,
        album: t.album && t.album.title,
        cover: t.album && t.album.cover_xl,
        duration: t.duration,
      });
    }

    /* --- stream resolution ----------------------------------------- */
    if (!trackId && !q.tidalId && !q.deezerId) {
      return fail(
        400,
        'Missing trackId. Use /api?trackId=<id> or /api/stream/<id>'
      );
    }

    // Explicit backend choice.
    if (provider === 'tidal' || provider === 'monochrome' || q.tidalId) {
      const id = q.tidalId || trackId;
      const r = await tidalStreamUrl(id);
      return json(200, {
        status: 'success',
        ...r,
        format: 'Hi-Res FLAC (24-bit)',
        trackId: id,
      });
    }

    if (provider === 'deezer' || q.deezerId) {
      const t = await deezerTrack(q.deezerId || trackId);
      return json(200, {
        status: 'success',
        provider: 'Deezer',
        format: 'MP3 preview (128k, 30s)',
        title: t.title,
        artist: t.artist && t.artist.name,
        url: t.preview,
      });
    }

    // Default: Qobuz Hi-Res FLAC.
    const r = await qobuzStreamUrl(trackId, formatId);
    return json(200, {
      status: 'success',
      ...r,
      format:
        formatId === 27
          ? 'Hi-Res FLAC (24-bit up to 192kHz)'
          : formatId === 7
            ? 'Hi-Res FLAC (24-bit up to 96kHz)'
            : formatId === 6
              ? 'FLAC (16-bit/44.1kHz)'
              : 'MP3 320k',
      trackId,
    });
  } catch (error) {
    const status = error.code === 'QOBUZ_NOT_CONFIGURED' ? 501 : 502;
    return fail(status, error.message, { code: error.code || 'UPSTREAM_ERROR' });
  }
};
