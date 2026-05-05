import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  Vibration,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { createAudioPlayer, AudioPlayer, setAudioModeAsync } from "expo-audio";

import { parseQR } from "../src/utils/parseQR";
import {
  addScan,
  clearScans,
  deleteScan,
  loadScans,
  ScanItem,
} from "../src/utils/storage";

const COLORS = {
  bg: "#FFFFFF",
  surface: "#F4F4F5",
  surface2: "#E4E4E7",
  ink: "#09090B",
  mute: "#52525B",
  accent: "#FF3B30",
  ok: "#10B981",
};

const fmt = (n: number) =>
  n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const fmtTime = (t: number) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
};

type ScanState = "idle" | "ok" | "error";

export default function ScannerScreen() {
  const [scans, setScans] = useState<ScanItem[]>([]);
  const [buffer, setBuffer] = useState("");
  const [status, setStatus] = useState<ScanState>("idle");
  const [statusMsg, setStatusMsg] = useState(
    "SCANNER READY — WAITING FOR DATA"
  );
  const [manualOpen, setManualOpen] = useState(false);
  const [diagOpen, setDiagOpen] = useState(false);
  const [rawLog, setRawLog] = useState<
    { id: string; raw: string; ok: boolean; t: number }[]
  >([]);
  const [mName, setMName] = useState("");
  const [mNetto, setMNetto] = useState("");
  const [mBrutto, setMBrutto] = useState("");
  const inputRef = useRef<TextInput | null>(null);
  const statusTimer = useRef<any>(null);
  const successPlayerRef = useRef<AudioPlayer | null>(null);
  const errorPlayerRef = useRef<AudioPlayer | null>(null);

  // Load scans + initialize audio (best-effort, never throws to UI)
  useEffect(() => {
    loadScans().then(setScans);

    (async () => {
      try {
        await setAudioModeAsync({
          playsInSilentMode: true,
          shouldPlayInBackground: false,
        });
      } catch {
        /* ignore */
      }
      try {
        successPlayerRef.current = createAudioPlayer(
          require("../assets/sounds/success.wav")
        );
      } catch (e) {
        console.warn("success audio init failed", e);
      }
      try {
        errorPlayerRef.current = createAudioPlayer(
          require("../assets/sounds/error.wav")
        );
      } catch (e) {
        console.warn("error audio init failed", e);
      }
    })();

    return () => {
      if (statusTimer.current) clearTimeout(statusTimer.current);
      try {
        successPlayerRef.current?.remove();
      } catch {}
      try {
        errorPlayerRef.current?.remove();
      } catch {}
    };
  }, []);

  const safePlay = (p: AudioPlayer | null) => {
    if (!p) return;
    try {
      p.seekTo(0);
      p.play();
    } catch {
      /* ignore */
    }
  };

  const flashStatus = (s: ScanState, msg: string) => {
    setStatus(s);
    setStatusMsg(msg);
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => {
      setStatus("idle");
      setStatusMsg("SCANNER READY — WAITING FOR DATA");
    }, 2500);
  };

  const processScan = async (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const parsed = parseQR(trimmed);
    // Always remember the last 20 raw scans so user can debug
    setRawLog((prev) => {
      const entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        raw: trimmed,
        ok: parsed !== null,
        t: Date.now(),
      };
      const next = [entry, ...prev];
      return next.slice(0, 20);
    });
    if (!parsed) {
      safePlay(errorPlayerRef.current);
      Vibration.vibrate(300);
      flashStatus(
        "error",
        `INVALID SCAN: "${trimmed.substring(0, 40)}${
          trimmed.length > 40 ? "..." : ""
        }" — TAP DIAG`
      );
      return;
    }
    const item: ScanItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: parsed.name,
      netto: parsed.netto,
      brutto: parsed.brutto,
      scannedAt: Date.now(),
    };
    safePlay(successPlayerRef.current);
    Vibration.vibrate(50);
    const next = await addScan(item);
    setScans(next);
    flashStatus(
      "ok",
      `ADDED: ${item.name ?? "ITEM"} — N ${fmt(item.netto)}g / B ${fmt(
        item.brutto
      )}g`
    );
  };

  const onSubmitEditing = async () => {
    const val = buffer;
    setBuffer("");
    await processScan(val);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const submitManual = async () => {
    const n = parseFloat(mNetto.replace(",", "."));
    const b = parseFloat(mBrutto.replace(",", "."));
    if (!Number.isFinite(n) || !Number.isFinite(b)) {
      Alert.alert("INVALID INPUT", "Enter valid Netto and Brutto numbers.");
      return;
    }
    const netto = Math.min(n, b);
    const brutto = Math.max(n, b);
    const item: ScanItem = {
      id: `${Date.now()}-m${Math.random().toString(36).slice(2, 6)}`,
      name: mName.trim() || undefined,
      netto,
      brutto,
      scannedAt: Date.now(),
    };
    safePlay(successPlayerRef.current);
    const next = await addScan(item);
    setScans(next);
    flashStatus(
      "ok",
      `ADDED: ${item.name ?? "ITEM"} — N ${fmt(netto)}g / B ${fmt(brutto)}g`
    );
    setMName("");
    setMNetto("");
    setMBrutto("");
    setManualOpen(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const handleDelete = useCallback((id: string, name?: string) => {
    Alert.alert(
      "DELETE ITEM?",
      `Remove ${name ?? "this item"} from the list?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            const next = await deleteScan(id);
            setScans(next);
            flashStatus("ok", "ITEM DELETED");
            setTimeout(() => inputRef.current?.focus(), 100);
          },
        },
      ]
    );
  }, []);

  const handleClearAll = () => {
    if (scans.length === 0) return;
    Alert.alert(
      "CLEAR ALL SCANS?",
      `This will delete all ${scans.length} items.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: async () => {
            await clearScans();
            setScans([]);
            flashStatus("ok", "CLEARED ALL");
            setTimeout(() => inputRef.current?.focus(), 100);
          },
        },
      ]
    );
  };

  const totalNetto = scans.reduce((s, x) => s + x.netto, 0);
  const totalBrutto = scans.reduce((s, x) => s + x.brutto, 0);

  const renderItem = ({ item, index }: { item: ScanItem; index: number }) => (
    <View style={styles.row} testID={`scan-row-${index}`}>
      <View style={styles.rowIndex}>
        <Text style={styles.rowIndexText}>
          {String(scans.length - index).padStart(2, "0")}
        </Text>
      </View>
      <View style={styles.rowInfo}>
        <Text style={styles.rowName} numberOfLines={1}>
          {item.name ?? `ITEM ${scans.length - index}`}
        </Text>
        <Text style={styles.rowTime}>{fmtTime(item.scannedAt)}</Text>
      </View>
      <View style={styles.rowVals}>
        <View style={styles.rowValBlock}>
          <Text style={styles.rowValLabel}>N</Text>
          <Text style={styles.rowVal}>{fmt(item.netto)}</Text>
        </View>
        <View style={styles.rowValBlock}>
          <Text style={styles.rowValLabel}>B</Text>
          <Text style={styles.rowVal}>{fmt(item.brutto)}</Text>
        </View>
      </View>
      <Pressable
        onPress={() => handleDelete(item.id, item.name)}
        style={styles.delBtn}
        testID={`delete-${index}`}
      >
        <Text style={styles.delBtnText}>×</Text>
      </Pressable>
    </View>
  );

  const statusStyle =
    status === "ok"
      ? { bg: COLORS.ok, fg: "#FFF", dot: "#FFF" }
      : status === "error"
      ? { bg: COLORS.accent, fg: "#FFF", dot: "#FFF" }
      : { bg: COLORS.surface2, fg: COLORS.ink, dot: COLORS.ink };

  return (
    <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>BLUETOOTH QR / WEIGHT</Text>
          <Text style={styles.title} testID="app-title">
            SCANNER
          </Text>
        </View>
        <Pressable
          testID="clear-all-btn"
          onPress={handleClearAll}
          style={[styles.iconBtn, scans.length === 0 && styles.iconBtnDisabled]}
        >
          <Text style={styles.iconBtnText}>CLEAR</Text>
        </Pressable>
      </View>

      {/* Status bar — tap to open diagnostics */}
      <Pressable
        onPress={() => {
          if (rawLog.length > 0) setDiagOpen(true);
          else inputRef.current?.focus();
        }}
        style={[styles.statusBar, { backgroundColor: statusStyle.bg }]}
        testID="status-bar"
      >
        <View
          style={[
            styles.statusDot,
            {
              backgroundColor: statusStyle.dot,
              opacity: status === "idle" ? 0.5 : 1,
            },
          ]}
        />
        <Text
          style={[styles.statusText, { color: statusStyle.fg }]}
          numberOfLines={1}
        >
          {statusMsg}
        </Text>
      </Pressable>

      {/* Hidden scanner input — auto-focused, captures Bluetooth HID input */}
      <TextInput
        ref={inputRef}
        testID="scanner-input"
        value={buffer}
        onChangeText={setBuffer}
        onSubmitEditing={onSubmitEditing}
        blurOnSubmit={false}
        autoFocus
        showSoftInputOnFocus={false}
        autoCorrect={false}
        autoCapitalize="none"
        style={styles.hiddenInput}
        placeholder=""
      />

      {/* Totals */}
      <View style={styles.metrics}>
        <View style={styles.metricRow}>
          <View style={styles.metricCard} testID="metric-netto">
            <Text style={styles.metricLabel}>TOTAL NETTO</Text>
            <View style={styles.metricValueRow}>
              <Text style={styles.metricValue}>{fmt(totalNetto)}</Text>
              <Text style={styles.metricUnit}>g</Text>
            </View>
          </View>
          <View style={styles.metricCard} testID="metric-brutto">
            <Text style={styles.metricLabel}>TOTAL BRUTTO</Text>
            <View style={styles.metricValueRow}>
              <Text style={styles.metricValue}>{fmt(totalBrutto)}</Text>
              <Text style={styles.metricUnit}>g</Text>
            </View>
          </View>
        </View>
        <View style={styles.metricCardHighlight} testID="metric-count">
          <Text style={styles.metricLabelLight}>ITEMS SCANNED</Text>
          <Text style={styles.metricValueLight}>{scans.length}</Text>
        </View>
      </View>

      {/* List */}
      <View style={styles.listWrap}>
        <View style={styles.listHeader}>
          <Text style={styles.listTitle}>SCANNED ITEMS</Text>
          <Text style={styles.listCount}>{scans.length}</Text>
        </View>
        {scans.length === 0 ? (
          <View style={styles.empty} testID="empty-state">
            <Text style={styles.emptyIcon}>▢</Text>
            <Text style={styles.emptyTitle}>NO ITEMS YET</Text>
            <Text style={styles.emptySub}>
              TRIGGER YOUR BLUETOOTH SCANNER TO ADD ITEMS
            </Text>
          </View>
        ) : (
          <FlatList
            data={scans}
            keyExtractor={(x) => x.id}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={() => <View style={styles.sep} />}
            testID="scan-list"
            keyboardShouldPersistTaps="always"
          />
        )}
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        <Pressable
          testID="diag-btn"
          onPress={() => setDiagOpen(true)}
          style={styles.secondaryBtn}
        >
          <Text style={styles.secondaryBtnText}>DIAG</Text>
          {rawLog.length > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{rawLog.length}</Text>
            </View>
          )}
        </Pressable>
        <Pressable
          testID="manual-add-btn"
          onPress={() => setManualOpen(true)}
          style={styles.primaryBtn}
        >
          <Text style={styles.primaryBtnText}>+ MANUAL ENTRY</Text>
        </Pressable>
      </View>

      {/* Manual Modal */}
      <Modal
        visible={manualOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setManualOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalRoot}
        >
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => {
              setManualOpen(false);
              setTimeout(() => inputRef.current?.focus(), 100);
            }}
          />
          <View style={styles.modalSheet} testID="manual-entry-modal">
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>MANUAL ENTRY</Text>
              <Pressable
                onPress={() => {
                  setManualOpen(false);
                  setTimeout(() => inputRef.current?.focus(), 100);
                }}
                testID="manual-close-btn"
                hitSlop={12}
              >
                <Text style={styles.modalClose}>×</Text>
              </Pressable>
            </View>

            <Text style={styles.inputLabel}>ITEM NAME (OPTIONAL)</Text>
            <TextInput
              testID="manual-name-input"
              value={mName}
              onChangeText={setMName}
              placeholder="Item 1"
              placeholderTextColor={COLORS.mute}
              style={styles.input}
            />

            <View style={styles.rowGap}>
              <View style={styles.col}>
                <Text style={styles.inputLabel}>NETTO (g)</Text>
                <TextInput
                  testID="manual-netto-input"
                  value={mNetto}
                  onChangeText={setMNetto}
                  placeholder="0.00"
                  placeholderTextColor={COLORS.mute}
                  keyboardType="decimal-pad"
                  style={styles.input}
                />
              </View>
              <View style={styles.col}>
                <Text style={styles.inputLabel}>BRUTTO (g)</Text>
                <TextInput
                  testID="manual-brutto-input"
                  value={mBrutto}
                  onChangeText={setMBrutto}
                  placeholder="0.00"
                  placeholderTextColor={COLORS.mute}
                  keyboardType="decimal-pad"
                  style={styles.input}
                />
              </View>
            </View>

            <Pressable
              testID="manual-submit-btn"
              onPress={submitManual}
              style={[styles.primaryBtn, { marginTop: 16 }]}
            >
              <Text style={styles.primaryBtnText}>ADD ITEM</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Diagnostic Modal */}
      <Modal
        visible={diagOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setDiagOpen(false)}
      >
        <View style={styles.modalRoot}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => {
              setDiagOpen(false);
              setTimeout(() => inputRef.current?.focus(), 100);
            }}
          />
          <View style={[styles.modalSheet, { maxHeight: "80%" }]} testID="diag-modal">
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>SCAN DIAGNOSTICS</Text>
              <Pressable
                onPress={() => {
                  setDiagOpen(false);
                  setTimeout(() => inputRef.current?.focus(), 100);
                }}
                testID="diag-close-btn"
                hitSlop={12}
              >
                <Text style={styles.modalClose}>×</Text>
              </Pressable>
            </View>
            <Text style={styles.diagHint}>
              Last {rawLog.length} raw scans. Long-press a row to view full text.
              Share with support if a code can&apos;t be parsed.
            </Text>
            {rawLog.length === 0 ? (
              <View style={{ paddingVertical: 24, alignItems: "center" }}>
                <Text style={styles.emptySub}>NO SCANS YET</Text>
              </View>
            ) : (
              <FlatList
                data={rawLog}
                keyExtractor={(x) => x.id}
                style={{ maxHeight: 420 }}
                ItemSeparatorComponent={() => <View style={styles.sep} />}
                renderItem={({ item }) => (
                  <Pressable
                    onLongPress={() =>
                      Alert.alert("RAW SCAN DATA", item.raw, [
                        { text: "OK" },
                      ])
                    }
                    style={[
                      styles.diagRow,
                      {
                        borderColor: item.ok ? COLORS.ok : COLORS.accent,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.diagBadge,
                        { backgroundColor: item.ok ? COLORS.ok : COLORS.accent },
                      ]}
                    >
                      <Text style={styles.diagBadgeText}>
                        {item.ok ? "OK" : "FAIL"}
                      </Text>
                    </View>
                    <View style={{ flex: 1, paddingHorizontal: 10 }}>
                      <Text style={styles.diagTime}>{fmtTime(item.t)}</Text>
                      <Text style={styles.diagRaw} numberOfLines={3}>
                        {item.raw}
                      </Text>
                    </View>
                  </Pressable>
                )}
                testID="diag-list"
              />
            )}
            <Pressable
              onPress={() => setRawLog([])}
              style={[styles.secondaryBtn, { marginTop: 12 }]}
              testID="diag-clear-btn"
            >
              <Text style={styles.secondaryBtnText}>CLEAR LOG</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const monoFont = Platform.select({ ios: "Menlo", android: "monospace" });

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 10,
  },
  label: {
    fontSize: 10,
    letterSpacing: 3,
    color: COLORS.mute,
    fontWeight: "700",
  },
  title: {
    fontSize: 28,
    fontWeight: "900",
    color: COLORS.ink,
    letterSpacing: -1,
    marginTop: 2,
  },
  iconBtn: {
    paddingHorizontal: 14,
    height: 44,
    backgroundColor: COLORS.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  iconBtnDisabled: { opacity: 0.3 },
  iconBtnText: {
    color: "#FFF",
    fontWeight: "900",
    fontSize: 11,
    letterSpacing: 2,
  },

  statusBar: {
    marginHorizontal: 20,
    borderWidth: 2,
    borderColor: COLORS.ink,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusText: {
    fontWeight: "800",
    fontSize: 12,
    letterSpacing: 1.2,
    flex: 1,
  },

  hiddenInput: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
    left: -1000,
    top: -1000,
  },

  metrics: {
    paddingHorizontal: 20,
    marginTop: 12,
    gap: 8,
  },
  metricRow: { flexDirection: "row", gap: 8 },
  metricCard: {
    flex: 1,
    borderWidth: 2,
    borderColor: COLORS.ink,
    backgroundColor: COLORS.bg,
    padding: 12,
  },
  metricCardHighlight: {
    borderWidth: 2,
    borderColor: COLORS.ink,
    backgroundColor: COLORS.ink,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  metricLabel: {
    fontSize: 10,
    letterSpacing: 2.5,
    color: COLORS.mute,
    fontWeight: "800",
    marginBottom: 6,
  },
  metricLabelLight: {
    fontSize: 10,
    letterSpacing: 2.5,
    color: "#FFF",
    fontWeight: "800",
    opacity: 0.7,
  },
  metricValueRow: { flexDirection: "row", alignItems: "baseline", gap: 4 },
  metricValue: {
    fontSize: 22,
    fontWeight: "900",
    color: COLORS.ink,
    letterSpacing: -1,
    fontFamily: monoFont,
  },
  metricValueLight: {
    fontSize: 32,
    fontWeight: "900",
    color: "#FFF",
    letterSpacing: -1,
    fontFamily: monoFont,
  },
  metricUnit: {
    fontSize: 12,
    color: COLORS.mute,
    fontWeight: "700",
  },

  listWrap: {
    flex: 1,
    marginTop: 16,
    paddingHorizontal: 20,
  },
  listHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 10,
  },
  listTitle: {
    fontSize: 12,
    fontWeight: "900",
    color: COLORS.ink,
    letterSpacing: 2.5,
  },
  listCount: {
    fontSize: 12,
    color: COLORS.mute,
    fontWeight: "800",
    fontFamily: monoFont,
  },
  listContent: { paddingBottom: 20 },
  sep: { height: 6 },
  row: {
    flexDirection: "row",
    alignItems: "stretch",
    borderWidth: 2,
    borderColor: COLORS.ink,
    backgroundColor: COLORS.bg,
    minHeight: 56,
  },
  rowIndex: {
    width: 40,
    backgroundColor: COLORS.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  rowIndexText: {
    color: "#FFF",
    fontWeight: "900",
    fontSize: 13,
    fontFamily: monoFont,
  },
  rowInfo: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    justifyContent: "center",
  },
  rowName: {
    fontSize: 13,
    fontWeight: "800",
    color: COLORS.ink,
    letterSpacing: -0.2,
  },
  rowTime: {
    fontSize: 10,
    color: COLORS.mute,
    marginTop: 2,
    letterSpacing: 1,
    fontFamily: monoFont,
  },
  rowVals: {
    flexDirection: "row",
    gap: 6,
    paddingRight: 6,
    alignItems: "center",
  },
  rowValBlock: {
    alignItems: "flex-end",
    minWidth: 56,
  },
  rowValLabel: {
    fontSize: 9,
    fontWeight: "800",
    color: COLORS.mute,
    letterSpacing: 1.5,
  },
  rowVal: {
    fontSize: 13,
    fontWeight: "900",
    color: COLORS.ink,
    fontFamily: monoFont,
  },
  delBtn: {
    width: 44,
    backgroundColor: COLORS.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  delBtnText: {
    color: "#FFF",
    fontSize: 26,
    fontWeight: "900",
    lineHeight: 28,
  },

  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 30,
    gap: 6,
    borderWidth: 2,
    borderColor: COLORS.surface2,
    borderStyle: "dashed",
  },
  emptyIcon: {
    fontSize: 56,
    color: COLORS.mute,
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: COLORS.ink,
    letterSpacing: 2,
    marginTop: 8,
  },
  emptySub: {
    fontSize: 11,
    color: COLORS.mute,
    letterSpacing: 1.5,
    fontWeight: "700",
    textAlign: "center",
  },

  actions: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 18,
  },
  primaryBtn: {
    flex: 1,
    height: 56,
    backgroundColor: COLORS.accent,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  primaryBtnText: {
    color: "#FFF",
    fontWeight: "900",
    letterSpacing: 2,
    fontSize: 13,
  },
  secondaryBtn: {
    height: 56,
    paddingHorizontal: 18,
    backgroundColor: COLORS.bg,
    borderWidth: 2,
    borderColor: COLORS.ink,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  secondaryBtnText: {
    color: COLORS.ink,
    fontWeight: "900",
    letterSpacing: 2,
    fontSize: 13,
  },
  badge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 4,
    backgroundColor: COLORS.accent,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 4,
  },
  badgeText: {
    color: "#FFF",
    fontWeight: "900",
    fontSize: 11,
    fontFamily: monoFont,
  },

  modalRoot: { flex: 1, justifyContent: "flex-end" },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  modalSheet: {
    backgroundColor: COLORS.bg,
    borderTopWidth: 3,
    borderColor: COLORS.ink,
    padding: 20,
    paddingBottom: 36,
    gap: 10,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "900",
    color: COLORS.ink,
    letterSpacing: -0.5,
  },
  modalClose: {
    fontSize: 28,
    fontWeight: "900",
    color: COLORS.ink,
    paddingHorizontal: 4,
  },
  inputLabel: {
    fontSize: 10,
    letterSpacing: 2.5,
    color: COLORS.mute,
    fontWeight: "800",
    marginTop: 6,
    marginBottom: 6,
  },
  input: {
    borderWidth: 2,
    borderColor: COLORS.ink,
    padding: 14,
    fontSize: 16,
    color: COLORS.ink,
    backgroundColor: COLORS.bg,
    fontFamily: monoFont,
  },
  rowGap: { flexDirection: "row", gap: 10 },
  col: { flex: 1 },

  diagHint: {
    fontSize: 11,
    color: COLORS.mute,
    fontWeight: "600",
    marginTop: 4,
    marginBottom: 10,
    lineHeight: 16,
  },
  diagRow: {
    flexDirection: "row",
    alignItems: "stretch",
    borderWidth: 2,
    minHeight: 56,
  },
  diagBadge: {
    width: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  diagBadgeText: {
    color: "#FFF",
    fontWeight: "900",
    fontSize: 12,
    letterSpacing: 1.2,
  },
  diagTime: {
    fontSize: 10,
    color: COLORS.mute,
    fontWeight: "700",
    fontFamily: monoFont,
    marginTop: 6,
    marginBottom: 2,
  },
  diagRaw: {
    fontSize: 12,
    color: COLORS.ink,
    fontWeight: "700",
    fontFamily: monoFont,
    paddingBottom: 6,
  },
});
