import { SEED_REPORTS } from "./data.js";

const KEY = "omae-sugeoham-reports-v1";

function readRaw() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function writeRaw(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch (e) {
    console.warn("저장 공간이 부족합니다.", e);
  }
}

export function getUserReports() {
  return readRaw();
}

export function getAllReports() {
  return [...SEED_REPORTS, ...readRaw()];
}

export function addReport(report) {
  const list = readRaw();
  list.unshift(report);
  writeRaw(list);
  return report;
}

export function getReportById(id) {
  return getAllReports().find((r) => r.id === id);
}
