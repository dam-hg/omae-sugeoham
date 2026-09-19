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

// OpenStreetMap Nominatim으로 좌표를 사람이 읽는 주소로 변환한다.
// 실패해도 좌표를 노출하지 않고 안전한 문구로 대체한다.
export async function reverseGeocode(lat, lng) {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (geocodeCache.has(key)) return geocodeCache.get(key);

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=ko`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("geocode failed");
    const data = await res.json();
    const a = data.address || {};
    const parts = [
      a.city || a.county || a.province,
      a.borough || a.city_district,
      a.suburb || a.neighbourhood || a.village || a.town,
      a.road,
      a.house_number,
    ].filter(Boolean);
    let addr = parts.join(" ").trim();
    if (!addr) addr = data.display_name ? data.display_name.split(",").slice(0, 3).join(",").trim() : "";
    if (!addr) addr = "주소를 확인할 수 없는 위치";
    geocodeCache.set(key, addr);
    return addr;
  } catch (e) {
    return "주소 확인 중 오류 (지도에서 선택한 위치)";
  }
}

export function escapeHtml(str = "") {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
