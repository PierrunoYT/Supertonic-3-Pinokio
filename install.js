module.exports = {
  run: [
    {
      when: "{{!exists('assets/onnx/vocoder.onnx')}}",
      method: "hf.download",
      params: {
        "_": ["Supertone/supertonic-3"],
        "repo-type": "space",
        "include": "assets/onnx/*",
        "local-dir": "."
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
