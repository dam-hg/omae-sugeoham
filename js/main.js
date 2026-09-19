import { NEIGHBORHOOD, REGISTERED_BOXES } from "./data.js";
import { getAllReports, getUserReports, addReport, getReportById } from "./store.js";
import { gradeOf, daysAgo, daysCompact, relTime, toast, escapeHtml, reverseGeocode, formatDateTime } from "./utils.js";
import { runDiagnosis } from "./diagnose.js";

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
  sheetOpen: false,
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
  const fullBleed = state.tab === "map" || (state.tab === "report" && state.reportStep === "camera");
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
    <div class="topbar-sub">사진 한 장으로 시작하는 우리 동네 수거함 지도 📍 ${NEIGHBORHOOD.name}</div>

    <div class="cta-card" data-action="go-report">
      <div class="cta-eyebrow">🚩 방치 수거함 발견!</div>
      <p class="cta-title">쓰레기장 된 의류수거함,<br/>사진 한 장으로 신고하기</p>
      <p class="cta-sub">AI가 30초 만에 위험도를 진단해드려요</p>
      <div class="cta-arrow">›</div>
    </div>

    <div class="section">
      <div class="stat-row">
        <div class="stat-card info">
          <div class="stat-num">${REGISTERED_BOXES.length}</div>
          <div class="stat-label">등록 수거함</div>
        </div>
        <div class="stat-card warn">
          <div class="stat-num">${unregCount}</div>
          <div class="stat-label">발견된 미등록</div>
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
/* MAP / DASHBOARD                                                */
/* ============================================================ */
function renderMap() {
  app.innerHTML = `
    <div class="map-view-wrap">
      <div id="dashboard-map"></div>
      <div class="map-legend">
        <span><span class="legend-dot" style="background:#3182F6"></span>등록(표준데이터)</span>
        <span><span class="legend-dot" style="background:#00C471"></span>관찰</span>
        <span><span class="legend-dot" style="background:#FF9F1C"></span>정비 권고</span>
        <span><span class="legend-dot" style="background:#FF5A5F"></span>정비 시급</span>
      </div>
      <button class="list-toggle-btn" id="toggle-sheet">🚩 우선 정비 리스트</button>
      <div class="sheet" id="priority-sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-head">
          <h3>우선 정비 리스트</h3>
          <button class="sheet-close" id="close-sheet">✕</button>
        </div>
        <div class="sheet-body" id="priority-list"></div>
      </div>
    </div>
  `;

  document.getElementById("toggle-sheet").addEventListener("click", () => toggleSheet(true));
  document.getElementById("close-sheet").addEventListener("click", () => toggleSheet(false));

  initDashboardMap();
  renderPriorityList();
}

function toggleSheet(open) {
  state.sheetOpen = open;
  const sheet = document.getElementById("priority-sheet");
  if (sheet) sheet.classList.toggle("open", open);
}

let dashboardMarkers = {};

function initDashboardMap() {
  const el = document.getElementById("dashboard-map");
  if (!el || !window.L) return;
  const map = L.map(el, { center: NEIGHBORHOOD.center, zoom: NEIGHBORHOOD.zoom });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  dashboardMarkers = {};

  REGISTERED_BOXES.forEach((b) => {
    const m = L.circleMarker([b.lat, b.lng], {
      radius: 8, color: "#fff", weight: 2, fillColor: "#3182F6", fillOpacity: 1,
    }).addTo(map);
    m.bindPopup(`<div class="popup-title">🔵 등록 수거함</div>${escapeHtml(b.addr)}<br/>표준데이터에 등록된 시설입니다.`);
  });

  getAllReports().forEach((r) => {
    const g = currentGrade(r);
    const color = g.key === "danger" ? "#FF5A5F" : g.key === "warn" ? "#FF9F1C" : "#00C471";
    const m = L.circleMarker([r.lat, r.lng], {
      radius: 9, color: "#fff", weight: 2, fillColor: color, fillOpacity: 1,
    }).addTo(map);
    const last = r.history[r.history.length - 1];
    const thumb = r.isSeed
      ? `<div class="popup-thumb" style="display:flex;align-items:center;justify-content:center;font-size:28px;background:${r.illustBg}">${r.illust}</div>`
      : `<img class="popup-thumb" src="${r.photo}" />`;
    m.bindPopup(`
      ${thumb}
      <div class="popup-title">${g.emoji} ${g.label} · ${last.score}점</div>
      ${escapeHtml(r.addr)}<br/>
      ${r.registered ? "표준데이터 등록" : "⚠️ 표준데이터 미등록"} · ${r.history.length}회 제보 · ${daysAgo(r.createdAt)}
      <div class="popup-btn" data-open-report="${r.id}">민원 초안 보기</div>
    `);
    dashboardMarkers[r.id] = m;
  });

  map.on("popupopen", (e) => {
    const btn = e.popup._contentNode.querySelector("[data-open-report]");
    if (btn) btn.addEventListener("click", () => openReportModal(btn.dataset.openReport));
  });

  maps.dashboard = map;
}

function flyToReport(id) {
  const r = getReportById(id);
  const m = dashboardMarkers[id];
  if (maps.dashboard && r) {
    maps.dashboard.flyTo([r.lat, r.lng], 18, { duration: 0.6 });
    if (m) setTimeout(() => m.openPopup(), 650);
  }
}

function renderPriorityList() {
  const list = document.getElementById("priority-list");
  if (!list) return;
  const all = getAllReports()
    .map((r) => {
      const last = r.history[r.history.length - 1];
      const g = gradeOf(last.score);
      const days = Math.floor((Date.now() - r.createdAt) / (1000 * 60 * 60 * 24));
      return { r, last, g, days };
    })
    .sort((a, b) => b.last.score - a.last.score || b.days - a.days);

  list.innerHTML = all
    .map((item, idx) => {
      return `
      <div class="priority-row" data-fly="${item.r.id}">
        <div class="priority-rank ${idx < 3 ? "top" : ""}">${idx + 1}</div>
        <div class="priority-mid">
          <div class="priority-addr">${escapeHtml(item.r.addr)}</div>
          <div class="priority-meta">${item.g.emoji} ${item.g.label} · ${item.r.registered ? "등록" : "미등록"} · ${item.days <= 0 ? "오늘 제보" : `방치 ${item.days}일`}</div>
        </div>
        <div class="priority-score" style="color:${item.g.key === "danger" ? "#FF5A5F" : item.g.key === "warn" ? "#FF9F1C" : "#00C471"}">${item.last.score}점</div>
      </div>`;
    })
    .join("");

  list.querySelectorAll("[data-fly]").forEach((row) =>
    row.addEventListener("click", () => {
      toggleSheet(false);
      flyToReport(row.dataset.fly);
    })
  );
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
