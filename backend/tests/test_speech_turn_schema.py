import io
import wave

from fastapi.testclient import TestClient

from app.main import app, get_speech_turn_service
from app.models.speech_turn import SpeechTurnAnalysis, SpeechTurnAudio, SpeechTurnResponse


class FakeSpeechTurnService:
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
        return SpeechTurnResponse(
            source_lang=source_lang,
            target_lang=target_lang,
            scenario=scenario,
            transcript="How do I say can I get char siu",
            normalized_request="How do I say: 'Can I get char siu?'",
            intent="translate_request",
            chinese="我可以来一份叉烧吗？",
            pinyin="Wǒ kěyǐ lái yí fèn chāshāo ma?",
            notes=[],
            audio=SpeechTurnAudio(format="mp3", url=f"{base_url}static/audio/mock.mp3"),
            analysis=SpeechTurnAnalysis(overall_score=None, phoneme_confidence=[]),
        )


def build_silence_wav() -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(16000)
        handle.writeframes(b"\x00\x00" * 800)
    return buffer.getvalue()


def test_speech_turn_schema():
    app.dependency_overrides[get_speech_turn_service] = lambda: FakeSpeechTurnService()
    client = TestClient(app)
    response = client.post(
        "/v1/speech/turn",
        files={"audio": ("sample.wav", build_silence_wav(), "audio/wav")},
    )

    app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    SpeechTurnResponse.model_validate(payload)
