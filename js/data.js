// 데모용 데이터: 관악구 신림동 원룸촌 일대 (기획서 "팀원 거주지 반경 600m 전수조사" 사례 재현)
export const NEIGHBORHOOD = {
  name: "관악구 신림동",
  center: [37.4843, 126.9302],
  zoom: 16,
};

// 「전국 의류수거함 표준데이터」에 등록된 것으로 가정한 9개 (기획서 근거자료 수치와 동일)
export const REGISTERED_BOXES = [
  { id: "R1", lat: 37.4849, lng: 126.9288, addr: "신림동 1524-3 앞" },
  { id: "R2", lat: 37.4856, lng: 126.9301, addr: "신림동 1531-10 골목" },
  { id: "R3", lat: 37.4838, lng: 126.9312, addr: "신림동 1509-2 앞" },
  { id: "R4", lat: 37.4831, lng: 126.9295, addr: "신림동 1518-7 인근" },
  { id: "R5", lat: 37.4845, lng: 126.932, addr: "신림동 1540-1 앞" },
  { id: "R6", lat: 37.4862, lng: 126.9284, addr: "신림동 1502-9 골목" },
  { id: "R7", lat: 37.4827, lng: 126.9308, addr: "신림동 1512-4 앞" },
  { id: "R8", lat: 37.4853, lng: 126.9273, addr: "신림동 1496-6 인근" },
  { id: "R9", lat: 37.484, lng: 126.9333, addr: "신림동 1548-2 앞" },
];

// 실제 현장 조사에서 발견됐지만 표준데이터엔 없는 미등록 수거함 (예시 데이터, 사진은 일러스트로 대체)
export const SEED_REPORTS = [
  {
    id: "seed-1",
    lat: 37.4834,
    lng: 126.9291,
    addr: "신림동 1520-5 담벼락 옆 (미등록)",
    registered: false,
    isSeed: true,
    illust: "🗑️",
    illustBg: "linear-gradient(135deg,#FF8A8A,#FF5A5F)",
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 41,
    history: [
      {
        date: Date.now() - 1000 * 60 * 60 * 24 * 41,
        score: 90,
        labels: ["포화", "주변 투기물 발생", "관리자 표시 없음"],
        reasons: [
          "투입구 주변으로 의류가 흘러넘쳐 적체되어 있습니다. (포화 10점)",
          "수거함 주변에 생활쓰레기가 다량 적치되어 있습니다. (투기물 30점)",
          "관리업체명·연락처 표시를 식별할 수 없습니다. (관리자 표시 없음 50점)",
        ],
      },
    ],
  },
  {
    id: "seed-2",
    lat: 37.4859, lng: 126.9315,
    addr: "신림동 1536-1 원룸촌 입구 (미등록)",
    registered: false,
    isSeed: true,
    illust: "🧥",
    illustBg: "linear-gradient(135deg,#FFD27A,#FF9F1C)",
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 18,
    history: [
      {
        date: Date.now() - 1000 * 60 * 60 * 24 * 18,
        score: 40,
        labels: ["파손·노후", "관리자 표시 없음"],
        reasons: [
          "본체에 부식과 기울어짐 등 구조적 손상이 보입니다. (파손·노후 10점)",
          "관리업체명·연락처 표시를 식별할 수 없습니다. (관리자 표시 없음 30점 반영)",
        ],
      },
      {
        date: Date.now() - 1000 * 60 * 60 * 24 * 4,
        score: 60,
        labels: ["주변 투기물 발생", "파손·노후", "관리자 표시 없음"],
        reasons: [
          "재조사 결과 주변 투기물이 새로 확인되었습니다. (투기물 30점)",
          "파손 상태가 유지되고 있습니다. (파손·노후 10점)",
          "여전히 관리자 표시가 없습니다. (관리자 표시 없음 20점 반영)",
        ],
      },
    ],
  },
  {
    id: "seed-3",
    lat: 37.4822, lng: 126.9285,
    addr: "신림동 1505-9 다세대주택 앞 (미등록)",
    registered: false,
    isSeed: true,
    illust: "📦",
    illustBg: "linear-gradient(135deg,#9AD9B6,#00C471)",
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 9,
    history: [
      {
        date: Date.now() - 1000 * 60 * 60 * 24 * 9,
        score: 20,
        labels: ["관리자 표시 없음"],
        reasons: [
          "관리업체명·연락처 표시를 식별할 수 없습니다. (관리자 표시 없음 20점 반영)",
        ],
      },
    ],
  },
  {
    id: "seed-4",
    lat: 37.4865, lng: 126.9327,
    addr: "신림동 1552-2 골목 안쪽 (미등록)",
    registered: false,
    isSeed: true,
    illust: "🚮",
    illustBg: "linear-gradient(135deg,#FF8A8A,#FF5A5F)",
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 27,
    history: [
      {
        date: Date.now() - 1000 * 60 * 60 * 24 * 27,
        score: 100,
        labels: ["포화", "주변 투기물 발생", "파손·노후", "관리자 표시 없음"],
        reasons: [
          "투입구가 완전히 막혀 의류가 외부로 적체되어 있습니다. (포화 10점)",
          "대형 폐기물 수준의 투기물이 확인됩니다. (투기물 30점)",
          "본체 파손이 심각합니다. (파손·노후 10점)",
          "관리업체명·연락처 표시를 식별할 수 없습니다. (관리자 표시 없음 50점)",
        ],
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
