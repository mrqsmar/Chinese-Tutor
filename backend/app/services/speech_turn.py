from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from typing import Literal
from uuid import uuid4

import httpx

from app.models.speech_turn import SpeechTurnAnalysis, SpeechTurnAudio, SpeechTurnResponse


@dataclass
class SpeechTurnTextResult:
    normalized_request: str
    intent: Literal["translate_request", "unknown"]
    chinese: str | None
    pinyin: str | None
    notes: list[str]


class GeminiSpeechTurnTextClient:
    def __init__(self, api_key: str, model: str = "gemini-2.5-flash") -> None:
        if not api_key:
            raise ValueError("Gemini API key not configured.")
        self._api_key = api_key
        self._model = model

    async def generate(
        self,
        transcript: str,
        source_lang: str,
        target_lang: str,
        scenario: str | None,
    ) -> SpeechTurnTextResult:
        scenario_hint = f"Scenario: {scenario}." if scenario else ""
        prompt = (
            "You are helping an English learner. "
            "Given a transcript, decide if the user wants a translation request. "
            "Return ONLY valid JSON with keys: normalized_request, intent, chinese, pinyin, notes. "
            "intent must be translate_request or unknown. "
            "If intent is unknown, chinese and pinyin must be empty strings. "
            f"Source language: {source_lang}. Target language: {target_lang}. {scenario_hint} "
            f"Transcript: {transcript}"
        )
        payload = {
            "generationConfig": {"temperature": 0.2, "maxOutputTokens": 256},
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": prompt}],
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
        content = (
            data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text")
        )
        if not content:
            raise ValueError("Gemini text generation returned no content.")
        return _parse_text_result(content, transcript)


class SpeechTurnService:
    def __init__(
        self,
        stt_client,
        tts_client,
        text_client: GeminiSpeechTurnTextClient,
        audio_dir: str,
        ttl_seconds: int = 900,
    ) -> None:
        self._stt_client = stt_client
        self._tts_client = tts_client
        self._text_client = text_client
        self._audio_dir = audio_dir
        self._ttl_seconds = ttl_seconds

    async def process(
        self,
        *,
        audio_bytes: bytes,
        mime_type: str,
        source_lang: str,
        target_lang: str,
        scenario: str | None,
        base_url: str,
    ) -> SpeechTurnResponse:
        transcript = await self._stt_client.transcribe(audio_bytes, mime_type, source_lang)
        text_result = await self._text_client.generate(
            transcript=transcript,
            source_lang=source_lang,
            target_lang=target_lang,
            scenario=scenario,
        )

        chinese = text_result.chinese or ""
        pinyin = text_result.pinyin or ""
        notes = text_result.notes

        if text_result.intent == "translate_request" and (not chinese or not pinyin):
            notes = notes + ["Translation incomplete; please retry."]

        tts_text = chinese or transcript
        audio = None
        tts_error = None
        try:
            audio_bytes, audio_format = await self._tts_client.synthesize(tts_text, target_lang)
            if not audio_bytes:
                raise ValueError("TTS returned no audio bytes.")
            filename = f"{uuid4().hex}.{audio_format}"
            file_path = os.path.join(self._audio_dir, filename)
            with open(file_path, "wb") as handle:
                handle.write(audio_bytes)

            self._cleanup_old_files()
            audio_url = f"{base_url.rstrip('/')}/static/audio/{filename}"
            audio = SpeechTurnAudio(format=audio_format, url=audio_url)
        except Exception as exc:  # noqa: BLE001
            tts_error = f"{type(exc).__name__}: {exc}"

        response = SpeechTurnResponse(
            source_lang=source_lang,
            target_lang=target_lang,
            scenario=scenario,
            transcript=transcript,
            normalized_request=text_result.normalized_request,
            intent=text_result.intent,
            chinese=chinese if text_result.intent == "translate_request" else "",
            pinyin=pinyin if text_result.intent == "translate_request" else "",
            notes=notes,
            audio=audio,
            tts_error=tts_error,
            analysis=SpeechTurnAnalysis(overall_score=None, phoneme_confidence=[]),
        )
        return response

    def _cleanup_old_files(self) -> None:
        if not os.path.exists(self._audio_dir):
            return
        now = time.time()
        for entry in os.scandir(self._audio_dir):
            if not entry.is_file():
                continue
            if now - entry.stat().st_mtime > self._ttl_seconds:
                try:
                    os.remove(entry.path)
                except OSError:
                    continue


def _parse_text_result(content: str, transcript: str) -> SpeechTurnTextResult:
    try:
        start = content.find("{")
        end = content.rfind("}")
        if start == -1 or end == -1:
            raise ValueError("No JSON payload")
        payload = json.loads(content[start : end + 1])
        intent = payload.get("intent") or "unknown"
        if intent not in {"translate_request", "unknown"}:
            intent = "unknown"
        return SpeechTurnTextResult(
            normalized_request=str(payload.get("normalized_request") or transcript),
            intent=intent,
            chinese=str(payload.get("chinese") or ""),
            pinyin=str(payload.get("pinyin") or ""),
            notes=list(payload.get("notes") or []),
        )
    except (ValueError, json.JSONDecodeError):
        return SpeechTurnTextResult(
            normalized_request=f"How do I say: '{transcript}'?",
            intent="unknown",
            chinese="",
            pinyin="",
            notes=["Unable to parse Gemini response."],
        )
