module.exports = {
  version: "5.0",
  title: "Supertonic 3",
  description: "Lightning-Fast, On-Device, Multilingual TTS — 31 languages, ONNX, 44.1kHz",
  icon: "icon.jpeg",
  menu: async (kernel, info) => {
    let installed = info.exists("assets/onnx/vocoder.onnx")
    let running = {
      install: info.running("install.js"),
      start: info.running("start.js"),
      update: info.running("update.js"),
      reset: info.running("reset.js")
    }
    if (running.install) {
      return [{
        default: true,
        icon: "fa-solid fa-plug",
        text: "Installing",
        href: "install.js"
      }]
    } else if (running.update) {
      return [{
        default: true,
        icon: "fa-solid fa-terminal",
        text: "Updating",
        href: "update.js"
      }]
    } else if (running.reset) {
      return [{
        default: true,
        icon: "fa-solid fa-terminal",
        text: "Resetting",
        href: "reset.js"
      }]
    } else if (installed) {
      if (running.start) {
        return [{
          default: true,
          icon: "fa-solid fa-rocket",
          text: "Open Web UI",
          href: "index.html"
        }, {
          icon: "fa-solid fa-terminal",
          text: "Terminal",
          href: "start.js"
        }, {
          icon: "fa-solid fa-download",
          text: "Models on HuggingFace",
          href: "https://huggingface.co/Supertone/supertonic-3",
          popout: true
        }]
      } else {
        return [{
          default: true,
          icon: "fa-solid fa-power-off",
          text: "Start",
          href: "start.js"
        }, {
          icon: "fa-solid fa-download",
          text: "Models on HuggingFace",
          href: "https://huggingface.co/Supertone/supertonic-3",
          popout: true
        }, {
          icon: "fa-solid fa-plug",
          text: "Update",
          href: "update.js"
        }, {
          icon: "fa-regular fa-circle-xmark",
          text: "<div><strong>Reset</strong><div>Revert to pre-install state</div></div>",
          href: "reset.js",
          confirm: "Are you sure you wish to reset the app?"
        }]
      }
    } else {
      return [{
        default: true,
        icon: "fa-solid fa-plug",
        text: "Install",
        href: "install.js"
      }]
    }
  }
}
