# Weight Scanner — Bluetooth QR Netto/Brutto

## Summary
Android-first mobile app (Expo React Native) that pairs with an **external Bluetooth barcode/QR scanner** (HID keyboard mode), accumulates Netto and Brutto weight values (in grams) per scan, and shows running totals + scanned items list with per-item delete.

## How it works
- An invisible, auto-focused `TextInput` stays focused at all times. Bluetooth HID scanners type the scanned payload + press **Enter**, which triggers the parse-and-add flow.
- **Success beep** plays on a valid scan (`assets/sounds/success.wav`), **error beep** plays on an invalid scan (`assets/sounds/error.wav`) — via `expo-audio`.
- Status banner at top flashes green ("ADDED: …") or red ("INVALID SCAN: …") for 2.5 s.

## Features
- External Bluetooth HID scanner input (no camera)
- Audio feedback: success beep + error beep (bundled WAV files)
- Haptic vibration on scan
- Live totals: Total Netto (g), Total Brutto (g), Items Scanned
- Full scanned-items list with per-row delete button
- "Clear all" trash button in header
- Manual entry modal as fallback (item name + netto + brutto)
- Local persistence (AsyncStorage); offline-first
- Industrial/neo-brutalist UI tuned for warehouse conditions

## Supported QR/barcode payload formats
- JSON: `{"netto":3.79,"brutto":5.94,"name":"Item 1"}`
- Key/Value: `netto:3.79,brutto:5.94`
- CSV: `3.79,5.94` or `Item 1,3.79,5.94`
- Tab-separated: `Item 1\t3.79\t5.94`
- Whitespace: `2.8 5.8`

## Architecture
- Frontend only (no backend required per user choice)
- `app/_layout.tsx` — Stack layout with SafeAreaProvider
- `app/index.tsx` — Main screen (scanner input, totals, list, manual modal)
- `src/utils/parseQR.ts` — Flexible payload parser
- `src/utils/storage.ts` — AsyncStorage wrapper (load/add/delete/clear)
- `assets/sounds/success.wav`, `assets/sounds/error.wav`

## Permissions (app.json)
- Android: `BLUETOOTH`, `BLUETOOTH_CONNECT`
- iOS: `NSBluetoothAlwaysUsageDescription`
