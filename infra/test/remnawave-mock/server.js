const http = require("node:http");

const metadata = {
  version: "2.7.0",
  build: {
    time: new Date(0).toISOString(),
    number: "dev",
  },
  git: {
    backend: {
      commitSha: "dev",
      branch: "dev",
      commitUrl: "http://localhost/dev",
    },
    frontend: {
      commitSha: "dev",
      commitUrl: "http://localhost/dev",
    },
  },
};

const server = http.createServer((req, res) => {
  req.resume();
  res.setHeader("content-type", "application/json");

  if (req.url === "/api/system/metadata") {
    res.end(JSON.stringify(metadata));
    return;
  }

  res.end(JSON.stringify({ response: null }));
});

server.listen(3000, "0.0.0.0", () => {
  console.log("Remnawave mock listening on 0.0.0.0:3000");
});
