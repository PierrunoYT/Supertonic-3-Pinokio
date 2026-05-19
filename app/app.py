import argparse
import time
from functools import lru_cache
from pathlib import Path
from typing import Optional

import gradio as gr
import numpy as np
from supertonic import TTS


SAMPLE_RATE = 44100
VOICE_CHOICES = ["M1", "M2", "M3", "M4", "M5", "F1", "F2", "F3", "F4", "F5"]
LANGUAGE_CHOICES = [
    ("Auto / fallback", "na"),
    ("Arabic", "ar"),
    ("Bulgarian", "bg"),
    ("Croatian", "hr"),
    ("Czech", "cs"),
    ("Danish", "da"),
    ("Dutch", "nl"),
    ("English", "en"),
    ("Estonian", "et"),
    ("Finnish", "fi"),
    ("French", "fr"),
    ("German", "de"),
    ("Greek", "el"),
    ("Hindi", "hi"),
    ("Hungarian", "hu"),
    ("Indonesian", "id"),
    ("Italian", "it"),
    ("Japanese", "ja"),
    ("Korean", "ko"),
    ("Latvian", "lv"),
    ("Lithuanian", "lt"),
    ("Polish", "pl"),
    ("Portuguese", "pt"),
    ("Romanian", "ro"),
    ("Russian", "ru"),
    ("Slovak", "sk"),
    ("Slovenian", "sl"),
    ("Spanish", "es"),
    ("Swedish", "sv"),
    ("Turkish", "tr"),
    ("Ukrainian", "uk"),
    ("Vietnamese", "vi"),
]


@lru_cache(maxsize=1)
def get_tts() -> TTS:
    return TTS(auto_download=True)


@lru_cache(maxsize=len(VOICE_CHOICES))
def get_builtin_style(voice: str):
    return get_tts().get_voice_style(voice_name=voice)


def get_style(voice: str, custom_style_path: Optional[str]):
    if custom_style_path:
        return get_tts().get_voice_style_from_path(str(Path(custom_style_path)))
    return get_builtin_style(voice)


def synthesize(
    text: str,
    voice: str,
    language: str,
    total_steps: int,
    speed: float,
    max_chunk_length: int,
    silence_duration: float,
    custom_style_file: Optional[str],
):
    text = (text or "").strip()
    if len(text) < 1:
        raise gr.Error("Enter some text to synthesize.")

    start_time = time.perf_counter()
    style = get_style(voice, custom_style_file)
    wav, duration = get_tts().synthesize(
        text=text,
        voice_style=style,
        total_steps=int(total_steps),
        speed=float(speed),
        max_chunk_length=int(max_chunk_length),
        silence_duration=float(silence_duration),
        lang=language,
        verbose=False,
    )
    elapsed = time.perf_counter() - start_time

    audio = np.asarray(wav, dtype=np.float32)
    duration_seconds = float(np.asarray(duration).reshape(-1)[0]) if np.size(duration) else 0.0
    stats = (
        f"Generated {duration_seconds:.2f}s of audio in {elapsed:.2f}s "
        f"(RTF {elapsed / duration_seconds:.3f})"
        if duration_seconds
        else f"Generated audio in {elapsed:.2f}s"
    )
    return (SAMPLE_RATE, audio), stats


def build_demo() -> gr.Blocks:
    with gr.Blocks(title="Supertonic 3") as demo:
        gr.Markdown(
            """
            # Supertonic 3 Gradio

            Lightning-fast, on-device multilingual text-to-speech using the
            official Supertonic ONNX Python runtime.
            """
        )

        with gr.Row():
            with gr.Column(scale=2):
                text = gr.Textbox(
                    label="Text",
                    lines=8,
                    value="Supertonic is a lightning fast, on-device TTS system.",
                )
                custom_style_file = gr.File(
                    label="Custom voice style JSON (optional)",
                    file_types=[".json"],
                    type="filepath",
                )
            with gr.Column(scale=1):
                voice = gr.Dropdown(VOICE_CHOICES, value="M3", label="Built-in voice")
                language = gr.Dropdown(
                    LANGUAGE_CHOICES,
                    value="en",
                    label="Language",
                    info="Use Auto / fallback when you do not know the language.",
                )
                total_steps = gr.Slider(
                    minimum=5,
                    maximum=12,
                    value=8,
                    step=1,
                    label="Quality steps",
                )
                speed = gr.Slider(
                    minimum=0.7,
                    maximum=2.0,
                    value=1.05,
                    step=0.05,
                    label="Speed",
                )
                max_chunk_length = gr.Slider(
                    minimum=80,
                    maximum=500,
                    value=300,
                    step=10,
                    label="Max chunk length",
                )
                silence_duration = gr.Slider(
                    minimum=0.0,
                    maximum=1.0,
                    value=0.3,
                    step=0.05,
                    label="Silence between chunks",
                )

        generate = gr.Button("Generate Speech", variant="primary")
        audio = gr.Audio(label="Generated audio", type="numpy", autoplay=True)
        stats = gr.Markdown()

        generate.click(
            fn=synthesize,
            inputs=[
                text,
                voice,
                language,
                total_steps,
                speed,
                max_chunk_length,
                silence_duration,
                custom_style_file,
            ],
            outputs=[audio, stats],
            api_name="synthesize",
        )
        text.submit(
            fn=synthesize,
            inputs=[
                text,
                voice,
                language,
                total_steps,
                speed,
                max_chunk_length,
                silence_duration,
                custom_style_file,
            ],
            outputs=[audio, stats],
            api_visibility="private",
        )

        gr.Examples(
            examples=[
                ["This text-to-speech system runs locally and keeps your audio private.", "M3", "en", 8, 1.05, 300, 0.3, None],
                ["The startup secured $5.2M in venture capital after a strong public demo.", "F3", "en", 8, 1.1, 300, 0.3, None],
                ["Use expression tags like <laugh>, <breath>, or <sigh> to add natural detail.", "F1", "en", 10, 1.0, 300, 0.3, None],
            ],
            inputs=[
                text,
                voice,
                language,
                total_steps,
                speed,
                max_chunk_length,
                silence_duration,
                custom_style_file,
            ],
        )

    return demo


def parse_args():
    parser = argparse.ArgumentParser(description="Run the Supertonic 3 Gradio app.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=7860, type=int)
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    demo = build_demo()
    demo.queue(default_concurrency_limit=1).launch(
        server_name=args.host,
        server_port=args.port,
        theme=gr.themes.Soft(),
        footer_links=["api", "settings"],
    )
