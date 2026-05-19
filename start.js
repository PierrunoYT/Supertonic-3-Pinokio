module.exports = {
  daemon: true,
  run: [
    {
      method: "web.open",
      params: {
        uri: "index.html",
        target: "_top"
      }
    }
  ]
}
