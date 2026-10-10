// ============================================================
//  PumpCalibrationModal.jsx — HerbanalytiX
//  Developer tool for pump flow-rate calibration.
//  Two modes:
//    mL mode  — picks 1–8 mL, pre-pump conduction + timed dose
//    Time mode — picks 1–9 s, raw pump-on for that duration
//  User presses one of three pump buttons (Bloom / Chelate / Grow).
//  Each pump is independent; only one runs at a time.
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

const { width: SCREEN_W } = Dimensions.get('window');
const POLL_MS = 500;

// Pump definitions matching server _CALIB_PUMPS
const PUMPS = [
  { key: 'bloom',   label: 'Bloom',   color: '#F472B6', icon: 'local-florist',  tube: 'tube_3', pin: 'A5' },
  { key: 'chelate', label: 'Chelate', color: '#60A5FA', icon: 'science',        tube: 'tube_2', pin: 'A4' },
  { key: 'grow',    label: 'Grow',    color: '#4ADE80', icon: 'eco',            tube: 'tube_1', pin: 'A3' },
];

const ML_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8];
const SEC_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

// ─── Voltage bar (reused pattern) ─────────────────────────────
function VoltageBar({ voltage, threshold, conducting, theme }) {
  const pct = Math.min(voltage / 5.0, 1);
  const barColor = conducting ? '#4ADE80' : '#60A5FA';
  const threshPct = Math.min(threshold / 5.0, 1);

  return (
    <View style={vbStyles.wrap}>
      <View style={[vbStyles.track, {
        backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)',
      }]}>
        <View style={[vbStyles.fill, { width: `${pct * 100}%`, backgroundColor: barColor }]} />
        <View style={[vbStyles.thresh, { left: `${threshPct * 100}%` }]} />
      </View>
      <View style={vbStyles.labels}>
        <Text style={[vbStyles.mvText, { color: barColor }]}>{voltage.toFixed(2)} V</Text>
        <Text style={[vbStyles.threshLabel, { color: theme.textMuted }]}>
          Threshold: {threshold.toFixed(1)} V
        </Text>
      </View>
    </View>
  );
}

const vbStyles = StyleSheet.create({
  wrap: { marginTop: 6, gap: 3 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden', position: 'relative' },
  fill: { height: '100%', borderRadius: 3 },
  thresh: {
    position: 'absolute', top: -1, bottom: -1, width: 1.5,
    backgroundColor: '#F59E0B90',
  },
  labels: { flexDirection: 'row', justifyContent: 'space-between' },
  mvText: { fontSize: 10, fontWeight: '800', fontVariant: ['tabular-nums'] },
  threshLabel: { fontSize: 9, fontWeight: '600' },
});


// ═══════════════════════════════════════════════════════════════
//  Main Modal
// ═══════════════════════════════════════════════════════════════
export default function PumpCalibrationModal({ visible, onClose }) {
  const theme = useTheme();
  const { apiBase, data } = useSensor();

  const [selectedMl, setSelectedMl] = useState(5);
  const [selectedSec, setSelectedSec] = useState(5);
  const [mode, setMode] = useState('ml'); // 'ml' | 'timed'

  // ── Calibration status from server ────────────────────────
  const [calibStatus, setCalibStatus] = useState({
    active: false, pump: '', step: '', countdown: 0,
  });
  const pollRef = useRef(null);

  // ── Fast-poll conductivity ────────────────────────────────
  const [condFast, setCondFast] = useState(null);
  const condPollRef = useRef(null);

  useEffect(() => {
    if (!visible) {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      if (condPollRef.current) clearInterval(condPollRef.current);
      condPollRef.current = null;
      setCondFast(null);
      setCalibStatus({ active: false, pump: '', step: '', countdown: 0 });
      return;
    }

    // Poll calibration status
    const pollCalib = async () => {
      try {
        const res = await fetch(`${apiBase}/api/pump/calibrate/status`);
        if (res.ok) {
          const json = await res.json();
          setCalibStatus(json);
        }
      } catch { /* retry next tick */ }
    };

    // Poll conductivity
    const pollCond = async () => {
      try {
        const res = await fetch(`${apiBase}/api/conductivity/status`);
        if (res.ok) {
          const json = await res.json();
          setCondFast(json.conductivity ?? null);
        }
      } catch { /* retry next tick */ }
    };

    pollCalib();
    pollCond();
    pollRef.current = setInterval(pollCalib, POLL_MS);
    condPollRef.current = setInterval(pollCond, POLL_MS);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (condPollRef.current) clearInterval(condPollRef.current);
      pollRef.current = null;
      condPollRef.current = null;
    };
  }, [visible, apiBase]);

  // ── Animations ────────────────────────────────────────────
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

  // ── Start calibration for a pump ──────────────────────────
  const startCalibration = useCallback(async (pumpKey) => {
    try {
      const body = mode === 'timed'
        ? { pump: pumpKey, seconds: selectedSec, mode: 'timed' }
        : { pump: pumpKey, ml: selectedMl };
      const res = await fetch(`${apiBase}/api/pump/calibrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        console.warn('[Calib] Start failed:', json.error);
      }
    } catch (err) {
      console.warn('[Calib] Start failed:', err.message);
    }
  }, [apiBase, selectedMl, selectedSec, mode]);

  // ── Abort calibration ─────────────────────────────────────
  const abortCalibration = useCallback(async () => {
    try {
      await fetch(`${apiBase}/api/pump/calibrate/abort`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      console.warn('[Calib] Abort failed:', err.message);
    }
  }, [apiBase]);

  // ── Close handler — abort if running ──────────────────────
  const handleClose = useCallback(async () => {
    if (calibStatus.active) {
      await abortCalibration();
    }
    dismiss();
  }, [calibStatus.active, abortCalibration, dismiss]);

  // Conductivity source (prefer fast-polled)
  const conductivity = condFast ?? data.conductivity ?? {};

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
        <View style={[ms.accent, { backgroundColor: '#A78BFA' }]} />

        {/* Header */}
        <View style={ms.header}>
          <View style={ms.headerLeft}>
            <View style={[ms.iconWrap, { backgroundColor: '#A78BFA15', borderColor: '#A78BFA40' }]}>
              <MaterialIcons name="speed" size={20} color="#A78BFA" />
            </View>
            <View>
              <Text style={[ms.title, { color: theme.textPrimary ?? '#FFF' }]}>
                Pump Calibration
              </Text>
              <Text style={[ms.subtitle, { color: theme.textMuted }]}>
                Test individual pumps with measured volume
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

        {/* Mode toggle */}
        <View style={ms.modeRow}>
          {[{ key: 'ml', label: 'mL Mode', hint: 'Conduction + dose' },
            { key: 'timed', label: 'Time Mode', hint: 'Raw pump seconds' }].map((m) => {
            const active = mode === m.key;
            return (
              <Pressable
                key={m.key}
                disabled={calibStatus.active}
                onPress={() => setMode(m.key)}
                style={({ pressed }) => [ms.modeBtn, {
                  backgroundColor: active ? '#A78BFA18' : (theme.isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)'),
                  borderColor: active ? '#A78BFA55' : theme.glassBorder,
                  opacity: (pressed || calibStatus.active) && !active ? 0.5 : 1,
                }]}
              >
                <MaterialIcons
                  name={m.key === 'ml' ? 'science' : 'timer'}
                  size={16}
                  color={active ? '#A78BFA' : theme.textMuted}
                />
                <View>
                  <Text style={[ms.modeBtnLabel, { color: active ? '#A78BFA' : theme.textPrimary }]}>
                    {m.label}
                  </Text>
                  <Text style={[ms.modeBtnHint, { color: theme.textMuted }]}>{m.hint}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* Picker — mL or seconds */}
        <View style={ms.pickerSection}>
          <Text style={[ms.pickerLabel, { color: theme.textMuted }]}>
            {mode === 'timed' ? 'Duration (seconds)' : 'Volume (mL)'}
          </Text>
          <View style={ms.pickerRow}>
            {(mode === 'timed' ? SEC_OPTIONS : ML_OPTIONS).map((val) => {
              const active = mode === 'timed' ? selectedSec === val : selectedMl === val;
              return (
                <Pressable
                  key={val}
                  disabled={calibStatus.active}
                  onPress={() => mode === 'timed' ? setSelectedSec(val) : setSelectedMl(val)}
                  style={({ pressed }) => [ms.mlBtn, {
                    backgroundColor: active ? '#A78BFA20' : (theme.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'),
                    borderColor: active ? '#A78BFA60' : theme.glassBorder,
                    opacity: (pressed || calibStatus.active) && !active ? 0.5 : 1,
                  }]}
                >
                  <Text style={[ms.mlBtnText, {
                    color: active ? '#A78BFA' : theme.textMuted,
                  }]}>{val}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={[ms.pickerHint, { color: theme.textMuted }]}>
            {mode === 'timed'
              ? `Raw pump-on for ${selectedSec}s · no conduction wait`
              : `Assumes 1 mL/s · ${selectedMl} mL = ${selectedMl}s pump time`}
          </Text>
        </View>

        <View style={[ms.divider, { backgroundColor: theme.glassBorder }]} />

        {/* Pump cards */}
        <ScrollView
          style={ms.scrollArea}
          contentContainerStyle={ms.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {PUMPS.map((pump) => {
            const isThisPumpActive = calibStatus.active && calibStatus.pump === pump.key;
            const tubeData = conductivity[pump.tube] ?? {};
            const voltage = tubeData.voltage ?? 0;
            const threshold = tubeData.threshold ?? 2.0;
            const conducting = tubeData.conducting ?? false;

            const statusColor = isThisPumpActive
              ? (conducting ? '#4ADE80' : pump.color)
              : theme.textMuted;

            const statusLabel = isThisPumpActive
              ? calibStatus.step
              : 'Idle';

            return (
              <View key={pump.key} style={[ms.pumpCard, {
                borderColor: isThisPumpActive ? pump.color + '40' : theme.glassBorder,
                backgroundColor: isThisPumpActive
                  ? (pump.color + '08')
                  : (theme.isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)'),
              }]}>
                {/* Top row: label + button */}
                <View style={ms.pumpTop}>
                  <View style={ms.pumpLabelWrap}>
                    <View style={[ms.pumpDot, { backgroundColor: isThisPumpActive ? pump.color : theme.textMuted + '60' }]} />
                    <View>
                      <Text style={[ms.pumpName, { color: theme.textPrimary ?? '#FFF' }]}>
                        {pump.label}
                      </Text>
                      <Text style={[ms.pumpSub, { color: theme.textMuted }]}>
                        {pump.pin} · {pump.tube}
                      </Text>
                    </View>
                  </View>

                  {isThisPumpActive ? (
                    <Pressable
                      onPress={abortCalibration}
                      style={({ pressed }) => [ms.pumpBtn, {
                        backgroundColor: '#EF444418',
                        borderColor: '#EF444460',
                        opacity: pressed ? 0.65 : 1,
                      }]}
                    >
                      <MaterialIcons name="stop" size={20} color="#EF4444" />
                      <Text style={[ms.btnLabel, { color: '#EF4444' }]}>Abort</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      disabled={calibStatus.active}
                      onPress={() => startCalibration(pump.key)}
                      style={({ pressed }) => [ms.pumpBtn, {
                        backgroundColor: calibStatus.active ? 'rgba(128,128,128,0.08)' : pump.color + '18',
                        borderColor: calibStatus.active ? theme.glassBorder : pump.color + '60',
                        opacity: (pressed || calibStatus.active) ? 0.5 : 1,
                      }]}
                    >
                      <MaterialIcons
                        name="play-arrow"
                        size={20}
                        color={calibStatus.active ? theme.textMuted : pump.color}
                      />
                      <Text style={[ms.btnLabel, {
                        color: calibStatus.active ? theme.textMuted : pump.color,
                      }]}>
                        {mode === 'timed' ? `${selectedSec}s` : `${selectedMl} mL`}
                      </Text>
                    </Pressable>
                  )}
                </View>

                {/* Status + countdown row */}
                <View style={ms.statusRow}>
                  <MaterialIcons
                    name={isThisPumpActive ? 'sync' : 'radio-button-unchecked'}
                    size={14}
                    color={statusColor}
                  />
                  <Text style={[ms.statusText, { color: statusColor }]} numberOfLines={1}>
                    {statusLabel}
                  </Text>
                  {isThisPumpActive && calibStatus.countdown > 0 && (
                    <View style={ms.timerPill}>
                      <MaterialIcons name="timer" size={12} color={pump.color} />
                      <Text style={[ms.timerText, { color: pump.color }]}>
                        {calibStatus.countdown}s
                      </Text>
                    </View>
                  )}
                </View>

                {/* Voltage bar */}
                <VoltageBar
                  voltage={voltage}
                  threshold={threshold}
                  conducting={conducting}
                  theme={theme}
                />
              </View>
            );
          })}
        </ScrollView>

        {/* Footer */}
        <View style={[ms.footer, { borderTopColor: theme.glassBorder }]}>
          <MaterialIcons name="info-outline" size={13} color={theme.textMuted} />
          <Text style={[ms.footerText, { color: theme.textMuted }]}>
            {mode === 'timed'
              ? 'Time mode: pump runs for the exact selected duration — no conduction wait.'
              : 'mL mode: pre-pump waits for conductivity (max 10 s), then pumps for the selected volume.'}
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

  // Mode toggle
  modeRow: {
    flexDirection: 'row', gap: 8,
    paddingHorizontal: 18, paddingTop: 14, paddingBottom: 4,
  },
  modeBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 12, borderWidth: 1,
  },
  modeBtnLabel: { fontSize: 12, fontWeight: '800' },
  modeBtnHint: { fontSize: 9, fontWeight: '600', marginTop: 1 },

  // Picker
  pickerSection: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 10 },
  pickerLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3, marginBottom: 8 },
  pickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  mlBtn: {
    width: (SCREEN_W - 36 - 56) / 8,
    minWidth: 36,
    aspectRatio: 1,
    borderRadius: 10, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  mlBtnText: { fontSize: 15, fontWeight: '900' },
  pickerHint: { fontSize: 10, fontWeight: '600', marginTop: 8, letterSpacing: 0.2 },

  // Pump cards
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
  pumpSub: { fontSize: 10, fontWeight: '600', letterSpacing: 0.3, marginTop: 1 },
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
