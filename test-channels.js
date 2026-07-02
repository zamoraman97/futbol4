"use strict";

/**
 * Test end-to-end del proxy: simula lo que hace el navegador con hls.js.
 * Para cada canal: pide el manifiesto por /hls, resuelve variantes hasta llegar
 * a una lista de segmentos, descarga el primer segmento y verifica que sean
 * bytes de video reales (MPEG-TS empieza con 0x47, o fMP4 con "ftyp"/"moof").
 * Uso: node test-channels.js
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const BASE = "http://127.0.0.1:8080";

function loadChannels() {
  // Permite testear solo TUDN/Canal 5 (por defecto) o toda la playlist (--all).
  if (!process.argv.includes("--all")) {
    return [
      { name: "TUDN", url: "https://streaming.alwaysdata.net/tudn.php" },
      { name: "Canal 5", url: "http://190.11.225.124:5000/live/canal5_hd/playlist.m3u8" },
    ];
  }
  const text = fs.readFileSync(path.join(__dirname, "playlist.m3u"), "utf8");
  const lines = text.split(/\r?\n/);
  const out = [];
  let name = null;
  for (const raw of lines) {
    const t = raw.trim();
    if (t.startsWith("#EXTINF")) name = t.split(",").slice(1).join(",").trim();
    else if (t && !t.startsWith("#")) { out.push({ name: name || t, url: t }); name = null; }
  }
  return out;
}

const CHANNELS = loadChannels();

function proxied(u) {
  return BASE + "/hls?u=" + encodeURIComponent(u);
}

function get(url, asBuffer) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks = [];
      res.on("data", (d) => chunks.push(d));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, ct: res.headers["content-type"] || "", buf });
      });
    });
    req.on("error", reject);
    req.setTimeout(20000, () => req.destroy(new Error("timeout")));
  });
}

function parseManifest(text) {
  const lines = text.split(/\r?\n/);
  const variants = [];
  const segments = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === "" || t === "#EXTM3U") continue;
    if (t.startsWith("#EXT-X-STREAM-INF")) {
      const next = (lines[i + 1] || "").trim();
      if (next && !next.startsWith("#")) variants.push(next);
    } else if (!t.startsWith("#")) {
      segments.push(t);
    }
  }
  return { variants, segments, isMaster: variants.length > 0 };
}

function videoKind(buf, ct) {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0x47) return "MPEG-TS";
  const head = buf.slice(0, 16).toString("latin1");
  if (head.startsWith("ID3")) return "MPEG-TS/ID3";
  if (head.includes("ftyp") || head.includes("moof") || head.includes("styp")) return "fMP4";
  if (head.startsWith("#EXTM3U")) return "PLAYLIST";
  // Fallback: si el servidor declara explícitamente video y hay datos suficientes.
  if (/^(video|audio)\//i.test(ct || "") && buf.length > 10000) return "MEDIA(" + ct + ")";
  return null;
}

async function testChannel(ch) {
  const log = [];
  try {
    log.push(`\n=== ${ch.name} ===`);
    let manUrl = proxied(ch.url);
    let hops = 0;
    let text = "";
    // Resuelve manifiestos anidados (master -> variante) hasta 4 niveles.
    while (hops < 4) {
      const r = await get(manUrl);
      log.push(`  GET manifest (hop ${hops}) -> status=${r.status} ct=${r.ct} bytes=${r.buf.length}`);
      if (r.status !== 200) return { ok: false, log, reason: `status ${r.status}` };
      text = r.buf.toString("utf8");
      if (!text.includes("#EXTM3U")) return { ok: false, log, reason: "no es un manifiesto M3U" };
      const p = parseManifest(text);
      if (p.isMaster) {
        log.push(`  master con ${p.variants.length} variante(s), tomo la primera`);
        manUrl = p.variants[0].startsWith("http") ? p.variants[0] : BASE + p.variants[0];
        hops++;
        continue;
      }
      if (p.segments.length === 0) return { ok: false, log, reason: "manifiesto sin segmentos" };
      log.push(`  media playlist con ${p.segments.length} segmento(s)`);
      const segUrl = p.segments[0].startsWith("http") ? p.segments[0] : BASE + p.segments[0];
      log.push(`  descargando 1er segmento...`);
      const seg = await get(segUrl, true);
      const kind = videoKind(seg.buf, seg.ct);
      const hex = seg.buf.slice(0, 8).toString("hex");
      log.push(`  segmento -> status=${seg.status} ct=${seg.ct} bytes=${seg.buf.length} tipo=${kind} hex=${hex}`);
      if (seg.status === 200 && seg.buf.length > 1000 && kind && kind !== "PLAYLIST") {
        return { ok: true, log, reason: `video ${kind} (${seg.buf.length} bytes)` };
      }
      return { ok: false, log, reason: `segmento inválido (status=${seg.status}, tipo=${kind})` };
    }
    return { ok: false, log, reason: "demasiados niveles de manifiesto" };
  } catch (e) {
    log.push(`  EXCEPCIÓN: ${e.message}`);
    return { ok: false, log, reason: e.message };
  }
}

(async () => {
  let allOk = true;
  for (const ch of CHANNELS) {
    const r = await testChannel(ch);
    console.log(r.log.join("\n"));
    console.log(`  RESULTADO: ${r.ok ? "OK ✓" : "FALLA ✗"} — ${r.reason}`);
    if (!r.ok) allOk = false;
  }
  console.log("\n================================");
  console.log(allOk ? "TODOS OK ✓" : "HAY FALLAS ✗");
  process.exit(allOk ? 0 : 1);
})();
