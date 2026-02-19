from __future__ import annotations
from dotenv import load_dotenv

load_dotenv()

from uuid import uuid4
from datetime import datetime, timezone
import asyncio
import logging
import time
import wave

import os
from typing import Literal

import httpx
import tempfile

from fastapi import (
    Body,
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from app.models.speech_turn import SpeechTurnAnalysis, SpeechTurnResponse
from app.security import (
    AuthContext,
    add_redaction_filter,
    create_audio_token,
    get_auth_context,
    get_default_roles,
    issue_tokens,
    require_roles,
    require_scopes,
    revoke_refresh_token,
    rotate_refresh_token,
    verify_audio_token,
    verify_password,
)
from app.services.gemini_stt import GeminiSTTClient
from app.services.gemini_tts import GeminiTTSClient
from app.services.speech_turn import (
    GeminiSpeechTurnTextClient,
    SpeechTurnService,
    _build_response_parts,
)

add_redaction_filter()

app = FastAPI(title="Chinese Tutor API", version="0.1.0")
_speech_service: SpeechTurnService | None = None    
logger = logging.getLogger(__name__)

AUDIO_DIR = os.path.join(tempfile.gettempdir(), "chinese_tutor_audio")
os.makedirs(AUDIO_DIR, exist_ok=True)
AUDIO_JOBS: dict[str, dict[str, str | None]] = {}

MAX_AUDIO_BYTES = int(os.getenv("MAX_AUDIO_BYTES", "10485760"))
ENVIRONMENT = os.getenv("ENVIRONMENT", "development").lower()
IS_PRODUCTION = ENVIRONMENT == "production"

COOKIE_NAME = "refresh_token"

VOICE_NAME_MAP = {
    "warm": "Kore",
    "bright": "Leda",
    "deep": "Puck",
}


def _resolve_voice_name(voice: str) -> str:
    return VOICE_NAME_MAP.get((voice or "warm").lower(), "Kore")


class RateLimiter:
    def __init__(self) -> None:
        self._requests: dict[str, list[float]] = {}

    def check(self, key: str, limit: int, window_seconds: int) -> None:
        now = time.time()
        window_start = now - window_seconds
        timestamps = [t for t in self._requests.get(key, []) if t >= window_start]
        if len(timestamps) >= limit:
            raise HTTPException(status_code=429, detail="Too many requests.")
        timestamps.append(now)
        self._requests[key] = timestamps


rate_limiter = RateLimiter()


def _client_key(request: Request, suffix: str) -> str:
    host = request.client.host if request.client else "unknown"
    return f"{host}:{suffix}"


def _is_https_request(request: Request) -> bool:
    forwarded = request.headers.get("x-forwarded-proto")
    if forwarded:
        return forwarded == "https"
    return request.url.scheme == "https"


def _require_https(request: Request) -> None:
    if IS_PRODUCTION and not _is_https_request(request):
        raise HTTPException(status_code=400, detail="HTTPS is required.")


def _cors_origins() -> list[str]:
    raw = os.getenv("CORS_ALLOWED_ORIGINS", "")
    origins = [o.strip() for o in raw.split(",") if o.strip()]
    if not IS_PRODUCTION:
        origins.extend(
            [
                "http://localhost:19006",
                "http://127.0.0.1:19006",
                "http://localhost:3000",
                "http://127.0.0.1:3000",
                "http://localhost:8081",
                "http://127.0.0.1:8081",
            ]
        )
    return list(dict.fromkeys(origins))


allowed_origins = _cors_origins()
if allowed_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type", "Accept", "X-Client-Type"],
    )

DOC_PATHS = {"/docs", "/openapi.json", "/redoc"}

@app.middleware("http")
async def security_headers(request: Request, call_next):
    _require_https(request)

    response = await call_next(request)

    response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=()"
    response.headers["X-Frame-Options"] = "DENY"

    if request.url.path in DOC_PATHS:
        # allow Swagger UI assets + inline script/styles used by docs page
        response.headers["Content-Security-Policy"] = (
            "default-src 'self' https:; "
            "img-src 'self' https: data:; "
            "style-src 'self' https: 'unsafe-inline'; "
            "script-src 'self' https: 'unsafe-inline'; "
            "connect-src 'self' http: https: ws:; "
            "frame-ancestors 'none';"
        )
    else:
        # strict by default for your API responses
        response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none';"

    return response


@app.middleware("http")
async def body_limit_middleware(request: Request, call_next):
    if request.url.path in {"/v1/speech/turn", "/speech_turn"}:
        content_length = request.headers.get("content-length")
        if content_length and int(content_length) > MAX_AUDIO_BYTES:
            return JSONResponse(status_code=413, content={"detail": "Audio upload too large."})
    return await call_next(request)


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, description="User input in English, Chinese, or mixed.")
    level: str = Field("beginner", pattern="^(beginner|intermediate)$")


class KeyPoint(BaseModel):
    phrase: str
    pinyin: str
    meaning: str


class Teaching(BaseModel):
    translation: str
    pinyin: str
    key_points: list[KeyPoint]
    alternatives: list[str]
    follow_up: str


class ChatResponse(BaseModel):
    reply: str
    teaching: Teaching


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1)


class LLMChatRequest(BaseModel):
    speaker: Literal["english", "chinese"]
    messages: list[ChatMessage]


class LLMChatResponse(BaseModel):
    reply: str


class SpeechAudioJobResponse(BaseModel):
    status: Literal["pending", "ready", "error"]
    audio_url: str | None = None
    audio_base64: str | None = None
    audio_mime: str | None = None
    tts_error: str | None = None


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=200)
    password: str = Field(..., min_length=8, max_length=200)


class LoginResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    refresh_token: str | None = None


def _set_refresh_cookie(response: JSONResponse, token: str | None) -> None:
    if token is None:
        response.delete_cookie(COOKIE_NAME, path="/")
        return
    response.set_cookie(
        COOKIE_NAME,
        token,
        httponly=True,
        secure=IS_PRODUCTION,
        samesite="lax",
        path="/",
        max_age=int(60 * 60 * 24 * 30),
    )


@app.post("/auth/login", response_model=LoginResponse)
async def login(request: Request, payload: LoginRequest) -> LoginResponse:
    rate_limiter.check(_client_key(request, "login"), limit=5, window_seconds=60)
    _require_https(request)
    if not verify_password(payload.username, payload.password):
        raise HTTPException(status_code=401, detail="Invalid credentials.")
    roles = get_default_roles(payload.username)
    scopes = ["chat:write", "speech:write"]
    tokens = issue_tokens(payload.username, roles=roles, scopes=scopes)
    expires_in = int(
        (tokens["access_expires_at"] - datetime.now(timezone.utc)).total_seconds()
    )
    response_payload = LoginResponse(
        access_token=tokens["access_token"],
        expires_in=max(expires_in, 0),
        refresh_token=None,
    )
    response = JSONResponse(content=response_payload.model_dump())
    client_type = request.headers.get("x-client-type", "mobile")
    if client_type == "web":
        _set_refresh_cookie(response, tokens["refresh_token"])
    else:
        response_payload.refresh_token = tokens["refresh_token"]
        response = JSONResponse(content=response_payload.model_dump())
    return response


@app.post("/auth/refresh", response_model=LoginResponse)
async def refresh(
    request: Request, refresh_token: str | None = Body(default=None, embed=True)
) -> LoginResponse:
    rate_limiter.check(_client_key(request, "refresh"), limit=10, window_seconds=60)
    _require_https(request)
    token = refresh_token or request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Missing refresh token.")
    tokens = rotate_refresh_token(token)
    expires_in = int(
        (tokens["access_expires_at"] - datetime.now(timezone.utc)).total_seconds()
    )
    response_payload = LoginResponse(
        access_token=tokens["access_token"],
        expires_in=max(expires_in, 0),
        refresh_token=None,
    )
    response = JSONResponse(content=response_payload.model_dump())
    client_type = request.headers.get("x-client-type", "mobile")
    if client_type == "web":
        _set_refresh_cookie(response, tokens["refresh_token"])
    else:
        response_payload.refresh_token = tokens["refresh_token"]
        response = JSONResponse(content=response_payload.model_dump())
    return response


@app.post("/auth/logout")
async def logout(
    request: Request, refresh_token: str | None = Body(default=None, embed=True)
) -> dict[str, bool]:
    _require_https(request)
    token = refresh_token or request.cookies.get(COOKIE_NAME)
    if token:
        revoke_refresh_token(token)
    response = JSONResponse(content={"ok": True})
    _set_refresh_cookie(response, None)
    return response


@app.get("/health")
async def health(_: AuthContext = Depends(get_auth_context)) -> dict[str, bool]:
    return {"ok": True}


@app.get("/debug/tts")
async def debug_tts(
    text: str = "你好",
    target_lang: str = "zh",
    _: AuthContext = Depends(require_roles("admin")),
) -> dict[str, str]:
    """
    Quick backend-only test:
    - Generates TTS audio for `text`
    - Saves a .wav under AUDIO_DIR
    - Returns a URL under /static/audio that should be playable
    """
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="Gemini API key not configured.")

    tts_client = GeminiTTSClient(api_key=api_key)

    try:
        pcm_bytes, meta = await tts_client.synthesize(text, target_lang)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"TTS failed: {type(exc).__name__}: {exc}")

    sample_rate = int(meta.get("sample_rate_hz", 24000))
    channels = int(meta.get("channels", 1))
    sampwidth = int(meta.get("sample_width_bytes", 2))

    filename = f"{uuid4().hex}.wav"
    file_path = os.path.join(AUDIO_DIR, filename)

    with wave.open(file_path, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(sampwidth)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm_bytes)

    return {
        "text": text,
        "audio_url": f"/static/audio/{filename}?token={create_audio_token(filename)}",
    }


@app.get("/static/audio/{filename}")
async def audio_file(filename: str, token: str) -> FileResponse:
    verify_audio_token(token, filename)
    file_path = os.path.join(AUDIO_DIR, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Audio not found.")
    return FileResponse(file_path, media_type="audio/wav")


def get_speech_turn_service() -> SpeechTurnService:
    global _speech_service
    if _speech_service is not None:
        return _speech_service

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="Gemini API key not configured.")

    stt_client = GeminiSTTClient(api_key=api_key)
    tts_client = GeminiTTSClient(api_key=api_key)
    text_client = GeminiSpeechTurnTextClient(api_key=api_key)

    _speech_service = SpeechTurnService(
        stt_client=stt_client,
        tts_client=tts_client,
        text_client=text_client,
        audio_dir=AUDIO_DIR,
    )
    return _speech_service


def _contains_chinese(text: str) -> bool:
    return any("\u4e00" <= char <= "\u9fff" for char in text)


def _simplify_topic(text: str) -> str:
    words = [word.strip(".,!? ") for word in text.split() if word.strip(".,!? ")]
    if not words:
        return "日常生活"
    return words[0].lower()


def _build_beginner_response(message: str) -> ChatResponse:
    topic = _simplify_topic(message)
    reply = f"你好！我们可以聊聊{topic}。你今天怎么样？"
    teaching = Teaching(
        translation=f"Hi! We can talk about {topic}. How are you today?",
        pinyin="Nǐ hǎo! Wǒmen kěyǐ liáo liáo " + f"{topic}。 Nǐ jīntiān zěnme yàng?",
        key_points=[
            KeyPoint(phrase="你好", pinyin="Nǐ hǎo", meaning="Hello"),
            KeyPoint(phrase="我们可以", pinyin="Wǒmen kěyǐ", meaning="We can"),
            KeyPoint(phrase="怎么样", pinyin="Zěnme yàng", meaning="How (is it)"),
        ],
        alternatives=["我们聊点别的吧。", "你想聊什么？"],
        follow_up="用中文回答：你今天感觉如何？",
    )
    return ChatResponse(reply=reply, teaching=teaching)


def _build_intermediate_response(message: str) -> ChatResponse:
    topic = _simplify_topic(message)
    reply = f"明白了。我们可以深入聊聊{topic}，你最感兴趣的部分是什么？"
    teaching = Teaching(
        translation=(
            "Got it. We can talk more in depth about "
            f"{topic}. Which part interests you most?"
        ),
        pinyin=(
            "Míngbai le. Wǒmen kěyǐ shēnrù liáo liáo "
            f"{topic}，nǐ zuì gǎn xìngqù de bùfen shì shénme?"
        ),
        key_points=[
            KeyPoint(phrase="明白了", pinyin="Míngbai le", meaning="Got it"),
            KeyPoint(phrase="深入", pinyin="Shēnrù", meaning="In depth"),
            KeyPoint(phrase="感兴趣", pinyin="Gǎn xìngqù", meaning="Interested"),
        ],
        alternatives=["我们换个话题吧。", "你想先从哪里开始？"],
        follow_up="试着用中文描述你最感兴趣的一点。",
    )
    return ChatResponse(reply=reply, teaching=teaching)


def _build_system_prompt(speaker: Literal["english", "chinese"]) -> str:
    base = (
        "You are a Chinese language tutor. Only help with Chinese ↔ English learning: "
        "translation, vocabulary, grammar, pronunciation (pinyin), and usage examples. "
        "If the user asks about unrelated topics (politics, health, coding, math, etc.), "
        "politely refuse and redirect them to a language-learning alternative. "
        "Keep replies concise, conversational, and tutor-like. "
        "Keep replies to a maximum of 4 lines. "
        "If more info is needed, ask ONE short follow-up question and wait. "
        "Always include: Chinese, Pinyin, and a short English explanation. "
        "Do NOT include character breakdowns. "
        "Do NOT include multiple examples or long explanations unless the user asks for more detail. "
        "Provide only one example or tip at a time; do not give multiple examples or tips. "
        "Split teaching across multiple back-and-forth turns, covering one concept at a time. "
        "End most responses with a short optional nudge (e.g., “Want an example?”, “Want to practice?”, “Want a casual version?”)."
    )

    if speaker == "english":
        return (
            base
            + " Explain in English, include Chinese examples, and provide pinyin for Chinese."
        )

    return (
        "你是一位中文导师。你的任务仅限于中文↔英文学习：翻译、词汇、语法、发音（拼音）与例句。"
        "如果用户问与语言学习无关的话题（政治、健康、编程、数学等），请礼貌拒绝，并引导回到语言学习任务（例如翻译一句话、解释一个短语）。"
        "保持简洁、对话式、像导师一样。"
        "每次回复最多4行。"
        "如果需要更多信息，只问一个简短的追问并等待。"
        "务必包含：中文、拼音、简短英文解释。"
        "不要做汉字拆解。"
        "除非用户要求更多细节，否则不要给多个例子或长解释。"
        "一次只给一个例子或提示，不要给多个。"
        "把教学拆成多轮对话，每次只讲一个点。"
        "大多数回复以简短可选的引导结尾（例如“要例句吗？/要练习吗？/要更口语的版本吗？”）。"
    )


@app.post("/chat", response_model=ChatResponse)
async def chat(
    request: ChatRequest, _: AuthContext = Depends(require_scopes("chat:write"))
) -> ChatResponse:
    message = request.message.strip()
    if request.level == "intermediate":
        response = _build_intermediate_response(message)
    else:
        response = _build_beginner_response(message)

    if _contains_chinese(message):
        response.reply = response.reply.replace("我们可以", "我们也可以")
    return response


@app.post("/api/chat", response_model=LLMChatResponse)
async def llm_chat(
    request: LLMChatRequest, _: AuthContext = Depends(require_scopes("chat:write"))
) -> LLMChatResponse:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="Gemini API key not configured.")

    system_prompt = _build_system_prompt(request.speaker)
    payload = {
        "systemInstruction": {"parts": [{"text": system_prompt}]},
        "generationConfig": {"maxOutputTokens": 160},
        "contents": [
            {
                "role": "model" if message.role == "assistant" else "user",
                "parts": [{"text": message.content}],
            }
            for message in request.messages
        ],
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
            headers={
                "Content-Type": "application/json",
            },
            params={"key": api_key},
            json=payload,
        )

    if response.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Gemini error: {response.status_code}: {response.text}",
        )

    data = response.json()
    content = (
        data.get("candidates", [{}])[0]
        .get("content", {})
        .get("parts", [{}])[0]
        .get("text")
    )
    if not content:
        raise HTTPException(status_code=502, detail="Gemini returned no content.")

    return LLMChatResponse(reply=content)


async def _speech_turn_handler(
    request: Request,
    audio: UploadFile,
    level: str,
    scenario: str,
    source_lang: str,
    target_lang: str,
    voice: str,
    service: SpeechTurnService,
    auth: AuthContext,
) -> SpeechTurnResponse:
    request_start = time.perf_counter()
    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Audio file is empty.")
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Audio upload too large.")
    mime_type = audio.content_type
    if not mime_type:
        if (audio.filename or "").endswith(".m4a"):
            mime_type = "audio/mp4"
        else:
            mime_type = "application/octet-stream"
    logger.info(
        "Speech turn upload received: filename=%s content_type=%s bytes=%s",
        audio.filename,
        mime_type,
        len(audio_bytes),
    )
    base_url = os.getenv("PUBLIC_BASE_URL") or str(request.base_url)
    voice_name = _resolve_voice_name(voice)

    transcript, text_result, stt_ms, llm_ms = await service.run_stt_and_llm(
        audio_bytes=audio_bytes,
        mime_type=mime_type,
        source_lang=source_lang,
        target_lang=target_lang,
        scenario=scenario,
    )
    chinese, pinyin, notes, tts_text = _build_response_parts(transcript, text_result)
    elapsed_ms = (time.perf_counter() - request_start) * 1000

    if elapsed_ms > 15000:
        job_id = uuid4().hex
        AUDIO_JOBS[job_id] = {
            "status": "pending",
            "audio_url": None,
            "audio_base64": None,
            "audio_mime": None,
            "tts_error": None,
            "owner_id": auth.user_id,
        }
        logger.info(
            "Speech turn pending audio job=%s stt_ms=%.1f llm_ms=%.1f total_ms=%.1f",
            job_id,
            stt_ms,
            llm_ms,
            elapsed_ms,
        )

        async def _run_audio_job() -> None:
            audio, audio_url, audio_mime, tts_ms, tts_error = await service.synthesize_audio(
                tts_text=tts_text,
                target_lang=target_lang,
                base_url=base_url,
                voice_name=voice_name,
            )
            AUDIO_JOBS[job_id] = {
                "status": "ready" if audio_url else "error",
                "audio_url": audio_url,
                "audio_base64": audio.base64 if audio else None,
                "audio_mime": audio_mime,
                "tts_error": tts_error,
                "owner_id": auth.user_id,
            }
            total_ms = (time.perf_counter() - request_start) * 1000
            logger.info(
                "Speech turn audio job=%s tts_ms=%.1f total_ms=%.1f",
                job_id,
                tts_ms,
                total_ms,
            )

        asyncio.create_task(_run_audio_job())

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
            audio=None,
            audio_url=None,
            audio_base64=None,
            audio_mime=None,
            audio_job_id=job_id,
            audio_pending=True,
            tts_error=None,
            analysis=SpeechTurnAnalysis(overall_score=None, phoneme_confidence=[]),
        )

    audio, audio_url, audio_mime, tts_ms, tts_error = await service.synthesize_audio(
        tts_text=tts_text,
        target_lang=target_lang,
        base_url=base_url,
        voice_name=voice_name,
    )
    total_ms = (time.perf_counter() - request_start) * 1000
    logger.info(
        "Speech turn timings stt_ms=%.1f llm_ms=%.1f tts_ms=%.1f total_ms=%.1f",
        stt_ms,
        llm_ms,
        tts_ms,
        total_ms,
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
        audio=audio,
        audio_url=audio_url,
        audio_base64=audio.base64 if audio else None,
        audio_mime=audio_mime,
        audio_job_id=None,
        audio_pending=False,
        tts_error=tts_error,
        analysis=SpeechTurnAnalysis(overall_score=None, phoneme_confidence=[]),
    )


@app.post("/v1/speech/turn", response_model=SpeechTurnResponse)
async def speech_turn(
    request: Request,
    audio: UploadFile = File(...),
    level: str = Form("beginner"),
    scenario: str = Form("restaurant"),
    source_lang: str = Form("en"),
    target_lang: str = Form("zh"),
    voice: str = Form("warm"),
    service: SpeechTurnService = Depends(get_speech_turn_service),
    auth: AuthContext = Depends(require_scopes("speech:write")),
) -> SpeechTurnResponse:
    rate_limiter.check(_client_key(request, "speech_turn"), limit=10, window_seconds=60)
    return await _speech_turn_handler(
        request=request,
        audio=audio,
        level=level,
        scenario=scenario,
        source_lang=source_lang,
        target_lang=target_lang,
        voice=voice,
        service=service,
        auth=auth,
    )


@app.post("/speech_turn", response_model=SpeechTurnResponse)
async def speech_turn_alias(
    request: Request,
    audio: UploadFile = File(...),
    level: str = Form("beginner"),
    scenario: str = Form("restaurant"),
    source_lang: str = Form("en"),
    target_lang: str = Form("zh"),
    voice: str = Form("warm"),
    service: SpeechTurnService = Depends(get_speech_turn_service),
    auth: AuthContext = Depends(require_scopes("speech:write")),
) -> SpeechTurnResponse:
    rate_limiter.check(_client_key(request, "speech_turn"), limit=10, window_seconds=60)
    return await _speech_turn_handler(
        request=request,
        audio=audio,
        level=level,
        scenario=scenario,
        source_lang=source_lang,
        target_lang=target_lang,
        voice=voice,
        service=service,
        auth=auth,
    )


@app.get("/v1/speech/audio/{job_id}", response_model=SpeechAudioJobResponse)
async def speech_audio_job(
    job_id: str, auth: AuthContext = Depends(require_scopes("speech:write"))
) -> SpeechAudioJobResponse:
    job = AUDIO_JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Audio job not found.")
    if job.get("owner_id") != auth.user_id and "admin" not in auth.roles:
        raise HTTPException(status_code=403, detail="Not authorized.")
    return SpeechAudioJobResponse(
        status=job.get("status") or "pending",
        audio_url=job.get("audio_url"),
        audio_base64=job.get("audio_base64"),
        audio_mime=job.get("audio_mime"),
        tts_error=job.get("tts_error"),
    )
