from __future__ import annotations

import json
import logging
import os
import re
import time
import wave
from dataclasses import dataclass
from typing import Literal, Any
from uuid import uuid4

import httpx

from app.models.speech_turn import SpeechTurnAnalysis, SpeechTurnAudio, SpeechTurnResponse

logger = logging.getLogger(__name__)


@dataclass
class SpeechTurnTextResult:
    normalized_request: str
    intent: Literal["translate_request", "unknown"]
    chinese: str
    pinyin: str
    notes: list[str]


class GeminiSpeechTurnTextClient:
    def __init__(self, api_key: str, model: str = "gemini-2.5-flash") -> None:
        if not api_key:
            raise ValueError("Gemini API key not configured.")
        self._api_key = api_key
        self._model = model
        self._client = httpx.AsyncClient(timeout=30.0)  # reuse connections

    async def generate(
        self,
        transcript: str,
        source_lang: str,
        target_lang: str,
        scenario: str | None,
    ) -> SpeechTurnTextResult:
        scenario_hint = f"Scenario: {scenario}." if scenario else ""

        # Keep the prompt, but we’ll ALSO enforce schema (much more reliable).
        prompt = (
            "You are a Chinese tutor. "
            "Decide if the user is asking how to say something in the target language. "
            "Return JSON only."
            f" Source language: {source_lang}. Target language: {target_lang}. {scenario_hint} "
            f" Transcript: {transcript}"
        )

        response_schema = {
            "type": "object",
            "properties": {
                "normalized_request": {"type": "string"},
                "intent": {"type": "string", "enum": ["translate_request", "unknown"]},
                "chinese": {"type": "string"},
                "pinyin": {"type": "string"},
                "notes": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["normalized_request", "intent", "chinese", "pinyin", "notes"],
        }

        payload = {
            "generationConfig": {
                "temperature": 0.2,
                "maxOutputTokens": 256,
                # JSON mode + schema → predictable output
                "responseMimeType": "application/json",
                "responseSchema": response_schema,
            },
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        }

        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self._model}:generateContent"

        # retry on 429 (rate limit) with small backoff
        last_exc: Exception | None = None
        for attempt in range(3):
            response = await self._client.post(
                url,
                headers={"Content-Type": "application/json"},
                params={"key": self._api_key},
                json=payload,
            )

            if response.status_code == 429:
                # backoff: 0.5s, 1.0s, 2.0s
                wait = 0.5 * (2**attempt)
                print(f"TEXT 429 Too Many Requests. retrying in {wait:.1f}s")
                time.sleep(wait)
                continue

            try:
                response.raise_for_status()
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                break

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

        # If we got here, retries failed
        raise last_exc or ValueError("Gemini text generation failed after retries.")


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
        transcript, text_result, _, _ = await self.run_stt_and_llm(
            audio_bytes=audio_bytes,
            mime_type=mime_type,
            source_lang=source_lang,
            target_lang=target_lang,
            scenario=scenario,
        )

        chinese, pinyin, notes, tts_text = _build_response_parts(transcript, text_result)

        audio, audio_url, audio_mime, _, tts_error = await self.synthesize_audio(
            tts_text=tts_text,
            target_lang=target_lang,
            base_url=base_url,
        )

        return SpeechTurnResponse(
            assistant_text=tts_text,
            source_lang=source_lang,
            target_lang=target_lang,
            scenario=scenario,
            transcript=transcript,
            normalized_request=text_result.normalized_request,
            intent=text_result.intent,
            chinese=text_result.chinese,
            pinyin=text_result.pinyin,
            notes=notes,
            audio=audio,
            audio_url=audio_url,
            audio_base64=audio.base64 if audio else None,
            audio_mime=audio_mime,
            tts_error=tts_error,
            analysis=SpeechTurnAnalysis(overall_score=None, phoneme_confidence=[]),
        )

    async def run_stt_and_llm(
        self,
        *,
        audio_bytes: bytes,
        mime_type: str,
        source_lang: str,
        target_lang: str,
        scenario: str | None,
    ) -> tuple[str, SpeechTurnTextResult, float, float]:
        stt_start = time.perf_counter()
        transcript = await self._stt_client.transcribe(audio_bytes, mime_type, source_lang)
        stt_ms = (time.perf_counter() - stt_start) * 1000

        llm_start = time.perf_counter()
        if _looks_like_translate_request(transcript):
            # skip the extra Gemini text call to avoid 429s
            text_result = SpeechTurnTextResult(
                normalized_request=transcript,
                intent="translate_request",
                chinese="",   # will be filled only if your text model runs; otherwise fallback will speak
                pinyin="",
                notes=["Heuristic: detected translation request."],
            )
            llm_ms = (time.perf_counter() - llm_start) * 1000
        else:
            text_result = await self._text_client.generate(
                transcript=transcript,
                source_lang=source_lang,
                target_lang=target_lang,
                scenario=scenario,
            )
            llm_ms = (time.perf_counter() - llm_start) * 1000

        return transcript, text_result, stt_ms, llm_ms

    async def synthesize_audio(
        self,
        *,
        tts_text: str,
        target_lang: str,
        base_url: str,
    ) -> tuple[SpeechTurnAudio | None, str | None, str | None, float, str | None]:
        audio = None
        audio_url = None
        audio_mime = None
        tts_error = None
        tts_start = time.perf_counter()

        if tts_text:
            try:
                pcm_bytes, tts_meta = await self._tts_client.synthesize(tts_text, target_lang)
                if not pcm_bytes:
                    raise ValueError("TTS returned no audio bytes.")

                # Gemini TTS returns raw PCM; write a proper WAV file (24kHz mono 16-bit by default)
                sample_rate = int(tts_meta.get("sample_rate_hz", 24000))
                channels = int(tts_meta.get("channels", 1))
                sampwidth = int(tts_meta.get("sample_width_bytes", 2))

                filename = f"{uuid4().hex}.wav"
                file_path = os.path.join(self._audio_dir, filename)

                with wave.open(file_path, "wb") as wf:
                    wf.setnchannels(channels)
                    wf.setsampwidth(sampwidth)
                    wf.setframerate(sample_rate)
                    wf.writeframes(pcm_bytes)

                self._cleanup_old_files()
                audio_url = f"{base_url.rstrip('/')}/static/audio/{filename}"
                audio_mime = "audio/wav"
                audio = SpeechTurnAudio(format="wav", url=audio_url)
                logger.info("TTS audio file saved: %s", file_path)
                logger.info("TTS audio URL: %s", audio_url)

            except Exception as exc:  # noqa: BLE001
                tts_error = f"{type(exc).__name__}: {exc}"

        tts_ms = (time.perf_counter() - tts_start) * 1000
        return audio, audio_url, audio_mime, tts_ms, tts_error

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


def _normalize_notes(raw: Any) -> list[str]:
    # Accept: list[str] or str or None
    if raw is None:
        return []
    if isinstance(raw, str):
        return [raw]
    if isinstance(raw, list):
        return [str(x) for x in raw]
    return [str(raw)]


def _looks_like_translate_request(t: str) -> bool:
    s = (t or "").lower()
    return ("how do i say" in s) or ("say " in s and " in chinese" in s) or ("in chinese" in s)


def _build_response_parts(
    transcript: str,
    text_result: SpeechTurnTextResult,
) -> tuple[str, str, list[str], str]:
    chinese = text_result.chinese
    pinyin = text_result.pinyin
    notes = text_result.notes

    # If model says translate_request but it's missing chinese, fall back to speaking what we heard
    if text_result.intent == "translate_request" and not chinese.strip():
        notes = notes + ["Translation incomplete; speaking a fallback. Please retry."]
        # Treat as unknown but we will still TTS a fallback below
        chinese = ""
        pinyin = ""

    # ✅ Only TTS Chinese (don’t fall back to English transcript)
    tts_text = chinese or f"I heard: {transcript}"
    return chinese, pinyin, notes, tts_text


def _parse_text_result(content: str, transcript: str) -> SpeechTurnTextResult:
    try:
        s = content.strip()
        s = re.sub(r"^```json\s*|\s*```$", "", s, flags=re.IGNORECASE)

        payload = json.loads(s)  # with responseMimeType app/json, this should be clean

        intent = str(payload.get("intent") or "unknown")
        if intent not in ("translate_request", "unknown"):
            intent = "unknown"

        chinese = str(payload.get("chinese") or "")
        pinyin = str(payload.get("pinyin") or "")

        # If unknown, force empty
        if intent == "unknown":
            chinese, pinyin = "", ""

        return SpeechTurnTextResult(
            normalized_request=str(payload.get("normalized_request") or f"How do I say: '{transcript}'?"),
            intent=intent,  # type: ignore[assignment]
            chinese=chinese,
            pinyin=pinyin,
            notes=_normalize_notes(payload.get("notes")),
        )

    except Exception:
        return SpeechTurnTextResult(
            normalized_request=f"How do I say: '{transcript}'?",
            intent="unknown",
            chinese="",
            pinyin="",
            notes=["Unable to parse Gemini response."],
        )
