import * as qobuz from './lib/qobuz.mjs';
import * as deezer from './lib/deezer.mjs';
import * as audius from './lib/audius.mjs';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

function errorPayload(err) {
  return {
    status: 'error',
    error: err.message,
    code: err.code || 500,
    hint: err.hint,
    missing: err.missing,
    restrictions: err.restrictions,
  };
}

function shortCircuit(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: CORS_HEADERS });
}

const MANIFEST = {
  id: 'com.waddon.hifi',
  name: 'Waddon Hi-Fi',
  version: '2.0.0',
  description: 'Hi-Res Lossless FLAC provider for BitChord via Qobuz (primary), Deezer (metadata) and Audius (fallback)',
  types: ['music', 'audio'],
  resources: ['stream', 'meta', 'search'],
  endpoint: '/api',
};

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 200, headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '');
  const q = url.searchParams;

  // ---- manifest ----
  if (path.endsWith('/manifest.json') || path.endsWith('/manifest')) {
    return json(MANIFEST);
  }

  // ---- health ----
  if (path.endsWith('/health')) {
    const qstat = qobuz.isConfigured();
    return json({
      status: 'ok',
      providers: {
        qobuz: {
          configured: qstat.userToken,
          app_id: qobuz.getConfig().appId,
          token_present: qstat.userToken,
          hires_capable: qstat.userToken,
        },
        deezer: {
          configured: Boolean(deezer.getConfig().arl),
          note: 'ARL present? full streams; otherwise metadata + 30s previews',
        },
        audius: { configured: true },
      },
    });
  }

  // ---- resolve route ----
  let action = null;
  if (path.includes('/api/stream')) action = 'stream';
  else if (path.includes('/api/search')) action = 'search';
  else if (path.includes('/api/album')) action = 'album';
  else if (path.includes('/api/meta')) action = 'meta';
  else if (path.includes('/api/providers')) action = 'providers';
  else if (path.includes('/api/status')) action = 'providers';

  const provider = (q.get('provider') || 'qobuz').toLowerCase();
  const trackId = q.get('trackId') || q.get('id') || q.get('track_id') || '';
  const query = q.get('query') || q.get('q') || '';
  const albumId = q.get('albumId') || q.get('album_id') || '';
  const format = q.get('format') || '27';
  const limit = Math.max(1, Math.min(Number(q.get('limit')) || 20, 50));

  // ---- providers listing ----
  if (action === 'providers') {
    const qstat = qobuz.isConfigured();
    return shortCircuit({
      providers: [
        {
          id: 'qobuz',
          name: 'Qobuz',
          lossless: true,
          hires: true,
          configured: qstat.userToken,
          formats: ['FLAC 16/44.1', 'Hi-Res FLAC 24/96', 'Hi-Res FLAC 24/192'],
          envVars: ['QOBUZ_APP_ID', 'QOBUZ_USER_TOKEN', 'QOBUZ_SEED (optional)'],
        },
        { id: 'deezer', name: 'Deezer', lossless: false, hires: false, configured: Boolean(deezer.getConfig().arl), formats: ['MP3 preview'] },
        { id: 'audius', name: 'Audius', lossless: false, hires: false, configured: true, formats: ['MP3/AAC stream'] },
      ],
      primary: 'qobuz',
    });
  }

  if (!action) {
    return json(
      {
        addon: MANIFEST,
        usage: {
          stream: '/api/stream?trackId=<qobuz-track-id>&format=27|7|6',
          search: '/api/search?query=<text>&provider=qobuz|deezer|audius&limit=20',
          album: '/api/album?albumId=<qobuz-album-id>',
          meta: '/api/meta?trackId=<deezer-track-id>&provider=deezer',
          providers: '/api/providers',
          health: '/health',
        },
      },
      200
    );
  }

  // ---- stream ----
  if (action === 'stream') {
    if (!trackId) return json({ status: 'error', error: 'Missing trackId' }, 400);
    try {
      if (provider === 'qobuz') {
        const out = await qobuz.getStreamUrl(trackId, { formatId: format });
        return json({ status: 'success', ...out });
      }
      if (provider === 'deezer') {
        const out = await deezer.getStreamUrl(trackId);
        return json({ status: 'success', ...out });
      }
      if (provider === 'audius' || provider === 'tidal' || provider === 'monochrome') {
        const out = await audius.getStreamUrl(trackId);
        return json({ status: 'success', ...out });
      }
      return json({ status: 'error', error: `Unknown provider "${provider}"` }, 400);
    } catch (err) {
      return json(errorPayload(err), err.code && err.code >= 400 && err.code < 600 ? err.code : 502);
    }
  }

  // ---- search ----
  if (action === 'search') {
    if (!query) return json({ status: 'error', error: 'Missing query' }, 400);
    try {
      let tracks;
      if (provider === 'qobuz') tracks = await qobuz.searchTracks(query, limit);
      else if (provider === 'deezer') tracks = await deezer.searchTracks(query, limit);
      else if (provider === 'audius' || provider === 'tidal' || provider === 'monochrome') tracks = await audius.searchTracks(query, limit);
      else return json({ status: 'error', error: `Unknown provider "${provider}"` }, 400);
      return json({ status: 'success', provider, count: tracks.length, tracks });
    } catch (err) {
      return json(errorPayload(err), err.code === 401 ? 401 : 502);
    }
  }

  // ---- album ----
  if (action === 'album') {
    if (!albumId) return json({ status: 'error', error: 'Missing albumId' }, 400);
    try {
      const tracks = await qobuz.albumTracks(albumId);
      return json({ status: 'success', provider: 'qobuz', count: tracks.length, tracks });
    } catch (err) {
      return json(errorPayload(err), 502);
    }
  }

  // ---- meta ----
  if (action === 'meta') {
    try {
      if (provider === 'deezer') {
        const meta = await deezer.getTrackMeta(trackId);
        return json({ status: 'success', provider: 'deezer', track: deezer.normalizeTrack(meta) });
      }
      if (provider === 'qobuz') {
        const res = await qobuz.apiGet('track', 'get', { track_id: trackId });
        if (res.code !== 200) throw new Error(res.data?.message || `Qobuz track lookup failed (${res.code})`);
        return json({ status: 'success', provider: 'qobuz', track: qobuz.normalizeTrack(res.data) });
      }
      return json({ status: 'error', error: `meta not supported for provider "${provider}"` }, 400);
    } catch (err) {
      return json(errorPayload(err), 502);
    }
  }

  return json({ status: 'error', error: 'Unhandled action' }, 400);
};

export const config = {
  path: ['/api/:action', '/api'],
};
