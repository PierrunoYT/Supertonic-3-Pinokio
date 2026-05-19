module.exports = {
  run: [
    {
      method: "shell.run",
      params: {
        message: "hf download Supertone/supertonic-3 --type space --include \"assets/onnx/*\" --local-dir ."
      }
    },
    {
      method: "notify",
      params: {
        html: "Installation finished! Click 'Open Web UI' to launch Supertonic 3."
      }
    }
  ]
}
