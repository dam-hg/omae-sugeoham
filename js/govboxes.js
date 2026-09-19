// 「전국의류수거함표준데이터」(data.go.kr, publicDataPk=15139214) 스냅샷.
// 조회방법: https://www.data.go.kr/download/standard.json?publicDataPk=15139214&svcTableNm=tn_pubr_public_clothing_collect_bins_svc
// 스냅샷 기준일 2026-07-27 · data/gov-boxes.json 에 정제된 형태로 저장.
//
// data/korea-regions.json 은 대한민국 17개 시도의 전체 시군구 228곳 목록
// (출처: cosmosfarm/korea-administrative-district). 표준데이터에 등록 건수가
// 0건인 시군구도 검색·조회가 가능해야 하므로, 검색 대상은 이 "전체 행정구역"
// 목록을 기준으로 하고 gov-boxes.json은 그 위에 건수를 매기는 용도로만 쓴다.
//
// gov-boxes.json의 dong 필드는 지번주소(LCTN_LOTNO_ADDR, "시군구+동+번지"가
// 공백 없이 붙는 형식)에서 정규식으로 추출한 값이다. 도로명주소는 동 정보를
// 담지 않아 사용하지 않았다. 제공기관마다 지번주소 표기 방식이 달라 모든
// 행에서 추출되지는 않으며(전국 기준 약 2.5%), 추출 실패 시 빈 문자열이다.
let boxCache = null;
let regionListCache = null;

export async function loadGovBoxes() {
  if (boxCache) return boxCache;
  const [boxRes, regionRes] = await Promise.all([fetch("data/gov-boxes.json"), fetch("data/korea-regions.json")]);
  const rawBoxes = await boxRes.json();
  const rawRegions = await regionRes.json();

  boxCache = rawBoxes.map((r) => ({ sido: r.p, sigungu: r.g, dong: r.d || "", name: r.n, addr: r.a, lat: r.y, lng: r.x }));

  const countMap = new Map();
  for (const b of boxCache) {
    const key = `${b.sido}|${b.sigungu}`;
    countMap.set(key, (countMap.get(key) || 0) + 1);
  }
  regionListCache = rawRegions
    .map((r) => ({ sido: r.p, sigungu: r.g, count: countMap.get(`${r.p}|${r.g}`) || 0 }))
    .sort((a, b) => (a.sido + a.sigungu).localeCompare(b.sido + b.sigungu, "ko"));

  return boxCache;
}

export function getRegionList() {
  return regionListCache || [];
}

export function searchRegions(regionList, query) {
  const q = query.trim();
  if (!q) return regionList;
  return regionList.filter((r) => (r.sido + " " + r.sigungu).includes(q));
}

export function getBoxesForRegion(boxes, sido, sigungu) {
  return boxes.filter((b) => b.sido === sido && b.sigungu === sigungu);
}

// 주소 문자열(리버스 지오코딩 결과)에서 실제 행정구역(시도/시군구)을 찾아낸다.
// 같은 시군구 이름이 여러 시도에 있을 수 있어(예: 중구), 시도까지 함께
// 일치하는 항목을 우선한다.
export function matchRegionFromAddress(regionList, address) {
  if (!address) return null;
  const candidates = regionList.filter((r) => address.includes(r.sigungu));
  if (!candidates.length) return null;
  const withSido = candidates.find((r) => address.includes(r.sido));
  return withSido || candidates[0];
}
