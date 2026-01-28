from __future__ import annotations
from dotenv import load_dotenv

import os
from typing import Literal

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

load_dotenv()

app = FastAPI(title="Chinese Tutor API", version="0.1.0")


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
async def chat(request: ChatRequest) -> ChatResponse:
    message = request.message.strip()
    if request.level == "intermediate":
        response = _build_intermediate_response(message)
    else:
        response = _build_beginner_response(message)

    if _contains_chinese(message):
        response.reply = response.reply.replace("我们可以", "我们也可以")
    return response


@app.post("/api/chat", response_model=LLMChatResponse)
async def llm_chat(request: LLMChatRequest) -> LLMChatResponse:
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
