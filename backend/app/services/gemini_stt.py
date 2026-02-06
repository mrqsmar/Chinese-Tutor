from __future__ import annotations

import base64
import httpx


class GeminiSTTClient:
    def __init__(self, api_key: str, model: str = "gemini-2.5-flash") -> None:
        if not api_key:
            raise ValueError("Gemini API key not configured.")
        self._api_key = api_key
        self._model = model
        self._client = httpx.AsyncClient(timeout=30.0)  # reuse connections

    def _needs_normalization(self, t: str) -> bool:
        s = (t or "").strip()
        if len(s.split()) <= 2:
            return True
        # common garbage patterns
        lower = s.lower()
        return any(x in lower for x in [" and chinese", " stay ", " bargain chip"])

    # --- STEP 1: raw transcription (unchanged logic) ---
    async def transcribe_raw(self, audio_bytes: bytes, mime_type: str, source_lang: str) -> str:
        encoded = base64.b64encode(audio_bytes).decode("utf-8")

        payload = {
            "systemInstruction": {
                "parts": [
                    {
                        "text": (
                            "You are a speech transcription engine for an English learning app. "
                            "Transcribe the user's spoken request as natural English. "
                            "Return ONLY the transcript text."
                        )
                    }
                ]
            },
            "generationConfig": {
                "temperature": 0,
                "maxOutputTokens": 128,
            },
            "contents": [
                {
                    "role": "user",
                    "parts": [
                        {"text": "Transcribe this audio."},
                        {"inlineData": {"mimeType": mime_type, "data": encoded}},
                    ],
                }
            ],
        }

        response = await self._client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{self._model}:generateContent",
            headers={"Content-Type": "application/json"},
            params={"key": self._api_key},
            json=payload,
        )

        response.raise_for_status()
        data = response.json()

        transcript = (
            data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text")
        )

        if not transcript:
            raise ValueError("Gemini STT returned no transcript.")

        return transcript.strip()

    # --- STEP 2: normalize obvious STT errors ---
    async def normalize_transcript(self, transcript: str) -> str:
        prompt = (
            "You are cleaning up speech-to-text mistakes.\n"
            "Rules:\n"
            "1) Do NOT shorten the sentence.\n"
            "2) Preserve ALL meaning and most words.\n"
            "3) Only fix misheard words (e.g., stay→say, and→in).\n"
            "4) If the transcript is already understandable, return it unchanged.\n"
            "Return ONLY the corrected sentence.\n\n"
            f"Transcript: {transcript}"
        )

        payload = {
            "generationConfig": {
                "temperature": 0,
                "maxOutputTokens": 64,
            },
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": prompt}],
                }
            ],
        }

        response = await self._client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{self._model}:generateContent",
            headers={"Content-Type": "application/json"},
            params={"key": self._api_key},
            json=payload,
        )

        response.raise_for_status()
        data = response.json()

        cleaned = (
            data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text", "")
            .strip()
        )

        # Fallback safely if model returns nothing
        return cleaned or transcript
    

    # --- STEP 3: public API (what the rest of your app already uses) ---
    async def transcribe(self, audio_bytes: bytes, mime_type: str, source_lang: str) -> str:
        raw = await self.transcribe_raw(audio_bytes, mime_type, source_lang)
        if self._needs_normalization(raw):
            norm = await self.normalize_transcript(raw)
            return norm
        return raw