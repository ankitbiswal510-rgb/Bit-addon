const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const DISCOVERY_HOSTS = [
  'https://api.audius.co',
  'https://discoveryprovider.audius.co',
  'https://discoveryprovider2.audius.co',
  'https://discoveryprovider3.audius.co',
];

const APP_NAME = 'waddon';

async function fetchJson(url, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    const data = await res.json();
    return { code: res.status, data };
  } finally {
    clearTimeout(t);
  }
}

async function resolveDiscovery() {
  for (const host of DISCOVERY_HOSTS) {
    try {
      const { code, data } = await fetchJson(`${host}/v1/apps/info?app_name=${APP_NAME}`, 6000);
      if (code === 200 && data?.data) return host;
    } catch {
      // try next
    }
  }
  return DISCOVERY_HOSTS[0];
}

function normalize(t) {
  if (!t) return null;
  return {
    id: t.id,
    provider: 'audius',
    title: t.title,
    artist: t.user?.name || '',
    album: t.album || '',
    duration: t.duration || 0,
    cover: t.artwork?.['480x480'] || t.artwork?.['150x150'] || '',
    hires: false,
    quality: t.is_streamable ? 'Audius stream' : '',
  };
}

export async function searchTracks(query, limit = 20) {
  const host = await resolveDiscovery();
  const { code, data } = await fetchJson(
    `${host}/v1/tracks/search?query=${encodeURIComponent(query)}&app_name=${APP_NAME}`
  );
  if (code !== 200 || !data?.data) {
    const err = new Error(`Audius search failed (${code})`);
    err.code = code;
    throw err;
  }
  return (data.data || []).slice(0, limit).map(normalize).filter((t) => t && t.title);
}

export async function getStreamUrl(trackId) {
  const host = await resolveDiscovery();
  const info = await fetchJson(`${host}/v1/tracks/${encodeURIComponent(trackId)}?app_name=${APP_NAME}`);
  const meta = info?.data?.data ? normalize(info.data.data) : null;
  return {
    url: `${host}/v1/tracks/${encodeURIComponent(trackId)}/stream?app_name=${APP_NAME}`,
    provider: 'Audius',
    format: 'Audius stream (lossy, credential-free)',
    mimeType: 'audio/mpeg',
    trackMeta: meta,
    fallback: true,
  };
}
