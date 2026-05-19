module.exports = {
  daemon: true,
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
        env: {},
        message: ["supertonic serve --host 127.0.0.1 --port {{port}}"],
        on: [{
          event: "/(http:\\/\\/[0-9.:]+)/",
          done: true
        }]
      }
    },
    {
      method: "local.set",
      params: {
        url: "{{input.event[1]}}/docs"
      }
    }
  ]
}
