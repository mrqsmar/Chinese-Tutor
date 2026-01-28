from __future__ import annotations

import base64

import httpx


class GeminiSTTClient:
    def __init__(self, api_key: str, model: str = "gemini-2.5-flash") -> None:
        if not api_key:
            raise ValueError("Gemini API key not configured.")
        self._api_key = api_key
        self._model = model

    async def transcribe(self, audio_bytes: bytes, mime_type: str, source_lang: str) -> str:
        encoded = base64.b64encode(audio_bytes).decode("utf-8")
        payload = {
            "systemInstruction": {
                "parts": [
                    {
                        "text": (
                            "You are a transcription engine. Return only the verbatim transcript "
                            f"in {source_lang}. Do not add commentary or punctuation not present."
                        )
                    }
                ]
            },
            "generationConfig": {"temperature": 0.2, "maxOutputTokens": 256},
            "contents": [
                {
                    "role": "user",
                    "parts": [
                        {"text": "Transcribe the following audio."},
                        {
                            "inlineData": {
                                "mimeType": mime_type,
                                "data": encoded,
                            }
                        },
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
        transcript = (
            data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text")
        )
        if not transcript:
            raise ValueError("Gemini STT returned no transcript.")
        return transcript.strip()
