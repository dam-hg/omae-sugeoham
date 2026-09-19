import { NEIGHBORHOOD, REGISTERED_BOXES, REGISTERED_DATA_SOURCE } from "./data.js";
import { getAllReports, getUserReports, addReport, getReportById } from "./store.js";
import { gradeOf, daysAgo, daysCompact, relTime, toast, escapeHtml, reverseGeocode, formatDateTime } from "./utils.js";
import { runDiagnosis } from "./diagnose.js";
import { loadGovBoxes, getRegionList, searchRegions, getBoxesForRegion, matchRegionFromAddress } from "./govboxes.js";

const app = document.getElementById("app");
const bottomnav = document.getElementById("bottomnav");

function freshDraft() {
  return { file: null, previewUrl: null, loc: null, locAddress: "", geocoding: false };
}

const state = {
  tab: "home",
  reportStep: "camera", // camera -> form -> loading -> preview -> submitted
  reportDraft: freshDraft(),
  lastResult: null,
};

const regionState = {
  loaded: false,
  loading: false,
  gpsPending: false,
  gpsDone: false,
  boxes: [],
  regionList: [],
  selected: null,
  activeList: "gov", // "gov" | "reports"
  view: "list", // "list" | "map"
  searchQuery: "",
};

const maps = { home: null, pin: null, dashboard: null };
let cameraStream = null;
let geocodeToken = 0;

function destroyMap(key) {
  if (maps[key]) {
    maps[key].remove();
    maps[key] = null;
  }
}
function destroyAllMaps() {
  Object.keys(maps).forEach(destroyMap);
}
function stopCameraStream() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
  }
}

/* ---------------------------------------------------------- */
/* NAV                                                          */
/* ---------------------------------------------------------- */
bottomnav.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-nav]");
  if (!btn) return;
  const tab = btn.dataset.nav;
  if (tab === "report") {
    state.reportStep = "camera";
    state.reportDraft = freshDraft();
  }
  setTab(tab);
});

function setTab(tab) {
  state.tab = tab;
  updateNavActive();
  render();
}

function startReportFlow() {
  state.reportStep = "camera";
  state.reportDraft = freshDraft();
  setTab("report");
}

function updateNavActive() {
  bottomnav.querySelectorAll(".nav-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.nav === state.tab);
  });
}

/* ---------------------------------------------------------- */
/* RENDER DISPATCH                                               */
/* ---------------------------------------------------------- */
function render() {
  destroyAllMaps();
  stopCameraStream();
  const fullBleed =
    (state.tab === "map" && regionState.view === "map") ||
    (state.tab === "report" && state.reportStep === "camera");
  app.classList.toggle("no-pad", fullBleed);
  if (state.tab === "home") renderHome();
  else if (state.tab === "report") renderReport();
  else if (state.tab === "map") renderMap();
  else if (state.tab === "mypage") renderMypage();
  window.scrollTo(0, 0);
}

/* ============================================================ */
/* HOME                                                          */
/* ============================================================ */
function renderHome() {
  const all = getAllReports();
  const unregCount = all.length;
  const dangerCount = all.filter((r) => currentGrade(r).key === "danger").length;
  const recent = [...all].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 5);

  app.innerHTML = `
    <div class="topbar">
      <div class="brand-wordmark">오매<span>!</span> 수거함</div>
    </div>
    <div class="topbar-sub">사진 한 장으로 시작하는 우리 동네 수거함 지도</div>

    <div class="cta-card" data-action="go-report">
      <div class="cta-eyebrow">🚩 방치 수거함 발견!</div>
      <p class="cta-title">쓰레기장 된 의류수거함,<br/>사진 한 장으로 신고하기</p>
      <p class="cta-sub">AI가 30초 만에 위험도를 진단해드려요</p>
      <div class="cta-arrow">›</div>
    </div>

    <div class="section">
      <div class="stat-row">
        <div class="stat-card info">
          <div class="stat-num">${REGISTERED_DATA_SOURCE.nationwideTotal.toLocaleString()}</div>
          <div class="stat-label">등록 수거함(전국)</div>
        </div>
        <div class="stat-card warn">
          <div class="stat-num">${unregCount}</div>
          <div class="stat-label">표준데이터 미등록</div>
        </div>
        <div class="stat-card danger">
          <div class="stat-num">${dangerCount}</div>
          <div class="stat-label">정비 시급 🔴</div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">우리 동네 지도 <small>탭하면 전체 지도로 이동</small></div>
      <div class="mini-map-wrap">
        <div id="home-mini-map"></div>
        <div class="mini-map-tap" data-action="go-map"></div>
        <div class="mini-map-badge">🗺️ 지도에서 자세히 보기</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">최근 제보 <small>실시간 업데이트</small></div>
      ${recent.length ? tickerHtml(recent) : `<div class="empty-note">아직 제보가 없어요. 첫 제보를 남겨보세요!</div>`}
    </div>

    <p class="foot-note">AI 진단 결과는 참고용이며, 최종 정비·계고 판단은 담당 공무원의 현장 확인을 거칩니다.</p>
  `;

  app.querySelectorAll("[data-action='go-report']").forEach((el) =>
    el.addEventListener("click", startReportFlow)
  );
  app.querySelectorAll("[data-action='go-map']").forEach((el) =>
    el.addEventListener("click", () => setTab("map"))
  );
  app.querySelectorAll("[data-open-report]").forEach((el) =>
    el.addEventListener("click", () => openReportModal(el.dataset.openReport))
  );

  initHomeMiniMap();
}

function tickerHtml(list) {
  const rows = list.map(tickerRowHtml).join("");
  const duration = list.length * 3.2;
  return `
    <div class="ticker-wrap">
      <div class="ticker-track" style="animation-duration:${duration}s">
        ${rows}
        ${rows}
      </div>
    </div>
  `;
}

function tickerRowHtml(r) {
  const g = currentGrade(r);
  const photoStyle = r.isSeed ? `background:${r.illustBg}` : `background-image:url('${r.photo}')`;
  return `
    <div class="ticker-row" data-open-report="${r.id}">
      <div class="ticker-thumb" style="${photoStyle}">${r.isSeed ? r.illust : ""}</div>
      <div class="ticker-mid">
        <p class="card-addr">${escapeHtml(r.addr)}</p>
        <div class="card-meta"><span class="grade-dot ${g.key}"></span>${g.emoji} ${g.label} · ${r.registered ? "등록" : "미등록"} · ${daysAgo(r.createdAt)}</div>
      </div>
    </div>
  `;
}

function currentGrade(r) {
  const last = r.history[r.history.length - 1];
  return gradeOf(last.score);
}

function initHomeMiniMap() {
  const el = document.getElementById("home-mini-map");
  if (!el || !window.L) return;
  const map = L.map(el, {
    center: NEIGHBORHOOD.center,
    zoom: NEIGHBORHOOD.zoom - 1,
    zoomControl: false,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    touchZoom: false,
    attributionControl: false,
  });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);
  REGISTERED_BOXES.forEach((b) =>
    L.circleMarker([b.lat, b.lng], { radius: 5, color: "#3182F6", fillColor: "#3182F6", fillOpacity: 0.9, weight: 1 }).addTo(map)
  );
  getAllReports().forEach((r) => {
    const g = currentGrade(r);
    const color = g.key === "danger" ? "#FF5A5F" : g.key === "warn" ? "#FF9F1C" : "#00C471";
    L.circleMarker([r.lat, r.lng], { radius: 5, color, fillColor: color, fillOpacity: 0.9, weight: 1 }).addTo(map);
  });
  maps.home = map;
}

/* ============================================================ */
/* REPORT FLOW — camera → form(location) → loading → result       */
/* ============================================================ */
function renderReport() {
  if (state.reportStep === "camera") renderCamera();
  else if (state.reportStep === "form") renderReportForm();
  else if (state.reportStep === "loading") renderReportLoading();
  else if (state.reportStep === "preview") renderReportPreview(state.lastResult);
  else if (state.reportStep === "submitted") renderReportSubmitted(state.lastResult);
}

function restartReportFlow() {
  state.lastResult = null;
  state.reportDraft = freshDraft();
  state.reportStep = "camera";
  render();
}

/* ---------------- camera step ---------------- */
function renderCamera() {
  app.innerHTML = `
    <div class="camera-view">
      <div class="camera-topbar">
        <button class="back-btn light" data-action="home-back">‹</button>
        <div class="camera-title">수거함 사진 촬영</div>
      </div>
      <div class="camera-stage">
        <video id="camera-video" autoplay playsinline muted></video>
        <div class="camera-hint" id="camera-hint">카메라를 켜는 중...</div>
      </div>
      <div class="camera-controls">
        <button class="camera-gallery-btn" id="camera-gallery-btn">🖼️<span>갤러리</span></button>
        <button class="camera-shutter" id="camera-shutter" disabled></button>
        <span class="camera-controls-spacer"></span>
      </div>
      <input type="file" accept="image/*" id="gallery-input" class="hidden" />
    </div>
  `;

  document.getElementById("gallery-input").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (f) proceedWithFile(f);
  });
  document.getElementById("camera-gallery-btn").addEventListener("click", () => {
    document.getElementById("gallery-input").click();
  });
  document.getElementById("camera-shutter").addEventListener("click", captureFromVideo);

  startCamera();
}

async function startCamera() {
  const video = document.getElementById("camera-video");
  const hint = document.getElementById("camera-hint");
  const shutter = document.getElementById("camera-shutter");
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    hint.textContent = "이 브라우저에서는 카메라를 지원하지 않아요. 갤러리에서 선택해주세요";
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
    if (state.reportStep !== "camera") {
      // 사용자가 그새 화면을 벗어났으면 바로 정리
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    cameraStream = stream;
    video.srcObject = stream;
    hint.classList.add("hidden");
    shutter.disabled = false;
  } catch (err) {
    hint.textContent = "카메라 접근이 거부됐어요. 갤러리에서 사진을 선택해주세요";
  }
}

function captureFromVideo() {
  const video = document.getElementById("camera-video");
  if (!video || !video.videoWidth) return;
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  canvas.toBlob(
    (blob) => {
      if (!blob) {
        toast("촬영에 실패했어요. 다시 시도해주세요");
        return;
      }
      const file = new File([blob], `capture_${Date.now()}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
      proceedWithFile(file);
    },
    "image/jpeg",
    0.9
  );
}

function proceedWithFile(file) {
  const d = state.reportDraft;
  d.file = file;
  d.previewUrl = URL.createObjectURL(file);
  stopCameraStream();
  state.reportStep = "form";
  render();
  attemptAutoGPS();
}

function goToCamera() {
  const d = state.reportDraft;
  d.file = null;
  d.previewUrl = null;
  state.reportStep = "camera";
  render();
}

/* ---------------- location step (배민/카카오T 스타일 중앙 고정핀) ---------------- */
function renderReportForm() {
  const d = state.reportDraft;
  app.innerHTML = `
    <div class="flow-header">
      <button class="back-btn" data-action="to-camera">‹</button>
      <div class="flow-title">위치 확인</div>
    </div>
    <div class="step-dots"><span class="on"></span><span class="on"></span><span></span></div>

    <div class="form-photo-row">
      <img src="${d.previewUrl}" class="form-photo-thumb" alt="촬영한 사진" />
      <div class="form-photo-info">
        <div class="form-photo-label">촬영한 사진</div>
        <div class="form-photo-sub">🔒 얼굴·번호판은 진단 시 자동 마스킹돼요</div>
      </div>
    </div>

    <div class="pin-map-wrap">
      <div id="pin-map-el"></div>
      <div class="center-pin">📍</div>
      <button class="recenter-btn" id="recenter-btn" aria-label="내 위치로 이동">🛰️</button>
    </div>
    <div class="loc-readout" id="loc-readout">${locReadoutText(d)}</div>

    <div class="fixed-bottom-btn">
      <button class="btn btn-primary" id="diagnose-btn" ${!(d.file && d.loc) ? "disabled" : ""}>
        AI 진단하기 →
      </button>
    </div>
  `;

  document.getElementById("recenter-btn").addEventListener("click", attemptAutoGPS);

  document.getElementById("diagnose-btn").addEventListener("click", async () => {
    if (!d.file || !d.loc) return;
    state.reportStep = "loading";
    render();
    try {
      const address = d.locAddress || (await reverseGeocode(d.loc.lat, d.loc.lng));
      const result = await runDiagnosis(d.file, d.loc, address);
      state.lastResult = result; // 아직 저장 전 — 사용자가 신고하기를 눌러야 확정
      state.reportStep = "preview";
      render();
    } catch (err) {
      console.error(err);
      toast("진단 중 오류가 발생했어요. 다시 시도해주세요");
      state.reportStep = "form";
      render();
    }
  });

  initPinMap();
  if (!d.loc) attemptAutoGPS();
}

function locReadoutText(d) {
  if (d.geocoding) return "주소 확인 중...";
  if (d.locAddress) return d.locAddress;
  return "위치를 확인하는 중이에요...";
}

function setLocReadoutText(text) {
  const el = document.getElementById("loc-readout");
  if (el) el.textContent = text;
}

function syncDiagnoseBtn() {
  const btn = document.getElementById("diagnose-btn");
  const d = state.reportDraft;
  if (btn) btn.disabled = !(d.file && d.loc);
}

function setLoc(loc) {
  const d = state.reportDraft;
  d.loc = loc;
  d.geocoding = true;
  syncDiagnoseBtn();
  setLocReadoutText("주소 확인 중...");
  const myToken = ++geocodeToken;
  reverseGeocode(loc.lat, loc.lng).then((addr) => {
    if (myToken !== geocodeToken) return; // 그 사이 위치가 또 바뀌었으면 무시
    d.locAddress = addr;
    d.geocoding = false;
    setLocReadoutText(addr);
  });
}

function panMapTo(lat, lng) {
  if (maps.pin) {
    maps.pin.setView([lat, lng], 17);
  } else {
    setLoc({ lat, lng });
  }
}

function attemptAutoGPS() {
  setLocReadoutText("GPS 위치를 확인하는 중...");
  if (!navigator.geolocation) {
    toast("이 브라우저에서는 위치 확인이 지원되지 않아요. 지도를 움직여 위치를 선택해주세요");
    panMapTo(NEIGHBORHOOD.center[0], NEIGHBORHOOD.center[1]);
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => panMapTo(pos.coords.latitude, pos.coords.longitude),
    () => {
      toast("위치 확인에 실패했어요. 지도를 움직여 정확한 위치를 선택해주세요");
      panMapTo(NEIGHBORHOOD.center[0], NEIGHBORHOOD.center[1]);
    },
    { timeout: 8000, enableHighAccuracy: true }
  );
}

function initPinMap() {
  const el = document.getElementById("pin-map-el");
  if (!el || !window.L) return;
  const d = state.reportDraft;
  const center = d.loc ? [d.loc.lat, d.loc.lng] : NEIGHBORHOOD.center;
  const map = L.map(el, { center, zoom: 17, zoomControl: false });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap",
  }).addTo(map);
  L.control.zoom({ position: "bottomright" }).addTo(map);

  // 배달의민족/카카오T 방식: 핀은 화면 중앙에 고정, 지도를 움직여 핀 아래 위치를 고른다
  map.on("moveend", () => {
    const c = map.getCenter();
    setLoc({ lat: c.lat, lng: c.lng });
  });

  maps.pin = map;
}

function renderReportLoading() {
  app.innerHTML = `
    <div class="flow-header">
      <div class="flow-title">수거함 신고하기</div>
    </div>
    <div class="step-dots"><span class="on"></span><span class="on"></span><span class="on"></span></div>
    <div class="loading-wrap">
      <div class="spinner"></div>
      <div class="loading-title">사진을 분석하고 있어요</div>
      <div class="loading-sub">얼굴·번호판 마스킹 처리 중 🔒<br/>포화·투기물·파손·관리자 표시 진단 중...</div>
    </div>
  `;
}

function renderReportPreview(r) {
  app.innerHTML = `
    <div class="flow-header">
      <button class="back-btn" data-action="home-back">‹</button>
      <div class="flow-title">진단 리포트</div>
    </div>
    <div class="step-dots"><span class="on"></span><span class="on"></span><span class="on"></span></div>
    ${buildReportDashboard(r)}
    <div class="result-actions">
      <button class="btn btn-primary" id="confirm-report-btn">🚩 신고하기</button>
      <button class="btn btn-outline" id="retry-btn">🔄 다시하기</button>
    </div>
  `;
  document.getElementById("confirm-report-btn").addEventListener("click", () => {
    addReport(r);
    state.reportStep = "submitted";
    render();
  });
  document.getElementById("retry-btn").addEventListener("click", restartReportFlow);
}

function renderReportSubmitted(r) {
  const all = getAllReports();
  const totalCount = all.length;
  const dangerCount = all.filter((x) => currentGrade(x).key === "danger").length;

  app.innerHTML = `
    <div class="flow-header">
      <div class="flow-title">민원 제출하기</div>
    </div>
    <div class="step-dots"><span class="on"></span><span class="on"></span><span class="on"></span></div>

    <div class="submit-success">✅ 제보가 저장됐어요!</div>

    <div class="impact-banner">
      <div class="impact-title">📢 민원이 쌓일수록, 정비는 빨라집니다</div>
      <p class="impact-desc">같은 방치 수거함에 반복 신고가 누적될수록 지자체 우선 정비 대상으로 분류돼요. 지금 안전신문고에 접수하면 실제 행정 처리로 이어집니다.</p>
      <div class="impact-stats">
        <div><strong>${totalCount}</strong><span>우리 동네 누적 제보</span></div>
        <div><strong>${dangerCount}</strong><span>정비 시급 🔴</span></div>
      </div>
    </div>

    ${buildDraftCardHtml(r)}

    <div class="result-actions">
      <button class="btn btn-dark" id="go-safety-btn">🏛️ 자치구에 민원넣기</button>
      <button class="btn btn-outline" id="home-btn">홈으로</button>
    </div>
  `;

  document.getElementById("home-btn").addEventListener("click", () => setTab("home"));
  document.getElementById("go-safety-btn").addEventListener("click", async () => {
    const text = r.draft || buildFallbackDraft(r);
    try {
      await navigator.clipboard.writeText(text);
      toast("민원 내용이 복사됐어요! 안전신문고에 붙여넣기 해주세요");
    } catch (e) {
      /* 복사 실패해도 이동은 진행 */
    }
    window.open("https://www.safetyreport.go.kr/", "_blank", "noopener");
  });
  bindCopyButtons(r);
}

function buildDraftCardHtml(r) {
  return `
    <div class="draft-card">
      <div class="draft-head"><strong>📝 민원 초안</strong><span class="card-meta">기존 신고 채널에 바로 제출 가능</span></div>
      <textarea class="draft-textarea" id="draft-text" readonly>${escapeHtml(r.draft || buildFallbackDraft(r))}</textarea>
      <div class="draft-actions">
        <button class="btn btn-ghost" data-copy="${r.id}">📋 복사하기</button>
      </div>
    </div>
  `;
}

function buildReportDashboard(r) {
  const g = gradeOf(r.score !== undefined ? r.score : r.history[r.history.length - 1].score);
  const score = r.score !== undefined ? r.score : r.history[r.history.length - 1].score;
  const labels = r.labels || r.history[r.history.length - 1].labels;
  const reasons = r.reasons || r.history[r.history.length - 1].reasons;
  const gaugeDeg = Math.round((score / 100) * 360);
  const gaugeColor = g.key === "danger" ? "#FF5A5F" : g.key === "warn" ? "#FF9F1C" : "#00C471";
  const photoHtml = r.isSeed
    ? `<div style="height:220px;display:flex;align-items:center;justify-content:center;font-size:56px;background:${r.illustBg}">${r.illust}</div>`
    : `<img src="${r.photo}" alt="진단 사진" />`;

  const items = [
    { key: "noManager", label: "관리자 표시 없음", pts: 50 },
    { key: "dump", label: "주변 투기물 발생", pts: 30 },
    { key: "satur", label: "포화 상태", pts: 10 },
    { key: "damage", label: "파손·노후", pts: 10 },
  ];
  const flagSet = new Set(labels.map((l) => l));
  const labelToKey = { "관리자 표시 없음": "noManager", "주변 투기물 발생": "dump", "포화": "satur", "파손·노후": "damage" };

  return `
    <div class="report-meta">📋 진단 리포트 · ${formatDateTime(r.history[r.history.length - 1].date)}</div>

    <div class="result-photo">
      ${photoHtml}
      <span class="mask-tag">🔒 개인정보 자동 마스킹 처리됨</span>
    </div>
    <div class="chips-row">
      ${labels.map((l) => `<span class="state-chip ${l !== "정상" ? "flag" : ""}">${l}</span>`).join("")}
    </div>

    <div class="section-label">종합 요약</div>
    <div class="summary-grid">
      <div class="summary-tile">
        <div class="summary-gauge" style="background:conic-gradient(${gaugeColor} ${gaugeDeg}deg, #EFEFEF 0deg)">
          <span>${score}</span>
        </div>
        <div class="summary-tile-label">위험도 점수</div>
      </div>
      <div class="summary-tile">
        <div class="summary-big" style="color:${gaugeColor}">${g.emoji}</div>
        <div class="summary-tile-label">${g.label}</div>
      </div>
      <div class="summary-tile">
        <div class="summary-big ${r.registered ? "" : "danger-text"}">${r.registered ? "등록" : "미등록"}</div>
        <div class="summary-tile-label">표준데이터</div>
      </div>
      <div class="summary-tile">
        <div class="summary-big">${daysCompact(r.createdAt)}</div>
        <div class="summary-tile-label">방치 이력</div>
      </div>
    </div>

    <div class="section-label">세부 진단 근거</div>
    <div class="breakdown-card">
      ${items
        .map((it) => {
          const on = [...flagSet].some((l) => labelToKey[l] === it.key);
          const reasonText = reasons.find((rs) => rs.includes(it.label));
          return `
          <div class="bd-row">
            <div class="bd-left">
              <div class="bd-name">${on ? "🔴" : "⚪️"} ${it.label}</div>
              ${on && reasonText ? `<div class="bd-reason">${escapeHtml(reasonText.replace(/\s*\(.*?\)$/, ""))}</div>` : ""}
            </div>
            <div class="bd-pts ${on ? "on" : ""}">${on ? "+" + it.pts : "0"}점</div>
          </div>`;
        })
        .join("")}
    </div>

    <div class="notice-banner">⚠️ <span>AI 진단은 참고용입니다. 실제 정비 여부는 반드시 <b>현장 확인</b>을 거쳐 결정됩니다.</span></div>
  `;
}

function buildFallbackDraft(r) {
  const last = r.history[r.history.length - 1];
  return `[오매! 수거함 제보]\n위치: ${r.addr}\n상태: ${last.labels.join(", ")}\n위험도: ${last.score}점`;
}

function bindCopyButtons(r) {
  app.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const text = document.getElementById("draft-text").value;
      try {
        await navigator.clipboard.writeText(text);
        toast("민원 초안이 복사되었어요 📋");
      } catch (e) {
        toast("복사에 실패했어요. 직접 선택해 복사해주세요");
      }
    });
  });
}

/* ============================================================ */
/* 동네 탭 — 시군구 검색 → 표준데이터/신고 목록 ↔ 지도                */
/* ============================================================ */
function renderMap() {
  if (!regionState.loaded) {
    renderRegionLoading("전국 표준데이터를 불러오는 중...");
    if (!regionState.loading) {
      regionState.loading = true;
      loadGovBoxes().then((boxes) => {
        regionState.boxes = boxes;
        regionState.regionList = getRegionList();
        regionState.loaded = true;
        regionState.loading = false;
        detectRegionFromGPS();
      });
    }
    return;
  }
  if (!regionState.selected) {
    renderRegionPrompt();
    return;
  }
  if (regionState.view === "map") renderRegionMap();
  else renderRegionList();
}

function detectRegionFromGPS() {
  if (regionState.selected || regionState.gpsDone) {
    render();
    return;
  }
  if (!navigator.geolocation) {
    regionState.gpsDone = true;
    render();
    return;
  }
  regionState.gpsPending = true;
  render();
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      try {
        const addr = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
        const match = matchRegionFromAddress(regionState.regionList, addr);
        if (match) regionState.selected = { sido: match.sido, sigungu: match.sigungu };
      } catch (e) {
        /* 위치 인식 실패 시 검색 안내 화면으로 대체 */
      }
      regionState.gpsPending = false;
      regionState.gpsDone = true;
      if (state.tab === "map") render();
    },
    () => {
      regionState.gpsPending = false;
      regionState.gpsDone = true;
      if (state.tab === "map") render();
    },
    { timeout: 8000 }
  );
}

function renderRegionLoading(message) {
  app.innerHTML = `
    <div class="topbar"><div class="brand-wordmark">우리 동네 조회</div></div>
    <div class="loading-wrap">
      <div class="spinner"></div>
      <div class="loading-title">${message}</div>
    </div>
  `;
}

function renderRegionPrompt() {
  app.innerHTML = `
    <div class="topbar"><div class="brand-wordmark">우리 동네 조회</div></div>
    <div class="region-search-row">
      <input type="text" id="region-search" class="region-search-input" placeholder="시/군/구 검색 (예: 강남구)" value="${escapeHtml(regionState.searchQuery)}" />
    </div>
    <div id="region-suggest" class="region-suggest ${regionState.searchQuery ? "" : "hidden"}"></div>
    <div class="empty-note" style="margin:0 20px;">
      ${regionState.gpsPending ? "현재 위치를 확인하는 중이에요..." : "현재 위치를 확인하지 못했어요. 위 검색창에서 동네를 찾아보세요."}
    </div>
  `;
  bindRegionControls();
}

function currentRegionBoxes() {
  return getBoxesForRegion(regionState.boxes, regionState.selected.sido, regionState.selected.sigungu);
}

function currentRegionReports() {
  const sigungu = regionState.selected.sigungu;
  return getAllReports()
    .filter((r) => r.addr && r.addr.includes(sigungu))
    .map((r) => {
      const last = r.history[r.history.length - 1];
      return { r, last, g: gradeOf(last.score) };
    })
    .sort((a, b) => b.last.score - a.last.score);
}

function renderRegionHeaderHtml() {
  const sel = regionState.selected;
  return `
    <div class="region-search-row">
      <input type="text" id="region-search" class="region-search-input" placeholder="시/군/구 검색 (예: 강남구)" value="${escapeHtml(regionState.searchQuery)}" />
    </div>
    <div id="region-suggest" class="region-suggest ${regionState.searchQuery ? "" : "hidden"}"></div>
    <div class="region-current">📍 <b>${escapeHtml(sel.sido)} ${escapeHtml(sel.sigungu)}</b></div>
    <div class="region-tabs">
      <button class="region-tab-btn ${regionState.activeList === "gov" ? "active" : ""}" data-list="gov">모든 수거함 <span class="region-tab-count">${currentRegionBoxes().length}</span></button>
      <button class="region-tab-btn ${regionState.activeList === "reports" ? "active" : ""}" data-list="reports">신고된 수거함 <span class="region-tab-count">${currentRegionReports().length}</span></button>
    </div>
  `;
}

function renderRegionList() {
  const govList = currentRegionBoxes();
  const reportList = currentRegionReports();
  const rows =
    regionState.activeList === "gov"
      ? govList.length
        ? govList.map(govRowHtml).join("")
        : `<div class="empty-note">이 지역엔 표준데이터에 등록된 수거함이 없어요.</div>`
      : reportList.length
      ? reportList.map(reportRowHtml).join("")
      : `<div class="empty-note">이 지역엔 아직 신고된 수거함이 없어요.</div>`;

  app.innerHTML = `
    <div class="topbar"><div class="brand-wordmark">우리 동네 조회</div></div>
    ${renderRegionHeaderHtml()}
    <div class="region-list">${rows}</div>
    <div class="map-toggle-fab-wrap"><button class="map-toggle-fab" id="to-map-view">🗺️ 지도로 보기</button></div>
  `;

  bindRegionControls();
  document.getElementById("to-map-view").addEventListener("click", () => {
    regionState.view = "map";
    render();
  });
}

function govRowHtml(b) {
  return `
    <div class="region-row">
      <div class="region-row-icon">🔵</div>
      <div class="region-row-mid">
        <div class="priority-addr">${escapeHtml(b.name || b.addr)}</div>
        <div class="priority-meta">${escapeHtml(b.addr)}</div>
      </div>
    </div>
  `;
}

function reportRowHtml({ r, g, last }) {
  return `
    <div class="region-row" data-open-report="${r.id}">
      <div class="region-row-icon">${g.emoji}</div>
      <div class="region-row-mid">
        <div class="priority-addr">${escapeHtml(r.addr)}</div>
        <div class="priority-meta">${g.label} · ${r.registered ? "등록" : "미등록"} · ${daysAgo(r.createdAt)}</div>
      </div>
      <div class="priority-score" style="color:${g.key === "danger" ? "#FF5A5F" : g.key === "warn" ? "#FF9F1C" : "#00C471"}">${last.score}점</div>
    </div>
  `;
}

function bindRegionControls() {
  const input = document.getElementById("region-search");
  input.addEventListener("input", (e) => {
    regionState.searchQuery = e.target.value;
    renderRegionSuggestions();
  });
  input.addEventListener("focus", renderRegionSuggestions);

  app.querySelectorAll(".region-tab-btn").forEach((btn) =>
    btn.addEventListener("click", () => {
      regionState.activeList = btn.dataset.list;
      renderRegionList();
    })
  );

  app.querySelectorAll("[data-open-report]").forEach((el) =>
    el.addEventListener("click", () => openReportModal(el.dataset.openReport))
  );
}

function renderRegionSuggestions() {
  const box = document.getElementById("region-suggest");
  if (!box) return;
  if (!regionState.searchQuery.trim()) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }
  const matches = searchRegions(regionState.regionList, regionState.searchQuery).slice(0, 8);
  box.classList.remove("hidden");
  box.innerHTML = matches.length
    ? matches
        .map(
          (m) =>
            `<div class="region-suggest-row" data-sido="${escapeHtml(m.sido)}" data-sigungu="${escapeHtml(m.sigungu)}">${escapeHtml(m.sido)} ${escapeHtml(m.sigungu)} <span class="region-tab-count">${m.count}</span></div>`
        )
        .join("")
    : `<div class="region-suggest-row empty">검색 결과가 없어요</div>`;

  box.querySelectorAll("[data-sido]").forEach((row) =>
    row.addEventListener("click", () => {
      regionState.selected = { sido: row.dataset.sido, sigungu: row.dataset.sigungu };
      regionState.searchQuery = "";
      render();
    })
  );
}

function renderRegionMap() {
  app.innerHTML = `
    <div class="map-view-wrap">
      <div id="dashboard-map"></div>
      <div class="map-legend">
        <span><span class="legend-dot" style="background:#3182F6"></span>등록(표준데이터)</span>
        <span><span class="legend-dot" style="background:#00C471"></span>관찰</span>
        <span><span class="legend-dot" style="background:#FF9F1C"></span>정비 권고</span>
        <span><span class="legend-dot" style="background:#FF5A5F"></span>정비 시급</span>
      </div>
      <button class="list-toggle-btn" id="to-list-view">📋 목록으로</button>
    </div>
  `;
  document.getElementById("to-list-view").addEventListener("click", () => {
    regionState.view = "list";
    render();
  });
  initRegionMap();
}

function initRegionMap() {
  const el = document.getElementById("dashboard-map");
  if (!el || !window.L) return;
  const govList = currentRegionBoxes();
  const reportList = currentRegionReports();
  const points = [...govList.map((b) => [b.lat, b.lng]), ...reportList.map(({ r }) => [r.lat, r.lng])];
  const center = points.length
    ? points.reduce((acc, p) => [acc[0] + p[0] / points.length, acc[1] + p[1] / points.length], [0, 0])
    : NEIGHBORHOOD.center;

  const map = L.map(el, { center, zoom: points.length ? 14 : NEIGHBORHOOD.zoom });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  govList.forEach((b) => {
    const m = L.circleMarker([b.lat, b.lng], {
      radius: 7, color: "#fff", weight: 2, fillColor: "#3182F6", fillOpacity: 1,
    }).addTo(map);
    m.bindPopup(`<div class="popup-title">🔵 등록 수거함</div>${escapeHtml(b.name || b.addr)}<br/>${escapeHtml(b.addr)}`);
  });

  reportList.forEach(({ r, g, last }) => {
    const color = g.key === "danger" ? "#FF5A5F" : g.key === "warn" ? "#FF9F1C" : "#00C471";
    const m = L.circleMarker([r.lat, r.lng], {
      radius: 9, color: "#fff", weight: 2, fillColor: color, fillOpacity: 1,
    }).addTo(map);
    const thumb = r.isSeed
      ? `<div class="popup-thumb" style="display:flex;align-items:center;justify-content:center;font-size:28px;background:${r.illustBg}">${r.illust}</div>`
      : `<img class="popup-thumb" src="${r.photo}" />`;
    m.bindPopup(`
      ${thumb}
      <div class="popup-title">${g.emoji} ${g.label} · ${last.score}점</div>
      ${escapeHtml(r.addr)}<br/>
      ${r.registered ? "표준데이터 등록" : "⚠️ 표준데이터 미등록"} · ${daysAgo(r.createdAt)}
      <div class="popup-btn" data-open-report="${r.id}">민원 초안 보기</div>
    `);
  });

  map.on("popupopen", (e) => {
    const btn = e.popup._contentNode.querySelector("[data-open-report]");
    if (btn) btn.addEventListener("click", () => openReportModal(btn.dataset.openReport));
  });

  maps.dashboard = map;
}

/* ============================================================ */
/* MYPAGE                                                         */
/* ============================================================ */
function renderMypage() {
  const mine = getUserReports();
  app.innerHTML = `
    <div class="topbar"><div class="brand-wordmark">마이 페이지</div></div>
    <div class="topbar-sub">내가 제출한 제보 내역 (${mine.length}건)</div>
    <div class="section">
      ${
        mine.length
          ? mine.map(myRowHtml).join("")
          : `<div class="empty-note">아직 제출한 제보가 없어요.<br/>방치된 수거함을 발견하면 신고해보세요!</div>`
      }
    </div>
    ${
      !mine.length
        ? `<div class="section"><button class="btn btn-primary" id="mypage-cta">📷 첫 제보 남기기</button></div>`
        : ""
    }
  `;
  const cta = document.getElementById("mypage-cta");
  if (cta) cta.addEventListener("click", startReportFlow);
  app.querySelectorAll("[data-open-report]").forEach((el) =>
    el.addEventListener("click", () => openReportModal(el.dataset.openReport))
  );
}

function myRowHtml(r) {
  const g = currentGrade(r);
  return `
    <div class="my-report-row" data-open-report="${r.id}">
      <div class="my-thumb" style="${r.isSeed ? `background:${r.illustBg}` : `background-image:url('${r.photo}')`}">${r.isSeed ? r.illust : ""}</div>
      <div class="priority-mid">
        <div class="priority-addr">${escapeHtml(r.addr)}</div>
        <div class="priority-meta">${g.emoji} ${g.label} · ${relTime(r.createdAt)}</div>
      </div>
      <div class="priority-score" style="color:${g.key === "danger" ? "#FF5A5F" : g.key === "warn" ? "#FF9F1C" : "#00C471"}">${r.history[r.history.length - 1].score}점</div>
    </div>
  `;
}

/* ============================================================ */
/* REPORT DETAIL MODAL                                            */
/* ============================================================ */
function openReportModal(id) {
  const r = getReportById(id);
  if (!r) return;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-head"><button class="sheet-close" id="modal-close">✕</button></div>
      ${buildReportDashboard(normalizeForModal(r))}
      ${buildDraftCardHtml(normalizeForModal(r))}
    </div>
  `;
  document.body.appendChild(backdrop);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) backdrop.remove();
  });
  backdrop.querySelector("#modal-close").addEventListener("click", () => backdrop.remove());
  backdrop.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const text = backdrop.querySelector("#draft-text").value;
      try {
        await navigator.clipboard.writeText(text);
        toast("민원 초안이 복사되었어요 📋");
      } catch (e) {
        toast("복사에 실패했어요");
      }
    });
  });
}

function normalizeForModal(r) {
  const last = r.history[r.history.length - 1];
  return {
    ...r,
    score: last.score,
    labels: last.labels,
    reasons: last.reasons,
    draft: r.draft || buildFallbackDraft(r),
  };
}

/* ============================================================ */
app.addEventListener("click", (e) => {
  if (e.target.closest("[data-action='home-back']")) setTab("home");
  if (e.target.closest("[data-action='to-camera']")) goToCamera();
});

setTab("home");
