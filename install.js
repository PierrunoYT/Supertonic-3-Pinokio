module.exports = {
  run: [
    {
      method: "shell.run",
      params: {
        venv: "env",
        path: "app",
        message: [
          "uv pip install -r requirements.txt",
          "python -c \"from supertonic import TTS; TTS(auto_download=True)\""
        ]
      }
    },
    {
      method: "notify",
      params: {
        html: "Installation finished! Click 'Start' to launch Supertonic 3."
      }
    }
  ]
}
