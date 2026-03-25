from app.main import (
    _is_structured_beginner_reply,
    _normalize_structured_reply,
)


def test_is_structured_beginner_reply_accepts_valid_format() -> None:
    text = (
        "Chinese: 一，二，三\n"
        "Pinyin: yī, èr, sān\n"
        "Meaning: 1, 2, 3\n"
    )
    assert _is_structured_beginner_reply(text) is True


def test_is_structured_beginner_reply_rejects_vague_text() -> None:
    text = "Here's how to say 1, 2, 3 in Chinese."
    assert _is_structured_beginner_reply(text) is False


def test_normalize_structured_reply_converts_english_label_to_meaning() -> None:
    text = (
        "Chinese: 你好\n"
        "Pinyin: nǐ hǎo\n"
        "English: hello\n"
        "Example: 你好，老师。\n"
    )
    normalized = _normalize_structured_reply(text)
    assert "Meaning: hello" in normalized
    assert "English:" not in normalized
