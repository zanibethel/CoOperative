# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "faster-whisper>=1.2.0",
# ]
# ///

"""Local speech-to-text helper for CoOperative Personal AI."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from faster_whisper import WhisperModel


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: windows-local-voice.py <audio-file>")

    audio_path = Path(sys.argv[1]).resolve()
    if not audio_path.is_file():
        raise RuntimeError("Audio file does not exist.")

    cache_dir = Path(__file__).resolve().parent / "models" / "whisper"
    cache_dir.mkdir(parents=True, exist_ok=True)

    model = WhisperModel(
        "base.en",
        device="cpu",
        compute_type="int8",
        download_root=str(cache_dir),
    )
    segments, info = model.transcribe(
        str(audio_path),
        beam_size=3,
        vad_filter=True,
    )
    text = " ".join(segment.text.strip() for segment in segments if segment.text.strip()).strip()
    print(json.dumps({
        "text": text,
        "language": info.language,
        "languageProbability": info.language_probability,
        "model": "faster-whisper-base.en",
    }))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)[:800]}))
        raise SystemExit(1)
