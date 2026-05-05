import AsyncStorage from "@react-native-async-storage/async-storage";

export type ScanItem = {
  id: string;
  name?: string;
  netto: number; // grams
  brutto: number; // grams
  scannedAt: number; // epoch ms
};

const STORAGE_KEY = "@weight_scanner/scans";

export async function loadScans(): Promise<ScanItem[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as ScanItem[];
  } catch {
    return [];
  }
}

export async function saveScans(items: ScanItem[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // ignore
  }
}

export async function addScan(item: ScanItem): Promise<ScanItem[]> {
  const current = await loadScans();
  const next = [item, ...current];
  await saveScans(next);
  return next;
}

export async function deleteScan(id: string): Promise<ScanItem[]> {
  const current = await loadScans();
  const next = current.filter((x) => x.id !== id);
  await saveScans(next);
  return next;
}

export async function clearScans(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
