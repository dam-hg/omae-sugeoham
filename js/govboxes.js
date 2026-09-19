// 「전국의류수거함표준데이터」(data.go.kr, publicDataPk=15139214) 스냅샷.
// 조회방법: https://www.data.go.kr/download/standard.json?publicDataPk=15139214&svcTableNm=tn_pubr_public_clothing_collect_bins_svc
// 스냅샷 기준일 2026-07-27 · data/gov-boxes.json 에 정제된 형태로 저장.
let cache = null;
let regionListCache = null;

export async function loadGovBoxes() {
  if (cache) return cache;
  const res = await fetch("data/gov-boxes.json");
  const raw = await res.json();
  cache = raw.map((r) => ({ sido: r.p, sigungu: r.g, name: r.n, addr: r.a, lat: r.y, lng: r.x }));
  return cache;
}

export function getRegionList(boxes) {
  if (regionListCache) return regionListCache;
  const map = new Map();
  for (const b of boxes) {
    const key = `${b.sido}|${b.sigungu}`;
    map.set(key, (map.get(key) || 0) + 1);
  }
  regionListCache = [...map.entries()]
    .map(([key, count]) => {
      const [sido, sigungu] = key.split("|");
      return { sido, sigungu, count };
    })
    .sort((a, b) => (a.sido + a.sigungu).localeCompare(b.sido + b.sigungu, "ko"));
  return regionListCache;
}

export function searchRegions(regionList, query) {
  const q = query.trim();
  if (!q) return regionList;
  return regionList.filter((r) => (r.sido + " " + r.sigungu).includes(q));
}

export function getBoxesForRegion(boxes, sido, sigungu) {
  return boxes.filter((b) => b.sido === sido && b.sigungu === sigungu);
}

export const DEFAULT_REGION = { sido: "서울특별시", sigungu: "관악구" };
