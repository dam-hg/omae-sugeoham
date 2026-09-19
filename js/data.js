// 데모용 데이터: 관악구 신림동 원룸촌 일대 (기획서 "팀원 거주지 반경 600m 전수조사" 사례 재현)
export const NEIGHBORHOOD = {
  name: "관악구 신림동",
  center: [37.4843, 126.9302],
  zoom: 16,
};

// 「전국 의류수거함 표준데이터」(data.go.kr, publicDataPk=15139214) 실제 조회 결과.
// 조회방법: https://www.data.go.kr/download/standard.json?publicDataPk=15139214&svcTableNm=tn_pubr_public_clothing_collect_bins_svc&perPage=10000&page=1(~2)
// 스냅샷 기준일 2026-07-27 · 전국 13,975건 중 SGG_NM="관악구" 조회 결과 0건.
// → 관악구는 이 표준데이터에 단 한 건도 등록돼 있지 않은 지역이라, 목업으로 채우지 않고 빈 배열로 둔다.
// (신뢰할 수 있는 인증키 기반 실시간 API는 브라우저에서 CORS가 막혀 있어, 정기 스냅샷 갱신 방식을 사용한다.)
export const REGISTERED_DATA_SOURCE = {
  name: "전국의류수거함표준데이터",
  url: "https://www.data.go.kr/data/15139214/standard.do",
  snapshotDate: "2026-07-27",
  nationwideTotal: 13975,
  gwanakCount: 0,
};
export const REGISTERED_BOXES = [];

const DAY = 1000 * 60 * 60 * 24;

// 시민 제보 예시. 위치와 주소는 「전국의류수거함표준데이터」에 실제로 등록된
// 수거함 좌표를 기준으로 하고, 상태·점수는 서비스 흐름을 보여주기 위한 예시값이다.
export const SEED_REPORTS = [
  {
    id: "seed-1",
    lat: 37.632286, lng: 127.068184,
    addr: "서울특별시 노원구 공릉로55길 88",
    registered: false,
    isSeed: true,
    illust: "🗑️",
    illustBg: "linear-gradient(135deg,#FF8A8A,#FF5A5F)",
    createdAt: Date.now() - DAY * 39,
    history: [
      {
        date: Date.now() - DAY * 39,
        score: 90,
        labels: ["포화", "주변 투기물 발생", "관리자 표시 없음"],
        reasons: ["투입구 밖으로 의류가 흘러넘쳐 쌓여 있습니다. (포화 10점)", "수거함 옆으로 생활쓰레기 봉투가 다수 쌓여 있습니다. (투기물 30점)", "관리업체명·연락처 표기를 확인할 수 없습니다. (관리자 표시 없음 50점)"],
      },
    ],
  },
  {
    id: "seed-2",
    lat: 37.529644, lng: 126.836053,
    addr: "서울특별시 양천구 곰달래로6길 5-22",
    registered: false,
    isSeed: true,
    illust: "🧥",
    illustBg: "linear-gradient(135deg,#FFD27A,#FF9F1C)",
    createdAt: Date.now() - DAY * 17,
    history: [
      {
        date: Date.now() - DAY * 17,
        score: 40,
        labels: ["주변 투기물 발생", "파손·노후"],
        reasons: ["주변에 폐기물이 일부 쌓여 있습니다. (투기물 30점)", "본체 하단이 부식되어 있습니다. (파손·노후 10점)"],
      },
    ],
  },
  {
    id: "seed-3",
    lat: 37.533703, lng: 126.853263,
    addr: "서울특별시 강서구 곰달래로31다길 31",
    registered: false,
    isSeed: true,
    illust: "📦",
    illustBg: "linear-gradient(135deg,#9AD9B6,#00C471)",
    createdAt: Date.now() - DAY * 25,
    history: [
      {
        date: Date.now() - DAY * 25,
        score: 60,
        labels: ["주변 투기물 발생", "관리자 표시 없음"],
        reasons: ["대형 폐기물이 수거함을 막고 있습니다. (투기물 30점)", "관리 주체 표기가 지워져 있습니다. (관리자 표시 없음 30점 반영)"],
      },
    ],
  },
  {
    id: "seed-4",
    lat: 37.541316, lng: 126.939447,
    addr: "서울특별시 마포구 대흥로4길 49",
    registered: false,
    isSeed: true,
    illust: "🚮",
    illustBg: "linear-gradient(135deg,#FF8A8A,#FF5A5F)",
    createdAt: Date.now() - DAY * 10,
    history: [
      {
        date: Date.now() - DAY * 10,
        score: 20,
        labels: ["관리자 표시 없음"],
        reasons: ["연락처 스티커가 훼손되어 식별이 어렵습니다. (관리자 표시 없음 20점 반영)"],
      },
    ],
  },
  {
    id: "seed-5",
    lat: 37.584932, lng: 127.022984,
    addr: "서울특별시 성북구 고려대로14길 44",
    registered: false,
    isSeed: true,
    illust: "👕",
    illustBg: "linear-gradient(135deg,#A8C6FF,#3182F6)",
    createdAt: Date.now() - DAY * 50,
    history: [
      {
        date: Date.now() - DAY * 50,
        score: 100,
        labels: ["포화", "주변 투기물 발생", "파손·노후", "관리자 표시 없음"],
        reasons: ["투입구가 완전히 막혀 있습니다. (포화 10점)", "주변이 사실상 무단투기장이 되어 있습니다. (투기물 30점)", "본체가 기울어지고 파손됐습니다. (파손·노후 10점)", "관리업체 표기가 전혀 없습니다. (관리자 표시 없음 50점)"],
      },
    ],
  },
  {
    id: "seed-6",
    lat: 37.594257, lng: 127.088983,
    addr: "서울특별시 중랑구 봉우재로41길 11",
    registered: false,
    isSeed: true,
    illust: "🧺",
    illustBg: "linear-gradient(135deg,#FFD27A,#FF9F1C)",
    createdAt: Date.now() - DAY * 0,
    history: [
      {
        date: Date.now() - DAY * 0,
        score: 10,
        labels: ["포화"],
        reasons: ["의류가 투입구까지 차 있습니다. (포화 10점)"],
      },
    ],
  },
  {
    id: "seed-7",
    lat: 37.544307, lng: 127.089073,
    addr: "서울특별시 광진구 자양로32길 70",
    registered: false,
    isSeed: true,
    illust: "🗑️",
    illustBg: "linear-gradient(135deg,#FF8A8A,#FF5A5F)",
    createdAt: Date.now() - DAY * 34,
    history: [
      {
        date: Date.now() - DAY * 34,
        score: 90,
        labels: ["포화", "주변 투기물 발생", "관리자 표시 없음"],
        reasons: ["투입구 밖으로 의류가 흘러넘쳐 쌓여 있습니다. (포화 10점)", "수거함 옆으로 생활쓰레기 봉투가 다수 쌓여 있습니다. (투기물 30점)", "관리업체명·연락처 표기를 확인할 수 없습니다. (관리자 표시 없음 50점)"],
      },
    ],
  },
  {
    id: "seed-8",
    lat: 37.268845, lng: 126.952448,
    addr: "경기도 수원시 권선구 매곡로 34-6",
    registered: false,
    isSeed: true,
    illust: "🧥",
    illustBg: "linear-gradient(135deg,#FFD27A,#FF9F1C)",
    createdAt: Date.now() - DAY * 14,
    history: [
      {
        date: Date.now() - DAY * 14,
        score: 40,
        labels: ["주변 투기물 발생", "파손·노후"],
        reasons: ["주변에 폐기물이 일부 쌓여 있습니다. (투기물 30점)", "본체 하단이 부식되어 있습니다. (파손·노후 10점)"],
      },
    ],
  },
  {
    id: "seed-9",
    lat: 37.324062, lng: 127.099348,
    addr: "경기도 용인시 수지구 풍덕천로 160번길 12",
    registered: false,
    isSeed: true,
    illust: "📦",
    illustBg: "linear-gradient(135deg,#9AD9B6,#00C471)",
    createdAt: Date.now() - DAY * 21,
    history: [
      {
        date: Date.now() - DAY * 21,
        score: 60,
        labels: ["주변 투기물 발생", "관리자 표시 없음"],
        reasons: ["대형 폐기물이 수거함을 막고 있습니다. (투기물 30점)", "관리 주체 표기가 지워져 있습니다. (관리자 표시 없음 30점 반영)"],
      },
    ],
  },
  {
    id: "seed-10",
    lat: 36.295988, lng: 127.33589,
    addr: "대전광역시 서구 관저동 1549-5",
    registered: false,
    isSeed: true,
    illust: "🚮",
    illustBg: "linear-gradient(135deg,#FF8A8A,#FF5A5F)",
    createdAt: Date.now() - DAY * 4,
    history: [
      {
        date: Date.now() - DAY * 4,
        score: 20,
        labels: ["관리자 표시 없음"],
        reasons: ["연락처 스티커가 훼손되어 식별이 어렵습니다. (관리자 표시 없음 20점 반영)"],
      },
    ],
  },
];

export const WEIGHTS = {
  noManager: { key: "noManager", label: "관리자 표시 없음", pts: 50 },
  dump: { key: "dump", label: "주변 투기물 발생", pts: 30 },
  satur: { key: "satur", label: "포화 상태", pts: 10 },
  damage: { key: "damage", label: "파손·노후", pts: 10 },
};

export const REASON_TEXT = {
  satur: "투입구 주변으로 의류가 흘러넘쳐 적체되어 있는 것으로 보입니다.",
  dump: "수거함 주변에 생활쓰레기·대형폐기물로 추정되는 물체가 확인됩니다.",
  damage: "본체 파손, 심한 부식, 기울어짐 등 구조적 손상이 관찰됩니다.",
  noManager: "표준데이터에 등록된 관리 정보가 없어 관리업체명·연락처를 확인할 수 없는 시설입니다.",
};

export const LABEL_TEXT = {
  satur: "포화",
  dump: "주변 투기물 발생",
  damage: "파손·노후",
  noManager: "관리자 표시 없음",
};
