from __future__ import annotations

import base64
import json
import os
import re
from typing import Any

import httpx


class GeminiTTSClient:
    def __init__(self, api_key: str, model: str | None = None) -> None:
        if not api_key:
            raise ValueError("Gemini API key not configured.")
        self._api_key = api_key
        self._model = model or os.getenv("GEMINI_TTS_MODEL", "gemini-2.5-flash-preview-tts")

    def _parse_rate(self, mime_type: str | None) -> int:
        # mime often looks like: audio/L16;codec=pcm;rate=24000
        if not mime_type:
            return 24000
        m = re.search(r"rate=(\d+)", mime_type)
        return int(m.group(1)) if m else 24000

    async def synthesize(self, text: str, target_lang: str) -> tuple[bytes, dict[str, Any]]:
        # Match the official REST example shape closely:
        # - contents -> [{ parts: [{ text: ... }] }]
        # - generationConfig -> responseModalities + speechConfig
        # - include "model" in the JSON body
        payload = {
            "contents": [
                {
                    "parts": [
                        {
                            # You can keep this simple for debug.
                            # Later you can do: f"Say in {target_lang}: {text}"
                            "text": text
                        }
                    ]
                }
            ],
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "speechConfig": {
                    "voiceConfig": {
                        "prebuiltVoiceConfig": {"voiceName": "Kore"}
                    }
                },
            },
            "model": self._model,
        }

        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self._model}:generateContent"


        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await client.post(
                url,
                headers={"Content-Type": "application/json"},
                params={"key": self._api_key},  # keep consistent with your text call
                json=payload,
            )

        if response.status_code >= 400:
            print("Gemini TTS error:", response.status_code, response.text)

        response.raise_for_status()
        data = response.json()

        candidate = (data.get("candidates") or [{}])[0]
        parts = candidate.get("content", {}).get("parts", []) or []

        encoded_audio = None
        mime_type = None

        for part in parts:
            inline = part.get("inlineData") or {}
            if inline.get("data"):
                encoded_audio = inline["data"]
                mime_type = inline.get("mimeType")
                break

        if not encoded_audio:
            finish_reason = candidate.get("finishReason", "unknown")
            response_json = json.dumps(data, ensure_ascii=False, indent=2)
            if len(response_json) > 4000:
                response_json = response_json[:4000] + "...(truncated)"
            print("Gemini TTS missing audio. finishReason:", finish_reason, "response:", response_json)
            raise ValueError(f"Gemini TTS returned no audio. finishReason={finish_reason}.")

        pcm_bytes = base64.b64decode(encoded_audio)
        rate = self._parse_rate(mime_type)

        # Return PCM bytes + metadata so caller can wrap to WAV
        meta = {
            "mime_type": mime_type or "audio/L16;codec=pcm;rate=24000",
            "sample_rate_hz": rate,
            "channels": 1,
            "sample_width_bytes": 2,  # 16-bit PCM
        }
        return pcm_bytes, meta