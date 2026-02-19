import io
import wave

import os

from fastapi.testclient import TestClient

from app.main import app, get_speech_turn_service
from app.security import issue_tokens
from app.models.speech_turn import SpeechTurnAnalysis, SpeechTurnAudio, SpeechTurnResponse


class FakeTextResult:
    normalized_request = "How do I say: 'Can I get char siu?'"
    intent = "translate_request"
    chinese = "我可以来一份叉烧吗？"
    pinyin = "Wǒ kěyǐ lái yí fèn chāshāo ma?"
    notes = ["Mocked response"]
    target_text = "我可以来一份叉烧吗？"
    romanization = "Wǒ kěyǐ lái yí fèn chāshāo ma?"


class FakeSpeechTurnService:
    async def run_stt_and_llm(
        self,
        *,
        audio_bytes: bytes,
        mime_type: str,
        source_lang: str,
        target_lang: str,
        scenario: str | None,
    ):
        return (
            "How do I say can I get char siu",
            FakeTextResult(),
            10.0,
            20.0,
        )

    async def synthesize_audio(
        self, *, tts_text: str, target_lang: str, base_url: str, voice_name: str = "Kore"
    ):
    async def synthesize_audio(self, *, tts_text: str, target_lang: str, base_url: str):
        return (
            SpeechTurnAudio(format="mp3", url=f"{base_url}static/audio/mock.mp3"),
            f"{base_url}static/audio/mock.mp3",
            "audio/mpeg",
            15.0,
            None,
        )



def _auth_headers() -> dict[str, str]:
    os.environ["ACCESS_TOKEN_SECRET"] = "test-access-secret"
    os.environ["REFRESH_TOKEN_SECRET"] = "test-refresh-secret"
    tokens = issue_tokens("test-user", roles=["user"], scopes=["speech:write"])
    return {"Authorization": f"Bearer {tokens['access_token']}"}
def build_silence_wav() -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(16000)
        handle.writeframes(b"\x00\x00" * 800)
    return buffer.getvalue()


def test_speech_turn_contract():
    app.dependency_overrides[get_speech_turn_service] = lambda: FakeSpeechTurnService()
    client = TestClient(app)
    response = client.post(
        "/v1/speech/turn",
        data={"scenario": "restaurant"},
        headers=_auth_headers(),
        files={"audio": ("sample.wav", build_silence_wav(), "audio/wav")},
    )

    app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert "transcript" in payload
    assert "chinese" in payload
    assert "pinyin" in payload
    assert "audio" in payload
    assert payload["audio"].get("url") or payload["audio"].get("base64")
    assert payload["analysis"]["overall_score"] is None
    assert isinstance(payload["analysis"]["phoneme_confidence"], list)
