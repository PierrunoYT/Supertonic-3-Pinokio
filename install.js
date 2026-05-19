module.exports = {
  requires: {
    bundle: "ai"
  },
  run: [
    {
      when: "{{platform === 'darwin'}}",
      method: "notify",
      params: {
        html: "macOS is not supported. Supertonic 3 requires Windows or Linux."
      },
      next: null
    },
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
