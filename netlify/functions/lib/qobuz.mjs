const APP_ID_FALLBACK = '798273057';
const SEED_DEFAULT = 'abb21364945c0583309667d13ca3d93a';
const API_BASE = 'https://www.qobuz.com/api.json/0.2';

import { createHash } from 'node:crypto';

const md5Hex = (s) => createHash('md5').update(s).digest('hex');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export function getConfig() {
  const env = typeof Netlify !== 'undefined' && Netlify.env ? Netlify.env : process.env;
  return {
    appId: env.get('QOBUZ_APP_ID') || APP_ID_FALLBACK,
    seed: env.get('QOBUZ_SEED') || SEED_DEFAULT,
    userToken: env.get('QOBUZ_USER_TOKEN') || '',
  };
}

export function isConfigured() {
  const c = getConfig();
  return { appId: true, userToken: Boolean(c.userToken) };
}

function signature(object, method, args, requestTs, seed) {
  let kv = '';
  for (const k of Object.keys(args).sort()) kv += `${k}${args[k]}`;
  return md5Hex(`${object}${method}${kv}${requestTs}${seed}`);
}

async function apiGet(object, method, args, { signed = true, withToken = true } = {}) {
  const { appId, seed, userToken } = getConfig();
  const requestTs = String(Math.floor(Date.now() / 1000));

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(args)) qs.set(k, String(v));
  if (signed) {
    qs.set('request_ts', requestTs);
    qs.set('request_sig', signature(object, method, args, requestTs, seed));
  }

  const headers = { 'User-Agent': UA, 'X-App-Id': appId };
  if (withToken && userToken) headers['X-User-Auth-Token'] = userToken;

  const res = await fetch(`${API_BASE}/${object}/${method}?${qs.toString()}`, { headers });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  return { code: res.status, data, body: text };
}

function normalizeTrack(t) {
  if (!t) return null;
  return {
    id: String(t.id),
    provider: 'qobuz',
    title: t.title,
    artist: t.album?.artist?.name || t.performer?.name || t.composers?.[0]?.name || '',
    album: t.album?.title || '',
    duration: t.duration || 0,
    cover: t.album?.image?.large || t.album?.image?.small || '',
    hires: Boolean(t.hires_streamable),
    maxSamplingRate: t.maximum_sampling_rate || null,
    maxBitDepth: t.maximum_bit_depth || null,
    quality:
      t.hires_streamable
        ? `Hi-Res FLAC ${t.maximum_sampling_rate}kHz/${t.maximum_bit_depth}bit`
        : 'FLAC 44.1kHz/16bit',
  };
}

export async function searchTracks(query, limit = 20) {
  const res = await apiGet('catalog', 'search', { query, limit: String(Math.min(limit, 50)) });
  if (res.code !== 200 || !res.data?.tracks?.items) {
    const msg = res.data?.message || `Qobuz search failed (${res.code})`;
    const err = new Error(msg);
    err.code = res.code;
    throw err;
  }
  return res.data.tracks.items.map(normalizeTrack).filter(Boolean);
}

export async function searchAlbums(query, limit = 5) {
  const res = await apiGet('catalog', 'search', { query, limit: String(Math.min(limit, 20)) });
  if (res.code !== 200 || !res.data?.albums?.items) return [];
  return res.data.albums.items.map((a) => ({
    id: a.id,
    provider: 'qobuz',
    title: a.title,
    artist: a.artist?.name || '',
    cover: a.image?.large || a.image?.small || '',
    hires: Boolean(a.hires_streamable),
    maxSamplingRate: a.maximum_sampling_rate || null,
    trackCount: a.tracks_count || null,
  }));
}

export async function albumTracks(albumId) {
  const res = await apiGet('album', 'get', { album_id: albumId, limit: '100' });
  if (res.code !== 200 || !res.data?.tracks?.items) return [];
  return res.data.tracks.items.map(normalizeTrack).filter(Boolean);
}

const FORMAT_LADDER = ['27', '7', '6'];
const FORMAT_LABEL = {
  27: 'Hi-Res FLAC (24-bit, up to 192kHz)',
  7: 'Hi-Res FLAC (24-bit, up to 96kHz)',
  6: 'FLAC CD (16-bit, 44.1kHz)',
};

export { apiGet, normalizeTrack };

export async function getStreamUrl(trackId, { formatId = '27' } = {}) {
  if (!getConfig().userToken) {
    const err = new Error('QOBUZ_USER_TOKEN environment variable is not set. Add it in Netlify: Site settings > Environment variables.');
    err.code = 0;
    err.missing = 'QOBUZ_USER_TOKEN';
    throw err;
  }

  const ladder = formatId === '27' ? FORMAT_LADDER : [formatId, ...FORMAT_LADDER.filter((f) => f !== formatId)];
  let lastError = null;

  for (const fmt of ladder) {
    const res = await apiGet('track', 'getFileUrl', {
      track_id: String(trackId),
      format_id: fmt,
      intent: 'stream',
    });
    if (res.code === 200 && res.data?.url) {
      const served = res.data.format_id || fmt;
      return {
        url: res.data.url,
        provider: 'Qobuz',
        format: FORMAT_LABEL[served] || `FLAC (format ${served})`,
        formatId: served,
        samplingRate: res.data.sampling_rate || null,
        bitDepth: res.data.bit_depth || null,
        mimeType: res.data.mime_type || 'audio/flac',
        duration: res.data.duration || null,
        trackMeta: normalizeTrack(res.data),
      };
    }
    lastError = {
      code: res.code,
      message: res.data?.message || (res.data?.restrictions?.length ? 'Stream restricted for this account/region' : `Qobuz getFileUrl failed (${res.code})`),
      restrictions: res.data?.restrictions || null,
    };
    if (res.code === 401) {
      lastError.hint = 'QOBUZ_USER_TOKEN looks invalid or expired. Log in to play.qobuz.com, then copy the fresh token from the x-user-auth-token request header (browser devtools > network).';
      break;
    }
  }
  const err = new Error(lastError?.message || 'Qobuz stream resolution failed');
  err.code = lastError?.code || 502;
  if (lastError?.hint) err.hint = lastError.hint;
  if (lastError?.restrictions) err.restrictions = lastError.restrictions;
  throw err;
}
