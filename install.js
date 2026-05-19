module.exports = {
  requires: {
    bundle: "ai"
  },
  run: [
    {
      method: "shell.run",
      params: {
        venv: "env",
        message: ["uv pip install -r requirements.txt"]
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
