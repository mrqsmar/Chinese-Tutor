from __future__ import annotations

import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)

DEFAULT_ELEVENLABS_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"


class ElevenLabsTTSClient:
    def __init__(self, api_key: str, model: str | None = None) -> None:
        if not api_key:
            raise ValueError("ElevenLabs API key not configured.")
        self._api_key = api_key
        self._model = model or os.getenv("ELEVENLABS_TTS_MODEL", "eleven_flash_v2_5")
        self._voice_ids = {
            "Kore": os.getenv("ELEVENLABS_VOICE_ID_WARM", DEFAULT_ELEVENLABS_VOICE_ID),
            "Leda": os.getenv("ELEVENLABS_VOICE_ID_BRIGHT", DEFAULT_ELEVENLABS_VOICE_ID),
            "Puck": os.getenv("ELEVENLABS_VOICE_ID_DEEP", DEFAULT_ELEVENLABS_VOICE_ID),
        }
        self._client = httpx.AsyncClient(timeout=30.0)

    def _resolve_voice_id(self, voice_name: str) -> str:
        return self._voice_ids.get(voice_name, DEFAULT_ELEVENLABS_VOICE_ID)

    async def synthesize(
        self,
        text: str,
        target_lang: str,
        voice_name: str = "Kore",
    ) -> tuple[bytes, dict[str, Any]]:
        voice_id = self._resolve_voice_id(voice_name)
        payload = {
            "text": text,
            "model_id": self._model,
            "language_code": target_lang,
        }
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
        logger.info(
            "ElevenLabs TTS request: model=%s voice_name=%s voice_id=%s",
            self._model,
            voice_name,
            voice_id,
        )

        response = await self._client.post(
            url,
            params={"output_format": "mp3_44100_128"},
            headers={
                "Content-Type": "application/json",
                "xi-api-key": self._api_key,
                "Accept": "audio/mpeg",
            },
            json=payload,
        )
        response.raise_for_status()
        audio_bytes = response.content
        if not audio_bytes:
            raise ValueError("ElevenLabs returned no audio bytes.")

        return audio_bytes, {
            "mime_type": "audio/mpeg",
            "file_extension": "mp3",
            "format": "mp3",
        }
