import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef, useState } from 'react';
import {
    Animated,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import AppModal from '../components/AppModal';
import HerbaBot from '../components/HerbaBot';
import SensorCard from '../components/SensorCard';
import { usePlantConfig } from '../context/PlantConfigContext';
import { useSensor } from '../context/SensorContext';
import { useTheme } from '../theme/ThemeContext';

const PHASE_DISPLAY = {
  seedling:   'Seedlings',
  vegetative: 'Vegetative Plants',
  empty:      'No Plants',
};

const PHASE_COLOR = {
  seedling:   '#4ADE80',
  vegetative: '#60A5FA',
  empty:      '#888',
};

// ── Helpers ───────────────────────────────────────────────────
function fmtSec(totalSec) {
  const s = Math.max(0, Math.round(totalSec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r === 0 ? `${m}m` : `${m}m ${r}s`;
}

function fmtTime(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ── Plant config card (with integrated misting status) ────────
function PlantConfigCard({ theme }) {
  const { confirmedPhase, mistingConfig, emptyPlantBox } = usePlantConfig();
  const { data } = useSensor();
  const [confirmVisible, setConfirmVisible] = useState(false);

  // Misting countdown — server is the single source of truth for phase.
  // The local interval only drives smooth countdown re-renders; it never
  // toggles the phase itself (avoids clock-drift flip-flop).
  const phaseRef   = useRef(data.mistingCyclePhase ?? 'off');
  const onSecRef   = useRef(data.mistingOnSec  ?? 5);
  const offSecRef  = useRef(data.mistingOffSec ?? 300);
  const endTimeRef = useRef(
    Date.now() + Math.max(0, ((data.mistingCyclePhase === 'on' ? (data.mistingOnSec ?? 5) : (data.mistingOffSec ?? 300)) - (data.mistingCycleElapsed ?? 0))) * 1000
  );
  const [, forceUpdate] = useState(0);

  // Sync refs from server poll — use elapsed-based math (clock-drift-safe)
  useEffect(() => {
    phaseRef.current  = data.mistingCyclePhase ?? 'off';
    onSecRef.current  = data.mistingOnSec  ?? 5;
    offSecRef.current = data.mistingOffSec ?? 300;
    const elapsed  = data.mistingCycleElapsed ?? 0;
    const duration = phaseRef.current === 'on' ? onSecRef.current : offSecRef.current;
    endTimeRef.current = Date.now() + Math.max(0, duration - elapsed) * 1000;
  }, [data]);

  // Smooth countdown ticker — no phase toggling, just re-renders
  useEffect(() => {
    const id = setInterval(() => forceUpdate(n => n + 1), 250);
    return () => clearInterval(id);
  }, []);

  const isActive  = phaseRef.current === 'on';
  const remaining = Math.max(0, Math.ceil((endTimeRef.current - Date.now()) / 1000));

  if (!confirmedPhase || confirmedPhase === 'empty') {
    return (
      <View style={[pcStyles.card, {
        backgroundColor: theme.sectionCardBg,
        borderColor: theme.glassBorder,
      }]}>
        <Text style={[pcStyles.noPlantText, { color: theme.textMuted }]}>
          No plant phase detected yet — the system will automatically
          recognize your plants via the{' '}
          <Text style={{ color: '#4ADE80', fontWeight: '700' }}>Vision</Text>{' '}
          camera.
        </Text>
      </View>
    );
  }

  const cfg   = mistingConfig[confirmedPhase] ?? { onSec: 5, offMin: 2 };
  const color = PHASE_COLOR[confirmedPhase] ?? '#4ADE80';

  return (
    <>
      <View style={[pcStyles.card, {
        backgroundColor: theme.sectionCardBg,
        borderColor: isActive ? (color + '60') : (color + '30'),
      }]}>
        {/* Trash icon — top right */}
        <TouchableOpacity
          style={pcStyles.trashBtn}
          onPress={() => setConfirmVisible(true)}
          activeOpacity={0.7}
          hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
        >
          <MaterialIcons name="delete-outline" size={20} color="#F87171" />
        </TouchableOpacity>

        {/* Phase info */}
        <Text style={[pcStyles.label, { color: theme.textSecondary }]}>
          Your current plants are:
        </Text>
        <View style={[pcStyles.phaseBadge, {
          backgroundColor: color + '15',
          borderColor: color + '40',
        }]}>
          <Text style={[pcStyles.phaseText, { color }]}>
            {PHASE_DISPLAY[confirmedPhase]?.toUpperCase()}
          </Text>
        </View>
        <Text style={[pcStyles.mistingLine, { color: theme.textMuted }]}>
          Mists for{' '}
          <Text style={[pcStyles.highlight, { color: theme.textPrimary }]}>{cfg.onSec}s</Text>
          {'  |  '}Rests for{' '}
          <Text style={[pcStyles.highlight, { color: theme.textPrimary }]}>
            {cfg.offMin} min{cfg.offMin !== 1 ? 's' : ''}
          </Text>
        </Text>

        {/* Divider */}
        <View style={[pcStyles.divider, { backgroundColor: color + '25' }]} />

        {/* Misting status row */}
        <View style={pcStyles.mistingRow}>
          <View style={pcStyles.mistingLeft}>
            <View style={[pcStyles.mistingIndicator, {
              backgroundColor: isActive ? 'rgba(74,222,128,0.15)' : 'rgba(128,128,128,0.1)',
              borderColor:     isActive ? 'rgba(74,222,128,0.4)'  : 'rgba(128,128,128,0.2)',
            }]}>
              <View style={[pcStyles.mistingDot, {
                backgroundColor: isActive ? '#4ADE80' : theme.textMuted,
              }]} />
              <Text style={[pcStyles.mistingStatusText, {
                color: isActive ? '#4ADE80' : theme.textMuted,
              }]}>
                {isActive ? 'Active' : 'Idle'}
              </Text>
            </View>
            <Text style={[pcStyles.mistingLabel, { color: theme.textSecondary }]}>
              Aeroponics Misting
            </Text>
          </View>
          <View style={pcStyles.mistingRight}>
            <Text style={[pcStyles.countdownNum, {
              color: isActive ? '#4ADE80' : theme.statNum,
            }]}>
              {fmtSec(remaining)}
            </Text>
            <Text style={[pcStyles.countdownLabel, { color: theme.textMuted }]}>
              {isActive
                ? `ends ${fmtTime(new Date(endTimeRef.current))}`
                : `next ${fmtTime(new Date(endTimeRef.current))}`}
            </Text>
          </View>
        </View>
      </View>

      <AppModal
        visible={confirmVisible}
        onClose={() => setConfirmVisible(false)}
        type="danger"
        title="Empty Plant Box?"
        message="This will stop all misting immediately. The system will automatically detect new plants when you place them in the box."
        actions={[
          { label: 'Cancel', style: 'ghost', onPress: null },
          { label: 'Empty', style: 'destructive', onPress: () => emptyPlantBox() },
        ]}
      />
    </>
  );
}

const pcStyles = StyleSheet.create({
  card: {
    borderRadius: 16, borderWidth: 1,
    paddingVertical: 14, paddingHorizontal: 16,
    marginBottom: 12, alignItems: 'center', gap: 8,
  },
  trashBtn: {
    position: 'absolute', top: 10, right: 10,
    padding: 6, borderRadius: 8,
    backgroundColor: 'rgba(248,113,113,0.08)',
  },
  label: { fontSize: 12, fontWeight: '600', letterSpacing: 0.2 },
  phaseBadge: {
    paddingHorizontal: 20, paddingVertical: 7,
    borderRadius: 12, borderWidth: 1,
  },
  phaseText: { fontSize: 16, fontWeight: '900', letterSpacing: 1 },
  mistingLine: { fontSize: 13 },
  highlight: { fontWeight: '800' },
  noPlantText: { fontSize: 12, textAlign: 'center', lineHeight: 18 },
  // Merged misting status
  divider: { height: 1, alignSelf: 'stretch', marginVertical: 2 },
  mistingRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', alignSelf: 'stretch',
  },
  mistingLeft: { flex: 1, gap: 4 },
  mistingIndicator: {
    flexDirection: 'row', alignItems: 'center',
    alignSelf: 'flex-start', paddingHorizontal: 10,
    paddingVertical: 4, borderRadius: 20, borderWidth: 1, gap: 6,
  },
  mistingDot: { width: 7, height: 7, borderRadius: 4 },
  mistingStatusText: { fontSize: 12, fontWeight: '700' },
  mistingLabel: { fontSize: 11, fontWeight: '600', letterSpacing: 0.3 },
  mistingRight: { alignItems: 'flex-end', gap: 2 },
  countdownNum: { fontSize: 22, fontWeight: '900', letterSpacing: 0.5 },
  countdownLabel: { fontSize: 10, fontWeight: '600' },
});

export default function DashboardScreen() {
  const { data } = useSensor();
  const theme = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const fadeIn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeIn, { toValue: 1, duration: 600, useNativeDriver: true }).start();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 800);
  };

  return (
    <LinearGradient
      colors={[theme.bgGradientTop, theme.bgGradientBot]}
      style={styles.root}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.light}
            colors={[theme.light]}
          />
        }
      >
        <Animated.View style={{ opacity: fadeIn }}>

          <PlantConfigCard theme={theme} />

          <HerbaBot />

          <View style={styles.sectionHeader}>
            <View style={[styles.sectionDot, { backgroundColor: theme.info }]} />
            <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>
              Reservoir Sensors
            </Text>
          </View>
          <View style={styles.row}>
            <SensorCard
              label="pH Level" sensorKey="ph"
              value={data.reservoir.ph} accentColor="#60A5FA"
              infoTitle="pH Level"
              infoText={
                'pH measures how acidic or alkaline your nutrient solution is, on a scale of 0 (very acidic) to 14 (very alkaline).\n\n'
                + 'Why it matters: Plants can only absorb nutrients within a specific pH range. '
                + 'If the pH drifts too high or too low, nutrients get \u201clocked out\u201d even if they\'re present in the water.\n\n'
                + 'Acceptable range: 5.5\u20136.5 for basil in aeroponics.\n'
                + 'Sweet spot: 5.8\u20136.2 is optimal.\n'
                + '\u2022 pH 5.5\u20135.7 \u2192 add a small dose of pH Up\n'
                + '\u2022 pH 6.3\u20136.5 \u2192 add a small dose of pH Down'
              }
            />
            <SensorCard
              label="TDS" sensorKey="tds"
              value={data.reservoir.tds} accentColor="#34D399"
              tdsTarget={data.tdsTarget}
              infoTitle="TDS (Total Dissolved Solids)"
              infoType="success"
              infoText={
                'TDS measures the total concentration of dissolved minerals and salts in your nutrient solution, reported in parts per million (ppm).\n\n'
                + 'Why it matters: It tells you how nutrient-rich your water is. '
                + 'Too low means your plants are starving; too high can cause nutrient burn or root damage.\n\n'
                + 'Ideal range: Seedlings prefer 400–600 ppm, while vegetative plants thrive at 600–800 ppm. '
                + 'Top up with fresh water to lower TDS, or add nutrients to raise it.'
              }
            />
          </View>

          <View style={styles.sectionHeader}>
            <View style={[styles.sectionDot, { backgroundColor: theme.light }]} />
            <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>
              Environment Sensors
            </Text>
          </View>
          <View style={styles.row}>
            <SensorCard
              label="Temperature" sensorKey="temperature"
              value={data.environment.temperature} accentColor="#FB923C"
            />
            <SensorCard
              label="Humidity" sensorKey="humidity"
              value={data.environment.humidity} accentColor="#A78BFA"
            />
          </View>

          <Text style={[styles.updated, { color: theme.textMuted }]}>
            Last Updated: {new Date(data.lastUpdated).toLocaleTimeString()}
          </Text>

        </Animated.View>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 12, paddingTop: 16, paddingBottom: 32 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8, marginLeft: 6 },
  sectionDot: { width: 6, height: 6, borderRadius: 3 },
  sectionTitle: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  row: { flexDirection: 'row', marginBottom: 20 },
  updated: { textAlign: 'center', fontSize: 11, marginTop: 4, letterSpacing: 0.3 },
});