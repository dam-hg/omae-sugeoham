import { haversine, gradeOf } from "./utils.js";
import { REGISTERED_BOXES, WEIGHTS, REASON_TEXT, LABEL_TEXT } from "./data.js";

const MAX_DIM = 480;
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

// 사진 픽셀을 실제로 훑어 어두운 비율(검정 봉투 추정)·명암 변화(잡동사니 정도)·
// 녹슨 갈색 톤 비율(파손·노후 추정)을 계산한다. 진짜 Vision AI는 아니지만
// 최소한 "이 사진에서" 실제로 뽑아낸 값으로 채점하기 위한 경량 분석.
function analyzeImage(img) {
  const canvas = document.createElement("canvas");
  canvas.width = ANALYSIS_DIM;
  canvas.height = ANALYSIS_DIM;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, ANALYSIS_DIM, ANALYSIS_DIM);
  const { data } = ctx.getImageData(0, 0, ANALYSIS_DIM, ANALYSIS_DIM);

  const n = ANALYSIS_DIM * ANALYSIS_DIM;
  let sumL = 0;
  let darkCount = 0;
  let brightCount = 0;
  let brownCount = 0;
  const lumas = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    lumas[i] = l;
    sumL += l;
    if (l < 55) darkCount++;
    if (l > 205) brightCount++;
    if (r > g && g >= b && r - b > 18 && l > 40 && l < 150) brownCount++;
  }

  const avgL = sumL / n;
  let variance = 0;
  for (let i = 0; i < n; i++) variance += (lumas[i] - avgL) ** 2;
  const stdL = Math.sqrt(variance / n);

  return {
    darkRatio: darkCount / n,
    brightRatio: brightCount / n,
    brownRatio: brownCount / n,
    stdL,
  };
}

function maskAndDraw(img) {
  let w = img.width, h = img.height;
  if (w > h && w > MAX_DIM) { h = Math.round((h * MAX_DIM) / w); w = MAX_DIM; }
  else if (h >= w && h > MAX_DIM) { w = Math.round((w * MAX_DIM) / h); h = MAX_DIM; }

  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);

  const boxCount = Math.random() < 0.55 ? 1 : 2;
  ctx.fillStyle = "#111";
  for (let i = 0; i < boxCount; i++) {
    const bw = w * (0.14 + Math.random() * 0.1);
    const bh = bw * (0.55 + Math.random() * 0.3);
    const bx = Math.random() * (w - bw);
    const by = Math.random() * (h - bh);
    ctx.fillRect(bx, by, bw, bh);
  }
  return canvas.toDataURL("image/jpeg", 0.82);
}

function nearestRegisteredDistance(lat, lng) {
  let min = Infinity;
  for (const box of REGISTERED_BOXES) {
    const d = haversine(lat, lng, box.lat, box.lng);
    if (d < min) min = d;
  }
  return min;
}

function buildDraft({ addr, dateStr, labels, score, grade, reasons, registered }) {
  return `[오매! 수거함 제보]
위치: ${addr}
촬영일시: ${dateStr}
상태 분류: ${labels.join(", ")}
위험도 점수: ${score}점 / 100점 (${grade.emoji} ${grade.label})
판단 근거:
${reasons.map((r) => " - " + r).join("\n")}
표준데이터 등록 여부: ${registered ? "등록" : "미등록 (표준데이터에서 확인되지 않음)"}

해당 의류수거함은 위 사유로 방치·정비가 필요한 상태로 진단되었습니다. 관할 부서의 현장 확인과 정비(또는 철거) 조치를 요청드립니다.
※ 본 진단은 AI 참고 자료이며, 최종 판단을 위한 현장 확인이 필요합니다.
(근거: 폐기물관리법 및 관할 지자체 폐기물·의류수거함 관리 조례)`;
}

export async function runDiagnosis(file, loc, resolvedAddress) {
  const img = await loadImage(file);

  // 지연 연출 (Vision AI 분석 흉내)
  await new Promise((r) => setTimeout(r, 1200 + Math.random() * 500));

  const stats = analyzeImage(img);
  const maskedDataUrl = maskAndDraw(img);

  const dist = nearestRegisteredDistance(loc.lat, loc.lng);
  const registered = dist <= 40;

  // 관리자 표시 판정은 실제 기획서 방식과 동일하게 "표준데이터 등록 여부"를 1차 기준으로 사용한다.
  // (사진만으로 연락처 표기를 읽어내는 것은 이 경량 분석으로는 불가능하기 때문)
  const flags = {
    noManager: !registered,
    dump: stats.darkRatio > 0.15 || stats.stdL > 55,
    satur: stats.brightRatio > 0.22 || (stats.darkRatio > 0.08 && stats.darkRatio <= 0.15),
    damage: stats.brownRatio > 0.05,
  };

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

  const grade = gradeOf(score);
  const addr = resolvedAddress && resolvedAddress.trim() ? resolvedAddress.trim() : "선택한 위치";

  const dateStr = new Date().toLocaleString("ko-KR", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });

  const draft = buildDraft({ addr, dateStr, labels, score, grade, reasons, registered });

  return {
    id: `u-${Date.now()}`,
    lat: loc.lat,
    lng: loc.lng,
    addr,
    registered,
    isSeed: false,
    photo: maskedDataUrl,
    createdAt: Date.now(),
    history: [
      {
        date: Date.now(),
        score,
        labels,
        reasons,
      },
    ],
    flags,
    score,
    grade,
    draft,
    reasons,
    labels,
  };
}
