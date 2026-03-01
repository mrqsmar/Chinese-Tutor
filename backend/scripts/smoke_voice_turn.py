#!/usr/bin/env python3
from __future__ import annotations

import argparse
import io
import json
import os
import time
import wave
from pathlib import Path

import httpx


def _build_silence_wav(duration_ms: int = 700, sample_rate: int = 16000) -> bytes:
    frames = int(sample_rate * (duration_ms / 1000))
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(b"\x00\x00" * frames)
    return buffer.getvalue()


def _require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required env var: {name}")
    return value


def _login(client: httpx.Client, base_url: str, username: str, password: str) -> str:
    response = client.post(
        f"{base_url}/auth/login",
        headers={"X-Client-Type": "mobile"},
        json={"username": username, "password": password},
    )
    response.raise_for_status()
    payload = response.json()
    token = payload.get("access_token")
    if not token:
        raise RuntimeError("Login did not return access_token")
    return token


def _poll_audio_job(
    client: httpx.Client,
    base_url: str,
    token: str,
    job_id: str,
    timeout_seconds: int,
) -> dict:
    headers = {"Authorization": f"Bearer {token}", "X-Client-Type": "mobile"}
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        response = client.get(f"{base_url}/v1/speech/audio/{job_id}", headers=headers)
        response.raise_for_status()
        payload = response.json()
        status = payload.get("status")
        if status in {"ready", "error"}:
            return payload
        time.sleep(1)
    raise TimeoutError(f"Audio job {job_id} did not complete within {timeout_seconds}s")


def main() -> int:
    parser = argparse.ArgumentParser(description="Smoke test /v1/speech/turn")
    parser.add_argument("--base-url", default=os.getenv("SMOKE_API_BASE_URL", "http://127.0.0.1:8000"))
    parser.add_argument("--username", default=os.getenv("SMOKE_AUTH_USER"))
    parser.add_argument("--password", default=os.getenv("SMOKE_AUTH_PASSWORD"))
    parser.add_argument("--audio", default="", help="Path to a wav/m4a file. If omitted, a short silent wav is generated.")
    parser.add_argument("--source-lang", default="en")
    parser.add_argument("--target-lang", default="zh")
    parser.add_argument("--scenario", default="restaurant")
    parser.add_argument("--voice", default="warm", choices=["warm", "bright", "deep"])
    parser.add_argument("--timeout-seconds", type=int, default=40)
    args = parser.parse_args()

    base_url = args.base_url.rstrip("/")
    username = args.username or _require_env("SMOKE_AUTH_USER")
    password = args.password or _require_env("SMOKE_AUTH_PASSWORD")

    audio_bytes: bytes
    audio_name: str
    audio_mime: str
    if args.audio:
        audio_path = Path(args.audio)
        if not audio_path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")
        audio_bytes = audio_path.read_bytes()
        audio_name = audio_path.name
        audio_mime = "audio/mp4" if audio_path.suffix.lower() == ".m4a" else "audio/wav"
    else:
        audio_bytes = _build_silence_wav()
        audio_name = "smoke.wav"
        audio_mime = "audio/wav"

    with httpx.Client(timeout=60.0) as client:
        token = _login(client, base_url, username, password)
        headers = {"Authorization": f"Bearer {token}", "X-Client-Type": "mobile"}
        response = client.post(
            f"{base_url}/v1/speech/turn",
            headers=headers,
            data={
                "level": "beginner",
                "scenario": args.scenario,
                "source_lang": args.source_lang,
                "target_lang": args.target_lang,
                "voice": args.voice,
            },
            files={"audio": (audio_name, audio_bytes, audio_mime)},
        )
        response.raise_for_status()
        payload = response.json()

    result = {
        "status": "ok",
        "intent": payload.get("intent"),
        "transcript": payload.get("transcript"),
        "assistant_text": payload.get("assistant_text"),
        "tts_error": payload.get("tts_error"),
        "audio_ready": bool(payload.get("audio") or payload.get("audio_url") or payload.get("audio_base64")),
        "audio_pending": payload.get("audio_pending"),
    }

    if payload.get("audio_pending") and payload.get("audio_job_id"):
        with httpx.Client(timeout=30.0) as client:
            job_payload = _poll_audio_job(
                client=client,
                base_url=base_url,
                token=token,
                job_id=str(payload["audio_job_id"]),
                timeout_seconds=args.timeout_seconds,
            )
        result["audio_job"] = {
            "status": job_payload.get("status"),
            "tts_error": job_payload.get("tts_error"),
            "audio_ready": bool(job_payload.get("audio_url") or job_payload.get("audio_base64")),
        }

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
