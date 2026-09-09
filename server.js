const http = require("http");
const fs = require("fs");
const path = require("path");

const port = Number(process.env.PORT) || 8787;
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8" };
const publicFiles = new Set(['index.html','app.js','styles.css','theme.css','rb.html','rb.js','rb.css','rb-calc.mjs']);

http.createServer((request, response) => {
  const relative = request.url === "/" ? "index.html" : request.url.split("?")[0].replace(/^\/+/, "");
  const file = path.resolve(__dirname, relative);
  if (!publicFiles.has(relative)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  fs.readFile(file, (error, content) => {
    if (error) { response.writeHead(404).end("Not found"); return; }
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", types[path.extname(file)]);
    response.end(content);
  });
}).listen(port, '127.0.0.1', () => console.log(`MNP ERP Simulation: http://localhost:${port}/rb.html`));
