const axios = require('axios');

const MONOCHROME_API = 'https://api.monochrome.tf';

exports.handler = async function (event, context) {
  const params = event.queryStringParameters || {};
  const searchQuery = params.query || params.q || params.id;

  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  if (!searchQuery) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ status: "online", backend: "Monochrome Proxy" })
    };
  }

  try {
    let trackId = searchQuery;

    // 1. If input is a search string instead of an ID, query the search endpoint first
    if (isNaN(searchQuery)) {
      const searchRes = await axios.get(`${MONOCHROME_API}/search?q=${encodeURIComponent(searchQuery)}`);
      const tracks = searchRes.data.items || searchRes.data.tracks || [];
      if (!tracks.length) throw new Error("No tracks found on backend.");
      trackId = tracks[0].id;
    }

    // 2. Fetch track stream details using the resolved track ID
    const streamRes = await axios.get(`${MONOCHROME_API}/track/${trackId}`);
    const streamData = streamRes.data;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: "success",
        stream: {
          url: streamData.streamUrl || streamData.url,
          format: "FLAC",
          bitrate: 1411,
          sampleRate: 44100,
          bitDepth: 16
        }
      })
    };
  } catch (error) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: "error",
        message: "Failed to resolve stream.",
        details: error.message
      })
    };
  }
};
