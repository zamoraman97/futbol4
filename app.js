"use strict";

/**
 * Mundial 2026 — MultiView profesional.
 * Hasta 4 streams simultáneos, DVR por ventana, audio que sigue al foco,
 * conexión robusta (auto-recuperación, reintentos y proxy de respaldo).
 */

const PLAYLIST_URL = "playlist.m3u";
const MAX_SLOTS = 4;
const TERMS_KEY = "wc26_terms_ok";

// Proxies de respaldo (se rotan cuando un stream directo falla).
const PROXIES = [
  "https://corsproxy.io/?url=",
  "https://api.allorigins.win/raw?url=",
];

const els = {
  stage: document.getElementById("stage"),
  list: document.getElementById("channel-list"),
  count: document.getElementById("count"),
  search: document.getElementById("search"),
  rail: document.getElementById("rail"),
  railToggle: document.getElementById("rail-toggle"),
  railBackdrop: document.getElementById("rail-backdrop"),
  layoutControls: document.getElementById("layout-controls"),
  gate: document.getElementById("terms-gate"),
  gateAccept: document.getElementById("terms-accept"),
  gateEnter: document.getElementById("terms-enter"),
  termsOpen: document.getElementById("terms-open"),
  termsOpen2: document.getElementById("terms-open-2"),
};

let allChannels = [];
let gridSize = 1;
let activeSlot = 0;
let booted = false;

/** Estado de cada slot. */
const slots = [];

/* --------------------------- Loader con proxy ----------------------------- */

/**
 * Crea una subclase del loader por defecto de hls.js que antepone un proxy
 * a TODAS las peticiones (manifiesto + segmentos), no solo a la primera.
 */
function makeProxyLoader(proxyBase) {
  if (!window.Hls) return null;
  const Base = Hls.DefaultConfig.loader;
  return class ProxyLoader extends Base {
    load(context, config, callbacks) {
      if (context && context.url && !context.url.startsWith(proxyBase)) {
        context.url = proxyBase + encodeURIComponent(context.url);
      }
      super.load(context, config, callbacks);
    }
  };
}

/* ----------------------------- Carga de datos ----------------------------- */

async function fetchPlaylist() {
  const res = await fetch(PLAYLIST_URL, { cache: "no-store" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const text = await res.text();
  if (!text.includes("#EXTM3U")) throw new Error("Respuesta no válida");
  return text;
}

function parseM3U(text) {
  const lines = text.split(/\r?\n/);
  const channels = [];
  let current = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("#EXTINF")) {
      const name = line.split(",").slice(1).join(",").trim();
      const logo = (line.match(/tvg-logo="([^"]*)"/) || [])[1] || "";
      const group = (line.match(/group-title="([^"]*)"/) || [])[1] || "";
      const id = (line.match(/tvg-id="([^"]*)"/) || [])[1] || "";
      current = { name: name || "Canal", logo, group: group || "Otros", id, url: "" };
    } else if (line && !line.startsWith("#") && current) {
      current.url = line;
      channels.push(current);
      current = null;
    }
  }
  return channels;
}

/* --------------------------------- Iconos --------------------------------- */

const ICONS = {
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  mute: '<svg viewBox="0 0 24 24"><path d="M11 5L6 9H3v6h3l5 4V5z"/><path d="M16 9l5 6M21 9l-5 6"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M11 5L6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 010 7"/><path d="M18.5 6a8 8 0 010 12"/></svg>',
  full: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  reload: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 11-2.6-6.4M21 4v5h-5"/></svg>',
};

/* ------------------------------- Stage / Slots ---------------------------- */

function buildStage() {
  els.stage.innerHTML = "";
  slots.length = 0;
  els.stage.dataset.grid = String(gridSize);
  els.stage.style.setProperty("--rows", gridSize >= 3 ? 2 : 1);

  for (let i = 0; i < gridSize; i++) {
    const slot = document.createElement("div");
    slot.className = "slot";
    slot.dataset.index = String(i);
    slot.style.setProperty("--d", i * 0.05 + "s");

    const video = document.createElement("video");
    video.playsInline = true;
    video.muted = true;

    const empty = document.createElement("div");
    empty.className = "slot-empty";
    empty.innerHTML = '<span class="slot-num">' + (i + 1) + "</span>";

    const skeleton = document.createElement("div");
    skeleton.className = "slot-skeleton hidden";
    skeleton.innerHTML = '<div class="sk-shimmer"></div><span class="sk-label">Conectando…</span>';

    const status = document.createElement("div");
    status.className = "slot-status hidden";

    // Barra superior de info/controles
    const bar = document.createElement("div");
    bar.className = "slot-bar hidden";

    const logo = document.createElement("img");
    logo.className = "slot-logo";
    logo.alt = "";

    const meta = document.createElement("div");
    meta.className = "slot-meta";
    const name = document.createElement("div");
    name.className = "slot-name";
    const sub = document.createElement("div");
    sub.className = "slot-sub";
    meta.append(name, sub);

    const vol = document.createElement("div");
    vol.className = "slot-vol";
    const muteBtn = document.createElement("button");
    muteBtn.className = "slot-btn";
    muteBtn.title = "Activar sonido";
    muteBtn.innerHTML = ICONS.mute;
    const volSlider = document.createElement("input");
    volSlider.type = "range";
    volSlider.className = "vol-slider";
    volSlider.min = "0"; volSlider.max = "100"; volSlider.value = "100";
    volSlider.title = "Volumen";
    vol.append(muteBtn, volSlider);

    const reloadBtn = document.createElement("button");
    reloadBtn.className = "slot-btn";
    reloadBtn.title = "Recargar";
    reloadBtn.innerHTML = ICONS.reload;

    const fullBtn = document.createElement("button");
    fullBtn.className = "slot-btn";
    fullBtn.title = "Pantalla completa";
    fullBtn.innerHTML = ICONS.full;

    const closeBtn = document.createElement("button");
    closeBtn.className = "slot-btn danger";
    closeBtn.title = "Quitar canal";
    closeBtn.innerHTML = ICONS.close;

    bar.append(logo, meta, vol, reloadBtn, fullBtn, closeBtn);

    // Barra DVR inferior
    const seek = document.createElement("div");
    seek.className = "slot-seek hidden";
    const liveBtn = document.createElement("button");
    liveBtn.className = "live-btn";
    liveBtn.innerHTML = '<span class="live-dot"></span>EN VIVO';
    liveBtn.title = "Ir al directo";
    const seekSlider = document.createElement("input");
    seekSlider.type = "range";
    seekSlider.className = "seek-slider";
    seekSlider.min = "0"; seekSlider.max = "1000"; seekSlider.value = "1000"; seekSlider.step = "1";
    const delay = document.createElement("span");
    delay.className = "seek-delay";
    delay.textContent = "EN DIRECTO";
    seek.append(liveBtn, seekSlider, delay);

    slot.append(video, empty, skeleton, status, bar, seek);
    els.stage.appendChild(slot);

    const S = {
      i, el: slot, video, empty, skeleton, status, bar, logo, name, sub,
      muteBtn, volSlider, seek, seekSlider, liveBtn, delay,
      hls: null, ch: null, proxyIdx: -1, netRetries: 0, mediaRetries: 0,
      seeking: false, lastTime: 0, stallTicks: 0, raf: null,
    };
    slots.push(S);

    slot.addEventListener("click", () => setActiveSlot(i));
    muteBtn.addEventListener("click", (e) => { e.stopPropagation(); setActiveSlot(i); toggleMute(S); });
    volSlider.addEventListener("input", (e) => { e.stopPropagation(); setActiveSlot(i); setVolume(S, e.target.value / 100); });
    volSlider.addEventListener("click", (e) => e.stopPropagation());
    reloadBtn.addEventListener("click", (e) => { e.stopPropagation(); if (S.ch) loadInto(S, S.ch); });
    fullBtn.addEventListener("click", (e) => { e.stopPropagation(); goFullscreen(S); });
    closeBtn.addEventListener("click", (e) => { e.stopPropagation(); clearSlot(S); });

    // DVR seek
    seekSlider.addEventListener("pointerdown", (e) => { e.stopPropagation(); S.seeking = true; });
    seekSlider.addEventListener("input", (e) => { e.stopPropagation(); previewSeek(S); });
    seekSlider.addEventListener("change", (e) => { e.stopPropagation(); commitSeek(S); S.seeking = false; });
    seekSlider.addEventListener("click", (e) => e.stopPropagation());
    liveBtn.addEventListener("click", (e) => { e.stopPropagation(); jumpToLive(S); });
  }

  if (activeSlot >= gridSize) activeSlot = 0;
  setActiveSlot(activeSlot);
  startDvrLoop();
}

function showUI(S) {
  if (!S) return;
  S.el.classList.add("show-ui");
  clearTimeout(S.uiTimer);
  S.uiTimer = setTimeout(() => S.el.classList.remove("show-ui"), 2600);
}

function setActiveSlot(i) {
  activeSlot = i;
  slots.forEach((s) => s.el.classList.toggle("active", s.i === i));
  showUI(slots[i]);
  // El audio sigue al foco: solo la pantalla enfocada con sonido.
  slots.forEach((s) => {
    if (!s.ch) return;
    if (s.i === i) {
      if (s.video.volume === 0) { s.video.volume = 1; s.volSlider.value = 100; }
      s.video.muted = false;
      s.video.play().catch(() => {});
    } else {
      s.video.muted = true;
    }
    refreshMuteBtn(s);
  });
}

function setSlotStatus(S, msg, isError) {
  if (!msg) { S.status.classList.add("hidden"); return; }
  S.status.classList.remove("hidden");
  S.status.classList.toggle("error", !!isError);
  S.status.innerHTML = '<span class="dot"></span>' + msg;
}

function showSkeleton(S, on) {
  S.skeleton.classList.toggle("hidden", !on);
}

/* --------------------------------- Audio ---------------------------------- */

function toggleMute(S) {
  if (!S.ch) return;
  if (S.video.muted) {
    slots.forEach((s) => { if (s !== S) { s.video.muted = true; refreshMuteBtn(s); } });
    if (S.video.volume === 0) { S.video.volume = 1; S.volSlider.value = 100; }
    S.video.muted = false;
    S.video.play().catch(() => {});
  } else {
    S.video.muted = true;
  }
  refreshMuteBtn(S);
}

function setVolume(S, v) {
  if (!S.ch) return;
  S.video.volume = v;
  if (v > 0) {
    slots.forEach((s) => { if (s !== S) { s.video.muted = true; refreshMuteBtn(s); } });
    S.video.muted = false;
    S.video.play().catch(() => {});
  } else {
    S.video.muted = true;
  }
  refreshMuteBtn(S);
}

function refreshMuteBtn(S) {
  const on = S.ch && !S.video.muted && S.video.volume > 0;
  S.muteBtn.classList.toggle("on", !!on);
  S.muteBtn.innerHTML = on ? ICONS.sound : ICONS.mute;
  S.muteBtn.title = on ? "Silenciar" : "Activar sonido";
  S.volSlider.style.setProperty("--fill", (on ? S.video.volume * 100 : 0) + "%");
  S.bar.classList.toggle("audio-on", !!on);
}

/* --------------------------------- DVR ------------------------------------ */

function getWindow(S) {
  const v = S.video;
  if (!v.seekable || v.seekable.length === 0) return null;
  const start = v.seekable.start(0);
  const end = v.seekable.end(0);
  if (!isFinite(start) || !isFinite(end) || end - start < 1) return null;
  return { start, end };
}

function fmt(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
}

function startDvrLoop() {
  if (startDvrLoop._on) return;
  startDvrLoop._on = true;
  const tick = () => {
    for (const S of slots) updateDvr(S);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function updateDvr(S) {
  if (!S.ch) { S.seek.classList.add("hidden"); return; }
  const win = getWindow(S);
  if (!win) {
    // Stream sin DVR: solo botón EN VIVO, sin barra útil.
    S.seek.classList.remove("hidden");
    S.seek.classList.add("no-dvr");
    S.delay.textContent = "EN DIRECTO";
    S.liveBtn.classList.add("at-live");
    return;
  }
  S.seek.classList.remove("hidden");
  S.seek.classList.remove("no-dvr");

  if (S.seeking) return; // no sobrescribir mientras el usuario arrastra

  const span = win.end - win.start;
  const pos = Math.min(Math.max(S.video.currentTime, win.start), win.end);
  const ratio = span > 0 ? (pos - win.start) / span : 1;
  S.seekSlider.value = String(Math.round(ratio * 1000));
  S.seekSlider.style.setProperty("--fill", (ratio * 100).toFixed(1) + "%");

  const behind = win.end - pos;
  const atLive = behind <= 6;
  S.liveBtn.classList.toggle("at-live", atLive);
  S.delay.textContent = atLive ? "EN DIRECTO" : "-" + fmt(behind);
}

function previewSeek(S) {
  const win = getWindow(S);
  if (!win) return;
  const ratio = Number(S.seekSlider.value) / 1000;
  S.seekSlider.style.setProperty("--fill", (ratio * 100).toFixed(1) + "%");
  const target = win.start + ratio * (win.end - win.start);
  const behind = win.end - target;
  S.delay.textContent = behind <= 6 ? "EN DIRECTO" : "-" + fmt(behind);
}

function commitSeek(S) {
  const win = getWindow(S);
  if (!win) return;
  const ratio = Number(S.seekSlider.value) / 1000;
  S.video.currentTime = win.start + ratio * (win.end - win.start);
  S.video.play().catch(() => {});
}

function jumpToLive(S) {
  if (S.hls && isFinite(S.hls.liveSyncPosition)) {
    S.video.currentTime = S.hls.liveSyncPosition;
  } else {
    const win = getWindow(S);
    if (win) S.video.currentTime = win.end - 1;
  }
  S.video.play().catch(() => {});
}

/* -------------------------------- Acciones -------------------------------- */

function goFullscreen(S) {
  const target = S.el;
  if (target.requestFullscreen) target.requestFullscreen().catch(() => {});
  else if (target.webkitRequestFullscreen) target.webkitRequestFullscreen();
}

function clearSlot(S) {
  if (S.hls) { S.hls.destroy(); S.hls = null; }
  S.video.pause();
  S.video.removeAttribute("src");
  S.video.load();
  S.ch = null;
  S.proxyIdx = -1; S.netRetries = 0; S.mediaRetries = 0;
  S.empty.classList.remove("hidden");
  S.bar.classList.add("hidden");
  S.seek.classList.add("hidden");
  showSkeleton(S, false);
  setSlotStatus(S, null);
  refreshMuteBtn(S);
  renderList();
}

/* ----------------------------- Reproducción ------------------------------- */

const HLS_CFG = {
  lowLatencyMode: false,
  enableWorker: true,
  backBufferLength: 90,
  maxBufferLength: 24,
  manifestLoadingMaxRetry: 4,
  manifestLoadingRetryDelay: 800,
  levelLoadingMaxRetry: 4,
  levelLoadingRetryDelay: 800,
  fragLoadingMaxRetry: 6,
  fragLoadingRetryDelay: 800,
};

function isDsportsChannel(ch) {
  const hay = ((ch && (ch.name + " " + ch.id + " " + ch.group)) || "").toLowerCase();
  return hay.includes("dsports");
}

function hlsCfgFor(ch) {
  const cfg = Object.assign({}, HLS_CFG);
  // DSports en esta playlist pública suele quedarse muy atrás del vivo si dejamos
  // demasiado buffer. Para ese canal priorizamos latencia baja sobre estabilidad.
  if (isDsportsChannel(ch)) {
    cfg.backBufferLength = 12;
    cfg.maxBufferLength = 8;
    cfg.maxMaxBufferLength = 12;
    cfg.liveSyncDurationCount = 1;
    cfg.liveMaxLatencyDurationCount = 3;
    cfg.maxLiveSyncPlaybackRate = 1.5;
    cfg.nudgeOffset = 0.05;
    cfg.nudgeMaxRetry = 8;
  }
  return cfg;
}

function snapNearLive(S) {
  if (!S || !S.ch) return;
  const win = getWindow(S);
  if (!win) return;
  const behind = win.end - S.video.currentTime;
  if (behind > 12) {
    jumpToLive(S);
  }
}

function streamUrl(S, ch) {
  if (S.proxyIdx >= 0 && PROXIES[S.proxyIdx]) {
    return PROXIES[S.proxyIdx] + encodeURIComponent(ch.url);
  }
  return ch.url;
}

/**
 * Cuando la página se sirve por HTTPS, los streams http:// se bloquean como
 * "contenido mixto". Para esos canales arrancamos directamente vía proxy HTTPS
 * en lugar de intentar la conexión directa (que fallaría siempre).
 */
function needsProxyFromStart(ch) {
  return location.protocol === "https:" && /^http:\/\//i.test(ch.url);
}

function loadInto(S, ch, opts) {
  opts = opts || {};
  const isRetry = opts.retry;
  S.ch = ch;
  if (!isRetry) {
    S.proxyIdx = needsProxyFromStart(ch) ? 0 : -1;
    S.netRetries = 0; S.mediaRetries = 0;
  }

  S.empty.classList.add("hidden");
  S.bar.classList.remove("hidden");
  S.name.textContent = ch.name;
  if (S.sub) S.sub.textContent = (S.proxyIdx >= 0 ? "vía proxy · " : "") + (ch.group || "");
  if (ch.logo) { S.logo.src = ch.logo; S.logo.style.display = ""; }
  else S.logo.style.display = "none";
  S.volSlider.value = 100;
  S.video.volume = 1;
  showSkeleton(S, true);
  setSlotStatus(S, S.proxyIdx >= 0 ? "Reconectando vía proxy…" : "Conectando…");

  if (S.hls) { S.hls.destroy(); S.hls = null; }
  const video = S.video;
  video.pause();
  video.removeAttribute("src");
  video.load();
  video.muted = S.i !== activeSlot;
  refreshMuteBtn(S);

  const url = streamUrl(S, ch);
  const isHls = /\.m3u8(\?|$)/i.test(ch.url) || ch.url.includes("m3u8") || ch.url.includes(".php");

  if (isHls && window.Hls && Hls.isSupported()) {
    const cfg = hlsCfgFor(ch);
    // En modo proxy usamos un loader que enruta TODAS las peticiones.
    if (S.proxyIdx >= 0) {
      const L = makeProxyLoader(PROXIES[S.proxyIdx]);
      if (L) cfg.loader = L;
    }
    const hls = new Hls(cfg);
    S.hls = hls;
    hls.loadSource(S.proxyIdx >= 0 ? ch.url : url);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      showSkeleton(S, false);
      setSlotStatus(S, null);
      jumpToLive(S);
      if (isDsportsChannel(ch)) {
        setTimeout(() => snapNearLive(S), 900);
      }
      if (S.i === activeSlot) { video.muted = false; refreshMuteBtn(S); }
      video.play().catch(() => {});
    });
    hls.on(Hls.Events.FRAG_BUFFERED, () => {
      S.netRetries = 0;
      if (isDsportsChannel(ch)) snapNearLive(S);
    });
    hls.on(Hls.Events.ERROR, (_e, data) => handleHlsError(S, ch, data));
  } else if (video.canPlayType("application/vnd.apple.mpegurl") || !isHls) {
    video.src = url;
    video.play().then(() => { showSkeleton(S, false); setSlotStatus(S, null); }).catch(() => {
      tryNativeFallback(S, ch);
    });
    video.addEventListener("playing", () => { showSkeleton(S, false); setSlotStatus(S, null); }, { once: true });
    video.addEventListener("error", () => tryNativeFallback(S, ch), { once: true });
  } else {
    showSkeleton(S, false);
    setSlotStatus(S, "Formato no soportado", true);
  }
  renderList();
}

function handleHlsError(S, ch, data) {
  if (!data.fatal) return;
  const hls = S.hls;
  if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
    if (S.netRetries < 3) {
      S.netRetries++;
      setSlotStatus(S, "Reintentando… (" + S.netRetries + ")");
      try { hls.startLoad(); return; } catch (e) {}
    }
    escalateProxy(S, ch);
  } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
    if (S.mediaRetries === 0) {
      S.mediaRetries++;
      setSlotStatus(S, "Recuperando vídeo…");
      try { hls.recoverMediaError(); return; } catch (e) {}
    } else if (S.mediaRetries === 1) {
      S.mediaRetries++;
      try { hls.swapAudioCodec(); hls.recoverMediaError(); return; } catch (e) {}
    }
    escalateProxy(S, ch);
  } else {
    escalateProxy(S, ch);
  }
}

function tryNativeFallback(S, ch) {
  escalateProxy(S, ch);
}

/** Pasa al siguiente proxy; si se agotan, marca error. */
function escalateProxy(S, ch) {
  if (S.proxyIdx + 1 < PROXIES.length) {
    S.proxyIdx++;
    S.netRetries = 0; S.mediaRetries = 0;
    loadInto(S, ch, { retry: true });
  } else {
    showSkeleton(S, false);
    setSlotStatus(S, "No disponible · prueba otro canal", true);
  }
}

/* ------------------------- Watchdog anti-congelación ---------------------- */

setInterval(() => {
  for (const S of slots) {
    if (!S.ch || !S.hls) continue;
    const t = S.video.currentTime;
    const playing = !S.video.paused && S.video.readyState >= 2;
    if (playing && Math.abs(t - S.lastTime) < 0.05) {
      S.stallTicks++;
      if (S.stallTicks === 3) setSlotStatus(S, "Reanudando…");
      if (S.stallTicks >= 5) {
        S.stallTicks = 0;
        try { S.hls.startLoad(); jumpToLive(S); } catch (e) {}
      }
    } else {
      if (S.stallTicks > 0 && !S.status.classList.contains("error")) setSlotStatus(S, null);
      S.stallTicks = 0;
    }
    S.lastTime = t;
  }
}, 2000);

/* --------------------------- Asignación de canal -------------------------- */

function assignChannel(ch) {
  let S = slots[activeSlot] || slots[0];
  loadInto(S, ch);
  setActiveSlot(S.i);
}

/* ------------------------------- Lista (rail) ----------------------------- */

function getFiltered() {
  const q = els.search.value.trim().toLowerCase();
  if (!q) return allChannels;
  return allChannels.filter((ch) =>
    (ch.name + " " + ch.group).toLowerCase().includes(q)
  );
}

function playingUrls() {
  return new Set(slots.filter((s) => s.ch).map((s) => s.ch.url));
}

function renderList() {
  const channels = getFiltered();
  els.count.textContent = channels.length + (channels.length === 1 ? " canal" : " canales");

  if (channels.length === 0) {
    els.list.innerHTML = '<li class="state-msg">Sin coincidencias.</li>';
    return;
  }

  const active = playingUrls();
  const frag = document.createDocumentFragment();
  let lastGroup = null;

  for (const ch of channels) {
    if (ch.group !== lastGroup) {
      lastGroup = ch.group;
      const gl = document.createElement("li");
      gl.className = "group-label";
      gl.textContent = ch.group;
      frag.appendChild(gl);
    }

    const li = document.createElement("li");
    li.className = "channel" + (active.has(ch.url) ? " playing" : "");
    li.title = ch.name;

    if (ch.logo) {
      const img = document.createElement("img");
      img.className = "channel-logo";
      img.src = ch.logo; img.alt = ""; img.loading = "lazy";
      img.onerror = () => {
        const fb = document.createElement("div");
        fb.className = "channel-fallback";
        fb.textContent = "📺";
        img.replaceWith(fb);
      };
      li.appendChild(img);
    } else {
      const fb = document.createElement("div");
      fb.className = "channel-fallback";
      fb.textContent = "📺";
      li.appendChild(fb);
    }

    const info = document.createElement("div");
    info.className = "channel-info";
    const name = document.createElement("div");
    name.className = "channel-name";
    name.textContent = ch.name;
    const group = document.createElement("div");
    group.className = "channel-group";
    group.textContent = ch.group;
    info.append(name, group);
    li.appendChild(info);

    const tag = document.createElement("span");
    tag.className = "live-tag";
    tag.textContent = "LIVE";
    li.appendChild(tag);

    li.addEventListener("click", () => assignChannel(ch));
    frag.appendChild(li);
  }

  els.list.innerHTML = "";
  els.list.appendChild(frag);
}

/* --------------------------------- Eventos -------------------------------- */

let searchTimer = null;
els.search.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderList, 140);
});

els.layoutControls.querySelectorAll(".lc-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const next = parseInt(btn.dataset.grid, 10);
    els.layoutControls.querySelectorAll(".lc-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    changeGrid(next);
  });
});

function changeGrid(next) {
  if (next === gridSize) return;
  const prev = slots.map((s) => s.ch);
  gridSize = next;
  buildStage();
  prev.slice(0, gridSize).forEach((ch, i) => { if (ch) loadInto(slots[i], ch); });
  setActiveSlot(activeSlot);
  renderList();
}

function isMobile() { return window.matchMedia("(max-width: 1100px)").matches; }

function toggleRail() {
  const collapsed = els.rail.classList.toggle("collapsed");
  document.body.classList.toggle("rail-hidden", collapsed);
  if (isMobile()) document.body.classList.toggle("rail-open", !collapsed);
}
els.railToggle.addEventListener("click", toggleRail);
els.railBackdrop.addEventListener("click", () => {
  els.rail.classList.add("collapsed");
  document.body.classList.add("rail-hidden");
  document.body.classList.remove("rail-open");
});

/* --------------------------- Términos y Condiciones ----------------------- */

function openGate(force) {
  els.gate.hidden = false;
  requestAnimationFrame(() => els.gate.classList.add("show"));
  if (force) {
    // Modo "ver términos": permite cerrar sin re-aceptar si ya aceptó antes.
    els.gate.classList.add("review");
  }
}

function closeGate() {
  els.gate.classList.remove("show");
  setTimeout(() => { els.gate.hidden = true; els.gate.classList.remove("review"); }, 320);
}

els.gateAccept.addEventListener("change", () => {
  els.gateEnter.disabled = !els.gateAccept.checked;
});

els.gateEnter.addEventListener("click", () => {
  if (els.gate.classList.contains("review")) { closeGate(); return; }
  if (!els.gateAccept.checked) return;
  try { localStorage.setItem(TERMS_KEY, "1"); } catch (e) {}
  closeGate();
  bootApp();
});

function openReview() {
  els.gateAccept.checked = true;
  els.gateEnter.disabled = false;
  els.gateEnter.textContent = "Cerrar";
  openGate(true);
}
els.termsOpen.addEventListener("click", openReview);
if (els.termsOpen2) els.termsOpen2.addEventListener("click", openReview);

/* --------------------------------- Init ----------------------------------- */

async function bootApp() {
  if (booted) return;
  booted = true;
  buildStage();
  els.list.innerHTML = '<li class="state-msg">Cargando canales…</li>';
  try {
    const text = await fetchPlaylist();
    allChannels = parseM3U(text).filter((ch) => ch.url);
    if (allChannels.length === 0) {
      els.list.innerHTML = '<li class="state-msg error">La playlist no contiene canales.</li>';
      els.count.textContent = "0 canales";
      return;
    }
    renderList();
    assignChannel(allChannels[0]);
  } catch (err) {
    console.error(err);
    els.count.textContent = "Error";
    els.list.innerHTML =
      '<li class="state-msg error">No se pudieron cargar los canales. Revisa tu conexión.</li>';
  }
}

function init() {
  let accepted = false;
  try { accepted = localStorage.getItem(TERMS_KEY) === "1"; } catch (e) {}
  if (accepted) {
    bootApp();
  } else {
    openGate(false);
  }
}

init();

/* ------------------- Interfaz (navbar / hero / features) ------------------ */

function openRailPanel() {
  els.rail.classList.remove("collapsed");
  document.body.classList.remove("rail-hidden");
  if (isMobile()) document.body.classList.add("rail-open");
}
function closeRailPanel() {
  els.rail.classList.add("collapsed");
  document.body.classList.add("rail-hidden");
  document.body.classList.remove("rail-open");
}

// Contador de pantallas en la cabecera ("N PANTALLA(S)").
function updateScreenCount() {
  const countEl = document.getElementById("screen-count");
  const pluralEl = document.getElementById("screen-plural");
  if (countEl) countEl.textContent = String(gridSize);
  if (pluralEl) pluralEl.textContent = gridSize === 1 ? "" : "S";
}
document.querySelectorAll("#layout-controls .lc-btn").forEach((btn) => {
  btn.addEventListener("click", () => setTimeout(updateScreenCount, 0));
});
updateScreenCount();

// Navegación superior.
const navLinks = document.querySelectorAll(".nav-link");
function setActiveNav(el) {
  navLinks.forEach((n) => n.classList.toggle("active", n === el));
}
function scrollToStage() {
  const stageWrap = document.querySelector(".stage-wrap");
  if (stageWrap) stageWrap.scrollIntoView({ behavior: "smooth", block: "start" });
}

const navLive = document.getElementById("nav-live");
const navMulti = document.getElementById("nav-multi");
const navSports = document.getElementById("nav-sports");
const railClose = document.getElementById("rail-close");

function focusSearch() {
  if (els.search) setTimeout(() => { try { els.search.focus(); } catch (e) {} }, 60);
}

if (navLive) navLive.addEventListener("click", () => { setActiveNav(navLive); openRailPanel(); focusSearch(); });
if (navSports) navSports.addEventListener("click", () => { setActiveNav(navSports); scrollToStage(); });
if (navMulti) navMulti.addEventListener("click", () => {
  setActiveNav(navMulti);
  const gridBtn = document.querySelector('#layout-controls .lc-btn[data-grid="4"]');
  if (gridBtn) gridBtn.click();
  scrollToStage();
});
if (railClose) railClose.addEventListener("click", closeRailPanel);

// El botón "Buscar" enfoca el buscador (en escritorio el panel ya está visible).
if (els.railToggle) els.railToggle.addEventListener("click", focusSearch);
