from __future__ import annotations

import base64
import json
import os

import httpx


class GeminiTTSClient:
    def __init__(self, api_key: str, model: str | None = None) -> None:
        if not api_key:
            raise ValueError("Gemini API key not configured.")
        self._api_key = api_key
        self._model = model or os.getenv("GEMINI_TTS_MODEL", "gemini-2.5-flash-preview-tts")

    async def synthesize(self, text: str, target_lang: str) -> tuple[bytes, str]:
        payload = {
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "responseMimeType": "audio/wav",
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
                        {"text": f"Speak in Mandarin Chinese: {text}"}
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
        candidate = data.get("candidates", [{}])[0]
        parts = candidate.get("content", {}).get("parts", []) or []
        encoded_audio = None
        mime_type = "audio/wav"
        for part in parts:
            inline = part.get("inlineData", {}) or {}
            encoded_audio = inline.get("data")
            if encoded_audio:
                mime_type = inline.get("mimeType", mime_type)
                break

        if not encoded_audio:
            finish_reason = candidate.get("finishReason", "unknown")
            response_json = json.dumps(data, ensure_ascii=False, indent=2)
            if len(response_json) > 4000:
                response_json = response_json[:4000] + "...(truncated)"
            print(
                "Gemini TTS missing audio. finishReason:",
                finish_reason,
                "response:",
                response_json,
            )
            raise ValueError(
                f"Gemini TTS returned no audio. finishReason={finish_reason}."
            )

        audio_bytes = base64.b64decode(encoded_audio)
        # mimeType may vary; don't assume mp3/wav too aggressively
        audio_format = "mp3" if "mpeg" in mime_type else ("wav" if "wav" in mime_type else "audio")
        return audio_bytes, audio_format
