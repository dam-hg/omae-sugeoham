// Gemini Vision으로 수거함 사진 상태를 판별한다.
// 실패(키 만료/과부하/네트워크)하면 호출부에서 사용자 체크리스트로 자연스럽게 넘어간다.
// 시연용 Gemini API 키. 공개 저장소에 포함되므로 외부 노출을 전제로 쓰고,
// 시연이 끝나면 폐기할 것. 키가 비거나 만료되면 analyzePhoto가 실패를 반환하고
// 사용자가 직접 체크하는 방식으로 자동 전환된다.
const API_KEY = "AQ.Ab8RN6KJuYql29t8UWmi_-xjhL36JaKnRafbesTCteGWoaLpmw";

// 과부하(503)가 잦아 최신 모델부터 순서대로 시도한다.
const MODELS = ["gemini-3.7-flash", "gemini-3.5-flash", "gemini-flash-latest"];

// 관리자 표시(업체명·연락처) 여부는 사진 판독으로는 신뢰도가 낮다.
// 스티커가 측면에 있거나 글자가 작으면 오판이 잦아서 AI에게 묻지 않고,
// 표준데이터 등록 여부로 판단한다(diagnose.js 참고).
const PROMPT = `너는 길거리 의류수거함 사진을 점검하는 검사관이다. 사진을 보고 아래 3가지를 판정해라.

- dump: 수거함 주변 바닥에 쓰레기봉투, 폐기물, 버려진 물건이 쌓여 있으면 true. 깨끗하면 false.
- satur: 투입구가 막혔거나 의류가 밖으로 흘러넘쳤으면 true. 아니면 false.
- damage: 본체가 부서졌거나 심하게 녹슬거나 기울어졌으면 true. 멀쩡하면 false.

중요:
- 사진에 의류수거함이 없으면 binFound를 false로 하고 나머지는 모두 false로 해라.
- 확실하지 않으면 false로 해라. 추측해서 true를 만들지 마라.
- summary는 사진에서 실제로 보이는 것만 한국어 한 문장으로 적어라.

반드시 아래 JSON만 출력해라:
{"binFound":true,"dump":false,"satur":false,"damage":false,"summary":"..."}`;

function extractJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch (e) {
    return null;
  }
}

// 구조화 출력으로 고정한다. 3.x 모델은 thinking 토큰이 출력 한도를 먹어버려서
// 본문이 비는 경우가 있어 thinkingBudget을 0으로 두고 한도도 넉넉히 잡는다.
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    binFound: { type: "boolean" },
    dump: { type: "boolean" },
    satur: { type: "boolean" },
    damage: { type: "boolean" },
    summary: { type: "string" },
  },
  required: ["binFound", "dump", "satur", "damage", "summary"],
};

async function callModel(model, base64, mimeType, signal) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY },
    signal,
    body: JSON.stringify({
      contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mimeType, data: base64 } }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });
  if (!res.ok) throw new Error(`${model} ${res.status}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  const parsed = extractJson(text);
  if (!parsed) throw new Error(`${model} parse failed`);
  return parsed;
}

// dataURL -> {base64, mimeType}
function splitDataUrl(dataUrl) {
  const [head, base64] = dataUrl.split(",");
  const mimeType = (head.match(/data:([^;]+)/) || [])[1] || "image/jpeg";
  return { base64, mimeType };
}

export async function analyzePhoto(photoDataUrl, timeoutMs = 20000) {
  if (!API_KEY) return { ok: false };
  const { base64, mimeType } = splitDataUrl(photoDataUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (const model of MODELS) {
      try {
        const r = await callModel(model, base64, mimeType, controller.signal);
        return {
          ok: true,
          model,
          binFound: r.binFound !== false,
          summary: typeof r.summary === "string" ? r.summary : "",
          // noManager는 표준데이터 등록 여부로 호출부에서 채운다.
          flags: {
            dump: !!r.dump,
            satur: !!r.satur,
            damage: !!r.damage,
          },
        };
      } catch (e) {
        if (controller.signal.aborted) break;
        console.warn("gemini fallback:", e.message);
      }
    }
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}
