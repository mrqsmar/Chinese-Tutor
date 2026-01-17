from __future__ import annotations

from fastapi import FastAPI
from pydantic import BaseModel, Field

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
