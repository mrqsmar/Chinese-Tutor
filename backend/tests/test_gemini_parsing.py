"""Unit tests for Gemini response parsing — no JWT or HTTP required."""
import json

import pytest

from app.models.speech_turn import SpeechTurnBreakdownItem
from app.services.speech_turn import (
    _build_response_parts,
    _coerce_character_breakdown,
    _has_character_level_breakdown,
    _is_parse_failure_result,
    _looks_like_translate_request,
    _parse_text_result,
    _salvage_translate_result_from_content,
)


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
    "breakdown": [
        {"text": "我", "pronunciation": "wǒ", "gloss": "I / me"},
        {"text": "想", "pronunciation": "xiǎng", "gloss": "want to"},
    ],
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
        assert result.breakdown[0].gloss == "I / me"

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

    def test_parse_failure_flag_detects_parse_fallback(self):
        result = _parse_text_result("not json at all", "How to ask someone out?")
        assert _is_parse_failure_result(result)


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


class TestCharacterBreakdownValidation:
    def test_accepts_one_row_per_character(self):
        assert _has_character_level_breakdown(
            "我爱你",
            [
                SpeechTurnBreakdownItem(text="我", pronunciation="wǒ", gloss="I / me"),
                SpeechTurnBreakdownItem(text="爱", pronunciation="ài", gloss="love"),
                SpeechTurnBreakdownItem(text="你", pronunciation="nǐ", gloss="you"),
            ],
        )

    def test_rejects_grouped_rows(self):
        assert not _has_character_level_breakdown(
            "我要三个烧卖",
            [
                SpeechTurnBreakdownItem(text="我", pronunciation="wǒ", gloss="I"),
                SpeechTurnBreakdownItem(text="要", pronunciation="yào", gloss="want"),
                SpeechTurnBreakdownItem(text="烧卖", pronunciation="shāo mài", gloss="siu mai"),
            ],
        )

    def test_coerces_grouped_rows_into_character_rows(self):
        items = _coerce_character_breakdown(
            chinese="我要三个烧卖",
            pinyin="wǒ yào sān gè shāo mài",
            breakdown=[
                SpeechTurnBreakdownItem(text="我", pronunciation="wǒ", gloss="I"),
                SpeechTurnBreakdownItem(text="要", pronunciation="yào", gloss="want"),
                SpeechTurnBreakdownItem(text="三", pronunciation="sān", gloss="three"),
                SpeechTurnBreakdownItem(text="个", pronunciation="gè", gloss="measure word"),
                SpeechTurnBreakdownItem(text="烧卖", pronunciation="shāo mài", gloss="siu mai"),
            ],
        )
        assert [item.text for item in items] == ["我", "要", "三", "个", "烧", "卖"]
        assert [item.pronunciation for item in items][-2:] == ["shāo", "mài"]
        assert [item.gloss for item in items][-2:] == ["siu mai", "siu mai"]


class TestTranslateHeuristic:
    def test_matches_generic_how_to_request(self):
        assert _looks_like_translate_request("How to order three dumplings?")

    def test_matches_generic_how_do_i_request(self):
        assert _looks_like_translate_request("How do I ask someone out?")


class TestFallbackSalvage:
    def test_salvages_embedded_json(self):
        result = _salvage_translate_result_from_content(
            'Here is the answer: {"target_text":"我想点三个饺子","pinyin":"wǒ xiǎng diǎn sān gè jiǎozi","notes":[]}',
            "How do I order three dumplings?",
        )
        assert result is not None
        assert result.target_text == "我想点三个饺子"

    def test_salvages_plain_text(self):
        result = _salvage_translate_result_from_content(
            "我想点三个饺子",
            "How do I order three dumplings?",
        )
        assert result is not None
        assert result.target_text == "我想点三个饺子"
        assert result.intent == "translate_request"

    def test_rejects_meta_json_preamble(self):
        result = _salvage_translate_result_from_content(
            "Here is the JSON requested",
            "How do I order three dumplings?",
        )
        assert result is None
