# Chinese Tutor MVP

A minimal Chinese language tutor with a FastAPI backend and an Expo React Native mobile client.

## Structure

```
backend/   # FastAPI service
mobile/    # Expo React Native app (TypeScript)
```

## Backend (FastAPI)

### Setup

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### Run

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Required environment variables

- `GEMINI_API_KEY`
- `ACCESS_TOKEN_SECRET`
- `REFRESH_TOKEN_SECRET`
- `AUTH_DEFAULT_USER`
- `AUTH_DEFAULT_PASSWORD_HASH` (bcrypt hash)
- `CORS_ALLOWED_ORIGINS` (comma-separated list of HTTPS origins for production)
- `PUBLIC_BASE_URL` (e.g. `https://api.example.com`)
- `DEMO_DISABLE_AUTH` (optional, set to `true` only for demos to bypass JWT checks)

### Auth

First-party JWT auth is enabled by default. Access tokens expire in ~15 minutes and
refresh tokens rotate on every refresh. The web client stores refresh tokens in
HttpOnly cookies; mobile stores them in SecureStore.

For demo-only flows, you can temporarily set `DEMO_DISABLE_AUTH=true` on the backend and
`EXPO_PUBLIC_DEMO_MODE=true` on the mobile app to bypass lock/login screens and open
directly to the chatbot UI.

If you only want the chatbot screen in mobile (no lock, no login, no onboarding),
set `EXPO_PUBLIC_CHATBOT_ONLY_MODE=true`. This auto-selects the English speaker path.

### Endpoints

`POST /auth/login`

`POST /auth/refresh`

`POST /auth/logout`

`POST /chat`

Request body:

```json
{
  "message": "Hi, 我想练习点中文",
  "level": "beginner"
}
```

Response body:

```json
{
  "reply": "...",
  "teaching": {
    "translation": "...",
    "pinyin": "...",
    "key_points": [
      { "phrase": "你好", "pinyin": "Nǐ hǎo", "meaning": "Hello" }
    ],
    "alternatives": ["..."],
    "follow_up": "..."
  }
}
```

`POST /v1/speech/turn` (multipart form-data)

```bash
curl -X POST "https://api.example.com/v1/speech/turn" \
  -F "audio=@/path/to/audio.m4a" \
  -F "level=beginner" \
  -F "scenario=restaurant" \
  -F "source_lang=en" \
  -F "target_lang=zh" \
  -F "voice=warm"
```

Smoke test (prints JSON including any `tts_error` when audio is unavailable):

```bash
curl -s -X POST "https://api.example.com/v1/speech/turn" \
  -F "audio=@/path/to/audio.m4a" \
  -F "level=beginner" \
  -F "scenario=restaurant" \
  -F "source_lang=en" \
  -F "target_lang=zh" \
  -F "voice=warm" | jq
```

Scripted end-to-end smoke test (login + speech turn + optional async audio polling):

```bash
cd backend
SMOKE_AUTH_USER=<username> SMOKE_AUTH_PASSWORD=<password> \
python scripts/smoke_voice_turn.py --base-url https://api.example.com --voice warm
```

Scripted end-to-end smoke test (login + speech turn + optional async audio polling):

```bash
cd backend
SMOKE_AUTH_USER=<username> SMOKE_AUTH_PASSWORD=<password> \
python scripts/smoke_voice_turn.py --base-url https://api.example.com --voice warm
python scripts/smoke_voice_turn.py --base-url https://api.example.com
```

## Mobile (Expo React Native)

### Setup

```bash
cd mobile
npm install
```

### Run

```bash
npm run start
```

> Set `EXPO_PUBLIC_API_URL` to your deployed HTTPS API (no localhost/LAN).
> Set `EXPO_PUBLIC_DEMO_MODE=true` only when you need a login-free demo build.
> Set `EXPO_PUBLIC_CHATBOT_ONLY_MODE=true` when you want chatbot-only UI.
> Sign-in is now optional by default. Set `EXPO_PUBLIC_REQUIRE_AUTH=true` only if you want the login screen enabled in production builds.
> When `EXPO_PUBLIC_REQUIRE_AUTH` is not `true`, the mobile client will not call `/auth/refresh` on `401` responses.

### Build an Android file (.apk) to share

If your partner wants an installable Android file, create an APK with EAS:

```bash
cd mobile
npm install
npx eas-cli login
EXPO_PUBLIC_API_URL=https://api.example.com \
EXPO_PUBLIC_CHATBOT_ONLY_MODE=true \
npx eas build --platform android --profile preview
```

- Download the generated `.apk` from the EAS build link and share it directly.
- `preview` profile in `mobile/eas.json` is configured for `apk` output.
- For Play Store uploads later, use `--profile production` (AAB output).

## Notes

- No secrets are committed. Configuration is kept local and minimal.
- The backend is deterministic for MVP usage and can be swapped with a real LLM later.
