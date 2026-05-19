<p align="center">
  <img src="icon.jpeg" alt="Supertonic 3 logo" width="160" />
</p>

# Supertonic 3 — Pinokio Launcher

A 1-click Pinokio launcher for [Supertonic 3](https://github.com/supertone-inc/supertonic) by Supertone — lightning-fast, on-device, multilingual TTS running entirely in your browser via WebGPU/WASM.

## What It Does

Supertonic 3 is a 99M-parameter ONNX-based text-to-speech system that synthesizes speech across 31 languages at 44.1kHz. It runs entirely on-device with no cloud calls, no API keys, and no GPU required. This launcher ships the official HuggingFace Space web UI and downloads the ONNX model weights locally on first install.

**Highlights:**
- 31 languages (Arabic, English, Japanese, Korean, French, German, Spanish, and more)
- 44.1kHz high-quality audio output
- 10 voice styles (M1–M5, F1–F5)
- 10 expression tags: `<laugh>`, `<breath>`, `<sigh>`, and more
- Runs on CPU — no NVIDIA GPU required
- WebGPU acceleration used automatically when available

## How to Use

1. Click **Install** — downloads the ONNX model weights (~380 MB) from HuggingFace.
2. Click **Open Web UI** — opens the Supertonic 3 browser interface.
3. Type your text, pick a voice and language, and click Generate.

This is a static browser app, so it does not keep a backend process running. To stop using it, close the Web UI tab.

## Supported Languages

Arabic (`ar`), Bulgarian (`bg`), Croatian (`hr`), Czech (`cs`), Danish (`da`), Dutch (`nl`), English (`en`), Estonian (`et`), Finnish (`fi`), French (`fr`), German (`de`), Greek (`el`), Hindi (`hi`), Hungarian (`hu`), Indonesian (`id`), Italian (`it`), Japanese (`ja`), Korean (`ko`), Latvian (`lv`), Lithuanian (`lt`), Polish (`pl`), Portuguese (`pt`), Romanian (`ro`), Russian (`ru`), Slovak (`sk`), Slovenian (`sl`), Spanish (`es`), Swedish (`sv`), Turkish (`tr`), Ukrainian (`uk`), Vietnamese (`vi`)

Pass `lang="na"` to let Supertonic detect the language automatically.

## Expression Tags

Inline tags add natural human nuance without reference audio:

| Tag | Effect |
|-----|--------|
| `<laugh>` | Laughter |
| `<breath>` | Audible breath |
| `<sigh>` | Sigh |
| `<clear-throat>` | Throat clear |
| `<cough>` | Cough |
| `<sneeze>` | Sneeze |
| `<sniff>` | Sniff |
| `<groan>` | Groan |
| `<yawn>` | Yawn |
| `<hmm>` | Thinking sound |

## Models

Downloaded at install from [Supertone/supertonic-3](https://huggingface.co/spaces/Supertone/supertonic-3) (HuggingFace Space):

| File | Size | Description |
|------|------|-------------|
| vector_estimator.onnx | ~245 MB | Main flow-matching model |
| vocoder.onnx | ~97 MB | Audio decoder |
| text_encoder.onnx | ~35 MB | Text encoder |
| duration_predictor.onnx | ~3.6 MB | Duration predictor |

## License

Sample code: [MIT License](LICENSE). Model weights: [OpenRAIL-M License](https://huggingface.co/Supertone/supertonic-3/blob/main/LICENSE). © 2026 Supertone Inc.
