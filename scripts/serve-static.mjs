import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.PORT || 8765);
const mime = {
  html: "text/html",
  css: "text/css",
  js: "application/javascript",
  json: "application/json",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml"
};

http.createServer((request, response) => {
  const pathname = decodeURIComponent((request.url || "/").split("?")[0]);
  const filePath = path.join(root, pathname === "/" ? "index.html" : pathname.replace(/^\//, ""));

  if (!filePath.startsWith(root) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  const extension = path.extname(filePath).slice(1).toLowerCase();
  response.writeHead(200, { "Content-Type": mime[extension] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(response);
}).listen(port, () => {
  console.log(`Static server ready on http://127.0.0.1:${port}`);
});
