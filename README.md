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

### Auth

First-party JWT auth is enabled by default. Access tokens expire in ~15 minutes and
refresh tokens rotate on every refresh. The web client stores refresh tokens in
HttpOnly cookies; mobile stores them in SecureStore.

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
  -F "target_lang=zh"
```

Smoke test (prints JSON including any `tts_error` when audio is unavailable):

```bash
curl -s -X POST "https://api.example.com/v1/speech/turn" \
  -F "audio=@/path/to/audio.m4a" \
  -F "level=beginner" \
  -F "scenario=restaurant" \
  -F "source_lang=en" \
  -F "target_lang=zh" | jq
```

Scripted end-to-end smoke test (login + speech turn + optional async audio polling):

```bash
cd backend
SMOKE_AUTH_USER=<username> SMOKE_AUTH_PASSWORD=<password> \
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

## Notes

- No secrets are committed. Configuration is kept local and minimal.
- The backend is deterministic for MVP usage and can be swapped with a real LLM later.
