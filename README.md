# Waddon Hi-Fi (bitchord-hifi-addon)

Hi-Res Lossless FLAC addon backend for BitChord, deployed on Netlify Functions.

## Endpoints

| Endpoint | Purpose |
|---|---|
| `/manifest.json` | Addon manifest |
| `/health` | Provider status |
| `/api` | Usage/endpoint list |
| `/api/search?query=<text>&provider=qobuz\|deezer\|audius&limit=20` | Track search (Hi-Res flags included) |
| `/api/stream?trackId=<id>&format=27\|7\|6&provider=qobuz` | Resolve stream URL (format 27 = Hi-Res 24-bit, ladder falls back 27→7→6) |
| `/api/album?albumId=<id>` | Album tracklist |
| `/api/meta?trackId=<id>&provider=deezer\|qobuz` | Track metadata |
| `/api/providers` | Provider capability listing |

## Environment variables (Netlify > Site settings > Environment variables)

| Variable | Required | Purpose |
|---|---|---|
| `QOBUZ_APP_ID` | no (default baked in) | Qobuz app id (production web-player id is the default) |
| `QOBUZ_USER_TOKEN` | **yes** | Qobuz account token — required for any stream. Get it from `play.qobuz.com` → devtools → Network → any API request → `X-User-Auth-Token` header |
| `QOBUZ_SEED` | no | Overrides the signing seed if Qobuz rotates it |
| `DEEZER_ARL` | optional | Deezer cookie. If valid, enables full Deezer streams; otherwise only metadata + 30s previews. Current value is expired |

## Notes

- Qobuz requests are signed per the Qobuz web player: `md5(object + method + sorted key-value params + request_ts + seed)`, sent as `request_ts` + `request_sig`, with `X-App-Id` + `X-User-Auth-Token` headers.
- Monochrome (`api.monochrome.tf`) is dead (owner suspended it) and was removed. Audius is the credential-free fallback.
- Track responses carry `hires`, `maxSamplingRate`, `maxBitDepth` so clients can show quality badges.
