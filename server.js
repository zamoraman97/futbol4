"use strict";

/**
 * Servidor estático mínimo (sin dependencias) para desplegar la web en Railway.
 * Sirve los archivos de este directorio y escucha en process.env.PORT.
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const ROOT = __dirname;
const PORT = process.env.PORT || 8080;
const HOST = "0.0.0.0";
const MAX_REDIRECTS = 5;

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

/* ------------------------------ Proxy HLS -------------------------------- */
/**
 * Proxy del mismo origen para streams de terceros. Resuelve dos problemas:
 *  - Contenido mixto (http:// dentro de una web https://).
 *  - Falta de cabeceras CORS y segmentos con rutas relativas.
 * Reescribe los manifiestos .m3u8 para que TODAS las peticiones (variantes,
 * segmentos y llaves) vuelvan a pasar por este mismo proxy.
 */
function fetchUpstream(targetUrl, redirectsLeft, cb) {
  let u;
  try { u = new URL(targetUrl); } catch (e) { cb(new Error("bad url")); return; }
  if (u.protocol !== "http:" && u.protocol !== "https:") { cb(new Error("bad proto")); return; }
  const mod = u.protocol === "https:" ? https : http;
  const options = {
    method: "GET",
    headers: { "User-Agent": "Mozilla/5.0", Accept: "*/*" },
  };
  const upReq = mod.request(u, options, (up) => {
    const status = up.statusCode || 0;
    if (status >= 300 && status < 400 && up.headers.location && redirectsLeft > 0) {
      const next = new URL(up.headers.location, u).toString();
      up.resume();
      fetchUpstream(next, redirectsLeft - 1, cb);
      return;
    }
    cb(null, up, u.toString());
  });
  upReq.on("error", (e) => cb(e));
  upReq.setTimeout(15000, () => upReq.destroy(new Error("timeout")));
  upReq.end();
}

function isPlaylist(contentType, finalUrl) {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("mpegurl") || ct.includes("vnd.apple")) return true;
  if (/\.m3u8?(\?|$)/i.test(finalUrl)) return true;
  if (finalUrl.includes(".php")) return true;
  return false;
}

function rewritePlaylist(body, baseUrl) {
  const self = "/hls?u=";
  const rewriteUri = (uri) => {
    try { return self + encodeURIComponent(new URL(uri, baseUrl).toString()); }
    catch (e) { return uri; }
  };
  return body.split(/\r?\n/).map((line) => {
    const t = line.trim();
    if (t === "") return line;
    if (t.startsWith("#")) {
      return line.replace(/URI="([^"]+)"/g, (_m, uri) => 'URI="' + rewriteUri(uri) + '"');
    }
    return rewriteUri(t);
  }).join("\n");
}

function handleProxy(req, res) {
  let target;
  try { target = new URL(req.url, "http://x").searchParams.get("u"); }
  catch (e) { target = null; }
  if (!target) { res.writeHead(400); res.end("missing u"); return; }

  fetchUpstream(target, MAX_REDIRECTS, (err, up, finalUrl) => {
    if (err || !up) {
      res.writeHead(502, { "Access-Control-Allow-Origin": "*" });
      res.end("upstream error");
      return;
    }
    const ct = up.headers["content-type"] || "";
    if (isPlaylist(ct, finalUrl)) {
      const chunks = [];
      up.on("data", (d) => chunks.push(d));
      up.on("end", () => {
        const body = rewritePlaylist(Buffer.concat(chunks).toString("utf8"), finalUrl);
        res.writeHead(200, {
          "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
        });
        res.end(body);
      });
      up.on("error", () => { try { res.writeHead(502); res.end("stream error"); } catch (e) {} });
    } else {
      const headers = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };
      if (ct) headers["Content-Type"] = ct;
      if (up.headers["content-length"]) headers["Content-Length"] = up.headers["content-length"];
      res.writeHead(up.statusCode || 200, headers);
      up.pipe(res);
    }
  });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/hls?") || req.url === "/hls") {
    handleProxy(req, res);
    return;
  }

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
