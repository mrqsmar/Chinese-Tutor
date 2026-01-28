from __future__ import annotations

import base64

import httpx


class GeminiTTSClient:
    def __init__(self, api_key: str, model: str = "gemini-2.5-flash") -> None:
        if not api_key:
            raise ValueError("Gemini API key not configured.")
        self._api_key = api_key
        self._model = model

    async def synthesize(self, text: str, target_lang: str) -> tuple[bytes, str]:
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
                        {
                            "text": (
                                "Read the following aloud in "
                                f"{target_lang} Chinese, natural tone: {text}"
                            )
                        }
                    ],
                }
            ],
        }

        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await client.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{self._model}:generateContent",
                headers={"Content-Type": "application/json"},
                params={"key": self._api_key},
                json=payload,
            )

        response.raise_for_status()
        data = response.json()
        part = (
            data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
        )
        inline = part.get("inlineData", {})
        encoded_audio = inline.get("data")
        mime_type = inline.get("mimeType", "audio/mpeg")
        if not encoded_audio:
            raise ValueError("Gemini TTS returned no audio.")
        audio_bytes = base64.b64decode(encoded_audio)
        audio_format = "mp3" if "mpeg" in mime_type else "wav"
        return audio_bytes, audio_format
