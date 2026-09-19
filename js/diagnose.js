import { haversine, gradeOf } from "./utils.js";
import { REGISTERED_BOXES, WEIGHTS, REASON_TEXT, LABEL_TEXT } from "./data.js";
import { analyzePhoto } from "./gemini.js";

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

function nearestRegisteredDistance(lat, lng) {
  let min = Infinity;
  for (const box of REGISTERED_BOXES) {
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
  return `[오매! 수거함 제보]
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

  const dist = nearestRegisteredDistance(loc.lat, loc.lng);
  const registered = dist <= 40;

  // 1순위: Gemini Vision 판독. 실패하면 픽셀 통계로 아주 뚜렷한 경우만 제안한다.
  // 어느 쪽이든 최종 확정은 사용자가 체크리스트로 확인한다.
  let flags = {
    noManager: false,
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
