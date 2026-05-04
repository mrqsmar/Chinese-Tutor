from __future__ import annotations

import asyncio
import json
import logging
import mimetypes
import os
import re
import time
from dataclasses import dataclass
from typing import Any, Literal
from uuid import uuid4

import httpx

from app.security import create_audio_token

from app.models.speech_turn import (
    SpeechTurnAnalysis,
    SpeechTurnAudio,
    SpeechTurnBreakdownItem,
    SpeechTurnResponse,
)

logger = logging.getLogger(__name__)

DEFAULT_TTS_VOICE = "Kore"
TTS_FALLBACK_VOICES = ("Kore", "Leda", "Puck")


@dataclass
class SpeechTurnTextResult:
    normalized_request: str
    intent: Literal["translate_request", "unknown"]
    target_text: str
    romanization: str
    chinese: str
    pinyin: str
    notes: list[str]
    breakdown: list[SpeechTurnBreakdownItem]


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
        looks_like_translate = _looks_like_translate_request(transcript)
        if looks_like_translate:
            return await self._generate_fast_translate(
                transcript=transcript,
                source_lang=source_lang,
                target_lang=target_lang,
                scenario=scenario,
            )

        scenario_hint = f"Scenario: {scenario}." if scenario else ""
        tutor_identity = (
            "You are an English tutor helping a Chinese speaker learn natural English."
            if target_lang == "en"
            else "You are a Chinese tutor helping an English speaker learn natural Chinese."
        )
        romanization_rule = (
            "Set romanization to a concise pronunciation hint for English output."
            if target_lang == "en"
            else "Set romanization to pinyin for Chinese output."
        )
        field_rule = (
            "When the target language is English, set chinese and target_text to the English phrase, "
            "and set pinyin to the pronunciation hint."
            if target_lang == "en"
            else "When the target language is Chinese, set chinese and target_text to the Chinese phrase, "
            "and set pinyin to its pinyin."
        )
        breakdown_rule = (
            "When the target language is English, breakdown may use short words or chunks. "
            "When the target language is Chinese, breakdown MUST contain exactly one row per Chinese character in order. "
            "Do not group characters together. "
            "Each row must include that single character as text, its own pinyin syllable as pronunciation, "
            "and a short English meaning for that character in this phrase. "
            "Example for 我爱你: "
            "[{\"text\":\"我\",\"pronunciation\":\"wǒ\",\"gloss\":\"I / me\"},"
            "{\"text\":\"爱\",\"pronunciation\":\"ài\",\"gloss\":\"love\"},"
            "{\"text\":\"你\",\"pronunciation\":\"nǐ\",\"gloss\":\"you\"}]."
            if target_lang == "zh"
            else "Populate breakdown with short teaching rows for each meaningful word or chunk in the final phrase. "
            "Each breakdown item must include the surface text, its pronunciation, and a brief English gloss."
        )
        intent_rule = (
            "In this tutor mode, the target language is already implied by the active app mode. "
            "Do NOT require the user to explicitly say 'in Chinese' or 'in English'. "
            "If the transcript is a phrase, sentence, sentence fragment, or a request like "
            "'how do I say', 'how to say', 'teach me', or similar, treat it as translate_request into the target language. "
            "For example, if source language is English and target language is Chinese, "
            "'How do I say I love you', 'Teach me one two three', and 'Ask someone out for dinner' "
            "should all be translate_request responses in Chinese. "
            "If the user simply says an English phrase like 'I love you' in English mode, "
            "interpret that as wanting the natural Chinese translation. "
            "Likewise, if the user simply says a Chinese phrase in Chinese mode, "
            "interpret that as wanting the natural English translation."
        )

        prompt = (
            f"{tutor_identity} "
            "Decide if the user is asking how to say something in the target language. "
            f"{intent_rule} "
            "For translate_request, output the best natural translation in the target language. "
            "Set target_text to the phrase to be spoken aloud. "
            f"{romanization_rule} "
            f"{field_rule} "
            f"{breakdown_rule} "
            "Return JSON only."
            f" Source language: {source_lang}. Target language: {target_lang}. {scenario_hint} "
            f" Transcript: {transcript}"
        )

        response_schema = {
            "type": "object",
            "properties": {
                "normalized_request": {"type": "string"},
                "intent": {"type": "string", "enum": ["translate_request", "unknown"]},
                "target_text": {"type": "string"},
                "romanization": {"type": "string"},
                "chinese": {"type": "string"},
                "pinyin": {"type": "string"},
                "notes": {"type": "array", "items": {"type": "string"}},
                "breakdown": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "text": {"type": "string"},
                            "pronunciation": {"type": "string"},
                            "gloss": {"type": "string"},
                        },
                        "required": ["text", "pronunciation", "gloss"],
                    },
                },
            },
            "required": [
                "normalized_request",
                "intent",
                "target_text",
                "romanization",
                "chinese",
                "pinyin",
                "notes",
                "breakdown",
            ],
        }

        payload = {
            "generationConfig": {
                "temperature": 0.2,
                "maxOutputTokens": 512,
                "responseMimeType": "application/json",
                "responseSchema": response_schema,
            },
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        }

        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self._model}:generateContent"

        last_exc: Exception | None = None
        for attempt in range(3):
            response = await self._client.post(
                url,
                headers={"Content-Type": "application/json"},
                params={"key": self._api_key},
                json=payload,
            )

            if response.status_code == 429:
                wait = 0.5 * (2**attempt)
                logger.warning("TEXT 429 Too Many Requests. retrying in %.1fs", wait)
                await asyncio.sleep(wait)
                continue

            try:
                response.raise_for_status()
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                break

            data = response.json()
            parts = (
                data.get("candidates", [{}])[0]
                .get("content", {})
                .get("parts", [{}])
            )
            # Gemini 2.5+ may include thinking tokens (thought=True) before the
            # actual response part.  Skip those and grab the first real text part.
            content = next(
                (p.get("text") for p in parts if not p.get("thought") and p.get("text")),
                None,
            )
            if not content:
                raise ValueError("Gemini text generation returned no content.")

            result = _parse_text_result(content, transcript)
            if _is_parse_failure_result(result) and looks_like_translate:
                logger.warning(
                    "Primary Gemini response parse failed for obvious translate request. transcript=%r",
                    transcript,
                )
                return await self._generate_translate_fallback(
                    transcript=transcript,
                    source_lang=source_lang,
                    target_lang=target_lang,
                    scenario=scenario,
                )
            return result

        raise last_exc or ValueError("Gemini text generation failed after retries.")

    async def _generate_fast_translate(
        self,
        *,
        transcript: str,
        source_lang: str,
        target_lang: str,
        scenario: str | None,
    ) -> SpeechTurnTextResult:
        scenario_hint = f"Scenario: {scenario}." if scenario else ""
        target_language_name = "English" if target_lang == "en" else "Chinese"
        romanization_rule = (
            "Return romanization as a concise pronunciation hint for the English phrase."
            if target_lang == "en"
            else "Return romanization as pinyin for the Chinese phrase."
        )
        field_rule = (
            "Set chinese and target_text to the final English phrase, and set pinyin to the pronunciation hint."
            if target_lang == "en"
            else "Set chinese and target_text to the final Chinese phrase, and set pinyin to its pinyin."
        )
        prompt = (
            f"Translate the user's request into natural spoken {target_language_name}. "
            "This is a fast voice-tutor translation path. "
            "Return only the phrase the learner should actually say. "
            "Do not explain the answer. Do not restate the question. "
            "If the user says something like 'How to ask someone out?' or 'How do I say I love you?', "
            "infer the intended phrase and translate that into the target language. "
            f"{romanization_rule} "
            f"{field_rule} "
            "Return JSON only."
            f" Source language: {source_lang}. Target language: {target_lang}. {scenario_hint} "
            f" Transcript: {transcript}"
        )
        payload = {
            "generationConfig": {
                "temperature": 0,
                "maxOutputTokens": 192,
                "responseMimeType": "application/json",
                "responseSchema": {
                    "type": "object",
                    "properties": {
                        "target_text": {"type": "string"},
                        "romanization": {"type": "string"},
                        "chinese": {"type": "string"},
                        "pinyin": {"type": "string"},
                    },
                    "required": ["target_text", "romanization", "chinese", "pinyin"],
                },
            },
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        }
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self._model}:generateContent"
        response = await self._client.post(
            url,
            headers={"Content-Type": "application/json"},
            params={"key": self._api_key},
            json=payload,
        )
        response.raise_for_status()
        data = response.json()
        parts = (
            data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])
        )
        content = next(
            (p.get("text") for p in parts if not p.get("thought") and p.get("text")),
            None,
        )
        if not content:
            raise ValueError("Gemini fast translation returned no content.")

        try:
            s = _strip_json_fence(content)
            payload_obj = json.loads(s)
            return _build_translate_result_from_payload(payload_obj, transcript)
        except Exception:
            logger.warning(
                "Fast translation parse failed. Falling back to secondary translation path. transcript=%r",
                transcript,
            )
            return await self._generate_translate_fallback(
                transcript=transcript,
                source_lang=source_lang,
                target_lang=target_lang,
                scenario=scenario,
            )

    async def _generate_translate_fallback(
        self,
        *,
        transcript: str,
        source_lang: str,
        target_lang: str,
        scenario: str | None,
    ) -> SpeechTurnTextResult:
        scenario_hint = f"Scenario: {scenario}." if scenario else ""
        target_language_name = "English" if target_lang == "en" else "Chinese"
        romanization_label = (
            "a concise pronunciation hint for the English phrase"
            if target_lang == "en"
            else "pinyin for the Chinese phrase"
        )
        prompt = (
            f"Translate the user's request into natural {target_language_name}. "
            "This is a language-tutor app. The user wants the phrase they should actually say, "
            "not an explanation and not a restatement of the question. "
            "If the request is phrased like 'How to ask someone out?' or 'How do I say I love you?', "
            "return the target-language phrase the learner should speak. "
            "Return JSON only with keys: target_text, romanization, chinese, pinyin, notes. "
            f"Set romanization to {romanization_label}. "
            f"Source language: {source_lang}. Target language: {target_lang}. {scenario_hint} "
            f"Transcript: {transcript}"
        )
        payload = {
            "generationConfig": {
                "temperature": 0,
                "maxOutputTokens": 256,
                "responseMimeType": "application/json",
                "responseSchema": {
                    "type": "object",
                    "properties": {
                        "target_text": {"type": "string"},
                        "romanization": {"type": "string"},
                        "chinese": {"type": "string"},
                        "pinyin": {"type": "string"},
                        "notes": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["target_text", "romanization", "chinese", "pinyin", "notes"],
                },
            },
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        }
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self._model}:generateContent"
        response = await self._client.post(
            url,
            headers={"Content-Type": "application/json"},
            params={"key": self._api_key},
            json=payload,
        )
        response.raise_for_status()
        data = response.json()
        parts = (
            data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])
        )
        content = next(
            (p.get("text") for p in parts if not p.get("thought") and p.get("text")),
            None,
        )
        if not content:
            raise ValueError("Gemini fallback translation returned no content.")

        salvaged = _salvage_translate_result_from_content(content, transcript)
        if salvaged:
            return salvaged
        logger.warning(
            "Secondary translation fallback returned meta/unparsable content. Falling back to plain text translation. transcript=%r",
            transcript,
        )
        return await self._generate_plain_text_translate(
            transcript=transcript,
            source_lang=source_lang,
            target_lang=target_lang,
            scenario=scenario,
        )

    async def _generate_plain_text_translate(
        self,
        *,
        transcript: str,
        source_lang: str,
        target_lang: str,
        scenario: str | None,
    ) -> SpeechTurnTextResult:
        scenario_hint = f"Scenario: {scenario}." if scenario else ""
        target_language_name = "English" if target_lang == "en" else "Chinese"
        romanization_rule = (
            "On the second line only, write a concise pronunciation hint in Latin letters."
            if target_lang == "en"
            else "On the second line only, write the pinyin."
        )
        prompt = (
            f"Translate the user's request into natural spoken {target_language_name}. "
            "Reply with only the final phrase the learner should say. No JSON. No explanation. No preamble. "
            "If the user asks something like 'How do I order three dumplings?', infer the phrase they want to say and translate that. "
            f"{romanization_rule} "
            f"Source language: {source_lang}. Target language: {target_lang}. {scenario_hint} "
            f"Transcript: {transcript}"
        )
        payload = {
            "generationConfig": {
                "temperature": 0,
                "maxOutputTokens": 128,
            },
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        }
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self._model}:generateContent"
        response = await self._client.post(
            url,
            headers={"Content-Type": "application/json"},
            params={"key": self._api_key},
            json=payload,
        )
        response.raise_for_status()
        data = response.json()
        parts = (
            data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])
        )
        content = next(
            (p.get("text") for p in parts if not p.get("thought") and p.get("text")),
            None,
        )
        if not content:
            raise ValueError("Gemini plain-text translation returned no content.")

        lines = [line.strip() for line in content.splitlines() if line.strip()]
        target_text = lines[0] if lines else _strip_json_fence(content).strip()
        romanization = lines[1] if len(lines) > 1 else ""
        return SpeechTurnTextResult(
            normalized_request=f"How do I say: '{transcript}'?",
            intent="translate_request",
            target_text=target_text,
            romanization=romanization,
            chinese=target_text,
            pinyin=romanization,
            notes=["Recovered translation from plain-text Gemini fallback."],
            breakdown=[],
        )

    async def generate_character_breakdown(
        self,
        *,
        chinese: str,
        pinyin: str,
        english_gloss: str,
    ) -> list[SpeechTurnBreakdownItem]:
        chinese_chars = [char for char in chinese if _is_chinese_char(char)]
        if not chinese_chars:
            return []

        prompt = (
            "You are creating a Chinese learning breakdown.\n"
            "Return JSON only.\n"
            "Output an array named breakdown with EXACTLY one item per Chinese character in order.\n"
            "Do not group characters.\n"
            "Each item must contain:\n"
            "- text: the single Chinese character\n"
            "- pronunciation: the matching single pinyin syllable for that character\n"
            "- gloss: a short English meaning for that character in context\n\n"
            f"Chinese phrase: {chinese}\n"
            f"Pinyin: {pinyin}\n"
            f"English translation: {english_gloss}\n\n"
            "Example:\n"
            "{\"breakdown\":["
            "{\"text\":\"我\",\"pronunciation\":\"wǒ\",\"gloss\":\"I / me\"},"
            "{\"text\":\"爱\",\"pronunciation\":\"ài\",\"gloss\":\"love\"},"
            "{\"text\":\"你\",\"pronunciation\":\"nǐ\",\"gloss\":\"you\"}"
            "]}"
        )

        payload = {
            "generationConfig": {
                "temperature": 0,
                "maxOutputTokens": 256,
                "responseMimeType": "application/json",
                "responseSchema": {
                    "type": "object",
                    "properties": {
                        "breakdown": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "text": {"type": "string"},
                                    "pronunciation": {"type": "string"},
                                    "gloss": {"type": "string"},
                                },
                                "required": ["text", "pronunciation", "gloss"],
                            },
                        }
                    },
                    "required": ["breakdown"],
                },
            },
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        }

        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self._model}:generateContent"
        response = await self._client.post(
            url,
            headers={"Content-Type": "application/json"},
            params={"key": self._api_key},
            json=payload,
        )
        response.raise_for_status()
        data = response.json()
        parts = (
            data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])
        )
        content = next(
            (p.get("text") for p in parts if not p.get("thought") and p.get("text")),
            None,
        )
        if not content:
            raise ValueError("Gemini breakdown generation returned no content.")

        parsed = json.loads(content.strip())
        return _normalize_breakdown(parsed.get("breakdown"))


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
            chinese=chinese,
            pinyin=pinyin,
            notes=notes,
            breakdown=text_result.breakdown,
            audio=audio,
            audio_url=audio_url,
            # Only include base64 if your SpeechTurnAudio actually sets it.
            audio_base64=getattr(audio, "base64", None) if audio else None,
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
            logger.info("Heuristic: detected translate request for transcript=%s", transcript)
        text_result = await self._text_client.generate(
            transcript=transcript,
            source_lang=source_lang,
            target_lang=target_lang,
            scenario=scenario,
        )
        llm_ms = (time.perf_counter() - llm_start) * 1000

        return transcript, text_result, stt_ms, llm_ms

    async def run_text_and_llm(
        self,
        *,
        text: str,
        source_lang: str,
        target_lang: str,
        scenario: str | None,
    ) -> tuple[str, SpeechTurnTextResult, float, float]:
        transcript = (text or "").strip()
        if not transcript:
            raise ValueError("Text input is empty.")

        llm_start = time.perf_counter()
        if _looks_like_translate_request(transcript):
            logger.info("Heuristic: detected translate request for text=%s", transcript)
        text_result = await self._text_client.generate(
            transcript=transcript,
            source_lang=source_lang,
            target_lang=target_lang,
            scenario=scenario,
        )
        llm_ms = (time.perf_counter() - llm_start) * 1000

        return transcript, text_result, 0.0, llm_ms

    async def synthesize_audio(
        self,
        *,
        tts_text: str,
        target_lang: str,
        base_url: str,
        voice_name: str = DEFAULT_TTS_VOICE,
    ) -> tuple[SpeechTurnAudio | None, str | None, str | None, float, str | None]:
        audio: SpeechTurnAudio | None = None
        audio_url: str | None = None
        audio_mime: str | None = None
        tts_error: str | None = None

        tts_start = time.perf_counter()
        tts_text = (tts_text or "").strip()

        if tts_text:
            voice_candidates = _build_tts_voice_candidates(
                voice_name=voice_name,
                target_lang=target_lang,
            )
            text_candidates = _build_tts_text_candidates(tts_text)
            last_error: str | None = None
            for candidate_text in text_candidates:
                for candidate_voice in voice_candidates:
                    try:
                        audio_bytes, tts_meta = await self._tts_client.synthesize(
                            candidate_text,
                            target_lang,
                            voice_name=candidate_voice,
                        )
                        if not audio_bytes:
                            raise ValueError("TTS returned no audio bytes.")

                        file_extension = str(tts_meta.get("file_extension", "wav"))
                        filename = f"{uuid4().hex}.{file_extension}"
                        file_path = os.path.join(self._audio_dir, filename)
                        with open(file_path, "wb") as audio_file:
                            audio_file.write(audio_bytes)

                        self._cleanup_old_files()

                        audio_token = create_audio_token(filename)
                        audio_url = (
                            f"{base_url.rstrip('/')}/static/audio/{filename}?token={audio_token}"
                        )
                        audio_mime = str(
                            tts_meta.get("mime_type")
                            or mimetypes.guess_type(filename)[0]
                            or "application/octet-stream"
                        )
                        audio_format = str(tts_meta.get("format", file_extension))
                        audio = SpeechTurnAudio(format=audio_format, url=audio_url)

                        logger.info(
                            "TTS audio file saved: %s (voice=%s text_variant=%s)",
                            file_path,
                            candidate_voice,
                            "original" if candidate_text == tts_text else "fallback",
                        )
                        if candidate_voice != voice_name:
                            logger.warning(
                                "TTS fallback voice used. requested=%s fallback=%s",
                                voice_name,
                                candidate_voice,
                            )
                        if candidate_text != tts_text:
                            logger.warning(
                                "TTS fallback text variant used. original=%r fallback=%r",
                                tts_text,
                                candidate_text,
                            )
                        last_error = None
                        break

                    except Exception as exc:  # noqa: BLE001
                        last_error = f"{type(exc).__name__}: {exc}"
                        logger.warning(
                            "TTS synth failed for voice=%s target_lang=%s text_variant=%s error=%s",
                            candidate_voice,
                            target_lang,
                            "original" if candidate_text == tts_text else "fallback",
                            last_error,
                        )
                        continue
                if last_error is None:
                    break

            if last_error:
                tts_error = last_error

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
    if raw is None:
        return []
    if isinstance(raw, str):
        return [raw]
    if isinstance(raw, list):
        return [str(x) for x in raw]
    return [str(raw)]


def _strip_json_fence(content: str) -> str:
    s = (content or "").strip()
    return re.sub(r"^```json\s*|\s*```$", "", s, flags=re.IGNORECASE)


def _extract_first_json_object(content: str) -> str | None:
    s = _strip_json_fence(content)
    start = s.find("{")
    if start < 0:
        return None
    depth = 0
    for index, char in enumerate(s[start:], start=start):
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return s[start : index + 1]
    return None


def _build_translate_result_from_payload(
    payload_obj: dict[str, Any],
    transcript: str,
) -> SpeechTurnTextResult:
    target_text = str(payload_obj.get("target_text") or payload_obj.get("chinese") or "").strip()
    romanization = str(payload_obj.get("romanization") or payload_obj.get("pinyin") or "").strip()
    chinese = str(payload_obj.get("chinese") or target_text).strip()
    pinyin = str(payload_obj.get("pinyin") or romanization).strip()
    return SpeechTurnTextResult(
        normalized_request=f"How do I say: '{transcript}'?",
        intent="translate_request",
        target_text=target_text,
        romanization=romanization,
        chinese=chinese,
        pinyin=pinyin,
        notes=_normalize_notes(payload_obj.get("notes")),
        breakdown=[],
    )


def _salvage_translate_result_from_content(
    content: str,
    transcript: str,
) -> SpeechTurnTextResult | None:
    json_object = _extract_first_json_object(content)
    if json_object:
        try:
            payload_obj = json.loads(json_object)
            if isinstance(payload_obj, dict):
                return _build_translate_result_from_payload(payload_obj, transcript)
        except Exception:
            pass

    plain = _strip_json_fence(content).strip()
    if not plain:
        return None

    lower_plain = plain.lower()
    if (
        "here is the json" in lower_plain
        or "requested json" in lower_plain
        or lower_plain in {"json", "{}", "[]"}
    ):
        return None

    # Last-resort salvage: if Gemini answered with plain text, speak that instead of 500ing.
    return SpeechTurnTextResult(
        normalized_request=f"How do I say: '{transcript}'?",
        intent="translate_request",
        target_text=plain,
        romanization="",
        chinese=plain,
        pinyin="",
        notes=["Recovered translation from non-JSON Gemini response."],
        breakdown=[],
    )


def _is_parse_failure_result(result: SpeechTurnTextResult) -> bool:
    return (
        result.intent == "unknown"
        and any("Unable to parse Gemini response." in note for note in result.notes)
    )


def _looks_like_translate_request(t: str) -> bool:
    s = (t or "").lower()
    if re.match(r"^\s*how to\s+\w+", s):
        return True
    if re.match(r"^\s*how do i\s+\w+", s):
        return True
    if re.match(r"^\s*how can i\s+\w+", s):
        return True
    if re.match(r"^\s*(what's|what is)\s+the\s+\w+", s):
        return True
    return (
        ("how do i say" in s)
        or ("how to say" in s)
        or ("teach me" in s)
        or ("translate" in s)
        or ("in mandarin" in s)
        or ("say " in s and " in chinese" in s)
        or ("say " in s and " in english" in s)
        or ("in chinese" in s)
        or ("in english" in s)
    )


def _is_chinese_char(char: str) -> bool:
    return "\u4e00" <= char <= "\u9fff"


def _character_count(text: str) -> int:
    return sum(1 for char in text if _is_chinese_char(char))


def _has_character_level_breakdown(
    chinese: str,
    breakdown: list[SpeechTurnBreakdownItem],
) -> bool:
    chinese_chars = [char for char in chinese if _is_chinese_char(char)]
    if not chinese_chars or len(breakdown) != len(chinese_chars):
        return False

    return all(
        len(item.text) == 1 and _is_chinese_char(item.text)
        for item in breakdown
    )


async def _ensure_character_breakdown(
    text_client: GeminiSpeechTurnTextClient,
    text_result: SpeechTurnTextResult,
    english_gloss: str,
) -> list[SpeechTurnBreakdownItem]:
    if _has_character_level_breakdown(text_result.chinese, text_result.breakdown):
        return text_result.breakdown

    try:
        breakdown = await text_client.generate_character_breakdown(
            chinese=text_result.chinese or text_result.target_text,
            pinyin=text_result.pinyin or text_result.romanization,
            english_gloss=english_gloss,
        )
        if _has_character_level_breakdown(text_result.chinese, breakdown):
            return breakdown
    except Exception as exc:  # noqa: BLE001
        logger.warning("Breakdown regeneration failed: %s: %s", type(exc).__name__, exc)

    fallback = _coerce_character_breakdown(
        chinese=text_result.chinese or text_result.target_text,
        pinyin=text_result.pinyin or text_result.romanization,
        breakdown=text_result.breakdown,
    )
    if _has_character_level_breakdown(text_result.chinese, fallback):
        return fallback

    return text_result.breakdown


def _split_pronunciation_syllables(pronunciation: str) -> list[str]:
    return [part for part in re.split(r"\s+", (pronunciation or "").strip()) if part]


def _coerce_character_breakdown(
    *,
    chinese: str,
    pinyin: str,
    breakdown: list[SpeechTurnBreakdownItem],
) -> list[SpeechTurnBreakdownItem]:
    chinese_chars = [char for char in chinese if _is_chinese_char(char)]
    if not chinese_chars:
        return []

    if breakdown:
        items: list[SpeechTurnBreakdownItem] = []
        for item in breakdown:
            item_chars = [char for char in item.text if _is_chinese_char(char)]
            if not item_chars:
                continue
            syllables = _split_pronunciation_syllables(item.pronunciation)
            for idx, char in enumerate(item_chars):
                items.append(
                    SpeechTurnBreakdownItem(
                        text=char,
                        pronunciation=syllables[idx] if idx < len(syllables) else "",
                        gloss=item.gloss,
                    )
                )
        if len(items) == len(chinese_chars):
            return items

    syllables = _split_pronunciation_syllables(pinyin)
    return [
        SpeechTurnBreakdownItem(
            text=char,
            pronunciation=syllables[idx] if idx < len(syllables) else "",
            gloss="",
        )
        for idx, char in enumerate(chinese_chars)
    ]


def _build_tts_voice_candidates(voice_name: str, target_lang: str) -> list[str]:
    candidates = [voice_name or DEFAULT_TTS_VOICE]
    if target_lang == "zh":
        candidates.extend(TTS_FALLBACK_VOICES)
    else:
        candidates.append(DEFAULT_TTS_VOICE)
    return list(dict.fromkeys(candidates))


def _build_tts_text_candidates(tts_text: str) -> list[str]:
    normalized = re.sub(r"[，。！？、；：,.!?;:]+", " ", tts_text)
    normalized = re.sub(r"\s+", " ", normalized).strip()

    candidates = [tts_text]
    if normalized and normalized != tts_text:
        candidates.append(normalized)
    return candidates


def _build_response_parts(
    transcript: str,
    text_result: SpeechTurnTextResult,
) -> tuple[str, str, list[str], str]:
    chinese = text_result.chinese or text_result.target_text or ""
    pinyin = text_result.pinyin or text_result.romanization or ""
    notes = text_result.notes or []

    # If model says translate_request but it's missing chinese, fall back to speaking what we heard
    if text_result.intent == "translate_request" and not chinese.strip():
        notes = notes + ["Translation incomplete; speaking a fallback. Please retry."]
        chinese = ""
        pinyin = ""

    # This will speak Chinese if present, otherwise a fallback.
    tts_text = text_result.target_text or chinese or f"I heard: {transcript}"
    return chinese, pinyin, notes, tts_text


def _normalize_breakdown(raw: Any) -> list[SpeechTurnBreakdownItem]:
    if not isinstance(raw, list):
        return []

    items: list[SpeechTurnBreakdownItem] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        items.append(
            SpeechTurnBreakdownItem(
                text=text,
                pronunciation=str(item.get("pronunciation") or "").strip(),
                gloss=str(item.get("gloss") or "").strip(),
            )
        )
    return items


def _parse_text_result(content: str, transcript: str) -> SpeechTurnTextResult:
    try:
        s = content.strip()
        s = re.sub(r"^```json\s*|\s*```$", "", s, flags=re.IGNORECASE)

        payload = json.loads(s)

        intent = str(payload.get("intent") or "unknown")
        if intent not in ("translate_request", "unknown"):
            intent = "unknown"

        target_text = str(payload.get("target_text") or payload.get("chinese") or "")
        romanization = str(payload.get("romanization") or payload.get("pinyin") or "")
        chinese = str(payload.get("chinese") or target_text)
        pinyin = str(payload.get("pinyin") or romanization)

        if intent == "unknown":
            chinese, pinyin = "", ""

        return SpeechTurnTextResult(
            normalized_request=str(
                payload.get("normalized_request") or f"How do I say: '{transcript}'?"
            ),
            intent=intent,  # type: ignore[assignment]
            target_text=target_text,
            romanization=romanization,
            chinese=chinese,
            pinyin=pinyin,
            notes=_normalize_notes(payload.get("notes")),
            breakdown=_normalize_breakdown(payload.get("breakdown")),
        )
    except Exception:
        return SpeechTurnTextResult(
            normalized_request=f"How do I say: '{transcript}'?",
            intent="unknown",
            target_text="",
            romanization="",
            chinese="",
            pinyin="",
            notes=["Unable to parse Gemini response."],
            breakdown=[],
        )
