export function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h;
}

export function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function gradeOf(score) {
  if (score <= 30) return { key: "safe", label: "관찰", emoji: "🟢" };
  if (score <= 60) return { key: "warn", label: "정비 권고", emoji: "🟡" };
  return { key: "danger", label: "정비 시급", emoji: "🔴" };
}

export function daysAgo(ts) {
  const diff = Date.now() - ts;
  const d = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (d <= 0) return "오늘 최초 제보";
  return `방치 ${d}일째`;
}

export function daysCompact(ts) {
  const diff = Date.now() - ts;
  const d = Math.floor(diff / (1000 * 60 * 60 * 24));
  return d <= 0 ? "오늘" : `${d}일`;
}

export function formatDateTime(ts) {
  return new Date(ts).toLocaleString("ko-KR", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

export function relTime(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "방금 전";
  if (mins < 60) return `${mins}분 전`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}시간 전`;
  const days = Math.floor(hrs / 24);
  return `${days}일 전`;
}

export function toast(msg) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 1800);
}

const geocodeCache = new Map();
const GEO_TIMEOUT = 7000;

async function fetchJson(url, timeoutMs = GEO_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    if (!res.ok) throw new Error(`geocode ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// BigDataCloud의 reverse-geocode-client. 키가 필요 없고 브라우저 호출을 전제로
// 제공되는 엔드포인트다. 행정구역을 adminLevel로 구조화해 주기 때문에
// 시도(4)/시군구(6)/법정동(8)을 안정적으로 뽑을 수 있어 1순위로 쓴다.
async function viaBigDataCloud(lat, lng) {
  const j = await fetchJson(
    `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=ko`
  );
  const adm = j?.localityInfo?.administrative || [];
  const nameAt = (level) => (adm.find((a) => a.adminLevel === level) || {}).name || "";
  const dongs = adm.filter((a) => a.adminLevel === 8);
  // 같은 좌표에 법정동과 행정동이 함께 오는데, 표준데이터는 법정동 기준이다.
  const dong = (dongs.find((a) => (a.description || "").includes("법정동")) || dongs[0] || {}).name || "";
  const parts = [...new Set([nameAt(4), nameAt(6), dong].filter(Boolean))];
  return parts.join(" ");
}

// 도로명·건물번호까지 붙으면 민원 문안이 더 정확해진다. 부가 정보라서
// 실패하면 조용히 건너뛴다.
async function roadDetail(lat, lng) {
  const j = await fetchJson(
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=ko`
  );
  const a = j.address || {};
  return [a.road, a.house_number].filter(Boolean).join(" ");
}

async function viaNominatim(lat, lng) {
  const data = await fetchJson(
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=ko`
  );
  const a = data.address || {};
  const parts = [
    a.city || a.county || a.province,
    a.borough || a.city_district,
    a.suburb || a.neighbourhood || a.village || a.town,
    a.road,
    a.house_number,
  ].filter(Boolean);
  const addr = parts.join(" ").trim();
  if (addr) return addr;
  return data.display_name ? data.display_name.split(",").slice(0, 3).join(",").trim() : "";
}

// 좌표를 사람이 읽는 주소로 바꾼다. 한쪽 서비스가 죽어도 신고가 막히지 않도록
// 두 제공자를 순서대로 시도하고, 끝까지 실패하면 빈 문자열을 반환한다.
// (호출부가 "실패"를 구분해 재시도 안내를 띄울 수 있게 하기 위함)
export async function reverseGeocode(lat, lng) {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (geocodeCache.has(key)) return geocodeCache.get(key);

  let addr = "";
  try {
    addr = await viaBigDataCloud(lat, lng);
  } catch (e) {
    console.warn("bigdatacloud 역지오코딩 실패", e.message);
  }

  if (addr) {
    try {
      const road = await roadDetail(lat, lng);
      if (road && !addr.includes(road)) addr += " " + road;
    } catch (e) {
      /* 도로명은 부가 정보라 실패해도 그대로 진행 */
    }
  } else {
    try {
      addr = await viaNominatim(lat, lng);
    } catch (e) {
      console.warn("nominatim 역지오코딩 실패", e.message);
    }
  }

  if (!addr) return "";
  geocodeCache.set(key, addr);
  return addr;
}

export function escapeHtml(str = "") {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
