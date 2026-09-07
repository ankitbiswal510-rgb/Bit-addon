const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export function getConfig() {
  const env = typeof Netlify !== 'undefined' && Netlify.env ? Netlify.env : process.env;
  return { arl: env.get('DEEZER_ARL') || '' };
}

async function fetchJson(url, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
    return { code: res.status, data: await res.json() };
  } finally {
    clearTimeout(t);
  }
}

export function normalizeTrack(t) {
  if (!t || t.error) return null;
  return {
    id: String(t.id),
    provider: 'deezer',
    title: t.title,
    artist: t.artist?.name || '',
    album: t.album?.title || '',
    duration: t.duration || 0,
    cover: t.album?.cover_xl || t.album?.cover_medium || '',
    hires: false,
    hasFloss: Boolean(t.readable),
    quality: 'Deezer metadata (stream via preview or fallback provider)',
  };
}

export async function searchTracks(query, limit = 20) {
  const { code, data } = await fetchJson(
    `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=${Math.min(limit, 50)}`
  );
  if (code !== 200 || !data?.data) {
    const err = new Error(`Deezer search failed (${code})`);
    err.code = code;
    throw err;
  }
  return data.data.map(normalizeTrack).filter(Boolean);
}

export async function getTrackMeta(trackId) {
  const { code, data } = await fetchJson(`https://api.deezer.com/track/${encodeURIComponent(trackId)}`);
  if (code !== 200 || !data || data.error) {
    const err = new Error(data?.error?.message || `Deezer track lookup failed (${code})`);
    err.code = code;
    throw err;
  }
  return data;
}

/**
 * Resolve a Deezer track to a playable URL.
 * Without a valid DEEZER_ARL we can only serve the 30s mp3 preview.
 * If a fresh ARL is configured later, this is where full FLAC would plug in
 * (via license_token + cdn-deezer media delivery).
 */
export async function getStreamUrl(trackId) {
  const meta = await getTrackMeta(trackId);
  return {
    url: meta.preview,
    provider: 'Deezer',
    format: '30s preview MP3 (full stream needs a valid DEEZER_ARL)',
    mimeType: 'audio/mp3',
    trackMeta: normalizeTrack(meta),
    preview: true,
  };
}
