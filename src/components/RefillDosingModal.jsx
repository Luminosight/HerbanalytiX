// ============================================================
//  RefillDosingModal.jsx — HerbanalytiX
//  Bottom-sheet modal for reservoir refill + nutrient dosing.
//
//  Flow:
//    1. User selects liters (min 2L, max 8L − current level).
//    2. "Start Dosing" triggers the server sequence:
//         Calibration — all 3 pumps ON simultaneously,
//           each stops on conduction (or 10 s timeout)
//         Fixed 2 mL Bloom → mix → 2 mL Iron Chelate → mix
//           → 2 mL Grow → 1 min final mix
//         TDS check → adaptive compensation if out of range
//    3. Live status + countdown + TDS polled from server.
//    4. User can abort at any time.
// ============================================================

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Animated,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSensor } from '../context/SensorContext';
import { useTheme } from '../theme/ThemeContext';

// ── Constants ─────────────────────────────────────────────────
const TANK_MAX_L = 8;
const ITEM_H     = 56;          // taller for easier touch
const VISIBLE    = 3;
const DRUM_H     = ITEM_H * VISIBLE;

// Dosing sequence labels (matches server order).
// Fixed 2 mL per nutrient → 1 min final mix → TDS adaptive check.
const STEPS = [
  { key: 'calib',   label: 'Calibration',       icon: 'tune',            color: '#A78BFA' },
  { key: 'bloom',   label: 'Bloom 2 mL',        icon: 'opacity',         color: '#F472B6' },
  { key: 'mix1',    label: 'Mixing',             icon: 'autorenew',       color: '#94A3B8' },
  { key: 'chelate', label: 'Iron Chelate 2 mL',  icon: 'science',         color: '#FBBF24' },
  { key: 'mix2',    label: 'Mixing',             icon: 'autorenew',       color: '#94A3B8' },
  { key: 'grow',    label: 'Grow 2 mL',          icon: 'eco',             color: '#4ADE80' },
  { key: 'mixer',   label: 'Final Mix (1 min)',  icon: 'autorenew',       color: '#60A5FA' },
  { key: 'tds',     label: 'TDS Check',          icon: 'monitor-heart',   color: '#38BDF8' },
];

const POLL_MS = 600;

// ═════════════════════════════════════════════════════════════
//  Scroll-wheel picker for liters (improved UX — ± buttons)
// ═════════════════════════════════════════════════════════════
function LiterPicker({ min, max, value, onChange, theme }) {
  const scrollRef = useRef(null);
  const skipNextScrollEnd = useRef(false);   // prevents ± / tap race with scroll callback
  const items = [];
  for (let i = min; i <= max; i++) items.push(i);
  const selectedIdx = value - min;

  // Scroll to selected on mount / value change
  useEffect(() => {
    const t = setTimeout(() => {
      skipNextScrollEnd.current = true;
      scrollRef.current?.scrollTo({ y: selectedIdx * ITEM_H, animated: true });
    }, 80);
    return () => clearTimeout(t);
  }, [selectedIdx]);

  const handleEnd = (e) => {
    if (skipNextScrollEnd.current) {
      skipNextScrollEnd.current = false;
      return;
    }
    const idx = Math.max(0, Math.min(
      Math.round(e.nativeEvent.contentOffset.y / ITEM_H),
      items.length - 1,
    ));
    onChange(items[idx]);
  };

  const increment = () => {
    if (value < max) {
      const next = value + 1;
      onChange(next);
    }
  };
  const decrement = () => {
    if (value > min) {
      const next = value - 1;
      onChange(next);
    }
  };

  return (
    <View style={pkStyles.outer}>
      {/* Minus button */}
      <TouchableOpacity
        onPress={decrement}
        disabled={value <= min}
        activeOpacity={0.6}
        style={[pkStyles.pmBtn, {
          borderColor: theme.glassBorder,
          opacity: value <= min ? 0.3 : 1,
          backgroundColor: theme.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
        }]}
      >
        <Text style={[pkStyles.pmText, { color: theme.textPrimary }]}>−</Text>
      </TouchableOpacity>

      {/* Drum / scroll wheel */}
      <View style={[pkStyles.drumWrap, {
        backgroundColor: theme.isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
        borderColor: theme.glassBorder,
      }]}>
        {/* Centre highlight band */}
        <View pointerEvents="none" style={[pkStyles.highlight, {
          backgroundColor: '#4ADE8018',
          borderColor: '#4ADE8040',
        }]} />

        <ScrollView
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
          snapToInterval={ITEM_H}
          decelerationRate="fast"
          bounces={Platform.OS === 'ios'}
          overScrollMode="never"
          contentContainerStyle={{ paddingVertical: ITEM_H }}
          onMomentumScrollEnd={handleEnd}
          onScrollEndDrag={handleEnd}
          scrollEventThrottle={16}
          style={{ height: DRUM_H }}
          nestedScrollEnabled
        >
          {items.map((n, idx) => {
            const isSelected = idx === selectedIdx;
            return (
              <Pressable
                key={n}
                onPress={() => {
                  onChange(n);
                }}
                style={{ height: ITEM_H, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{
                  fontSize: isSelected ? 34 : 20,
                  fontWeight: isSelected ? '900' : '500',
                  color: isSelected ? '#4ADE80' : theme.textMuted,
                  opacity: Math.abs(idx - selectedIdx) > 1 ? 0.2
                         : isSelected ? 1 : 0.5,
                }}>{n}</Text>
                {isSelected && (
                  <Text style={{ fontSize: 11, fontWeight: '700', color: '#4ADE8090', marginTop: -2 }}>
                    Liters
                  </Text>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Plus button */}
      <TouchableOpacity
        onPress={increment}
        disabled={value >= max}
        activeOpacity={0.6}
        style={[pkStyles.pmBtn, {
          borderColor: theme.glassBorder,
          opacity: value >= max ? 0.3 : 1,
          backgroundColor: theme.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
        }]}
      >
        <Text style={[pkStyles.pmText, { color: theme.textPrimary }]}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const pkStyles = StyleSheet.create({
  outer: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 14,
  },
  pmBtn: {
    width: 48, height: 48, borderRadius: 14,
    borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
  pmText: { fontSize: 28, fontWeight: '600', lineHeight: 32 },
  drumWrap: {
    borderRadius: 16, borderWidth: 1,
    overflow: 'hidden', position: 'relative',
    width: 120,
  },
  highlight: {
    position: 'absolute',
    left: 0, right: 0,
    top: ITEM_H,
    height: ITEM_H,
    borderTopWidth: 1, borderBottomWidth: 1,
    zIndex: 1,
  },
});


// ═════════════════════════════════════════════════════════════
//  Dosing progress card — with live countdown
// ═════════════════════════════════════════════════════════════
function DosingProgress({ step, countdown, tds, tdsPhase, tdsTarget, theme }) {
  // Map server step string → step index in STEPS[]
  // Calib=0, Bloom=1, Mix=2, Chelate=3, Mix=4, Grow=5, FinalMix=6, TDS=7
  const activeIdx = (() => {
    if (!step) return -1;
    const s = step.toLowerCase();
    if (s.includes('calibrat'))                                                  return 0;
    if (s.includes('bloom') && (s.includes('done') || s.includes('mixing')))     return 2;
    if (s.includes('bloom'))                                                     return 1;
    if (s.includes('chelate') && (s.includes('done') || s.includes('mixing')))   return 4;
    if (s.includes('chelate'))                                                   return 3;
    if (s.includes('grow') && (s.includes('done') || s.includes('mixing')))      return 4;
    if (s.includes('grow') && !s.includes('compensation'))                       return 5;
    if (s.includes('initial dose complete') || s.includes('mixing for'))         return 6;
    if (s.includes('tds') || s.includes('compensation') || s.includes('add water')) return 7;
    return -1;
  })();

  const fmtCountdown = (sec) => {
    if (!sec || sec <= 0) return '';
    const m = Math.floor(sec / 60);
    const r = sec % 60;
    if (m > 0) return `${m}:${String(r).padStart(2, '0')}`;
    return `${r}s`;
  };

  const tdsColor = tdsPhase === 'in_range' ? '#4ADE80'
                 : tdsPhase === 'above_range' ? '#F59E0B'
                 : tdsPhase === 'below_range' ? '#38BDF8'
                 : '#94A3B8';

  return (
    <View style={dpStyles.wrap}>
      <View style={dpStyles.headerRow}>
        <MaterialIcons name="sync" size={18} color="#FBBF24" />
        <Text style={[dpStyles.heading, { color: '#FBBF24' }]}>Dosing In Progress</Text>
      </View>

      {/* Live step label from server */}
      <Text style={[dpStyles.stepText, { color: theme.textSecondary }]} numberOfLines={3}>
        {step || 'Initializing…'}
      </Text>

      {/* Countdown bubble */}
      {countdown > 0 && (
        <View style={dpStyles.countdownRow}>
          <View style={dpStyles.countdownBubble}>
            <MaterialIcons name="timer" size={16} color="#FFF" />
            <Text style={dpStyles.countdownText}>{fmtCountdown(countdown)}</Text>
          </View>
          <Text style={[dpStyles.countdownHint, { color: theme.textMuted }]}>remaining</Text>
        </View>
      )}

      {/* ── Live TDS card (visible during adaptive phase) ── */}
      {(tdsPhase === 'above_range' || tdsPhase === 'below_range' || tdsPhase === 'in_range') && (
        <View style={[dpStyles.tdsCard, { borderColor: tdsColor + '50' }]}>
          <View style={dpStyles.tdsRow}>
            <MaterialIcons name="monitor-heart" size={18} color={tdsColor} />
            <Text style={[dpStyles.tdsValue, { color: tdsColor }]}>
              {tds > 0 ? `${Math.round(tds)} ppm` : '---'}
            </Text>
            {tdsTarget?.min != null && (
              <Text style={[dpStyles.tdsRange, { color: theme.textMuted }]}>
                Target: {tdsTarget.min}–{tdsTarget.max} ppm
              </Text>
            )}
          </View>
          {tdsPhase === 'above_range' && (
            <View style={dpStyles.tdsHintRow}>
              <MaterialIcons name="warning" size={14} color="#F59E0B" />
              <Text style={[dpStyles.tdsHint, { color: '#F59E0B' }]}>
                TDS too high — add water gradually to dilute
              </Text>
            </View>
          )}
          {tdsPhase === 'below_range' && (
            <View style={dpStyles.tdsHintRow}>
              <MaterialIcons name="trending-up" size={14} color="#38BDF8" />
              <Text style={[dpStyles.tdsHint, { color: '#38BDF8' }]}>
                TDS below range — micro-dosing compensation…
              </Text>
            </View>
          )}
          {tdsPhase === 'in_range' && (
            <View style={dpStyles.tdsHintRow}>
              <MaterialIcons name="check-circle" size={14} color="#4ADE80" />
              <Text style={[dpStyles.tdsHint, { color: '#4ADE80' }]}>
                TDS is in range — dosing complete!
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Sequence mini-steps */}
      <View style={dpStyles.steps}>
        {STEPS.map((st, idx) => {
          const done = idx < activeIdx;
          const active = idx === activeIdx;
          return (
            <View key={st.key} style={[dpStyles.stepRow, { opacity: done ? 0.4 : 1 }]}>
              <View style={[dpStyles.stepDot, {
                backgroundColor: done ? st.color + '60'
                  : active ? st.color
                  : theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
                borderColor: active ? st.color + '80' : 'transparent',
                borderWidth: active ? 2 : 0,
              }]}>
                {done && <MaterialIcons name="check" size={10} color="#FFF" />}
                {active && <MaterialIcons name={st.icon} size={10} color="#FFF" />}
              </View>
              <Text style={[dpStyles.stepLabel, {
                color: active ? st.color : done ? theme.textMuted : theme.textSecondary,
                fontWeight: active ? '800' : '600',
              }]}>
                {st.label}
              </Text>
              {active && countdown > 0 && (
                <View style={[dpStyles.activeBadge, { backgroundColor: st.color + '20', borderColor: st.color + '50' }]}>
                  <Text style={[dpStyles.activeBadgeText, { color: st.color }]}>{fmtCountdown(countdown)}</Text>
                </View>
              )}
              {active && countdown <= 0 && (
                <View style={[dpStyles.activeBadge, { backgroundColor: st.color + '20', borderColor: st.color + '50' }]}>
                  <Text style={[dpStyles.activeBadgeText, { color: st.color }]}>Active</Text>
                </View>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const dpStyles = StyleSheet.create({
  wrap: { gap: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heading: { fontSize: 16, fontWeight: '900', letterSpacing: -0.2 },
  stepText: { fontSize: 12, fontWeight: '600', lineHeight: 18, letterSpacing: 0.2 },
  countdownRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  countdownBubble: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#2D6A4F',
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 12,
  },
  countdownText: {
    color: '#FFF', fontSize: 20, fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  countdownHint: { fontSize: 12, fontWeight: '600' },
  tdsCard: {
    borderWidth: 1, borderRadius: 12,
    padding: 12, gap: 8,
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  tdsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tdsValue: { fontSize: 22, fontWeight: '900', fontVariant: ['tabular-nums'] },
  tdsRange: { fontSize: 11, fontWeight: '600', marginLeft: 'auto' },
  tdsHintRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tdsHint: { fontSize: 11, fontWeight: '700', flex: 1 },
  steps: { gap: 5, marginTop: 2 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepDot: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
  },
  stepLabel: { fontSize: 12, letterSpacing: 0.2, flex: 1 },
  activeBadge: {
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 6, borderWidth: 1,
  },
  activeBadgeText: { fontSize: 9, fontWeight: '800', fontVariant: ['tabular-nums'] },
});


// ═════════════════════════════════════════════════════════════
//  Main Modal
// ═════════════════════════════════════════════════════════════
export default function RefillDosingModal({ visible, onClose }) {
  const theme = useTheme();
  const { data, startDose, pollDoseStatus, stopDose } = useSensor();

  // Current reservoir volume → max liters user may add
  const currentVolume = Math.floor(parseFloat(data.reservoir?.volume) || 0);
  const maxAdd = Math.max(TANK_MAX_L - currentVolume, 0);
  const minAdd = 2;   // server requires at least 2 L refill

  const [liters, setLiters]         = useState(Math.max(minAdd, Math.min(minAdd, maxAdd)));
  const [dosing, setDosing]         = useState(false);
  const [doseStep, setDoseStep]     = useState('');
  const [countdown, setCountdown]   = useState(0);
  const [doseTds, setDoseTds]       = useState(0);
  const [doseTdsPhase, setDoseTdsPhase] = useState('');
  const [doseTdsTarget, setDoseTdsTarget] = useState({});
  const [error, setError]           = useState(null);
  const [aborting, setAborting]     = useState(false);
  const pollRef = useRef(null);

  // Clamp liters when reservoir changes
  useEffect(() => {
    setLiters(prev => Math.min(prev, maxAdd));
  }, [maxAdd]);

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

  // Check if dosing is already active when modal opens
  useEffect(() => {
    if (!visible) return;
    (async () => {
      const status = await pollDoseStatus();
      if (status?.active) {
        setDosing(true);
        setDoseStep(status.step || '');
        setCountdown(status.countdown || 0);
        setDoseTds(status.tds || 0);
        setDoseTdsPhase(status.tdsPhase || '');
        setDoseTdsTarget(status.tdsTarget || {});
      }
    })();
  }, [visible]);

  const dismiss = useCallback(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 0, duration: 180, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 60, duration: 180, useNativeDriver: true }),
    ]).start(() => onClose());
  }, [onClose]);

  // Start dosing
  const handleStart = useCallback(async () => {
    setError(null);
    const result = await startDose(liters);
    if (!result.ok) {
      setError(result.error ?? 'Failed to start dosing');
      return;
    }
    setDosing(true);
    setDoseStep('Starting dosing sequence…');
    setCountdown(0);
  }, [liters, startDose]);

  // Abort dosing
  const handleAbort = useCallback(async () => {
    setAborting(true);
    await stopDose();
    setDosing(false);
    setDoseStep('');
    setCountdown(0);
    setAborting(false);
  }, [stopDose]);

  // Poll dose status while dosing is active
  useEffect(() => {
    if (!dosing || !visible) {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      return;
    }

    const poll = async () => {
      const status = await pollDoseStatus();
      if (!status) return;
      setDoseStep(status.step || '');
      setCountdown(status.countdown || 0);
      setDoseTds(status.tds || 0);
      setDoseTdsPhase(status.tdsPhase || '');
      setDoseTdsTarget(status.tdsTarget || {});
      if (!status.active) {
        setDosing(false);
        setDoseStep('');
        setCountdown(0);
        setDoseTds(0);
        setDoseTdsPhase('');
        setDoseTdsTarget({});
      }
    };

    poll();
    pollRef.current = setInterval(poll, POLL_MS);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [dosing, visible, pollDoseStatus]);

  // Handle close — always allowed, dosing continues on server
  const handleClose = useCallback(() => {
    dismiss();
  }, [dismiss]);

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
      <Animated.View style={[s.backdrop, { opacity: fadeAnim }]}>
        <TouchableOpacity style={s.backdropTouch} activeOpacity={1} onPress={handleClose} />
      </Animated.View>

      {/* Sheet */}
      <Animated.View style={[s.sheet, {
        backgroundColor: bgCard,
        borderColor: theme.glassBorder,
        transform: [{ translateY: slideAnim }],
        opacity: fadeAnim,
      }]}>
        {/* Accent bar */}
        <View style={[s.accent, { backgroundColor: '#60A5FA' }]} />

        {/* Header */}
        <View style={s.header}>
          <View style={s.headerLeft}>
            <View style={[s.iconWrap, { backgroundColor: '#60A5FA15', borderColor: '#60A5FA40' }]}>
              <MaterialIcons name="water-drop" size={20} color="#60A5FA" />
            </View>
            <View>
              <Text style={[s.title, { color: theme.textPrimary ?? '#FFF' }]}>
                Refill Reservoir
              </Text>
              <Text style={[s.subtitle, { color: theme.textMuted }]}>
                Add water &amp; auto-dose nutrients
              </Text>
            </View>
          </View>
          <Pressable
            onPress={handleClose}
            style={({ pressed }) => [s.closeBtn, {
              backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
              opacity: pressed ? 0.6 : 1,
            }]}
          >
            <MaterialIcons name="close" size={18} color={theme.textMuted} />
          </Pressable>
        </View>

        <View style={[s.divider, { backgroundColor: theme.glassBorder }]} />

        <ScrollView
          style={s.scrollArea}
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {dosing ? (
            /* ── Dosing in progress ───────────────────────── */
            <DosingProgress
              step={doseStep}
              countdown={countdown}
              tds={doseTds}
              tdsPhase={doseTdsPhase}
              tdsTarget={doseTdsTarget}
              theme={theme}
            />
          ) : (
            /* ── Selection UI ─────────────────────────────── */
            <>
              {/* Current level info */}
              <View style={[s.infoRow, {
                backgroundColor: theme.isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
                borderColor: theme.glassBorder,
              }]}>
                <MaterialIcons name="info-outline" size={14} color={theme.textMuted} />
                <Text style={[s.infoText, { color: theme.textMuted }]}>
                  Current level: <Text style={{ color: '#4ADE80', fontWeight: '800' }}>{currentVolume}L</Text>
                  {'  ·  '}
                  Capacity: <Text style={{ fontWeight: '800' }}>{TANK_MAX_L}L</Text>
                  {'  ·  '}
                  You can add up to <Text style={{ color: '#60A5FA', fontWeight: '800' }}>{maxAdd}L</Text>
                </Text>
              </View>

              {/* Description */}
              <Text style={[s.desc, { color: theme.textMuted }]}>
                Select how many liters of water you're adding.
                Each nutrient will receive a fixed 2 mL initial dose
                followed by TDS-based compensation.
              </Text>

              {/* Liter picker (disabled if not enough room) */}
              {maxAdd >= minAdd ? (
                <LiterPicker
                  min={minAdd}
                  max={maxAdd}
                  value={liters}
                  onChange={setLiters}
                  theme={theme}
                />
              ) : (
                <View style={{ alignItems: 'center', paddingVertical: 10 }}>
                  <MaterialIcons name="block" size={32} color="#EF4444" />
                  <Text style={{ color: '#EF4444', fontWeight: '700', fontSize: 12, marginTop: 6, textAlign: 'center' }}>
                    Reservoir is near capacity — cannot add {minAdd}L minimum.
                  </Text>
                </View>
              )}

              {/* Summary card */}
              <View style={[s.summaryCard, {
                backgroundColor: theme.isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
                borderColor: theme.glassBorder,
              }]}>
                <Text style={[s.summaryTitle, { color: theme.textSecondary }]}>
                  Dosing Summary
                </Text>
                <View style={s.summaryRows}>
                  <SummaryRow
                    icon="opacity" color="#A78BFA"
                    label="Bloom Solution" value="2 mL"
                    theme={theme}
                  />
                  <SummaryRow
                    icon="science" color="#FBBF24"
                    label="Iron Chelate" value="2 mL"
                    theme={theme}
                  />
                  <SummaryRow
                    icon="eco" color="#4ADE80"
                    label="Grow Solution" value="2 mL"
                    theme={theme}
                  />
                  <SummaryRow
                    icon="autorenew" color="#60A5FA"
                    label="Final Mix + TDS Check" value="1 min + adaptive"
                    theme={theme}
                  />
                </View>
              </View>

              {/* Error */}
              {error && (
                <Text style={s.errorText}>{error}</Text>
              )}
            </>
          )}
        </ScrollView>

        {/* Footer */}
        {!dosing && (
          <View style={[s.footer, { borderTopColor: theme.glassBorder }]}>
            <Pressable
              onPress={handleStart}
              disabled={maxAdd < minAdd}
              style={({ pressed }) => [s.startBtn, { opacity: (pressed || maxAdd < minAdd) ? 0.4 : 1 }]}
            >
              <MaterialIcons name="play-arrow" size={20} color="#FFF" />
              <Text style={s.startBtnText}>Start Dosing — {liters}L</Text>
            </Pressable>
          </View>
        )}

        {dosing && (
          <View style={[s.footer, { borderTopColor: theme.glassBorder }]}>
            <View style={s.dosingFooterRow}>
              <View style={s.dosingFooterHint}>
                <MaterialIcons name="info-outline" size={13} color={theme.textMuted} />
                <Text style={[s.footerHintText, { color: theme.textMuted }]}>
                  Continues in background if closed.
                </Text>
              </View>
              <Pressable
                onPress={handleAbort}
                disabled={aborting}
                style={({ pressed }) => [s.abortBtn, {
                  opacity: pressed || aborting ? 0.5 : 1,
                }]}
              >
                <MaterialIcons name="stop" size={16} color="#FFF" />
                <Text style={s.abortBtnText}>{aborting ? 'Stopping…' : 'Stop'}</Text>
              </Pressable>
            </View>
          </View>
        )}
      </Animated.View>
    </Modal>
  );
}


// ── Summary row helper ──────────────────────────────────────
function SummaryRow({ icon, color, label, value, theme }) {
  return (
    <View style={srStyles.row}>
      <View style={[srStyles.dot, { backgroundColor: color }]}>
        <MaterialIcons name={icon} size={10} color="#FFF" />
      </View>
      <Text style={[srStyles.label, { color: theme.textSecondary }]}>{label}</Text>
      <Text style={[srStyles.value, { color }]}>{value}</Text>
    </View>
  );
}

const srStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  dot: {
    width: 20, height: 20, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  label: { flex: 1, fontSize: 12, fontWeight: '600' },
  value: { fontSize: 13, fontWeight: '900' },
});


// ── Styles ──────────────────────────────────────────────────
const s = StyleSheet.create({
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
  scrollArea: { flex: 1 },
  scrollContent: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 10 },
  infoRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 12, borderRadius: 12, borderWidth: 1,
    marginBottom: 12,
  },
  infoText: { flex: 1, fontSize: 11, fontWeight: '600', lineHeight: 17 },
  desc: {
    fontSize: 11, fontWeight: '600', lineHeight: 17,
    letterSpacing: 0.2, marginBottom: 14,
  },
  summaryCard: {
    borderRadius: 14, borderWidth: 1,
    padding: 14, marginTop: 14,
  },
  summaryTitle: {
    fontSize: 11, fontWeight: '700', letterSpacing: 0.6,
    textTransform: 'uppercase', marginBottom: 4,
  },
  summaryRows: { gap: 0 },
  errorText: {
    color: '#EF4444', fontSize: 12, fontWeight: '700',
    textAlign: 'center', marginTop: 10,
  },
  footer: {
    paddingHorizontal: 18, paddingVertical: 14,
    borderTopWidth: 1,
  },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center',
    gap: 8,
    backgroundColor: '#2D6A4F',
    paddingVertical: 14,
    borderRadius: 14,
  },
  startBtnText: { color: '#FFF', fontSize: 15, fontWeight: '800' },
  dosingFooterRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
  },
  dosingFooterHint: {
    flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1,
  },
  footerHintText: { fontSize: 10, fontWeight: '600', letterSpacing: 0.2 },
  abortBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#EF4444',
    paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 10,
  },
  abortBtnText: { color: '#FFF', fontSize: 13, fontWeight: '800' },
});
