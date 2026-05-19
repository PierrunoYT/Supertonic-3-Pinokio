<p align="center">
  <img src="icon.jpeg" alt="Supertonic 3 logo" width="160" />
</p>

# Supertonic 3 — Pinokio Launcher

A 1-click Pinokio launcher for [Supertonic 3](https://github.com/supertone-inc/supertonic) by Supertone — lightning-fast, on-device, multilingual TTS exposed through a local Gradio app.

## What It Does

Supertonic 3 is a 99M-parameter ONNX-based text-to-speech system that synthesizes speech across 31 languages at 44.1kHz. It runs locally with no cloud calls, no API keys, and no GPU required. This launcher installs the official Python `supertonic` runtime and serves a Gradio UI.

**Highlights:**
- 31 languages (Arabic, English, Japanese, Korean, French, German, Spanish, and more)
- 44.1kHz high-quality audio output
- 10 voice styles (M1–M5, F1–F5)
- 10 expression tags: `<laugh>`, `<breath>`, `<sigh>`, and more
- Runs on CPU — no NVIDIA GPU required
- Local Gradio API endpoint for automation

## How to Use

1. Click **Install** — installs the Python app and downloads the ONNX model weights (~400 MB) from HuggingFace.
2. Click **Start** — launches the local Gradio server.
3. Click **Open Web UI** — opens the Supertonic 3 Gradio interface.
4. Type your text, pick a voice and language, and click Generate.

Use the Pinokio stop control on the `start.js` terminal when you want to stop the Gradio server.

## API Usage

The Gradio app exposes a `synthesize` endpoint. The local URL is shown in Pinokio after clicking **Start**.

### JavaScript

```javascript
import { Client } from "@gradio/client";

const client = await Client.connect("http://127.0.0.1:7860");
const result = await client.predict("/synthesize", {
  text: "Supertonic is a lightning fast, on-device TTS system.",
  voice: "M3",
  language: "en",
  total_steps: 8,
  speed: 1.05,
  max_chunk_length: 300,
  silence_duration: 0.3,
  custom_style_file: null
});

console.log(result.data);
```

### Python

```python
from gradio_client import Client

client = Client("http://127.0.0.1:7860")
result = client.predict(
    text="Supertonic is a lightning fast, on-device TTS system.",
    voice="M3",
    language="en",
    total_steps=8,
    speed=1.05,
    max_chunk_length=300,
    silence_duration=0.3,
    custom_style_file=None,
    api_name="/synthesize",
)
print(result)
```

### Curl

```bash
curl -X POST http://127.0.0.1:7860/gradio_api/call/synthesize \
  -H "Content-Type: application/json" \
  -d '{
    "data": [
      "Supertonic is a lightning fast, on-device TTS system.",
      "M3",
      "en",
      8,
      1.05,
      300,
      0.3,
      null
    ]
  }'
```

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
