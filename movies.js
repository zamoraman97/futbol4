"use strict";

/**
 * Futbol4 — Sección de Películas (VOD) en español.
 * Fuente: Internet Archive (dominio público). Busca vía advancedsearch,
 * resuelve archivos MP4 vía metadata y reproduce en un modal HTML5.
 */

const IA_SEARCH = "https://archive.org/advancedsearch.php";
const IA_META = "https://archive.org/metadata/";
const IA_IMG = "https://archive.org/services/img/";
const IA_DL = "https://archive.org/download/";
const ROWS = 48;

// Cada filtro añade condiciones a la query base.
// "all" se restringe a la colección feature_films (películas reales curadas);
// los géneros usan subject amplio para maximizar cantidad.
const FILTERS = {
  all: "AND collection:(feature_films)",
  "cine-oro": 'AND (subject:(cine de oro) OR subject:(mexicano) OR "época de oro" OR "epoca de oro")',
  terror: "AND subject:(terror OR horror)",
  comedia: "AND subject:(comedia OR comedy)",
  accion: "AND subject:(accion OR action OR aventura OR adventure)",
  scifi: 'AND subject:("ciencia ficcion" OR "science fiction" OR "sci-fi" OR scifi)',
};

const BASE_Q = "mediatype:movies AND language:(Spanish OR Español OR spa OR castellano)";

const mEls = {};
let mState = { q: "", filter: "all", page: 1, loading: false, done: false, total: 0 };

function grabEls() {
  mEls.view = document.getElementById("movies-view");
  mEls.search = document.getElementById("movies-search-input");
  mEls.filters = document.getElementById("movies-filters");
  mEls.grid = document.getElementById("movies-grid");
  mEls.count = document.getElementById("movies-count");
  mEls.loadMore = document.getElementById("movies-load-more");
  mEls.loader = document.getElementById("movies-loader");
  mEls.modal = document.getElementById("movie-modal");
  mEls.modalBackdrop = document.getElementById("movie-modal-backdrop");
  mEls.modalClose = document.getElementById("movie-modal-close");
  mEls.video = document.getElementById("movie-video");
  mEls.videoStatus = document.getElementById("movie-video-status");
  mEls.mTitle = document.getElementById("movie-modal-title");
  mEls.mSub = document.getElementById("movie-modal-sub");
  mEls.mQuality = document.getElementById("movie-quality");
  mEls.mDesc = document.getElementById("movie-modal-desc");
}

/* ------------------------------- Búsqueda -------------------------------- */

function buildQuery() {
  let q = BASE_Q + " " + (FILTERS[mState.filter] || "");
  if (mState.q) {
    const safe = mState.q.replace(/["\\]/g, " ").trim();
    if (safe) q += ` AND (title:(${safe}) OR description:(${safe}) OR subject:(${safe}))`;
  }
  return q.trim();
}

function searchUrl() {
  const params = new URLSearchParams();
  params.set("q", buildQuery());
  params.append("fl[]", "identifier");
  params.append("fl[]", "title");
  params.append("fl[]", "year");
  params.append("fl[]", "downloads");
  params.append("sort[]", "downloads desc");
  params.set("rows", String(ROWS));
  params.set("page", String(mState.page));
  params.set("output", "json");
  return IA_SEARCH + "?" + params.toString();
}

async function fetchPage() {
  if (mState.loading || mState.done) return;
  mState.loading = true;
  setLoader(true);
  try {
    const res = await fetch(searchUrl(), { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const docs = (data.response && data.response.docs) || [];
    mState.total = (data.response && data.response.numFound) || 0;
    if (mState.page === 1) mEls.grid.innerHTML = "";
    renderCards(docs);
    updateCount();
    if (docs.length < ROWS || mEls.grid.children.length >= mState.total) {
      mState.done = true;
    }
    mEls.loadMore.hidden = mState.done;
    if (mState.page === 1 && docs.length === 0) {
      mEls.grid.innerHTML = '<div class="movies-empty">Sin resultados. Prueba otra búsqueda o filtro.</div>';
    }
  } catch (err) {
    console.error("movies fetch", err);
    if (mState.page === 1) {
      mEls.grid.innerHTML = '<div class="movies-empty error">No se pudieron cargar las películas. Revisa tu conexión.</div>';
      mEls.count.textContent = "Error";
    }
  } finally {
    mState.loading = false;
    setLoader(false);
  }
}

function setLoader(on) {
  if (mEls.loader) mEls.loader.classList.toggle("hidden", !on);
}

function updateCount() {
  const shown = mEls.grid.querySelectorAll(".movie-card").length;
  mEls.count.textContent = shown + " de ~" + mState.total.toLocaleString("es") + " películas";
}

/* -------------------------------- Render --------------------------------- */

function renderCards(docs) {
  const frag = document.createDocumentFragment();
  for (const d of docs) {
    if (!d.identifier) continue;
    const card = document.createElement("button");
    card.className = "movie-card";
    card.title = d.title || d.identifier;

    const posterWrap = document.createElement("div");
    posterWrap.className = "movie-poster";
    const img = document.createElement("img");
    img.loading = "lazy";
    img.alt = "";
    img.src = IA_IMG + encodeURIComponent(d.identifier);
    img.onerror = () => {
      posterWrap.classList.add("no-img");
      img.remove();
      const ic = document.createElement("span");
      ic.className = "poster-fallback";
      ic.textContent = "🎬";
      posterWrap.appendChild(ic);
    };
    const play = document.createElement("span");
    play.className = "movie-play";
    play.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
    posterWrap.append(img, play);

    const meta = document.createElement("div");
    meta.className = "movie-card-meta";
    const t = document.createElement("div");
    t.className = "movie-card-title";
    t.textContent = d.title || d.identifier;
    const y = document.createElement("div");
    y.className = "movie-card-year";
    y.textContent = d.year || "";
    meta.append(t, y);

    card.append(posterWrap, meta);
    card.addEventListener("click", () => openMovie(d));
    frag.appendChild(card);
  }
  mEls.grid.appendChild(frag);
}

/* ---------------------------- Reproducción ------------------------------- */

function pickMp4s(files) {
  const mp4 = files.filter((f) => /\.mp4$/i.test(f.name || ""));
  // Etiqueta cada archivo con una calidad legible.
  return mp4.map((f) => {
    let label = "SD";
    if (/512kb/i.test(f.name)) label = "512kbps";
    else if (/HD|1080|720/i.test(f.name)) label = "HD";
    else if (/\.mp4$/i.test(f.name)) label = "Original";
    const mb = f.size ? Math.round(Number(f.size) / 1e6) : null;
    return { name: f.name, label, mb };
  });
}

function defaultMp4(list) {
  // Prioriza 512kb para arranque rápido; si no, el primero.
  return list.find((x) => x.label === "512kbps") || list[0];
}

async function openMovie(doc) {
  openModal();
  mEls.mTitle.textContent = doc.title || doc.identifier;
  mEls.mSub.textContent = doc.year ? "Año " + doc.year : "";
  mEls.mDesc.textContent = "";
  mEls.mQuality.innerHTML = "";
  setVideoStatus("Cargando película…");
  mEls.video.removeAttribute("src");
  mEls.video.load();

  try {
    const res = await fetch(IA_META + encodeURIComponent(doc.identifier), { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const meta = await res.json();
    const files = (meta.files || []);
    const mp4s = pickMp4s(files);
    if (mp4s.length === 0) {
      setVideoStatus("Esta película no tiene un formato reproducible en el navegador.", true);
      return;
    }
    if (meta.metadata && meta.metadata.description) {
      const raw = Array.isArray(meta.metadata.description) ? meta.metadata.description[0] : meta.metadata.description;
      mEls.mDesc.textContent = String(raw).replace(/<[^>]+>/g, "").slice(0, 500);
    }
    buildQualityButtons(doc.identifier, mp4s);
    playFile(doc.identifier, defaultMp4(mp4s));
  } catch (err) {
    console.error("movie meta", err);
    setVideoStatus("No se pudo cargar la película. Intenta con otra.", true);
  }
}

function buildQualityButtons(id, list) {
  mEls.mQuality.innerHTML = "";
  if (list.length <= 1) return;
  const lbl = document.createElement("span");
  lbl.className = "mq-label";
  lbl.textContent = "Calidad:";
  mEls.mQuality.appendChild(lbl);
  list.forEach((f) => {
    const b = document.createElement("button");
    b.className = "mq-btn";
    b.textContent = f.label + (f.mb ? " · " + f.mb + "MB" : "");
    b.addEventListener("click", () => {
      mEls.mQuality.querySelectorAll(".mq-btn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      playFile(id, f);
    });
    mEls.mQuality.appendChild(b);
  });
}

function playFile(id, f) {
  if (!f) return;
  const url = IA_DL + encodeURIComponent(id) + "/" + encodeURIComponent(f.name);
  const t = mEls.video.currentTime || 0;
  setVideoStatus("");
  mEls.video.src = url;
  mEls.video.load();
  mEls.video.play().catch(() => {});
  // Marca la calidad activa por defecto.
  const btns = mEls.mQuality.querySelectorAll(".mq-btn");
  btns.forEach((b) => {
    if (b.textContent.startsWith(f.label)) b.classList.add("active");
  });
  mEls.video.onerror = () => setVideoStatus("Error al reproducir este archivo. Prueba otra calidad.", true);
}

function setVideoStatus(msg, isError) {
  if (!mEls.videoStatus) return;
  if (!msg) { mEls.videoStatus.classList.add("hidden"); mEls.videoStatus.textContent = ""; return; }
  mEls.videoStatus.classList.remove("hidden");
  mEls.videoStatus.classList.toggle("error", !!isError);
  mEls.videoStatus.textContent = msg;
}

/* --------------------------------- Modal --------------------------------- */

function openModal() {
  mEls.modal.hidden = false;
  requestAnimationFrame(() => mEls.modal.classList.add("show"));
  document.body.classList.add("modal-open");
}

function closeModal() {
  mEls.modal.classList.remove("show");
  mEls.video.pause();
  mEls.video.removeAttribute("src");
  mEls.video.load();
  document.body.classList.remove("modal-open");
  setTimeout(() => { mEls.modal.hidden = true; }, 280);
}

/* --------------------------------- Init ---------------------------------- */

function resetAndSearch() {
  mState.page = 1;
  mState.done = false;
  fetchPage();
}

let mSearchTimer = null;

window.initMovies = function initMovies() {
  grabEls();
  if (!mEls.grid) return;

  mEls.search.addEventListener("input", () => {
    clearTimeout(mSearchTimer);
    mSearchTimer = setTimeout(() => {
      mState.q = mEls.search.value.trim();
      resetAndSearch();
    }, 350);
  });

  mEls.filters.querySelectorAll(".mf-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      mEls.filters.querySelectorAll(".mf-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      mState.filter = btn.dataset.filter;
      resetAndSearch();
    });
  });

  mEls.loadMore.addEventListener("click", () => { mState.page++; fetchPage(); });
  mEls.modalClose.addEventListener("click", closeModal);
  mEls.modalBackdrop.addEventListener("click", closeModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && mEls.modal && !mEls.modal.hidden) closeModal();
  });

  fetchPage();
};
