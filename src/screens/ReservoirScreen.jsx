// ============================================================
//  ReservoirScreen.jsx — HerbanalytiX
//  Clean, modern reservoir gauge with animated water fill,
//  distance/volume readouts, level thresholds, and nutrient
//  dosing via the Refill button.
// ============================================================

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef, useState } from 'react';
import {
    Animated,
    Easing,
    Pressable,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import RefillDosingModal from '../components/RefillDosingModal';
import { useSensor } from '../context/SensorContext';
import { useTheme } from '../theme/ThemeContext';

// ── Constants ────────────────────────────────────────────────
const TANK_MAX_L  = 8.0;
const TANK_WARN_L = 2.4;   // 30 %
const TANK_CRIT_L = 0.8;   // 10 %

const GAUGE_W = 200;
const GAUGE_H = 260;

function getLevelColor(vol) {
  if (vol <= TANK_CRIT_L) return '#EF4444';
  if (vol <= TANK_WARN_L) return '#F59E0B';
  return '#4ADE80';
}

function getLevelLabel(vol) {
  if (vol <= 0)                  return 'NO DATA';
  if (vol <= TANK_CRIT_L)       return 'CRITICAL';
  if (vol <= TANK_WARN_L)       return 'LOW';
  if (vol >= TANK_MAX_L * 0.85) return 'FULL';
  return 'GOOD';
}

function getLevelIcon(vol) {
  if (vol <= TANK_CRIT_L)       return 'warning';
  if (vol <= TANK_WARN_L)       return 'water-drop';
  if (vol >= TANK_MAX_L * 0.85) return 'check-circle';
  return 'water-drop';
}

function getLevelMessage(vol) {
  if (vol <= 0)                  return 'Waiting for sensor data…';
  if (vol <= TANK_CRIT_L)       return 'Refill urgently! Roots may dry out.';
  if (vol <= TANK_WARN_L)       return 'Running low — top up soon.';
  if (vol >= TANK_MAX_L * 0.85) return 'Reservoir is full and thriving.';
  return 'Healthy water level for your herbs.';
}


// ═════════════════════════════════════════════════════════════
//  Reservoir Gauge — rectangular tank with animated water fill
// ═════════════════════════════════════════════════════════════
function ReservoirGauge({ pct, color, vol, dist, theme }) {
  const fillAnim  = useRef(new Animated.Value(0)).current;
  const waveAnim  = useRef(new Animated.Value(0)).current;
  const wave2Anim = useRef(new Animated.Value(0)).current;
  const glowAnim  = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    Animated.timing(fillAnim, {
      toValue: pct, duration: 1800,
      easing: Easing.out(Easing.cubic), useNativeDriver: false,
    }).start();
  }, [pct]);

  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(waveAnim, { toValue: 1, duration: 2400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(waveAnim, { toValue: 0, duration: 2400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ])).start();
    Animated.loop(Animated.sequence([
      Animated.timing(wave2Anim, { toValue: 1, duration: 3200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(wave2Anim, { toValue: 0, duration: 3200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ])).start();
    Animated.loop(Animated.sequence([
      Animated.timing(glowAnim, { toValue: 0.6, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(glowAnim, { toValue: 0.3, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ])).start();
  }, []);

  const fillH  = fillAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  const waveY  = waveAnim.interpolate({ inputRange: [0, 1], outputRange: [-5, 5] });
  const wave2Y = wave2Anim.interpolate({ inputRange: [0, 1], outputRange: [4, -4] });

  // Threshold marks
  const thresholds = [
    { v: TANK_CRIT_L, c: '#EF4444', label: 'CRIT' },
    { v: TANK_WARN_L, c: '#F59E0B', label: 'LOW' },
    { v: TANK_MAX_L * 0.85, c: '#34D399', label: 'FULL' },
  ];

  return (
    <View style={gStyles.wrap}>
      {/* Threshold scale on the left */}
      <View style={gStyles.scaleCol}>
        {thresholds.map((t, i) => (
          <View key={i} style={[gStyles.scaleMark, { bottom: `${(t.v / TANK_MAX_L) * 100}%` }]}>
            <Text style={[gStyles.scaleLabel, { color: t.c }]}>{t.label}</Text>
            <View style={[gStyles.scaleLine, { backgroundColor: t.c + '60' }]} />
          </View>
        ))}
      </View>

      {/* Tank body */}
      <View style={[gStyles.tank, { borderColor: color + '40' }]}>
        {/* Inner shadow */}
        <LinearGradient
          colors={['rgba(0,0,0,0.20)', 'transparent', 'rgba(0,0,0,0.10)']}
          start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
          style={[StyleSheet.absoluteFill, { borderRadius: 16 }]}
        />

        {/* Threshold lines inside tank */}
        {thresholds.map((t, i) => (
          <View key={i} style={[gStyles.threshLine, {
            bottom: `${(t.v / TANK_MAX_L) * 100}%`,
            borderBottomColor: t.c + '35',
          }]} />
        ))}

        {/* Water fill */}
        <Animated.View style={[gStyles.fill, { height: fillH }]}>
          <LinearGradient
            colors={[color + '75', color + '50', color + '25', color + '10']}
            style={StyleSheet.absoluteFill}
            start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }}
          />
          {/* Primary wave */}
          <Animated.View style={[gStyles.wave, {
            backgroundColor: color,
            opacity: glowAnim,
            transform: [{ translateY: waveY }],
          }]} />
          {/* Secondary wave */}
          <Animated.View style={[gStyles.wave2, {
            backgroundColor: color + '50',
            transform: [{ translateY: wave2Y }],
          }]} />
        </Animated.View>

        {/* Center readout */}
        <View style={gStyles.center}>
          <Text style={[gStyles.pctNum, {
            color,
            textShadowColor: color + '50',
            textShadowOffset: { width: 0, height: 0 },
            textShadowRadius: 16,
          }]}>
            {vol > 0 ? Math.round(pct * 100) : '--'}
          </Text>
          <Text style={[gStyles.pctSign, { color: color + 'BB' }]}>%</Text>
        </View>
      </View>

      {/* Right side: volume + distance readout */}
      <View style={gStyles.readoutCol}>
        <View style={gStyles.readoutBlock}>
          <MaterialIcons name="water-drop" size={16} color={color} />
          <Text style={[gStyles.readoutVal, { color }]}>
            {vol > 0 ? vol.toFixed(1) : '--'}
          </Text>
          <Text style={[gStyles.readoutUnit, { color: theme.textMuted }]}>L</Text>
        </View>
        <View style={[gStyles.readoutDivider, { backgroundColor: theme.glassBorder }]} />
        <View style={gStyles.readoutBlock}>
          <MaterialIcons name="straighten" size={16} color={theme.textSecondary} />
          <Text style={[gStyles.readoutVal, { color: theme.textSecondary }]}>
            {!isNaN(dist) && dist > 0 ? dist.toFixed(1) : '--'}
          </Text>
          <Text style={[gStyles.readoutUnit, { color: theme.textMuted }]}>cm</Text>
        </View>
      </View>
    </View>
  );
}

const gStyles = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 12, gap: 10,
  },
  // ─ Left scale ─
  scaleCol: {
    width: 42, height: GAUGE_H, position: 'relative',
  },
  scaleMark: {
    position: 'absolute', right: 0, flexDirection: 'row',
    alignItems: 'center', gap: 3,
  },
  scaleLabel: { fontSize: 8, fontWeight: '900', letterSpacing: 0.5 },
  scaleLine: { width: 10, height: 1.5, borderRadius: 1 },
  // ─ Tank body ─
  tank: {
    width: GAUGE_W, height: GAUGE_H,
    borderRadius: 18, borderWidth: 1.5,
    overflow: 'hidden', position: 'relative',
    backgroundColor: 'rgba(0,0,0,0.30)',
    alignItems: 'center', justifyContent: 'center',
  },
  threshLine: {
    position: 'absolute', left: 0, right: 0, height: 0,
    borderBottomWidth: 1, borderStyle: 'dashed',
  },
  fill: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    overflow: 'hidden',
  },
  wave: {
    position: 'absolute', top: -1, left: -10, right: -10,
    height: 3, borderRadius: 2,
  },
  wave2: {
    position: 'absolute', top: 5, left: -6, right: -6,
    height: 2.5, borderRadius: 1.5,
  },
  center: {
    alignItems: 'center', justifyContent: 'center',
    zIndex: 10,
  },
  pctNum: { fontSize: 52, fontWeight: '900', letterSpacing: -2 },
  pctSign: { fontSize: 18, fontWeight: '800', marginTop: -8 },
  // ─ Right readouts ─
  readoutCol: {
    width: 60, alignItems: 'center', gap: 14,
  },
  readoutBlock: { alignItems: 'center', gap: 2 },
  readoutVal: { fontSize: 18, fontWeight: '900' },
  readoutUnit: { fontSize: 11, fontWeight: '700' },
  readoutDivider: { width: 24, height: 1, borderRadius: 1, opacity: 0.3 },
});


// ═════════════════════════════════════════════════════════════
//  Stat mini-card
// ═════════════════════════════════════════════════════════════
function StatMini({ icon, label, value, unit, color, theme }) {
  return (
    <View style={[smStyles.card, {
      backgroundColor: theme.sectionCardBg ?? 'rgba(0,0,0,0.18)',
      borderColor: color + '20',
    }]}>
      <MaterialIcons name={icon} size={16} color={color} />
      <View style={smStyles.text}>
        <Text style={[smStyles.val, { color }]}>
          {value}<Text style={smStyles.unit}>{unit}</Text>
        </Text>
        <Text style={[smStyles.label, { color: theme.textMuted }]}>{label}</Text>
      </View>
    </View>
  );
}

const smStyles = StyleSheet.create({
  card: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 12, paddingHorizontal: 12,
    borderRadius: 14, borderWidth: 1,
  },
  text: { flex: 1 },
  val: { fontSize: 16, fontWeight: '900', letterSpacing: -0.2 },
  unit: { fontSize: 11, fontWeight: '700' },
  label: { fontSize: 10, fontWeight: '600', letterSpacing: 0.3, marginTop: 1 },
});


// ═════════════════════════════════════════════════════════════
//  Main Screen
// ═════════════════════════════════════════════════════════════
export default function ReservoirScreen() {
  const { data } = useSensor();
  const theme    = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const [refillOpen, setRefillOpen] = useState(false);
  const fadeIn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeIn, { toValue: 1, duration: 500, useNativeDriver: true }).start();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 800);
  };

  const res   = data.reservoir ?? {};
  const vol   = parseFloat(res.volume) || 0;
  const dist  = parseFloat(res.distance) || 0;
  const pct   = Math.min(Math.max(vol / TANK_MAX_L, 0), 1);
  const color = getLevelColor(vol);
  const label = getLevelLabel(vol);
  const icon  = getLevelIcon(vol);
  const msg   = getLevelMessage(vol);

  return (
    <LinearGradient colors={[theme.bgGradientTop, theme.bgGradientBot]} style={s.root}>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh}
            tintColor={theme.light} colors={[theme.light]} />
        }
      >
        <Animated.View style={{ opacity: fadeIn }}>

          {/* ── Hero: reservoir gauge ─────────────────────── */}
          <View style={[s.heroCard, {
            backgroundColor: theme.sectionCardBg ?? 'rgba(0,0,0,0.15)',
            borderColor: color + '18',
          }]}>
            {/* Status badge */}
            <View style={[s.badge, { backgroundColor: color + '12', borderColor: color + '30' }]}>
              <MaterialIcons name={icon} size={13} color={color} />
              <Text style={[s.badgeText, { color }]}>{label}</Text>
            </View>

            <ReservoirGauge pct={pct} color={color} vol={vol} dist={dist} theme={theme} />

            <Text style={[s.heroMsg, { color: theme.textSecondary }]}>{msg}</Text>
          </View>

          {/* ── Stats row ──────────────────────────────────── */}
          <View style={s.statsRow}>
            <StatMini icon="straighten" label="LiDAR Dist."
              value={dist > 0 ? dist.toFixed(1) : '--'} unit=" cm"
              color={theme.textSecondary} theme={theme} />
            <StatMini icon="local-drink" label="Capacity"
              value={TANK_MAX_L.toFixed(1)} unit=" L"
              color="#4ADE80" theme={theme} />
          </View>

          {/* ── Threshold guide ────────────────────────────── */}
          <View style={[s.guideCard, {
            backgroundColor: theme.sectionCardBg ?? 'rgba(0,0,0,0.15)',
            borderColor: theme.glassBorder,
          }]}>
            <View style={s.guideHeader}>
              <MaterialIcons name="tune" size={14} color={theme.textMuted} />
              <Text style={[s.guideTitle, { color: theme.textSecondary }]}>
                Level Thresholds
              </Text>
            </View>
            <ThresholdRow color="#EF4444" label="Critical"
              range={`< ${TANK_CRIT_L} L`} desc="Misting will fail" theme={theme} />
            <ThresholdRow color="#F59E0B" label="Low"
              range={`< ${TANK_WARN_L} L`} desc="Refill soon" theme={theme} />
            <ThresholdRow color="#4ADE80" label="Good"
              range={`${TANK_WARN_L} – ${(TANK_MAX_L * 0.85).toFixed(1)} L`}
              desc="Normal operation" theme={theme} />
            <ThresholdRow color="#34D399" label="Full"
              range={`> ${(TANK_MAX_L * 0.85).toFixed(1)} L`}
              desc="Optimal" theme={theme} last />
          </View>

          {/* ── Refill + Dose button ───────────────────────── */}
          <Pressable
            onPress={() => setRefillOpen(true)}
            style={({ pressed }) => [s.refillBtn, {
              backgroundColor: theme.sectionCardBg ?? 'rgba(0,0,0,0.15)',
              borderColor: '#60A5FA30',
              opacity: pressed ? 0.7 : 1,
            }]}
          >
            <View style={s.refillBtnLeft}>
              <View style={[s.refillIconWrap, { backgroundColor: '#60A5FA15', borderColor: '#60A5FA40' }]}>
                <MaterialIcons name="water-drop" size={18} color="#60A5FA" />
              </View>
              <View>
                <Text style={[s.refillBtnTitle, { color: theme.textPrimary ?? '#FFF' }]}>
                  Refill &amp; Dose Nutrients
                </Text>
                <Text style={[s.refillBtnSub, { color: theme.textMuted }]}>
                  Add water and auto-dose all nutrient solutions
                </Text>
              </View>
            </View>
            <MaterialIcons name="chevron-right" size={20} color={theme.textMuted} />
          </Pressable>

          {/* ── Tips card ──────────────────────────────────── */}
          <View style={[s.tipsCard, {
            backgroundColor: theme.sectionCardBg ?? 'rgba(0,0,0,0.15)',
            borderColor: theme.glassBorder,
          }]}>
            <MaterialIcons name="lightbulb-outline" size={15} color="#FBBF24" />
            <View style={s.tipsText}>
              <Text style={[s.tip, { color: theme.textMuted }]}>
                Keep water above{' '}
                <Text style={{ color: '#4ADE80', fontWeight: '800' }}>4 L</Text>{' '}
                for reliable aeroponic misting.
              </Text>
              <Text style={[s.tip, { color: theme.textMuted }]}>
                Distance is measured by a VL53L0X LiDAR sensor pointing
                at the water surface inside the reservoir.
              </Text>
            </View>
          </View>

          <Text style={[s.updated, { color: theme.textMuted }]}>
            Last Updated: {new Date(data.lastUpdated).toLocaleTimeString()}
          </Text>

        </Animated.View>
      </ScrollView>

      {/* Refill + Dosing Modal */}
      <RefillDosingModal
        visible={refillOpen}
        onClose={() => setRefillOpen(false)}
      />
    </LinearGradient>
  );
}


// ── Threshold row helper ────────────────────────────────────
function ThresholdRow({ color, label, range, desc, theme, last }) {
  return (
    <View style={[trStyles.row, !last && {
      borderBottomWidth: 1,
      borderBottomColor: theme.glassBorder ?? 'rgba(255,255,255,0.06)',
    }]}>
      <View style={[trStyles.dot, { backgroundColor: color }]} />
      <Text style={[trStyles.label, { color }]}>{label}</Text>
      <Text style={[trStyles.range, { color: theme.textSecondary }]}>{range}</Text>
      <Text style={[trStyles.desc, { color: theme.textMuted }]}>{desc}</Text>
    </View>
  );
}

const trStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 9,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  label: { fontSize: 11, fontWeight: '800', width: 58, letterSpacing: 0.3 },
  range: { fontSize: 11, fontWeight: '700', flex: 1 },
  desc: { fontSize: 10, fontWeight: '600' },
});


// ── Styles ──────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 32 },

  heroCard: {
    borderRadius: 20, borderWidth: 1,
    paddingVertical: 20, paddingHorizontal: 18,
    marginBottom: 14, alignItems: 'center',
  },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 5,
    borderRadius: 20, borderWidth: 1, marginBottom: 10,
  },
  badgeText: { fontSize: 11, fontWeight: '900', letterSpacing: 1.5 },
  heroMsg: {
    fontSize: 12, fontWeight: '600', textAlign: 'center',
    marginTop: 10, lineHeight: 18, letterSpacing: 0.2,
  },

  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },

  guideCard: {
    borderRadius: 16, borderWidth: 1,
    paddingVertical: 12, paddingHorizontal: 14,
    marginBottom: 14,
  },
  guideHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginBottom: 6,
  },
  guideTitle: {
    fontSize: 11, fontWeight: '700',
    letterSpacing: 0.6, textTransform: 'uppercase',
  },

  tipsCard: {
    flexDirection: 'row', gap: 10,
    borderRadius: 14, borderWidth: 1,
    paddingVertical: 14, paddingHorizontal: 14,
    marginBottom: 8,
  },
  tipsText: { flex: 1, gap: 8 },
  tip: { fontSize: 11, fontWeight: '600', lineHeight: 16, letterSpacing: 0.2 },

  refillBtn: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 14, borderWidth: 1,
    paddingVertical: 14, paddingHorizontal: 14,
    marginBottom: 14,
  },
  refillBtnLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  refillIconWrap: {
    width: 36, height: 36, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  refillBtnTitle: { fontSize: 13, fontWeight: '800' },
  refillBtnSub: { fontSize: 10, fontWeight: '600', letterSpacing: 0.2, marginTop: 1 },

  updated: { textAlign: 'center', fontSize: 11, marginTop: 8, letterSpacing: 0.3 },
});
