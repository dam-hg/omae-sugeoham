import { haversine, gradeOf } from "./utils.js";
import { WEIGHTS, REASON_TEXT, LABEL_TEXT } from "./data.js";
import { analyzePhoto } from "./gemini.js";
import { loadGovBoxes } from "./govboxes.js";

const MAX_DIM = 720;
const ANALYSIS_DIM = 64;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// 사진 픽셀 통계. 이 값만으로는 "쓰레기"와 "그림자"를 구분할 수 없기 때문에
// 아주 강한 신호일 때만 후보로 제안하고, 최종 판정은 사용자가 확인한다.
function analyzeImage(img) {
  const canvas = document.createElement("canvas");
  canvas.width = ANALYSIS_DIM;
  canvas.height = ANALYSIS_DIM;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, ANALYSIS_DIM, ANALYSIS_DIM);
  const { data } = ctx.getImageData(0, 0, ANALYSIS_DIM, ANALYSIS_DIM);

  const n = ANALYSIS_DIM * ANALYSIS_DIM;
  let sumL = 0, darkCount = 0, brightCount = 0, brownCount = 0;
  const lumas = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    lumas[i] = l;
    sumL += l;
    if (l < 45) darkCount++;
    if (l > 215) brightCount++;
    if (r > g && g >= b && r - b > 30 && l > 50 && l < 140) brownCount++;
  }
  const avgL = sumL / n;
  let variance = 0;
  for (let i = 0; i < n; i++) variance += (lumas[i] - avgL) ** 2;

  return {
    darkRatio: darkCount / n,
    brightRatio: brightCount / n,
    brownRatio: brownCount / n,
    stdL: Math.sqrt(variance / n),
  };
}

function drawResized(img) {
  let w = img.width, h = img.height;
  if (w > h && w > MAX_DIM) { h = Math.round((h * MAX_DIM) / w); w = MAX_DIM; }
  else if (h >= w && h > MAX_DIM) { w = Math.round((w * MAX_DIM) / h); h = MAX_DIM; }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.85);
}

// 「전국의류수거함표준데이터」 13,975건 전체를 기준으로 가장 가까운 등록 수거함까지의
// 거리를 구한다. 좌표가 일치하는 항목이 이 반경 안에 있으면 "등록"으로 본다.
const REGISTERED_RADIUS_M = 40;

async function nearestRegisteredDistance(lat, lng) {
  let boxes = [];
  try {
    boxes = await loadGovBoxes();
  } catch (e) {
    console.warn("표준데이터를 불러오지 못해 등록 여부를 확인할 수 없음", e);
    return null; // 알 수 없음
  }
  let min = Infinity;
  for (const box of boxes) {
    // 위·경도 차이로 먼저 걸러 13,975건 전수 haversine을 피한다(약 0.01도 ≈ 1.1km).
    if (Math.abs(box.lat - lat) > 0.01 || Math.abs(box.lng - lng) > 0.01) continue;
    const d = haversine(lat, lng, box.lat, box.lng);
    if (d < min) min = d;
  }
  return min;
}

export function scoreFromFlags(flags) {
  let score = 0;
  const reasons = [];
  const labels = [];
  for (const key of ["noManager", "dump", "satur", "damage"]) {
    if (flags[key]) {
      score += WEIGHTS[key].pts;
      reasons.push(`${REASON_TEXT[key]} (${LABEL_TEXT[key]} ${WEIGHTS[key].pts}점)`);
      labels.push(LABEL_TEXT[key]);
    }
  }
  if (labels.length === 0) labels.push("정상");
  return { score, reasons, labels, grade: gradeOf(score) };
}

export function buildDraft({ addr, dateStr, labels, score, grade, reasons, registered }) {
  return `[오메! 수거함 제보]
위치: ${addr}
촬영일시: ${dateStr}
상태 분류: ${labels.join(", ")}
위험도 점수: ${score}점 / 100점 (${grade.emoji} ${grade.label})
판단 근거:
${reasons.length ? reasons.map((r) => " - " + r).join("\n") : " - 제보자가 확인한 특이사항 없음"}
표준데이터 등록 여부: ${registered ? "등록" : "미등록 (표준데이터에서 확인되지 않음)"}

해당 의류수거함은 위 사유로 방치·정비가 필요한 상태로 제보되었습니다. 관할 부서의 현장 확인과 정비(또는 철거) 조치를 요청드립니다.
※ 상태 항목은 제보자가 사진을 보고 직접 확인한 내용입니다.
(근거: 폐기물관리법 및 관할 지자체 폐기물·의류수거함 관리 조례)`;
}

export async function runDiagnosis(file, loc, resolvedAddress) {
  const img = await loadImage(file);
  const stats = analyzeImage(img);
  const photo = drawResized(img);

  const dist = await nearestRegisteredDistance(loc.lat, loc.lng);
  const registered = dist !== null && dist <= REGISTERED_RADIUS_M;

  // 1순위: Gemini Vision 판독. 실패하면 픽셀 통계로 아주 뚜렷한 경우만 제안한다.
  // 어느 쪽이든 최종 확정은 사용자가 체크리스트로 확인한다.
  let flags = {
    dump: stats.darkRatio > 0.35 && stats.stdL > 60,
    satur: stats.brightRatio > 0.4,
    damage: stats.brownRatio > 0.15,
  };
  let ai = { ok: false };
  try {
    ai = await analyzePhoto(photo);
    if (ai.ok) flags = ai.flags;
  } catch (e) {
    console.warn("vision 분석 실패, 기본 제안값 사용", e);
  }

  // 관리자 표시 여부는 사진 판독 신뢰도가 낮아 표준데이터 등록 여부로 판단한다.
  // 표준데이터에 없는 수거함은 관리 주체가 확인되지 않는 것이므로 체크된다.
  // 표준데이터를 못 불러왔을 때(dist === null)는 근거가 없으므로 체크하지 않는다.
  flags.noManager = dist !== null && !registered;

  const { score, reasons, labels, grade } = scoreFromFlags(flags);
  const addr = resolvedAddress && resolvedAddress.trim() ? resolvedAddress.trim() : "선택한 위치";
  const dateStr = new Date().toLocaleString("ko-KR", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });

  return {
    id: `u-${Date.now()}`,
    lat: loc.lat,
    lng: loc.lng,
    addr,
    registered,
    isSeed: false,
    photo,
    createdAt: Date.now(),
    history: [{ date: Date.now(), score, labels, reasons }],
    flags,
    score,
    grade,
    aiUsed: !!ai.ok,
    aiSummary: ai.ok ? ai.summary : "",
    aiBinFound: ai.ok ? ai.binFound : true,
    draft: buildDraft({ addr, dateStr, labels, score, grade, reasons, registered }),
    reasons,
    labels,
  };
}
