const axios = require('axios');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const query = event.queryStringParameters || {};
  const { trackId, provider = 'qobuz' } = query;

  try {
    // 1. Qobuz Direct Stream (Your Account)
    if (provider === 'qobuz') {
      const qobuzRes = await axios.get(`https://www.qobuz.com/api.json/0.2/track/getFileUrl`, {
        params: {
          track_id: trackId,
          format_id: 27, // 24-bit Hi-Res FLAC
          app_id: process.env.QOBUZ_APP_ID,
          user_auth_token: process.env.QOBUZ_USER_TOKEN
        }
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          status: 'success',
          provider: 'Qobuz',
          format: 'Hi-Res FLAC (24-bit)',
          url: qobuzRes.data.url
        })
      };
    } 
    
    // 2. Monochrome Public TIDAL Fallback Proxy
    else if (provider === 'monochrome' || provider === 'tidal') {
      const monochromeRes = await axios.get(`https://api.monochrome.tf/track`, {
        params: { id: trackId },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36',
          'Referer': 'https://monochrome.tf/'
        }
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          status: 'success',
          provider: 'Tidal (via Monochrome)',
          format: 'Hi-Res FLAC / Master',
          url: monochromeRes.data.url || monochromeRes.data.streamUrl
        })
      };
    } 
    
    // 3. Deezer Metadata Stream
    else if (provider === 'deezer') {
      const deezerRes = await axios.get(`https://api.deezer.com/track/${trackId}`);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          status: 'success',
          provider: 'Deezer',
          format: 'FLAC (16-bit)',
          title: deezerRes.data.title,
          artist: deezerRes.data.artist.name,
          preview_url: deezerRes.data.preview
        })
      };
    }

    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Specify provider=qobuz, provider=monochrome, or provider=deezer' })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
