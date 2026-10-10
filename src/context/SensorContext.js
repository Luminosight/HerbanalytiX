// ============================================================
//  SensorContext.js  —  HerbanalytiX
//  Polls the Pi Flask API at every 5-second boundary and distributes
//  live data to all screens via React Context.
//
//  Also maintains a local history buffer (last 60 readings)
//  that mirrors what the Pi's /api/history returns, so the
//  History screen works even if the API call fails.
// ============================================================

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { DEFAULT_PI_URL, getApiBase, saveApiBase } from '../utils/apiConfig';
import { usePlantConfig } from './PlantConfigContext';

// ── Hermes-safe fetch with timeout via AbortController ────────
function fetchWithTimeout(url, options = {}, ms = 5000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...options, signal: ctrl.signal })
    .finally(() => clearTimeout(timer));
}

// ── Config ───────────────────────────────────────────────────
// The Pi URL is stored in AsyncStorage and editable from Settings.
// Fallback: DEFAULT_PI_URL from apiConfig.js
const POLL_INTERVAL_MS = 5_000;  // 5 seconds

// ── Fallback shape (shown while connecting or on error) ──────
const FALLBACK_DATA = {
  reservoir: { ph: "---", tds: "---", distance: "---", volume: "---" },
  environment: { temperature: "---", humidity: "---" },
  deviceStatus:         "Offline",
  mistingActive:        false,
  mistingInterval:      0,
  mistingOnSec:         5,
  mistingOffSec:        300,
  mistingCyclePhase:    "off",
  mistingCycleElapsed:  0,
  mistingCycleEndEpoch: 0,
  nextMisting:          0,
  plantPhase:           "empty",
  slots: Array.from({ length: 6 }, (_, i) => ({
    slot: i + 1, class: "Empty", confidence: 0,
  })),
  relays: {
    submersible:   false,
    mist_pump:     false,
    peristaltic_1: false,
    peristaltic_2: false,
    peristaltic_3: false,
    grow_light:    false,
  },
  conductivity: {
    tube_1: { conducting: false, micro_siemens: 0, voltage: 0, threshold: 2.0 },
    tube_2: { conducting: false, micro_siemens: 0, voltage: 0, threshold: 3.5 },
    tube_3: { conducting: false, micro_siemens: 0, voltage: 0, threshold: 3.0 },
  },
  conductivityPreset: 'nutrient',
  conductivityPresets: {
    nutrient: { tube_1: 2.0, tube_2: 3.5, tube_3: 3.0 },
    water:    { tube_1: 4.3, tube_2: 4.3, tube_3: 4.3 },
  },
  dosingActive: false,
  dosingStep:   "",
  light: { mode: "manual", state: false, on_time: "06:30", off_time: "21:30" },
  cvSchedule: { enabled: true, on_time: "06:30", off_time: "21:30", active: true },
  cvRoi: { enabled: false, x_pct: 0, y_pct: 0, w_pct: 100, h_pct: 100 },
  tdsTarget: { min: 400, max: 600 },
  mistingConfig: {},
  consensus: { phase: null, agreement: 0, votes: 0, cooldown: false, windowSec: 10, threshold: 0.7 },
  phaseEvent: null,
  lastUpdated: new Date().toISOString(),
};

// ── Context ──────────────────────────────────────────────────
const SensorContext = createContext(null);

export function SensorProvider({ children }) {
  const [data, setData]       = useState(FALLBACK_DATA);
  const [history, setHistory] = useState([]);
  const [connected, setConnected] = useState(false);
  const [error, setError]     = useState(null);
  const [resetAt, setResetAt] = useState(0);

  // ── Sync misting config from Pi to PlantConfigContext ────────
  const { syncFromServer } = usePlantConfig();
  const lastMistingSyncRef = useRef('');

  // Dynamic Pi server URL — loaded from AsyncStorage on mount
  const apiBaseRef  = useRef(DEFAULT_PI_URL);
  const [apiBase, _setApiBaseState] = useState(DEFAULT_PI_URL);

  // Load saved Pi URL on mount
  useEffect(() => {
    getApiBase().then(url => {
      apiBaseRef.current = url;
      _setApiBaseState(url);
    });
  }, []);

  // Update Pi URL, persist to AsyncStorage, re-trigger connection
  const updateApiBase = useCallback(async (newUrl) => {
    const trimmed = newUrl.trim();
    await saveApiBase(trimmed);
    apiBaseRef.current = trimmed;
    _setApiBaseState(trimmed);
    setConnected(false);
    setError(null);
  }, []);

  // Track last successful fetch time to detect stale data
  const lastFetchRef = useRef(null);

  // ── Raw fetch — returns result without touching state ──────
  const rawFetchStatus = useCallback(async () => {
    try {
      console.log("[SensorContext] Fetching:", `${apiBaseRef.current}/api/status`);
      const res = await fetchWithTimeout(`${apiBaseRef.current}/api/status`, {
        method: "GET",
        headers: { Accept: "application/json" },
      }, 8000);

      console.log("[SensorContext] Response status:", res.status);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json = await res.json();
      console.log("[SensorContext] Reservoir:", JSON.stringify(json.reservoir));
      console.log("[SensorContext] Environment:", JSON.stringify(json.environment));

      const mapped = {
        reservoir: {
          ph:       String(json.reservoir?.ph       ?? "---"),
          tds:      String(json.reservoir?.tds      ?? "---"),
          distance: String(json.reservoir?.distance ?? "---"),
          volume:   String(json.reservoir?.volume   ?? "---"),
        },
        environment: {
          temperature: String(json.environment?.temperature ?? "---"),
          humidity:    String(json.environment?.humidity    ?? "---"),
        },
        deviceStatus:        "Online",
        mistingActive:       json.mistingActive       ?? false,
        mistingInterval:     json.mistingInterval     ?? 0,
        mistingOnSec:        json.mistingOnSec        ?? 5,
        mistingOffSec:       json.mistingOffSec       ?? 300,
        mistingCyclePhase:   json.mistingCyclePhase   ?? "off",
        mistingCycleElapsed: json.mistingCycleElapsed ?? 0,
        mistingCycleEndEpoch: json.mistingCycleEndEpoch ?? 0,
        nextMisting:         json.nextMisting         ?? 0,
        plantPhase:          json.plantPhase          ?? "empty",
        slots:               json.slots               ?? FALLBACK_DATA.slots,
        relays:              json.relays              ?? FALLBACK_DATA.relays,
        conductivity:        json.conductivity        ?? FALLBACK_DATA.conductivity,
        conductivityPreset:  json.conductivityPreset  ?? FALLBACK_DATA.conductivityPreset,
        conductivityPresets: json.conductivityPresets  ?? FALLBACK_DATA.conductivityPresets,
        dosingActive:        json.dosingActive        ?? false,
        dosingStep:          json.dosingStep          ?? "",
        light:               json.light               ?? FALLBACK_DATA.light,
        cvSchedule:          json.cvSchedule            ?? FALLBACK_DATA.cvSchedule,
        cvRoi:               json.cvRoi                 ?? FALLBACK_DATA.cvRoi,
        tdsTarget:           json.tdsTarget           ?? {},
        mistingConfig:       json.mistingConfig       ?? {},
        consensus:           json.consensus             ?? FALLBACK_DATA.consensus,
        phaseEvent:          json.phaseEvent            ?? null,
        lastUpdated:         json.lastUpdated           ?? new Date().toISOString(),
      };

      return { ok: true, data: mapped };
    } catch (err) {
      console.log("[SensorContext] Fetch FAILED:", err.name, err.message);
      const msg = err.name === "AbortError"
        ? "Connection timed out"
        : err.message;
      return { ok: false, error: msg };
    }
  }, []);

  // ── Apply a buffered result to state ───────────────────────
  const applyResult = useCallback((result) => {
    // Snap the displayed timestamp to the current 5-second mark
    const now = new Date();
    const totalSec = now.getMinutes() * 60 + now.getSeconds();
    now.setSeconds(Math.floor(totalSec / 5) * 5 % 60, 0);
    const boundaryISO = now.toISOString();

    if (result.ok) {
      const mapped = { ...result.data, lastUpdated: boundaryISO };
      setData(mapped);
      setConnected(true);
      setError(null);
      lastFetchRef.current = Date.now();

      setHistory(prev => {
        const entry = {
          reservoir:     mapped.reservoir,
          environment:   mapped.environment,
          plantPhase:    mapped.plantPhase,
          mistingActive: mapped.mistingActive,
          lastUpdated:   boundaryISO,
          timestamp:     boundaryISO,
        };
        return [...prev.slice(-59), entry];
      });
    } else {
      setConnected(false);
      setError(result.error);
      setData({ ...FALLBACK_DATA, lastUpdated: boundaryISO });
    }
  }, []);

  // ── Fetch history from Pi on mount ─────────────────────────
  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetchWithTimeout(`${apiBaseRef.current}/api/history`, {}, 8000);
      if (!res.ok) return;
      const json = await res.json();
      if (Array.isArray(json.history) && json.history.length > 0) {
        setHistory(json.history);
      }
    } catch {
      // History fetch failure is non-critical, ignore silently
    }
  }, []);

  // ── Poll loop — prefetch 1.5 s early, flush at exact 5-s boundary ─
  //    Ensures the UI updates every 5 seconds for near-real-time sync.
  useEffect(() => {
    fetchHistory();
    // Immediate first fetch on mount
    rawFetchStatus().then(applyResult);

    let cancelled = false;
    let prefetchTimer = null;
    let flushTimer = null;
    const pendingRef = { value: null };

    const scheduleCycle = () => {
      if (cancelled) return;

      const now = Date.now();
      // Next 5-second wall-clock boundary
      const mod = now % 5000;
      const msUntilBoundary = mod === 0 ? 5000 : 5000 - mod;

      // Start the API call ~1.5 s before the boundary so the
      // response is ready by the time the clock ticks over.
      const prefetchDelay = Math.max(msUntilBoundary - 1500, 100);

      prefetchTimer = setTimeout(async () => {
        if (cancelled) return;
        try {
          pendingRef.value = await rawFetchStatus();
        } catch (e) {
          pendingRef.value = { ok: false, error: e.message ?? 'Fetch error' };
        }

        // Re-measure how many ms remain until the exact boundary
        const now2 = Date.now();
        const mod2  = now2 % 5000;
        const remaining = mod2 === 0 ? 0 : 5000 - mod2;

        flushTimer = setTimeout(() => {
          if (cancelled) return;
          if (pendingRef.value) {
            applyResult(pendingRef.value);
            pendingRef.value = null;
          }
          scheduleCycle();          // queue the next cycle
        }, remaining);
      }, prefetchDelay);
    };

    scheduleCycle();

    return () => {
      cancelled = true;
      if (prefetchTimer) clearTimeout(prefetchTimer);
      if (flushTimer) clearTimeout(flushTimer);
    };
  }, [rawFetchStatus, applyResult, fetchHistory]);
  // ── Keep PlantConfigContext in sync with Pi's misting config ─
  useEffect(() => {
    if (!connected || data.mistingConfig === undefined) return;
    const key = `${data.plantPhase}|${JSON.stringify(data.mistingConfig)}`;
    if (key === lastMistingSyncRef.current) return;
    lastMistingSyncRef.current = key;
    syncFromServer(data.plantPhase, data.mistingConfig);
  }, [connected, data.plantPhase, data.mistingConfig, syncFromServer]);
  // ── Manual relay control ────────────────────────────────────
  const setRelay = useCallback(async (relayName, state) => {
    try {
      const res = await fetchWithTimeout(
        `${apiBaseRef.current}/api/relay`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ relay: relayName, state }),
        },
        5000,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Optimistically update local state
      setData(prev => ({
        ...prev,
        relays: { ...prev.relays, [relayName]: state },
      }));
      return true;
    } catch (err) {
      console.warn(`[Relay] Failed to set ${relayName}:`, err.message);
      return false;
    }
  }, []);

  // ── Nutrient dosing trigger ─────────────────────────────────
  const startDose = useCallback(async (liters) => {
    try {
      const res = await fetchWithTimeout(
        `${apiBaseRef.current}/api/dose`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ liters }),
        },
        5000,
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }, []);

  // ── Poll dose status while dosing is active ─────────────────
  const pollDoseStatus = useCallback(async () => {
    try {
      const res = await fetchWithTimeout(`${apiBaseRef.current}/api/dose/status`, {}, 5000);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }, []);

  // ── Abort a running dosing sequence ─────────────────────────
  const stopDose = useCallback(async () => {
    try {
      const res = await fetchWithTimeout(
        `${apiBaseRef.current}/api/dose/abort`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } },
        5000,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Optimistically clear local dosing state
      setData(prev => ({ ...prev, dosingActive: false, dosingStep: '' }));
      return { ok: true };
    } catch (err) {
      console.warn('[SensorContext] stopDose failed:', err.message);
      return { ok: false, error: err.message };
    }
  }, []);

  // ── Grow light control ──────────────────────────────────────
  const setLight = useCallback(async (payload) => {
    // payload: { mode: "manual", state: bool }
    //       or { mode: "schedule", on_time: "18:00", off_time: "06:00" }
    try {
      const res = await fetchWithTimeout(
        `${apiBaseRef.current}/api/light`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        5000,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }, []);

  // ── CV Schedule (Night Guard) control ───────────────────────
  const setCvSchedule = useCallback(async (payload) => {
    // payload: { enabled: bool }
    //       or { enabled: bool, on_time: "06:00", off_time: "18:00" }
    // Optimistically update local state so the UI responds instantly
    setData(prev => ({
      ...prev,
      cvSchedule: { ...prev.cvSchedule, ...payload },
    }));
    try {
      const res = await fetchWithTimeout(
        `${apiBaseRef.current}/api/cv/schedule`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        5000,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      // Apply server-computed 'active' field
      if (json.active !== undefined) {
        setData(prev => ({
          ...prev,
          cvSchedule: { ...prev.cvSchedule, active: json.active },
        }));
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }, []);

  // ── CV ROI (Region of Interest) control ─────────────────────
  const setCvRoi = useCallback(async (payload) => {
    // payload: { enabled: bool }
    //       or { enabled: true, x_pct: 10, y_pct: 5, w_pct: 80, h_pct: 90 }
    // Optimistically update local state
    setData(prev => ({
      ...prev,
      cvRoi: { ...prev.cvRoi, ...payload },
    }));
    try {
      const res = await fetchWithTimeout(
        `${apiBaseRef.current}/api/cv/roi`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        5000,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      // Apply server-confirmed values
      setData(prev => ({
        ...prev,
        cvRoi: {
          enabled: json.enabled ?? prev.cvRoi.enabled,
          x_pct:   json.x_pct  ?? prev.cvRoi.x_pct,
          y_pct:   json.y_pct  ?? prev.cvRoi.y_pct,
          w_pct:   json.w_pct  ?? prev.cvRoi.w_pct,
          h_pct:   json.h_pct  ?? prev.cvRoi.h_pct,
        },
      }));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }, []);

  // ── Switch conductivity threshold preset ─────────────────
  const setConductivityPreset = useCallback(async (preset) => {
    try {
      const res = await fetchWithTimeout(
        `${apiBaseRef.current}/api/conductivity/preset`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ preset }),
        },
        5000,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      // Optimistically update local conductivity preset + thresholds
      setData(prev => {
        const updated = { ...prev, conductivityPreset: preset };
        const thresholds = json.thresholds ?? {};
        const cond = { ...prev.conductivity };
        for (const [key, thresh] of Object.entries(thresholds)) {
          if (cond[key]) {
            cond[key] = {
              ...cond[key],
              threshold: thresh,
              conducting: (cond[key].voltage ?? 0) < thresh,
            };
          }
        }
        updated.conductivity = cond;
        return updated;
      });
      return { ok: true };
    } catch (err) {
      console.warn('[SensorContext] setConductivityPreset failed:', err.message);
      return { ok: false, error: err.message };
    }
  }, []);

  // ── Immediate one-shot refresh (used after relay toggles) ──
  const refreshNow = useCallback(async () => {
    const result = await rawFetchStatus();
    applyResult(result);
  }, [rawFetchStatus, applyResult]);

  // ── Clear history (Reset Device flow) ──────────────────────
  const clearHistory = useCallback(async () => {
    // Abort any running dosing sequence first
    try {
      await fetchWithTimeout(
        `${apiBaseRef.current}/api/dose/abort`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } },
        3000,
      );
    } catch {
      // Best-effort — server DELETE /api/history also aborts dosing
    }
    // Wipe the Pi server's history buffer first
    try {
      await fetchWithTimeout(
        `${apiBaseRef.current}/api/history`,
        { method: 'DELETE' },
        5000,
      );
    } catch {
      // Non-critical — wipe local state regardless
    }
    setHistory([]);
    setData(FALLBACK_DATA);
    setResetAt(Date.now());
  }, []);

  // ── Fetch CV status (for Plant Box view) ───────────────────
  const fetchCvStatus = useCallback(async () => {
    try {
      const res = await fetchWithTimeout(`${apiBaseRef.current}/api/cv/status`, {}, 5000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch {
      return null;
    }
  }, []);

  // ── CV frame URL (for live image display) ──────────────────
  const cvFrameUrl = `${apiBase}/api/cv/frame`;

  // ── Send misting config to Pi ───────────────────────────────
  const sendMistingConfig = useCallback(async (phase, mistingConfig) => {
    try {
      const res = await fetchWithTimeout(
        `${apiBaseRef.current}/api/misting/config`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phase, mistingConfig }),
        },
        5000,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { ok: true };
    } catch (err) {
      console.warn('[SensorContext] sendMistingConfig failed:', err.message);
      return { ok: false, error: err.message };
    }
  }, []);

  return (
    <SensorContext.Provider value={{
      data,
      history,
      connected,
      error,
      // Actions
      setRelay,
      startDose,
      pollDoseStatus,
      stopDose,
      setLight,
      setCvSchedule,
      setCvRoi,
      clearHistory,
      fetchCvStatus,
      refreshNow,
      sendMistingConfig,
      setConductivityPreset,
      // Utility
      apiBase,
      updateApiBase,
      cvFrameUrl,
      resetAt,
    }}>
      {children}
    </SensorContext.Provider>
  );
}

export const useSensor = () => {
  const context = useContext(SensorContext);
  if (!context) throw new Error("useSensor must be used inside SensorProvider");
  return context;
};