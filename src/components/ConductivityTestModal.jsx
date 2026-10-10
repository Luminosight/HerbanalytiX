// ============================================================
//  ConductivityTestModal.jsx — HerbanalytiX
//  Full-screen modal for manual pump testing with live
//  conductivity feedback from three 2-prong Arduino probes.
//  A3 = Grow (2.0V), A4 = Chelate (1.7V), A5 = Bloom (1.8V).
//  Shows per-pump controls, real-time voltage, conduction
//  status (Conducting / Not Conducting), and elapsed timers.
// ============================================================

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Animated,
    Dimensions,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSensor } from '../context/SensorContext';
import { useTheme } from '../theme/ThemeContext';

// Fast-poll interval for real-time conductivity updates (ms).
// Matches the Arduino's 500 ms conductivity report cycle.
const COND_POLL_MS = 500;

const { width: SCREEN_W } = Dimensions.get('window');

// Pump wiring: peristaltic_3 (GPIO 23) → A3 Grow, peristaltic_2 (GPIO 24) → A4 Chelate, peristaltic_1 (GPIO 22) → A5 Bloom
const PUMPS = [
  { relay: 'peristaltic_3', tube: 'tube_1', pin: 'A3', solution: 'Grow Solution',    defaultThreshold: 2.0 },
  { relay: 'peristaltic_2', tube: 'tube_2', pin: 'A4', solution: 'Chelate Solution', defaultThreshold: 1.7 },
  { relay: 'peristaltic_1', tube: 'tube_3', pin: 'A5', solution: 'Bloom Solution',   defaultThreshold: 1.8 },
];

// ─────────────────────────────────────────────────────────────
//  Voltage bar — visualises 0..5 V with per-sensor threshold
// ─────────────────────────────────────────────────────────────
const VOLTAGE_BAR_MAX = 5.0;   // 5V full scale

function VoltageBar({ voltage, threshold, conducting, theme }) {
  const pct = Math.min(voltage / VOLTAGE_BAR_MAX, 1);
  const barColor = conducting ? '#4ADE80' : '#60A5FA';
  const threshPct = Math.min(threshold / VOLTAGE_BAR_MAX, 1);

  return (
    <View style={vbStyles.wrap}>
      <View style={[vbStyles.track, { backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)' }]}>
        <View style={[vbStyles.fill, { width: `${pct * 100}%`, backgroundColor: barColor }]} />
        {/* Threshold line */}
        <View style={[vbStyles.thresh, { left: `${threshPct * 100}%` }]} />
      </View>
      <View style={vbStyles.labels}>
        <Text style={[vbStyles.mvText, { color: barColor }]}>{voltage.toFixed(2)} V</Text>
        <Text style={[vbStyles.threshLabel, { color: theme.textMuted }]}>Threshold: {threshold.toFixed(1)} V</Text>
      </View>
    </View>
  );
}

const vbStyles = StyleSheet.create({
  wrap: { marginTop: 6, gap: 3 },
  track: {
    height: 6, borderRadius: 3, overflow: 'hidden',
    position: 'relative',
  },
  fill: { height: '100%', borderRadius: 3 },
  thresh: {
    position: 'absolute', top: -1, bottom: -1, width: 1.5,
    backgroundColor: '#F59E0B90',
  },
  labels: {
    flexDirection: 'row', justifyContent: 'space-between',
  },
  mvText: { fontSize: 10, fontWeight: '800', fontVariant: ['tabular-nums'] },
  threshLabel: { fontSize: 9, fontWeight: '600' },
});


// ═════════════════════════════════════════════════════════════
//  Main Modal
// ═════════════════════════════════════════════════════════════
export default function ConductivityTestModal({ visible, onClose }) {
  const theme = useTheme();
  const { setRelay, data, setConductivityPreset, apiBase } = useSensor();

  // Current preset from server data
  const currentPreset = data.conductivityPreset ?? 'nutrient';
  const [switching, setSwitching] = useState(false);

  // ── Fast-poll conductivity while modal is visible ──────────
  // Bypasses the global 10-s cycle so probe status appears instantly.
  const [condFast, setCondFast] = useState(null);
  const condPollRef = useRef(null);

  useEffect(() => {
    if (!visible) {
      // Modal closed — stop polling, clear cached data
      if (condPollRef.current) clearInterval(condPollRef.current);
      condPollRef.current = null;
      setCondFast(null);
      return;
    }

    // Kick off an immediate fetch, then repeat every COND_POLL_MS
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`${apiBase}/api/conductivity/status`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setCondFast(json.conductivity ?? null);
      } catch {
        // Non-critical — will retry next tick
      }
    };

    poll();
    condPollRef.current = setInterval(poll, COND_POLL_MS);

    return () => {
      cancelled = true;
      if (condPollRef.current) clearInterval(condPollRef.current);
      condPollRef.current = null;
    };
  }, [visible, apiBase]);

  // Animations
  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(80)).current;

  useEffect(() => {
    if (visible) {
      fadeAnim.setValue(0);
      slideAnim.setValue(80);
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
        Animated.spring(slideAnim, { toValue: 0, tension: 65, friction: 12, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const dismiss = useCallback(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 0, duration: 180, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 60, duration: 180, useNativeDriver: true }),
    ]).start(() => onClose());
  }, [onClose]);

  // Per-pump state
  const [pumpState, setPumpState] = useState(
    PUMPS.map(() => ({
      running: false,
      triggered: false,
      startTime: null,
      elapsedSec: 0,
    }))
  );
  const intervalRefs = useRef([]);

  const stopTimer = useCallback((idx) => {
    if (intervalRefs.current[idx]) {
      clearInterval(intervalRefs.current[idx]);
      intervalRefs.current[idx] = null;
    }
  }, []);

  // Stop all pumps and timers on close
  const handleClose = useCallback(async () => {
    for (let i = 0; i < PUMPS.length; i++) {
      if (pumpState[i].running) {
        await setRelay(PUMPS[i].relay, false);
        stopTimer(i);
      }
    }
    setPumpState(PUMPS.map(() => ({
      running: false, triggered: false, startTime: null, elapsedSec: 0,
    })));
    dismiss();
  }, [pumpState, setRelay, stopTimer, dismiss]);

  // Toggle pump
  const togglePump = useCallback(async (idx) => {
    const current = pumpState[idx];

    if (current.running) {
      await setRelay(PUMPS[idx].relay, false);
      stopTimer(idx);
      setPumpState(prev => {
        const next = [...prev];
        next[idx] = { ...next[idx], running: false };
        return next;
      });
    } else {
      await setRelay(PUMPS[idx].relay, true);
      stopTimer(idx);
      const now = Date.now();
      setPumpState(prev => {
        const next = [...prev];
        next[idx] = { running: true, triggered: false, startTime: now, elapsedSec: 0 };
        return next;
      });
      intervalRefs.current[idx] = setInterval(() => {
        setPumpState(prev => {
          const next = [...prev];
          if (!next[idx].running) return prev;
          next[idx] = { ...next[idx], elapsedSec: Math.floor((Date.now() - now) / 1000) };
          return next;
        });
      }, 500);
    }
  }, [pumpState, setRelay, stopTimer]);

  // Auto-trigger from live conductivity data
  // Prefer fast-polled data (condFast) over the global 10-s cycle.
  const conductivity = condFast ?? data.conductivity ?? {};
  useEffect(() => {
    setPumpState(prev => {
      let changed = false;
      const next = prev.map((ps, idx) => {
        if (!ps.running || ps.triggered) return ps;
        const tubeData = conductivity[PUMPS[idx].tube];
        if (tubeData?.conducting) {
          changed = true;
          return { ...ps, triggered: true };
        }
        return ps;
      });
      return changed ? next : prev;
    });
  }, [conductivity]);

  // Cleanup on unmount
  useEffect(() => {
    return () => intervalRefs.current.forEach((ref) => ref && clearInterval(ref));
  }, []);

  const formatTime = (sec) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const bgCard = theme.isDark ? '#0D1F16' : '#F0FAF4';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      {/* Backdrop */}
      <Animated.View style={[ms.backdrop, { opacity: fadeAnim }]}>
        <TouchableOpacity style={ms.backdropTouch} activeOpacity={1} onPress={handleClose} />
      </Animated.View>

      {/* Sheet */}
      <Animated.View style={[ms.sheet, {
        backgroundColor: bgCard,
        borderColor: theme.glassBorder,
        transform: [{ translateY: slideAnim }],
        opacity: fadeAnim,
      }]}>
        {/* Accent bar */}
        <View style={[ms.accent, { backgroundColor: '#F59E0B' }]} />

        {/* Header */}
        <View style={ms.header}>
          <View style={ms.headerLeft}>
            <View style={[ms.iconWrap, { backgroundColor: '#F59E0B15', borderColor: '#F59E0B40' }]}>
              <MaterialIcons name="science" size={20} color="#F59E0B" />
            </View>
            <View>
              <Text style={[ms.title, { color: theme.textPrimary ?? '#FFF' }]}>
                Conductivity Test
              </Text>
              <Text style={[ms.subtitle, { color: theme.textMuted }]}>
                Manual pump control with probe timing
              </Text>
            </View>
          </View>
          <Pressable
            onPress={handleClose}
            style={({ pressed }) => [ms.closeBtn, {
              backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
              opacity: pressed ? 0.6 : 1,
            }]}
          >
            <MaterialIcons name="close" size={18} color={theme.textMuted} />
          </Pressable>
        </View>

        <View style={[ms.divider, { backgroundColor: theme.glassBorder }]} />

        {/* Preset toggle: Nutrient / Water */}
        <View style={ms.presetRow}>
          <Text style={[ms.presetLabel, { color: theme.textMuted }]}>Threshold Preset:</Text>
          <View style={ms.presetBtnGroup}>
            {['nutrient', 'water'].map((preset) => {
              const active = currentPreset === preset;
              const label = preset === 'nutrient' ? 'Nutrient' : 'Water (Dev)';
              return (
                <Pressable
                  key={preset}
                  disabled={switching}
                  onPress={async () => {
                    if (active) return;
                    setSwitching(true);
                    await setConductivityPreset(preset);
                    setSwitching(false);
                  }}
                  style={({ pressed }) => [ms.presetBtn, {
                    backgroundColor: active
                      ? (preset === 'nutrient' ? '#4ADE8020' : '#60A5FA20')
                      : (theme.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'),
                    borderColor: active
                      ? (preset === 'nutrient' ? '#4ADE8060' : '#60A5FA60')
                      : theme.glassBorder,
                    opacity: pressed || switching ? 0.6 : 1,
                  }]}
                >
                  <Text style={[ms.presetBtnText, {
                    color: active
                      ? (preset === 'nutrient' ? '#4ADE80' : '#60A5FA')
                      : theme.textMuted,
                  }]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Description */}
        <Text style={[ms.desc, { color: theme.textMuted }]}>
          Start a pump to dose nutrient solution. The timer begins immediately.
          When water reaches the tube end, the conductivity probe triggers
          automatically — confirming liquid arrival.
        </Text>

        {/* Pump cards */}
        <ScrollView
          style={ms.scrollArea}
          contentContainerStyle={ms.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {PUMPS.map((pump, idx) => {
            const ps = pumpState[idx];
            const relayOn = data.relays?.[pump.relay] ?? false;
            const isOn = ps.running || relayOn;
            const tubeData = conductivity[pump.tube];
            const conducting = tubeData?.conducting ?? false;
            const voltage = tubeData?.voltage ?? 0;
            const threshold = tubeData?.threshold ?? pump.defaultThreshold;

            const isTriggered = ps.triggered || (isOn && conducting);
            const statusColor = isTriggered
              ? '#4ADE80'
              : (isOn ? '#60A5FA' : theme.textMuted);
            const statusLabel = isTriggered
              ? 'Conducting'
              : (isOn ? 'Pumping — Waiting…' : 'Not Conducting');
            const statusIcon = isTriggered
              ? 'check-circle'
              : (isOn ? 'sync' : 'radio-button-unchecked');

            return (
              <View key={idx} style={[ms.pumpCard, {
                borderColor: isOn ? statusColor + '35' : theme.glassBorder,
                backgroundColor: isOn
                  ? (statusColor + '08')
                  : (theme.isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)'),
              }]}>
                {/* Top row: label + button */}
                <View style={ms.pumpTop}>
                  <View style={ms.pumpLabelWrap}>
                    <View style={[ms.pumpDot, { backgroundColor: statusColor }]} />
                    <View>
                      <Text style={[ms.pumpName, { color: theme.textPrimary ?? '#FFF' }]}>
                        {pump.pin} ({pump.solution})
                      </Text>
                      <Text style={[ms.pumpTube, { color: theme.textMuted }]}>
                        Threshold: {threshold.toFixed(2)} V
                      </Text>
                    </View>
                  </View>

                  <Pressable
                    onPress={() => togglePump(idx)}
                    style={({ pressed }) => [ms.pumpBtn, {
                      backgroundColor: isOn ? '#EF444418' : '#4ADE8018',
                      borderColor: isOn ? '#EF444460' : '#4ADE8060',
                      opacity: pressed ? 0.65 : 1,
                    }]}
                  >
                    <MaterialIcons
                      name={isOn ? 'stop' : 'play-arrow'}
                      size={20} color={isOn ? '#EF4444' : '#4ADE80'}
                    />
                    <Text style={[ms.btnLabel, { color: isOn ? '#EF4444' : '#4ADE80' }]}>
                      {isOn ? 'Stop' : 'Start'}
                    </Text>
                  </Pressable>
                </View>

                {/* Status row */}
                <View style={ms.statusRow}>
                  <MaterialIcons name={statusIcon} size={14} color={statusColor} />
                  <Text style={[ms.statusText, { color: statusColor }]}>
                    {statusLabel}
                  </Text>
                  {isOn && (
                    <View style={ms.timerPill}>
                      <MaterialIcons name="timer" size={12} color={statusColor} />
                      <Text style={[ms.timerText, { color: statusColor }]}>
                        {formatTime(ps.elapsedSec)}
                      </Text>
                    </View>
                  )}
                </View>

                {/* Voltage bar with threshold */}
                <VoltageBar voltage={voltage} threshold={threshold} conducting={conducting} theme={theme} />
              </View>
            );
          })}
        </ScrollView>

        {/* Footer hint */}
        <View style={[ms.footer, { borderTopColor: theme.glassBorder }]}>
          <MaterialIcons name="info-outline" size={13} color={theme.textMuted} />
          <Text style={[ms.footerText, { color: theme.textMuted }]}>
            All pumps will be stopped when you close this panel.
          </Text>
        </View>
      </Animated.View>
    </Modal>
  );
}

// ── Styles ──────────────────────────────────────────────────
const ms = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  backdropTouch: { flex: 1 },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderWidth: 1, borderBottomWidth: 0,
    maxHeight: '88%',
    overflow: 'hidden',
  },
  accent: { height: 3, width: '100%' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18, paddingTop: 18, paddingBottom: 10,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  iconWrap: {
    width: 40, height: 40, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  title: { fontSize: 16, fontWeight: '900', letterSpacing: -0.3 },
  subtitle: { fontSize: 11, fontWeight: '600', letterSpacing: 0.2, marginTop: 1 },
  closeBtn: {
    width: 32, height: 32, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  divider: { height: 1, marginHorizontal: 18 },
  presetRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingTop: 12, paddingBottom: 4,
  },
  presetLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  presetBtnGroup: { flexDirection: 'row', gap: 8 },
  presetBtn: {
    paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: 8, borderWidth: 1,
  },
  presetBtnText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.2 },
  desc: {
    fontSize: 11, fontWeight: '600', lineHeight: 17,
    letterSpacing: 0.2,
    paddingHorizontal: 18, paddingTop: 12, paddingBottom: 6,
  },
  scrollArea: { flex: 1 },
  scrollContent: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 4 },
  pumpCard: {
    borderRadius: 14, borderWidth: 1,
    padding: 14, marginBottom: 10,
  },
  pumpTop: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
  },
  pumpLabelWrap: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pumpDot: { width: 8, height: 8, borderRadius: 4 },
  pumpName: { fontSize: 14, fontWeight: '800' },
  pumpTube: { fontSize: 10, fontWeight: '600', letterSpacing: 0.3, marginTop: 1 },
  pumpBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 16, paddingVertical: 9,
    borderRadius: 10, borderWidth: 1,
  },
  btnLabel: { fontSize: 13, fontWeight: '800' },
  statusRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 10,
  },
  statusText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3, flex: 1 },
  timerPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.15)',
  },
  timerText: { fontSize: 14, fontWeight: '900', fontVariant: ['tabular-nums'] },
  footer: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 18, paddingVertical: 12,
    borderTopWidth: 1,
  },
  footerText: { fontSize: 10, fontWeight: '600', letterSpacing: 0.2 },
});
