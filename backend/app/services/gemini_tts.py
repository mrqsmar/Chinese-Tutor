from __future__ import annotations

import base64
import os
import httpx


class GeminiTTSClient:
    def __init__(self, api_key: str, model: str | None = None) -> None:
        if not api_key:
            raise ValueError("Gemini API key not configured.")
        self._api_key = api_key
        self._model = model or os.getenv("GEMINI_TTS_MODEL", "gemini-2.5-flash-preview-tts")

    async def synthesize(self, text: str, target_lang: str) -> tuple[bytes, str]:
        # Avoid "zh Chinese" phrasing
        lang = "Mandarin Chinese" if target_lang in ("zh", "zh-CN", "zh-Hans") else target_lang

        payload = {
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "speechConfig": {
                    "voiceConfig": {
                        "prebuiltVoiceConfig": {"voiceName": "Kore"}
                    }
                },
            },
            "contents": [
                {
                    "role": "user",
                    "parts": [
                        {"text": f"Read the following aloud in {lang}, natural tone: {text}"}
                    ],
                }
            ],
        }

        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self._model}:generateContent"

        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await client.post(
                url,
                headers={
                    "Content-Type": "application/json",
                    "x-goog-api-key": self._api_key,
                },
                json=payload,
            )

        if response.status_code >= 400:
            # This will reveal the exact Gemini error (model not supported, invalid arg, etc.)
            print("Gemini TTS error:", response.status_code, response.text)

        response.raise_for_status()

        data = response.json()
        part = data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0]
        inline = part.get("inlineData", {})
        encoded_audio = inline.get("data")
        mime_type = inline.get("mimeType", "audio/mpeg")

        if not encoded_audio:
            raise ValueError(f"Gemini TTS returned no audio. Response: {data}")

        audio_bytes = base64.b64decode(encoded_audio)
        # mimeType may vary; don't assume mp3/wav too aggressively
        audio_format = "mp3" if "mpeg" in mime_type else ("wav" if "wav" in mime_type else "audio")
        return audio_bytes, audio_format