from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator


class SpeechTurnAudio(BaseModel):
    format: Literal["mp3", "wav"]
    url: str | None = None
    base64: str | None = None

    @model_validator(mode="after")
    def _validate_source(self) -> "SpeechTurnAudio":
        if not self.url and not self.base64:
            raise ValueError("audio must include url or base64")
        return self


class SpeechTurnAnalysis(BaseModel):
    overall_score: float | None = None
    phoneme_confidence: list[float] = Field(default_factory=list)


class SpeechTurnResponse(BaseModel):
    source_lang: str
    target_lang: str
    scenario: str | None = None
    transcript: str
    normalized_request: str
    intent: Literal["translate_request", "unknown"]
    chinese: str | None = None
    pinyin: str | None = None
    notes: list[str] = Field(default_factory=list)
    audio: SpeechTurnAudio
    analysis: SpeechTurnAnalysis

    @model_validator(mode="after")
    def _validate_translation_fields(self) -> "SpeechTurnResponse":
        if self.intent == "translate_request":
            if self.chinese is None or self.pinyin is None:
                raise ValueError("chinese and pinyin are required for translate_request")
        return self
