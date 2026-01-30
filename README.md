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

### Endpoints

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
curl -X POST "http://localhost:8000/v1/speech/turn" \
  -F "audio=@/path/to/audio.m4a" \
  -F "level=beginner" \
  -F "scenario=restaurant" \
  -F "source_lang=en" \
  -F "target_lang=zh"
```

Smoke test (prints JSON including any `tts_error` when audio is unavailable):

```bash
curl -s -X POST "http://localhost:8000/v1/speech/turn" \
  -F "audio=@/path/to/audio.m4a" \
  -F "level=beginner" \
  -F "scenario=restaurant" \
  -F "source_lang=en" \
  -F "target_lang=zh" | jq
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

> If you are testing on a physical device, set `EXPO_PUBLIC_API_URL` to your machine's LAN IP
> (for example, `http://192.168.1.100:8000`).

## Notes

- No secrets are committed. Configuration is kept local and minimal.
- The backend is deterministic for MVP usage and can be swapped with a real LLM later.
