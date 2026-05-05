# Weight Scanner — Bluetooth QR Netto/Brutto

## Summary
Android-first mobile app (Expo React Native) that pairs with an **external Bluetooth barcode/QR scanner** (HID keyboard mode), accumulates Netto and Brutto weight values (in grams) per scan, and shows running totals + scanned items list with per-item delete.

## How it works
- Invisible auto-focused `TextInput` stays focused at all times. Bluetooth HID scanners type the scanned payload + press **Enter**, which triggers parse-and-add flow.
- **Success beep** plays on a valid scan; **error beep** plays on an invalid scan (best-effort via `expo-audio` — failure to load audio does not crash the app).
- Status banner at top flashes green ("ADDED: …") or red ("INVALID SCAN: …") for 2.5s.
- Vibration also fires for both scan states (50ms ok, 300ms error).

## Robust QR Parsing (latest)
Tries strategies in priority order:
1. **JSON** — `{"netto":3.79,"brutto":5.94,"name":"Item 1"}`
2. **Key/Value labels** — `netto:3.79,brutto:5.94`, `Netto: 8.18 gr, Bruto: 10.95 gr`
3. **Free text "Netto X gr / Bruto Y gr"** anywhere in the string
4. **Triple match** — extracts ALL `<number> gr/g/kg` values from the string and finds the triple where `a + b ≈ c`. Used for jewelry slash-format tags like:
   `OP25080206/BR0129108TPOAV/VERONA BRACELET/Size 15/8.2 gr./6K SI/YL/8.18gr./1 Pc/2.77 gr./10.95 gr./...` → netto=8.18, packing=2.77, **bruto=10.95** (exact match wins over close approximations).
5. **Min/Max of weight values** when triple cannot be found
6. **Fallback** — last 2 numeric tokens (CSV/whitespace), with min→netto and max→bruto

**Safety rule:** `bruto >= netto` is always enforced — if a payload feeds them in reverse, they're auto-swapped.

## Features
- External Bluetooth HID scanner input (no camera)
- Audio + haptic feedback (best-effort)
- Live totals: Total Netto (g), Total Brutto (g), Items Scanned
- Full scanned-items list with per-row delete button
- "Clear all" button in header
- Manual entry modal (item name + netto + brutto, also auto-swaps if entered reversed)
- Local persistence (AsyncStorage); offline-first
- Industrial/neo-brutalist UI tuned for warehouse/jewelry workshop conditions

## Architecture
- Frontend only (no backend required per user choice)
- `app/_layout.tsx` — Stack layout with SafeAreaProvider
- `app/index.tsx` — Main screen (scanner input, totals, list, manual modal)
- `src/utils/parseQR.ts` — Multi-strategy parser w/ triple-finding
- `src/utils/storage.ts` — AsyncStorage wrapper
- `assets/sounds/success.wav`, `assets/sounds/error.wav`

## Notable fixes
- Replaced `@expo/vector-icons` with text/Unicode glyphs to avoid intermittent "Font file empty" crash on Expo Go via tunnel.
- Audio is now created imperatively inside `useEffect` with try/catch; the app never crashes if WAV asset bundling fails on a device.
- Aligned all packages to Expo SDK 54 versions (`expo-audio@~1.1.1`, `@react-native-async-storage/async-storage@2.2.0`, `expo-camera@~17.0.10`).

## Permissions (app.json)
- Android: `BLUETOOTH`, `BLUETOOTH_CONNECT`
- iOS: `NSBluetoothAlwaysUsageDescription`
