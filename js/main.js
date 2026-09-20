import { NEIGHBORHOOD, REGISTERED_BOXES, REGISTERED_DATA_SOURCE } from "./data.js";
import { getAllReports, getUserReports, addReport, getReportById } from "./store.js";
import { gradeOf, daysAgo, daysCompact, relTime, toast, escapeHtml, reverseGeocode, formatDateTime } from "./utils.js";
import { runDiagnosis, scoreFromFlags, buildDraft } from "./diagnose.js";
import { loadGovBoxes, getRegionList, searchRegions, getBoxesForRegion, matchRegionFromAddress } from "./govboxes.js";

const app = document.getElementById("app");
const bottomnav = document.getElementById("bottomnav");

function freshDraft() {
  return {
    file: null,
    previewUrl: null,
    loc: null,
    locAddress: "",
    geocoding: false,
    // "default" = GPS 실패 시 보여주는 임시 좌표(사용자의 실제 위치가 아님)
    // "gps" = GPS로 잡은 좌표, "manual" = 사용자가 지도를 움직여 지정한 좌표
    locSource: "default",
    locStatus: null,
    locRequested: false,
  };
}

const state = {
  tab: "home",
  reportStep: "camera", // camera -> form -> loading -> preview -> submitted
  reportDraft: freshDraft(),
  lastResult: null,
};

const REGION_PAGE_SIZE = 10;

const regionState = {
  loaded: false,
  loading: false,
  gpsPending: false,
  gpsDone: false,
  boxes: [],
  regionList: [],
  selected: null,
  pendingSido: null, // 시/군/구 드롭다운에서 시/도만 고르고 아직 구를 안 고른 상태
  selectedDong: null, // null = 전체
  dongOptions: [],
  activeList: "gov", // "gov" | "reports"
  view: "list", // "list" | "map"
  searchQuery: "",
  boundsFilter: null, // 지도에서 "이 지역에서 검색하기"로 지정한 영역
  visibleCount: REGION_PAGE_SIZE,
};

const maps = { home: null, pin: null, dashboard: null };
let cameraStream = null;
let geocodeToken = 0;
let gpsToken = 0;

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
  detachRegionScroll();
  const fullBleed =
    (state.tab === "map" && regionState.view === "map") ||
    (state.tab === "report" && state.reportStep === "camera");
  app.classList.toggle("no-pad", fullBleed);
  if (state.tab === "home") renderHome();
  else if (state.tab === "report") renderReport();
  else if (state.tab === "map") renderMap();
  else if (state.tab === "mypage") renderMypage();
  // 전체화면 뷰(지도·카메라)는 높이를 화면에 딱 맞추기 때문에, 진입 모션의
  // translateY가 걸려 있는 동안 뷰 하단이 하단 네비 밑으로 밀려 내려가
  // "목록으로 돌아가기" 버튼이 잘려 보인다. 그래서 모션을 걸지 않는다.
  if (fullBleed) app.classList.remove("view-enter");
  else playViewEnter();
  window.scrollTo(0, 0);
}

// 화면이 바뀔 때마다 살짝 올라오며 나타나는 전환 모션을 재생한다.
function playViewEnter() {
  app.classList.remove("view-enter");
  void app.offsetWidth;
  app.classList.add("view-enter");
}

// 신고 완료처럼 성취감을 줘야 하는 순간에 화면 중앙에 크게 띄우는 연출.
function showCelebration(title, sub) {
  const el = document.createElement("div");
  el.className = "celebrate";
  el.innerHTML = `
    <div class="celebrate-inner">
      <div class="celebrate-icon">🎉</div>
      <div class="celebrate-title">${title}</div>
      <div class="celebrate-sub">${sub}</div>
    </div>
  `;
  document.body.appendChild(el);
  setTimeout(() => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 320);
  }, 1500);
}

/* ============================================================ */
/* HOME                                                          */
/* ============================================================ */
function renderHome() {
  const homeReports = regionState.selected ? getReportsForRegionRaw(regionState.selected.sigungu) : getAllReports();
  const unregCount = homeReports.length;
  const dangerCount = homeReports.filter((r) => currentGrade(r).key === "danger").length;
  const recentPool = homeReports.length ? homeReports : getAllReports();
  const recent = [...recentPool].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 5);

  app.innerHTML = `
    <div class="topbar">
      <div class="brand-wordmark">오메<span>!</span> 수거함</div>
    </div>
    <div class="topbar-sub">사진 한 장으로 시작하는 우리 동네 방치수거함 신고</div>

    <div class="cta-card" data-action="go-report">
      <p class="cta-title">쓰레기장 된 의류수거함,<br/>사진 한 장으로 신고하기</p>
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

function getReportsForRegionRaw(sigungu) {
  return getAllReports().filter((r) => r.addr && r.addr.includes(sigungu));
}

function initHomeMiniMap() {
  const el = document.getElementById("home-mini-map");
  if (!el || !window.L) return;

  const sel = regionState.selected;
  const govList = sel && regionState.loaded ? getBoxesForRegion(regionState.boxes, sel.sido, sel.sigungu) : REGISTERED_BOXES;
  const reportList = sel ? getReportsForRegionRaw(sel.sigungu) : getAllReports();
  const points = [...govList.map((b) => [b.lat, b.lng]), ...reportList.map((r) => [r.lat, r.lng])];
  const center = points.length
    ? points.reduce((acc, p) => [acc[0] + p[0] / points.length, acc[1] + p[1] / points.length], [0, 0])
    : NEIGHBORHOOD.center;

  const map = L.map(el, {
    center,
    zoom: points.length ? 13 : NEIGHBORHOOD.zoom - 1,
    zoomControl: false,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    touchZoom: false,
    attributionControl: false,
  });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);
  govList.forEach((b) =>
    L.circleMarker([b.lat, b.lng], { radius: 5, color: "#3182F6", fillColor: "#3182F6", fillOpacity: 0.9, weight: 1 }).addTo(map)
  );
  reportList.forEach((r) => {
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
  render(); // renderReportForm이 위치 권한 확인까지 이어서 진행한다
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
        <div class="form-photo-sub">다음 화면에서 상태를 확인하고 신고해요</div>
      </div>
    </div>

    <div class="pin-map-wrap">
      <div id="pin-map-el"></div>
      <div class="center-pin">📍</div>
      <button class="recenter-btn" id="recenter-btn" aria-label="내 위치로 이동">🛰️</button>
    </div>
    <div class="loc-status hidden" id="loc-status"></div>
    <div class="loc-readout" id="loc-readout">${locReadoutText(d)}</div>

    <div class="fixed-bottom-btn">
      <button class="btn btn-primary" id="diagnose-btn" ${!(d.file && d.loc) ? "disabled" : ""}>
        AI 진단하기 →
      </button>
    </div>
  `;

  document.getElementById("recenter-btn").addEventListener("click", userRequestLocation);

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
  renderLocStatus(); // 다시 그려질 때 이전 상태 배너를 복원한다
  // 이 신고 건에서 아직 위치를 요청하지 않았을 때만 권한 확인부터 시작한다.
  if (!d.locRequested) {
    d.locRequested = true;
    initLocationFlow();
  }
}

function locReadoutText(d) {
  if (d.locSource === "default") return "아직 수거함 위치가 지정되지 않았어요";
  if (d.geocoding) return "주소 확인 중...";
  if (d.locAddress) return d.locAddress;
  return "지도를 움직여 위치를 맞춰주세요";
}

function setLocReadoutText(text) {
  const el = document.getElementById("loc-readout");
  if (el) el.textContent = text;
}

// 임시 좌표 그대로는 다음 단계로 못 넘어간다. GPS로 잡았거나 사용자가 지도를
// 움직여 직접 지정했을 때만 진행시킨다(엉뚱한 위치로 신고되는 것을 막는다).
function syncDiagnoseBtn() {
  const btn = document.getElementById("diagnose-btn");
  const d = state.reportDraft;
  if (!btn) return;
  const ready = !!(d.file && d.loc && d.locSource !== "default");
  btn.disabled = !ready;
  btn.textContent = ready ? "AI 진단하기 →" : "지도를 움직여 위치를 맞춰주세요";
}

let geocodeDebounce = null;

// 좌표는 즉시 확정하고(= 다음 단계 버튼 활성화), 주소 조회만 디바운스한다.
// 지도를 드래그하는 동안 moveend가 연달아 발생해도 요청이 몰리지 않게 한다.
function setLoc(loc, source) {
  const d = state.reportDraft;
  d.loc = loc;
  if (source) d.locSource = source;
  syncDiagnoseBtn();

  // 임시 좌표는 사용자의 실제 위치가 아니다. 여기서 주소를 조회해 보여주면
  // 엉뚱한 동네 주소를 자기 위치인 것처럼 읽게 되므로 조회하지 않는다.
  if (d.locSource === "default") {
    d.geocoding = false;
    d.locAddress = "";
    setLocReadoutText("아직 수거함 위치가 지정되지 않았어요");
    return;
  }

  d.geocoding = true;
  setLocReadoutText("주소 확인 중...");
  const myToken = ++geocodeToken;
  clearTimeout(geocodeDebounce);
  geocodeDebounce = setTimeout(() => {
    reverseGeocode(loc.lat, loc.lng).then((addr) => {
      if (myToken !== geocodeToken) return; // 그 사이 위치가 또 바뀌었으면 무시
      d.geocoding = false;
      d.locAddress = addr; // 실패하면 빈 문자열
      // 주소를 못 얻어도 좌표는 유효하므로 신고는 계속 진행할 수 있다.
      setLocReadoutText(addr || "주소를 확인하지 못했어요 · 위치는 지도 핀 기준으로 기록돼요");
    });
  }, 450);
}

function panMapTo(lat, lng, source) {
  if (maps.pin) maps.pin.setView([lat, lng], 17);
  // moveend가 안 오는 경우(같은 뷰로 이동)에도 좌표가 반영되도록 직접 확정한다.
  setLoc({ lat, lng }, source);
}

function getPosition(options) {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

/* ---------------- 위치 권한 ---------------- */
// 브라우저가 위치 권한을 "거부"로 기억하고 있으면 getCurrentPosition은
// 권한 창을 띄우지 않고 곧바로 실패한다. 이때와 "아직 묻지 않음"을 구분하지
// 못하면 "위치를 조회할 수 없다"는 말밖에 못 하게 되므로, 실제 조회 전에
// Permissions API로 상태를 먼저 확인한다.
async function geoPermissionState() {
  if (!navigator.geolocation) return "unsupported";
  if (!navigator.permissions || !navigator.permissions.query) return "unknown";
  try {
    const st = await navigator.permissions.query({ name: "geolocation" });
    return st.state; // granted | prompt | denied
  } catch (e) {
    return "unknown"; // 일부 사파리는 geolocation 항목 조회를 지원하지 않는다
  }
}

// 권한을 되살리는 경로가 OS마다 달라서 각각 안내한다.
function permissionHelpText() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) {
    return "설정 앱 → Safari → 위치 → ‘확인 후 허용’으로 바꾸고, 사이트별 설정에서도 이 사이트의 위치를 허용한 뒤 새로고침해주세요.";
  }
  if (/Android/.test(ua)) {
    return "주소창 왼쪽 자물쇠(또는 ⓘ) → 권한 → 위치를 ‘허용’으로 바꾼 뒤 새로고침해주세요. 휴대폰 설정에서 브라우저 앱의 위치 권한도 켜져 있어야 해요.";
  }
  return "주소창 왼쪽 자물쇠 아이콘 → 위치 권한을 ‘허용’으로 바꾼 뒤 새로고침해주세요.";
}

function setLocStatus(kind, message, actionLabel) {
  state.reportDraft.locStatus = { kind, message, actionLabel };
  renderLocStatus();
}

function renderLocStatus() {
  const el = document.getElementById("loc-status");
  if (!el) return;
  const s = state.reportDraft.locStatus;
  if (!s) {
    el.className = "loc-status hidden";
    el.innerHTML = "";
    return;
  }
  el.className = `loc-status ${s.kind}`;
  el.innerHTML = `
    <div class="loc-status-msg">${s.message}</div>
    ${s.actionLabel ? `<button class="loc-status-btn" id="loc-action">${s.actionLabel}</button>` : ""}
  `;
  const btn = document.getElementById("loc-action");
  if (btn) btn.addEventListener("click", userRequestLocation);
}

function showDeniedStatus() {
  setLocStatus(
    "denied",
    `<b>위치 권한이 차단되어 있어요.</b><br>${permissionHelpText()}<br>지금은 지도를 움직여 수거함 위치를 직접 맞춰주세요.`,
    "권한 다시 확인"
  );
}

// 위치 확인 단계에 들어올 때 한 번 호출된다.
// 이미 허용된 경우에만 바로 조회하고, 아직 묻지 않았으면 왜 필요한지
// 먼저 설명한 뒤 사용자가 버튼을 눌렀을 때 권한 창을 띄운다.
async function initLocationFlow() {
  watchGeoPermission();
  const perm = await geoPermissionState();

  if (perm === "unsupported") {
    setLocStatus("denied", "이 브라우저는 위치 기능을 지원하지 않아요.<br>지도를 움직여 수거함 위치를 맞춰주세요.");
    return;
  }
  if (perm === "denied") {
    showDeniedStatus();
    return;
  }
  if (perm === "granted" || perm === "unknown") {
    fetchPosition();
    return;
  }
  // perm === "prompt" — 아직 한 번도 묻지 않은 상태
  setLocStatus(
    "prompt",
    "수거함 위치를 자동으로 찾으려면 <b>위치 권한</b>이 필요해요.<br>허용하면 지금 계신 곳으로 지도를 옮겨드려요.",
    "위치 권한 허용하고 내 위치 찾기"
  );
}

// 버튼(권한 허용 / 다시 시도 / 🛰️)에서 호출된다. 사용자의 탭에서 출발하므로
// 권한 창이 확실히 뜬다.
async function userRequestLocation() {
  const perm = await geoPermissionState();
  if (perm === "unsupported") {
    setLocStatus("denied", "이 브라우저는 위치 기능을 지원하지 않아요.<br>지도를 움직여 수거함 위치를 맞춰주세요.");
    return;
  }
  if (perm === "denied") {
    showDeniedStatus();
    return;
  }
  fetchPosition();
}

// 모바일 GPS 콜드스타트는 실내에서 10초를 넘기는 일이 흔해 단판 조회로는
// 자주 실패한다. 그래서 2단계로 나눈다.
//   1단계 - 기지국·와이파이 기반 저정확도 조회(캐시 허용). 보통 즉시 잡힌다.
//   2단계 - 위성 기반 고정확도 조회로 핀을 다시 보정.
async function fetchPosition() {
  const myToken = ++gpsToken;
  setLocStatus("checking", "내 위치를 찾는 중이에요...");
  let gotAny = false;

  try {
    const coarse = await getPosition({ enableHighAccuracy: false, timeout: 10000, maximumAge: 120000 });
    if (myToken !== gpsToken) return;
    gotAny = true;
    applyGpsPosition(coarse);
  } catch (err) {
    if (myToken !== gpsToken) return;
    if (err && err.code === 1) return showDeniedStatus();
  }

  try {
    const fine = await getPosition({ enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
    if (myToken !== gpsToken) return;
    gotAny = true;
    applyGpsPosition(fine);
  } catch (err) {
    if (myToken !== gpsToken) return;
    if (err && err.code === 1) return showDeniedStatus();
    if (!gotAny) {
      setLocStatus(
        "failed",
        "<b>GPS 신호를 잡지 못했어요.</b><br>실내나 지하에서는 잘 안 잡혀요. 지도를 움직여 수거함 위치를 직접 맞춰주세요.",
        "다시 시도"
      );
    }
  }
}

function applyGpsPosition(pos) {
  const { latitude, longitude, accuracy } = pos.coords;
  panMapTo(latitude, longitude, "gps");
  setLocStatus(
    "ok",
    `현재 위치를 찾았어요 · 오차 약 ${Math.round(accuracy)}m<br>수거함이 있는 지점으로 지도를 움직여 맞춰주세요.`
  );
}

// 사용자가 설정에서 권한을 바꾸면 새로고침 없이 바로 반영한다.
let geoPermWatcher = null;
async function watchGeoPermission() {
  if (geoPermWatcher || !navigator.permissions || !navigator.permissions.query) return;
  try {
    const st = await navigator.permissions.query({ name: "geolocation" });
    geoPermWatcher = st;
    st.onchange = () => {
      if (state.tab !== "report" || state.reportStep !== "form") return;
      if (st.state === "granted") fetchPosition();
      else if (st.state === "denied") showDeniedStatus();
    };
  } catch (e) {
    /* 미지원 브라우저는 그냥 넘어간다 */
  }
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
    setLoc({ lat: c.lat, lng: c.lng }); // 출처는 그대로 두고 좌표만 갱신
  });

  // dragend는 사용자가 직접 끌었을 때만 발생한다(프로그램 이동에는 안 뜬다).
  // 이때 비로소 "직접 지정한 위치"로 승격시킨다.
  map.on("dragend", () => {
    const c = map.getCenter();
    setLoc({ lat: c.lat, lng: c.lng }, "manual");
    if (!d.locStatus || d.locStatus.kind !== "ok") {
      setLocStatus("ok", "이 위치로 신고해요. 핀이 수거함 위에 오도록 맞춰주세요.");
    }
  });

  maps.pin = map;

  // setView가 기존 뷰와 같으면 Leaflet은 moveend를 발생시키지 않는다.
  // 그 경우 d.loc이 끝까지 비어버리므로 지도를 만든 직후 중심을 한 번 확정한다.
  const c0 = map.getCenter();
  setLoc({ lat: c0.lat, lng: c0.lng }, d.locSource);
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
      <div class="loading-sub">사진에서 포화·투기물·파손 흔적을 살펴보는 중...</div>
    </div>
  `;
}

const CHECK_ITEMS = [
  {
    key: "noManager",
    label: "관리자 표시 없음",
    pts: 50,
    // 사진으로는 스티커 위치·글자 크기 때문에 오판이 잦아, 이 항목만은
    // 표준데이터 등록 여부로 자동 판정한다.
    hint: (r) =>
      r.registered
        ? "표준데이터에 등록된 수거함이에요 · 관리 주체 확인됨"
        : "표준데이터에서 확인되지 않는 수거함이에요 · 관리 주체 미확인",
  },
  { key: "dump", label: "주변 투기물 발생", pts: 30, hint: "수거함 주변에 쓰레기가 쌓여 있나요?" },
  { key: "satur", label: "포화 상태", pts: 10, hint: "투입구가 막히거나 옷이 넘쳐 있나요?" },
  { key: "damage", label: "파손·노후", pts: 10, hint: "본체가 부서지거나 심하게 녹슬었나요?" },
];

function renderReportPreview(r) {
  if (!state.previewFlags) state.previewFlags = { ...r.flags };
  if (!state.previewMasks) state.previewMasks = [];
  const flags = state.previewFlags;
  const { score, grade } = scoreFromFlags(flags);
  const gaugeColor = grade.key === "danger" ? "#FF5A5F" : grade.key === "warn" ? "#FF9F1C" : "#00C471";

  app.innerHTML = `
    <div class="flow-header">
      <button class="back-btn" data-action="home-back">‹</button>
      <div class="flow-title">진단 결과 확인</div>
    </div>
    <div class="step-dots"><span class="on"></span><span class="on"></span><span class="on"></span></div>

    <div class="report-meta">📋 사진을 확인하고 해당하는 항목을 골라주세요</div>
    ${
      r.aiUsed
        ? `<div class="ai-summary ${r.aiBinFound ? "" : "warn"}">
             <b>${r.aiBinFound ? "🤖 AI 판독" : "🤖 수거함을 찾지 못했어요"}</b>
             <span>${escapeHtml(r.aiSummary || "사진에서 확인된 내용을 아래 항목으로 제안했어요")}</span>
           </div>`
        : ""
    }

    <div class="result-photo" id="mask-photo-wrap">
      <img src="${r.photo}" alt="촬영 사진" id="mask-photo" />
      ${state.previewMasks
        .map((m) => `<span class="mask-box" style="left:${m.x * 100}%;top:${m.y * 100}%;width:${m.w * 100}%;height:${m.h * 100}%"></span>`)
        .join("")}
    </div>
    <div class="mask-guide">
      <div class="mask-guide-main">🔒 사람 얼굴이나 차량 번호판이 찍혔나요?</div>
      <div class="mask-guide-sub">사진에서 <b>가리고 싶은 곳을 탭</b>하면 검게 가려집니다${state.previewMasks.length ? ` · 현재 ${state.previewMasks.length}곳` : ""}</div>
      ${state.previewMasks.length ? `<button class="btn-mini" id="mask-clear">전부 지우기</button>` : ""}
    </div>

    <div class="score-preview" style="border-color:${gaugeColor}">
      <div class="score-preview-num" style="color:${gaugeColor}">${score}<span>/100점</span></div>
      <div class="score-preview-grade">${grade.emoji} ${grade.label}</div>
    </div>

    <div class="checklist-card">
      ${CHECK_ITEMS.map(
        (it) => `
        <label class="check-row ${flags[it.key] ? "on" : ""}">
          <input type="checkbox" data-flag="${it.key}" ${flags[it.key] ? "checked" : ""} />
          <span class="check-mid">
            <span class="check-label">${it.label}</span>
            <span class="check-hint">${typeof it.hint === "function" ? it.hint(r) : it.hint}</span>
          </span>
          <span class="check-pts">+${it.pts}</span>
        </label>`
      ).join("")}
    </div>

    <div class="notice-banner">⚠️ <span>사진 분석은 참고용 제안일 뿐이라 <b>직접 확인한 항목만</b> 체크해주세요. 체크한 내용이 그대로 민원 초안에 들어갑니다.</span></div>

    <div class="result-actions">
      <button class="btn btn-primary" id="confirm-report-btn">🚩 신고하기</button>
      <button class="btn btn-outline" id="retry-btn">🔄 다시하기</button>
    </div>
  `;

  app.querySelectorAll("[data-flag]").forEach((cb) =>
    cb.addEventListener("change", () => {
      state.previewFlags[cb.dataset.flag] = cb.checked;
      renderReportPreview(r);
    })
  );

  const photoWrap = document.getElementById("mask-photo-wrap");
  photoWrap.addEventListener("click", (e) => {
    const rect = photoWrap.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    state.previewMasks.push({ x: Math.max(0, x - 0.045), y: Math.max(0, y - 0.035), w: 0.09, h: 0.07 });
    renderReportPreview(r);
  });
  const clearBtn = document.getElementById("mask-clear");
  if (clearBtn) {
    clearBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      state.previewMasks = [];
      renderReportPreview(r);
    });
  }

  document.getElementById("confirm-report-btn").addEventListener("click", async () => {
    const confirmed = await finalizeReport(r);
    addReport(confirmed);
    state.lastResult = confirmed;
    state.previewFlags = null;
    state.previewMasks = null;
    state.reportStep = "submitted";
    render();
    showCelebration("신고 데이터가 쌓였어요!", "당신의 제보가 우리 동네 기록이 됐어요");
  });
  document.getElementById("retry-btn").addEventListener("click", () => {
    state.previewFlags = null;
    state.previewMasks = null;
    restartReportFlow();
  });
}

// 사용자가 확인한 체크 항목과 직접 지정한 마스킹을 최종 제보에 반영한다.
async function finalizeReport(r) {
  const flags = state.previewFlags || r.flags;
  const { score, reasons, labels, grade } = scoreFromFlags(flags);
  const photo = state.previewMasks && state.previewMasks.length ? await bakeMasks(r.photo, state.previewMasks) : r.photo;
  const dateStr = formatDateTime(r.createdAt);
  return {
    ...r,
    photo,
    flags,
    score,
    grade,
    labels,
    reasons,
    history: [{ date: r.createdAt, score, labels, reasons }],
    draft: buildDraft({ addr: r.addr, dateStr, labels, score, grade, reasons, registered: r.registered }),
  };
}

function bakeMasks(photoDataUrl, masks) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      ctx.fillStyle = "#111";
      masks.forEach((m) => ctx.fillRect(m.x * img.width, m.y * img.height, m.w * img.width, m.h * img.height));
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => resolve(photoDataUrl);
    img.src = photoDataUrl;
  });
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

    <div class="submit-success">✅ 신고 데이터가 쌓였어요!</div>

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
  return `[오메! 수거함 제보]\n위치: ${r.addr}\n상태: ${last.labels.join(", ")}\n위험도: ${last.score}점`;
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
  ensureRegionData();
  if (!regionState.loaded) {
    renderRegionLoading("전국 표준데이터를 불러오는 중...");
    return;
  }
  // 지역을 고르지 않았으면 전국 전체 목록을 그대로 보여준다.
  if (regionState.view === "map") renderRegionMap();
  else renderRegionList();
}

// 홈 화면과 동네 탭이 같은 지역 데이터를 쓰도록, 앱 시작 시 한 번만 불러온다.
function ensureRegionData() {
  if (regionState.loaded || regionState.loading) return;
  regionState.loading = true;
  loadGovBoxes().then((boxes) => {
    regionState.boxes = boxes;
    regionState.regionList = getRegionList();
    regionState.loaded = true;
    regionState.loading = false;
    detectRegionFromGPS();
  });
}

function refreshIfIdle() {
  if (state.tab === "home" || state.tab === "map") render();
}

function selectRegion(sido, sigungu) {
  regionState.selected = { sido, sigungu };
  regionState.boundsFilter = null;
  regionState.pendingSido = null;
  regionState.selectedDong = null;
  regionState.dongOptions = computeDongOptions(sido, sigungu);
  regionState.activeList = "gov"; // 지역을 고르면 표준데이터 목록부터 바로 보여준다
  regionState.view = "list";
  regionState.visibleCount = REGION_PAGE_SIZE;
}

function getSidoList() {
  return [...new Set(regionState.regionList.map((r) => r.sido))];
}
function getSigunguListForSido(sido) {
  return regionState.regionList.filter((r) => r.sido === sido).map((r) => r.sigungu);
}

function detectRegionFromGPS() {
  if (regionState.selected || regionState.gpsDone) {
    refreshIfIdle();
    return;
  }
  if (!navigator.geolocation) {
    regionState.gpsDone = true;
    refreshIfIdle();
    return;
  }
  regionState.gpsPending = true;
  refreshIfIdle();
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      try {
        const addr = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
        const match = matchRegionFromAddress(regionState.regionList, addr);
        if (match) selectRegion(match.sido, match.sigungu);
      } catch (e) {
        /* 위치 인식 실패 시 검색 안내 화면으로 대체 */
      }
      regionState.gpsPending = false;
      regionState.gpsDone = true;
      refreshIfIdle();
    },
    () => {
      regionState.gpsPending = false;
      regionState.gpsDone = true;
      refreshIfIdle();
    },
    // 시군구만 알아내면 되므로 정확도보다 성공률을 택한다(캐시 위치 허용).
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
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

function regionPickerHtml() {
  const sel = regionState.selected;
  const currentSido = regionState.pendingSido || (sel && sel.sido) || "";
  const sigunguList = currentSido ? getSigunguListForSido(currentSido) : [];
  return `
    <div class="region-search-row">
      <input type="text" id="region-search" class="region-search-input" placeholder="시/군/구 검색 (예: 강남구)" value="${escapeHtml(regionState.searchQuery)}" />
    </div>
    <div id="region-suggest" class="region-suggest ${regionState.searchQuery ? "" : "hidden"}"></div>
    <div class="region-select-row">
      <select id="sido-select" class="region-select">
        <option value="">시/도</option>
        ${getSidoList()
          .map((s) => `<option value="${escapeHtml(s)}" ${currentSido === s ? "selected" : ""}>${escapeHtml(s)}</option>`)
          .join("")}
      </select>
      <select id="sigungu-select" class="region-select" ${sigunguList.length ? "" : "disabled"}>
        <option value="">시/군/구</option>
        ${sigunguList
          .map((g) => `<option value="${escapeHtml(g)}" ${sel && sel.sigungu === g ? "selected" : ""}>${escapeHtml(g)}</option>`)
          .join("")}
      </select>
      <select id="dong-select" class="region-select" ${regionState.dongOptions.length ? "" : "disabled"}>
        <option value="">동 전체</option>
        ${regionState.dongOptions
          .map((d) => `<option value="${escapeHtml(d)}" ${regionState.selectedDong === d ? "selected" : ""}>${escapeHtml(d)}</option>`)
          .join("")}
      </select>
    </div>
  `;
}


// gov-boxes.json의 dong 필드(지번주소에서 추출, govboxes.js 주석 참고)는 정확도가
// 높아 그대로 쓴다. 제보 주소(리버스 지오코딩 결과, 공백으로 구분된 형식)는
// "OO동"이 독립된 단어로 등장하는 경우만 인정해 오탐(예: 아파트 "가동")을 막는다.
const REPORT_DONG_RE = /(?:^|\s)([가-힣]{2,4}동)(?=\s|$)/;
function extractReportDong(addr) {
  const m = (addr || "").match(REPORT_DONG_RE);
  return m ? m[1] : "";
}

function computeDongOptions(sido, sigungu) {
  const govList = getBoxesForRegion(regionState.boxes, sido, sigungu);
  const reportList = getReportsForRegionRaw(sigungu);
  const counts = new Map();
  const add = (dong) => {
    if (dong) counts.set(dong, (counts.get(dong) || 0) + 1);
  };
  govList.forEach((b) => add(b.dong));
  reportList.forEach((r) => add(extractReportDong(r.addr)));
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name).slice(0, 14);
}

function inBounds(lat, lng) {
  const b = regionState.boundsFilter;
  return lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east;
}

function currentRegionBoxes() {
  const sel = regionState.selected;
  let list = sel ? getBoxesForRegion(regionState.boxes, sel.sido, sel.sigungu) : regionState.boxes;
  if (regionState.boundsFilter) list = list.filter((b) => inBounds(b.lat, b.lng));
  if (!regionState.selectedDong) return list;
  return list.filter((b) => b.dong === regionState.selectedDong);
}

function currentRegionReports() {
  const sel = regionState.selected;
  let base = sel ? getReportsForRegionRaw(sel.sigungu) : getAllReports();
  if (regionState.boundsFilter) base = base.filter((r) => inBounds(r.lat, r.lng));
  return base
    .filter((r) => !regionState.selectedDong || extractReportDong(r.addr) === regionState.selectedDong)
    .map((r) => {
      const last = r.history[r.history.length - 1];
      return { r, last, g: gradeOf(last.score) };
    })
    .sort((a, b) => b.last.score - a.last.score);
}

function renderRegionHeaderHtml() {
  const sel = regionState.selected;
  const label = regionState.boundsFilter
    ? "지도에서 선택한 영역"
    : sel
    ? `${escapeHtml(sel.sido)} ${escapeHtml(sel.sigungu)}${regionState.selectedDong ? ` · ${escapeHtml(regionState.selectedDong)}` : ""}`
    : "전국 전체";
  return `
    ${regionPickerHtml()}
    <div class="region-current">📍 <b>${label}</b>${regionState.gpsPending ? ` <span class="region-gps-hint">내 위치 확인 중…</span>` : ""}</div>
    <div class="region-tabs">
      <button class="region-tab-btn ${regionState.activeList === "gov" ? "active" : ""}" data-list="gov">모든 수거함 <span class="region-tab-count">${currentRegionBoxes().length.toLocaleString()}</span></button>
      <button class="region-tab-btn ${regionState.activeList === "reports" ? "active" : ""}" data-list="reports">신고된 수거함 <span class="region-tab-count">${currentRegionReports().length}</span></button>
    </div>
  `;
}

let regionScrollHandler = null;
function detachRegionScroll() {
  if (regionScrollHandler) {
    window.removeEventListener("scroll", regionScrollHandler);
    regionScrollHandler = null;
  }
}

function renderRegionList() {
  regionState.visibleCount = REGION_PAGE_SIZE;

  const isGov = regionState.activeList === "gov";
  const fullList = isGov ? currentRegionBoxes() : currentRegionReports();
  const rowFn = isGov ? govRowHtml : reportRowHtml;
  const emptyMsg = isGov ? "이 지역엔 표준데이터에 등록된 수거함이 없어요." : "이 지역엔 아직 신고된 수거함이 없어요.";
  const visible = fullList.slice(0, regionState.visibleCount);
  const rows = visible.length ? visible.map(rowFn).join("") : `<div class="empty-note">${emptyMsg}</div>`;
  const hasMore = fullList.length > regionState.visibleCount;

  app.innerHTML = `
    <div class="topbar"><div class="brand-wordmark">우리 동네 조회</div></div>
    ${renderRegionHeaderHtml()}
    <div class="region-list" id="region-list">${rows}</div>
    ${hasMore ? `<div class="region-list-loading" id="region-list-loading">더 불러오는 중...</div>` : ""}
    <div class="map-toggle-fab-wrap"><button class="map-toggle-fab" id="to-map-view">🗺️ 지도로 보기</button></div>
  `;

  bindRegionControls();
  document.getElementById("to-map-view").addEventListener("click", () => {
    regionState.view = "map";
    render();
  });

  const listEl = document.getElementById("region-list");
  if (listEl) {
    listEl.addEventListener("click", (e) => {
      const el = e.target.closest("[data-open-report]");
      if (el) openReportModal(el.dataset.openReport);
    });
  }

  attachRegionScroll(fullList, rowFn);
}

function attachRegionScroll(fullList, rowFn) {
  detachRegionScroll();
  if (fullList.length <= regionState.visibleCount) return;
  regionScrollHandler = () => {
    if (window.scrollY + window.innerHeight < document.body.scrollHeight - 300) return;
    if (regionState.visibleCount >= fullList.length) {
      detachRegionScroll();
      return;
    }
    const next = fullList.slice(regionState.visibleCount, regionState.visibleCount + REGION_PAGE_SIZE);
    regionState.visibleCount += REGION_PAGE_SIZE;
    const listEl = document.getElementById("region-list");
    if (listEl) listEl.insertAdjacentHTML("beforeend", next.map(rowFn).join(""));
    if (regionState.visibleCount >= fullList.length) {
      detachRegionScroll();
      const loadingEl = document.getElementById("region-list-loading");
      if (loadingEl) loadingEl.remove();
    }
  };
  window.addEventListener("scroll", regionScrollHandler);
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

  const sidoSel = document.getElementById("sido-select");
  const sigunguSel = document.getElementById("sigungu-select");
  const dongSel = document.getElementById("dong-select");

  if (sidoSel) {
    sidoSel.addEventListener("change", () => {
      regionState.pendingSido = sidoSel.value || null;
      if (!sidoSel.value) {
        // "시/도"로 되돌리면 전국 전체 목록으로 복귀
        regionState.selected = null;
        regionState.selectedDong = null;
        regionState.dongOptions = [];
      }
      render();
    });
  }
  if (sigunguSel) {
    sigunguSel.addEventListener("change", () => {
      const sido = regionState.pendingSido || (regionState.selected && regionState.selected.sido);
      const sigungu = sigunguSel.value;
      if (!sido || !sigungu) return;
      selectRegion(sido, sigungu);
      regionState.searchQuery = "";
      render();
    });
  }
  if (dongSel) {
    dongSel.addEventListener("change", () => {
      regionState.selectedDong = dongSel.value || null;
      renderRegionList();
    });
  }
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
      selectRegion(row.dataset.sido, row.dataset.sigungu);
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
      <button class="map-back-btn" id="to-list-top">‹ 목록으로</button>
      <button class="search-here-btn hidden" id="search-here">🔍 이 지역에서 검색하기</button>
      <button class="list-toggle-btn" id="to-list-view">📋 목록으로 돌아가기</button>
    </div>
  `;
  const backToList = () => {
    regionState.view = "list";
    render();
  };
  document.getElementById("to-list-view").addEventListener("click", backToList);
  document.getElementById("to-list-top").addEventListener("click", backToList);
  initRegionMap();
}

const MAP_MARKER_LIMIT = 800;
let regionMarkerLayer = null;

function initRegionMap() {
  const el = document.getElementById("dashboard-map");
  if (!el || !window.L) return;
  const govList = currentRegionBoxes().slice(0, MAP_MARKER_LIMIT);
  const reportList = currentRegionReports();
  const points = [...govList.map((b) => [b.lat, b.lng]), ...reportList.map(({ r }) => [r.lat, r.lng])];
  const center = points.length
    ? points.reduce((acc, p) => [acc[0] + p[0] / points.length, acc[1] + p[1] / points.length], [0, 0])
    : NEIGHBORHOOD.center;

  const zoom = regionState.boundsFilter ? 14 : points.length ? (regionState.selected ? 14 : 11) : NEIGHBORHOOD.zoom;
  const map = L.map(el, { center, zoom });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  regionMarkerLayer = L.layerGroup().addTo(map);
  drawRegionMarkers(govList, reportList);

  map.on("popupopen", (e) => {
    const btn = e.popup._contentNode.querySelector("[data-open-report]");
    if (btn) btn.addEventListener("click", () => openReportModal(btn.dataset.openReport));
  });

  // 지도를 움직이면 그 화면 기준으로 다시 검색할 수 있게 버튼을 띄운다.
  const searchBtn = document.getElementById("search-here");
  map.on("movestart", () => searchBtn && searchBtn.classList.remove("hidden"));
  if (searchBtn) {
    searchBtn.addEventListener("click", () => {
      const b = map.getBounds();
      regionState.boundsFilter = { north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() };
      regionState.selected = null;
      regionState.selectedDong = null;
      regionState.dongOptions = [];
      const nextGov = currentRegionBoxes().slice(0, MAP_MARKER_LIMIT);
      const nextReports = currentRegionReports();
      drawRegionMarkers(nextGov, nextReports);
      searchBtn.classList.add("hidden");
      toast(`이 영역에서 ${nextGov.length.toLocaleString()}곳을 찾았어요`);
    });
  }

  maps.dashboard = map;
}

function drawRegionMarkers(govList, reportList) {
  if (!regionMarkerLayer) return;
  regionMarkerLayer.clearLayers();

  govList.forEach((b) => {
    const m = L.circleMarker([b.lat, b.lng], {
      radius: 7, color: "#fff", weight: 2, fillColor: "#3182F6", fillOpacity: 1,
    }).addTo(regionMarkerLayer);
    m.bindPopup(`<div class="popup-title">🔵 등록 수거함</div>${escapeHtml(b.name || b.addr)}<br/>${escapeHtml(b.addr)}`);
  });

  reportList.forEach(({ r, g, last }) => {
    const color = g.key === "danger" ? "#FF5A5F" : g.key === "warn" ? "#FF9F1C" : "#00C471";
    const m = L.circleMarker([r.lat, r.lng], {
      radius: 9, color: "#fff", weight: 2, fillColor: color, fillOpacity: 1,
    }).addTo(regionMarkerLayer);
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
ensureRegionData(); // 홈 화면도 실제 위치 데이터를 쓰므로 앱 시작과 동시에 불러온다
