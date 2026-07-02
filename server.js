"use strict";

/**
 * Servidor estático mínimo (sin dependencias) para desplegar la web en Railway.
 * Sirve los archivos de este directorio y escucha en process.env.PORT.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PORT = process.env.PORT || 8080;
const HOST = "0.0.0.0";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".m3u": "application/vnd.apple.mpegurl; charset=utf-8",
  ".m3u8": "application/vnd.apple.mpegurl; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

function safeJoin(root, reqPath) {
  const decoded = decodeURIComponent(reqPath.split("?")[0]);
  const resolved = path.normalize(path.join(root, decoded));
  if (!resolved.startsWith(root)) return null; // evita path traversal
  return resolved;
}

const server = http.createServer((req, res) => {
  let urlPath = req.url === "/" ? "/index.html" : req.url;
  let filePath = safeJoin(ROOT, urlPath);

  if (!filePath) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || stat.isDirectory()) {
      // Fallback a index.html (SPA-friendly)
      filePath = path.join(ROOT, "index.html");
    }

    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || "application/octet-stream";

    // La playlist no debe cachearse para reflejar cambios de canales.
    const cache =
      ext === ".m3u" || ext === ".m3u8"
        ? "no-store"
        : ext === ".html"
        ? "no-cache"
        : "public, max-age=3600";

    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
      }
      res.writeHead(200, { "Content-Type": type, "Cache-Control": cache });
      res.end(data);
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Servidor escuchando en http://${HOST}:${PORT}`);
});
