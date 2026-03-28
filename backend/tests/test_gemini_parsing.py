"""Unit tests for Gemini response parsing — no JWT or HTTP required."""
import json

import pytest

from app.services.speech_turn import _parse_text_result, _build_response_parts


# ---------------------------------------------------------------------------
# Helpers that simulate the Gemini API response structure
# ---------------------------------------------------------------------------

def _gemini_response(parts: list[dict]) -> dict:
    """Wrap parts in a minimal Gemini generateContent response envelope."""
    return {"candidates": [{"content": {"parts": parts}}]}


def _extract_content(data: dict) -> str | None:
    """Mirrors the fixed extraction logic in speech_turn.py."""
    parts = (
        data.get("candidates", [{}])[0]
        .get("content", {})
        .get("parts", [{}])
    )
    return next(
        (p.get("text") for p in parts if not p.get("thought") and p.get("text")),
        None,
    )


VALID_JSON = json.dumps({
    "normalized_request": "How do I say: 'I want to ask a girl out on a date'?",
    "intent": "translate_request",
    "target_text": "我想约你出去约会",
    "romanization": "wǒ xiǎng yuē nǐ chūqù yuēhuì",
    "chinese": "我想约你出去约会",
    "pinyin": "wǒ xiǎng yuē nǐ chūqù yuēhuì",
    "notes": ["Romantic phrasing; tone 3 on 想 (xiǎng)"],
})


# ---------------------------------------------------------------------------
# Part extraction — the core of the thinking-token fix
# ---------------------------------------------------------------------------

class TestGeminiPartExtraction:
    def test_plain_response_returns_text(self):
        data = _gemini_response([{"text": VALID_JSON}])
        assert _extract_content(data) == VALID_JSON

    def test_thinking_token_first_skipped(self):
        """Gemini 2.5-flash prepends a thought part; extraction must skip it."""
        data = _gemini_response([
            {"thought": True, "text": "Let me think about this translation..."},
            {"text": VALID_JSON},
        ])
        assert _extract_content(data) == VALID_JSON

    def test_multiple_thinking_tokens_skipped(self):
        data = _gemini_response([
            {"thought": True, "text": "First thought"},
            {"thought": True, "text": "Second thought"},
            {"text": VALID_JSON},
        ])
        assert _extract_content(data) == VALID_JSON

    def test_only_thinking_tokens_returns_none(self):
        data = _gemini_response([
            {"thought": True, "text": "Only thinking, no answer"},
        ])
        assert _extract_content(data) is None

    def test_empty_parts_returns_none(self):
        data = _gemini_response([])
        assert _extract_content(data) is None

    def test_missing_candidates_returns_none(self):
        assert _extract_content({}) is None


# ---------------------------------------------------------------------------
# _parse_text_result — JSON → SpeechTurnTextResult
# ---------------------------------------------------------------------------

class TestParseTextResult:
    def test_valid_translate_request(self):
        result = _parse_text_result(VALID_JSON, "I want to ask a girl out")
        assert result.intent == "translate_request"
        assert result.chinese == "我想约你出去约会"
        assert result.pinyin == "wǒ xiǎng yuē nǐ chūqù yuēhuì"
        assert len(result.notes) == 1

    def test_unknown_intent_clears_chinese(self):
        payload = json.dumps({
            "normalized_request": "Hello",
            "intent": "unknown",
            "target_text": "",
            "romanization": "",
            "chinese": "你好",
            "pinyin": "nǐ hǎo",
            "notes": [],
        })
        result = _parse_text_result(payload, "Hello")
        assert result.intent == "unknown"
        assert result.chinese == ""
        assert result.pinyin == ""

    def test_invalid_json_returns_fallback(self):
        """Thinking token text (non-JSON) must fall back gracefully."""
        result = _parse_text_result(
            "Let me think about how to translate this phrase...",
            "I want to ask a girl out",
        )
        assert result.intent == "unknown"
        assert result.chinese == ""
        assert result.pinyin == ""
        assert any("Unable to parse" in n for n in result.notes)

    def test_markdown_wrapped_json_is_stripped(self):
        wrapped = f"```json\n{VALID_JSON}\n```"
        result = _parse_text_result(wrapped, "test")
        assert result.intent == "translate_request"
        assert result.chinese == "我想约你出去约会"

    def test_truncated_json_returns_fallback(self):
        truncated = VALID_JSON[:40]  # cut mid-object
        result = _parse_text_result(truncated, "test")
        assert result.intent == "unknown"
        assert any("Unable to parse" in n for n in result.notes)


# ---------------------------------------------------------------------------
# _build_response_parts — assembles final chinese/pinyin/tts_text
# ---------------------------------------------------------------------------

class TestBuildResponseParts:
    def test_translate_request_with_chinese(self):
        result = _parse_text_result(VALID_JSON, "test")
        chinese, pinyin, notes, tts_text = _build_response_parts("test", result)
        assert chinese == "我想约你出去约会"
        assert pinyin == "wǒ xiǎng yuē nǐ chūqù yuēhuì"
        assert tts_text == "我想约你出去约会"

    def test_translate_request_missing_chinese_adds_note(self):
        payload = json.dumps({
            "normalized_request": "test",
            "intent": "translate_request",
            "target_text": "",
            "romanization": "",
            "chinese": "",
            "pinyin": "",
            "notes": [],
        })
        result = _parse_text_result(payload, "test")
        chinese, pinyin, notes, tts_text = _build_response_parts("test", result)
        assert chinese == ""
        assert any("incomplete" in n.lower() for n in notes)
        assert tts_text == "I heard: test"
