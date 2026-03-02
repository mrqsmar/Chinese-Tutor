import os

from app.main import _resolve_voice_name
from app.services.speech_turn import SpeechTurnService


class _FailThenSucceedTTSClient:
    def __init__(self) -> None:
        self.calls: list[str] = []

    async def synthesize(self, text: str, target_lang: str, voice_name: str = "Kore"):
        self.calls.append(voice_name)
        if voice_name != "Kore":
            raise ValueError("voice unavailable")
        return (b"\x00\x00" * 100, {"sample_rate_hz": 24000, "channels": 1, "sample_width_bytes": 2})


def test_resolve_voice_name_map():
    assert _resolve_voice_name("warm") == "Kore"
    assert _resolve_voice_name("bright") == "Leda"
    assert _resolve_voice_name("deep") == "Puck"
    assert _resolve_voice_name("unknown") == "Kore"


def test_tts_fallback_to_default_voice(tmp_path):
    os.environ["ACCESS_TOKEN_SECRET"] = "test-access-secret"
    os.environ["REFRESH_TOKEN_SECRET"] = "test-refresh-secret"

    tts_client = _FailThenSucceedTTSClient()
    service = SpeechTurnService(
        stt_client=object(),
        tts_client=tts_client,
        text_client=object(),
        audio_dir=str(tmp_path),
    )

    import asyncio

    audio, audio_url, audio_mime, _, tts_error = asyncio.run(service.synthesize_audio(
        tts_text="你好",
        target_lang="zh",
        base_url="https://api.example.com",
        voice_name="Leda",
    ))

    assert tts_error is None
    assert audio is not None
    assert audio_mime == "audio/wav"
    assert audio_url and "/static/audio/" in audio_url
    assert tts_client.calls == ["Leda", "Kore"]
