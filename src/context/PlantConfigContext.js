// ============================================================
//  PlantConfigContext.js  —  HerbanalytiX
//  Persists plant phase + misting config to AsyncStorage so
//  settings survive app restarts.  Pushes to the Pi whenever
//  either value changes.
// ============================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { getApiBase } from '../utils/apiConfig';

// ── Storage keys ─────────────────────────────────────────────
const KEY_PHASE   = '@herbanalytix:confirmedPhase';
const KEY_MISTING = '@herbanalytix:mistingConfig';

// ── Defaults ─────────────────────────────────────────────────
export const DEFAULT_MISTING_CONFIG = {
  seedling:   { onSec: 5, offMin: 2 },
  vegetative: { onSec: 3, offMin: 3 },
};

export const PHASE_LABELS = {
  seedling:   'Seedlings',
  vegetative: 'Vegetative Plants',
  empty:      'No Plants',
};

// ── Lightweight fetch helpers ───────────────────────────────
function piPost(endpoint, body) {
  return getApiBase().then(base =>
    fetch(`${base}${endpoint}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    }).catch(() => null)
  );
}

function piGet(endpoint) {
  return getApiBase().then(base =>
    fetch(`${base}${endpoint}`, { method: 'GET' })
      .then(r => r.ok ? r.json() : null)
      .catch(() => null)
  );
}

// ── Context ───────────────────────────────────────────────────
const PlantConfigContext = createContext(null);

export function PlantConfigProvider({ children }) {
  const [confirmedPhase, _setConfirmedPhase] = useState(null);
  const [mistingConfig,  _setMistingConfig]  = useState(DEFAULT_MISTING_CONFIG);
  const [loaded, setLoaded] = useState(false);

  // Ref so push callbacks always see latest values
  const phaseRef    = useRef(confirmedPhase);
  const mcRef       = useRef(mistingConfig);
  // Write-guard: suppress incoming syncFromServer for a few seconds after
  // a local write so the next poll (which may return stale data) can't
  // overwrite the user's action.
  const writeCooldownRef = useRef(0);
  const markWrite = () => { writeCooldownRef.current = Date.now() + 4000; };

  // ── Load on mount — Pi is source of truth ─────────────────
  // Try to fetch saved config from the Pi first so all phones
  // see the same state. Fall back to AsyncStorage if the Pi is
  // unreachable (e.g. phone is offline or Pi hasn't booted yet).
  useEffect(() => {
    (async () => {
      try {
        // 1. Try Pi first
        const piData = await piGet('/api/misting/config');

        if (piData && typeof piData.phase === 'string') {
          // Pi has authoritative data — use it
          const phase = piData.phase;
          const mc    = (piData.mistingConfig && Object.keys(piData.mistingConfig).length > 0)
            ? piData.mistingConfig
            : DEFAULT_MISTING_CONFIG;

          _setConfirmedPhase(phase === 'empty' ? null : phase);
          phaseRef.current = phase === 'empty' ? null : phase;
          _setMistingConfig(mc);
          mcRef.current = mc;

          // Mirror Pi state to local AsyncStorage so offline fallback stays fresh
          try {
            await AsyncStorage.multiSet([
              [KEY_PHASE,   phase],
              [KEY_MISTING, JSON.stringify(mc)],
            ]);
          } catch {}

        } else {
          // 2. Pi unreachable — fall back to AsyncStorage
          const [rawPhase, rawMC] = await AsyncStorage.multiGet([KEY_PHASE, KEY_MISTING]);
          const savedPhase = rawPhase[1] ?? null;
          const savedMC    = rawMC[1] ? JSON.parse(rawMC[1]) : DEFAULT_MISTING_CONFIG;

          if (savedPhase && savedPhase !== 'empty') {
            _setConfirmedPhase(savedPhase);
            phaseRef.current = savedPhase;
          }
          _setMistingConfig(savedMC);
          mcRef.current = savedMC;
        }
      } catch (e) {
        console.warn('[PlantConfig] Load error:', e);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  // ── Push confirmed phase + config to Pi ───────────────────
  const pushToPi = useCallback((phase, config) => {
    if (!phase || phase === 'empty') return;
    piPost('/api/misting/config', { phase, mistingConfig: config });
  }, []);

  // ── Public setter — phase (used only for manual empty action) ──
  const setConfirmedPhase = useCallback(async (phase) => {
    markWrite();
    const normalized = phase === 'empty' ? null : phase;
    _setConfirmedPhase(normalized);
    phaseRef.current = normalized;
    try { await AsyncStorage.setItem(KEY_PHASE, phase); } catch {}
    pushToPi(phase, mcRef.current);
  }, [pushToPi]);

  // ── Public setter — misting config ────────────────────────
  const setMistingConfig = useCallback(async (config) => {
    markWrite();
    _setMistingConfig(config);
    mcRef.current = config;
    try { await AsyncStorage.setItem(KEY_MISTING, JSON.stringify(config)); } catch {}
    pushToPi(phaseRef.current, config);
  }, [pushToPi]);

  // ── Reset (called from the app Reset button) ──────────────
  const resetPlantConfig = useCallback(async () => {
    markWrite();
    _setConfirmedPhase(null);
    _setMistingConfig(DEFAULT_MISTING_CONFIG);
    phaseRef.current = null;
    mcRef.current    = DEFAULT_MISTING_CONFIG;
    try {
      await AsyncStorage.multiRemove([KEY_PHASE, KEY_MISTING]);
    } catch {}
    // Tell Pi to reset too — await so it processes before next poll
    await piPost('/api/misting/reset', {});
  }, []);

  // ── Empty plant box (stop misting, keep config) ───────────
  const emptyPlantBox = useCallback(async () => {
    markWrite();
    _setConfirmedPhase('empty');
    phaseRef.current = 'empty';
    try { await AsyncStorage.setItem(KEY_PHASE, 'empty'); } catch {}
    // Await so the Pi processes the reset before the next poll
    await piPost('/api/misting/reset', {});
  }, []);

  // Re-push to Pi after reconnect (screens can call this)
  const pushConfigToPi = useCallback(() => {
    pushToPi(phaseRef.current, mcRef.current);
  }, [pushToPi]);

  // ── Live sync from server (called by SensorContext on each poll) ──
  const syncFromServer = useCallback((serverPhase, serverConfig) => {
    // Skip if a local write happened recently — the Pi may not
    // have processed it yet, so the poll data could be stale.
    if (Date.now() < writeCooldownRef.current) return;

    const phase = (!serverPhase || serverPhase === 'empty') ? null : serverPhase;
    const config = (serverConfig && Object.keys(serverConfig).length > 0)
      ? serverConfig
      : DEFAULT_MISTING_CONFIG;

    let changed = false;
    if (phase !== phaseRef.current) {
      _setConfirmedPhase(phase);
      phaseRef.current = phase;
      changed = true;
    }
    if (JSON.stringify(config) !== JSON.stringify(mcRef.current)) {
      _setMistingConfig(config);
      mcRef.current = config;
      changed = true;
    }
    if (changed) {
      AsyncStorage.multiSet([
        [KEY_PHASE, serverPhase || 'empty'],
        [KEY_MISTING, JSON.stringify(config)],
      ]).catch(() => {});
    }
  }, []);

  return (
    <PlantConfigContext.Provider value={{
      confirmedPhase,
      mistingConfig,
      loaded,
      setConfirmedPhase,
      setMistingConfig,
      resetPlantConfig,
      emptyPlantBox,
      pushConfigToPi,
      syncFromServer,
    }}>
      {children}
    </PlantConfigContext.Provider>
  );
}

export function usePlantConfig() {
  const ctx = useContext(PlantConfigContext);
  if (!ctx) throw new Error('usePlantConfig must be used inside PlantConfigProvider');
  return ctx;
}
