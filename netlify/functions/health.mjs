import * as qobuz from './lib/qobuz.mjs';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

export default async () => {
  const qstat = qobuz.isConfigured();
  const cfg = qobuz.getConfig();
  return new Response(
    JSON.stringify({
      status: 'ok',
      providers: {
        qobuz: {
          configured: qstat.userToken,
          app_id_present: Boolean(cfg.appId),
          token_present: qstat.userToken,
          hires_capable: qstat.userToken,
        },
        audius: { configured: true },
      },
    }),
    { status: 200, headers: CORS_HEADERS }
  );
};
