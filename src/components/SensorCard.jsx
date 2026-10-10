import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { SENSOR_RANGES, getSensorStatus } from '../utils/mockSensors';
import AppModal from './AppModal';

const getStatusConfig = (theme) => ({
  normal:    { color: theme.statusNormal,  label: 'Normal',      bg: theme.statusNormal  + '22' },
  warning:   { color: theme.statusWarning, label: 'Check Level', bg: theme.statusWarning + '22' },
  danger:    { color: theme.statusDanger,  label: 'Critical',    bg: theme.statusDanger  + '22' },
  too_basic: { color: theme.statusWarning, label: 'Too Basic',   bg: theme.statusWarning + '22' },
  too_acidic:{ color: theme.statusWarning, label: 'Too Acidic',  bg: theme.statusWarning + '22' },
  too_humid: { color: theme.statusWarning, label: 'Too Humid',   bg: theme.statusWarning + '22' },
  too_arid:  { color: theme.statusWarning, label: 'Too Arid',    bg: theme.statusWarning + '22' },
});

export default function SensorCard({ label, value, sensorKey, accentColor, infoTitle, infoText, infoType = 'info', tdsTarget }) {
  const theme = useTheme();
  const [infoVisible, setInfoVisible] = useState(false);
  let range = SENSOR_RANGES[sensorKey] ?? { min: 0, max: 100, unit: '', ideal: '--' };

  // Phase-dependent TDS override: use tdsTarget from server when available
  if (sensorKey === 'tds' && tdsTarget && tdsTarget.min != null && tdsTarget.max != null) {
    range = { ...range, min: tdsTarget.min, max: tdsTarget.max, ideal: `${tdsTarget.min}–${tdsTarget.max}` };
  }
  const hasTdsTarget = sensorKey !== 'tds' || (tdsTarget && tdsTarget.min != null);

  const status = getSensorStatus(sensorKey, value, range);
  const STATUS_CONFIG = getStatusConfig(theme);
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.normal;
  const unit = range.unit;

  const fadeAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.timing(fadeAnim, { toValue: 0.4, duration: 150, useNativeDriver: true }),
      Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();
  }, [value]);

  const v = parseFloat(value) || 0;
  const progress = Math.min(
    Math.max((v - range.min * 0.85) / ((range.max * 1.15) - range.min * 0.85), 0), 1
  );

  return (
    <View style={styles.cardWrap}>
      <LinearGradient
        colors={theme.cardBg}
        style={[styles.card, { borderColor: theme.cardBorder }]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={[styles.topBar, { backgroundColor: accentColor }]} />

        <View style={styles.labelRow}>
          <Text style={[styles.label, { color: theme.textSecondary }]}>{label}</Text>
          {infoText ? (
            <TouchableOpacity
              onPress={() => setInfoVisible(true)}
              activeOpacity={0.7}
              hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
              style={[styles.infoBtn, { backgroundColor: accentColor + '18', borderColor: accentColor + '40' }]}
            >
              <MaterialIcons name="info-outline" size={13} color={accentColor} />
            </TouchableOpacity>
          ) : null}
        </View>

        <Animated.Text style={[styles.value, { opacity: fadeAnim, color: accentColor }]}>
          {value}<Text style={[styles.unit, { color: accentColor }]}>{unit}</Text>
        </Animated.Text>

        <View style={[styles.progressBg, { backgroundColor: theme.glassWhite }]}>
          <View style={[styles.progressFill, {
            width: `${progress * 100}%`,
            backgroundColor: accentColor,
          }]} />
        </View>

        {hasTdsTarget ? (
          <Text style={[styles.ideal, { color: theme.textMuted }]}>
            Ideal: {range.ideal}{unit}
          </Text>
        ) : (
          <Text style={[styles.ideal, { color: 'transparent' }]}>{' '}</Text>
        )}

        {hasTdsTarget ? (
          <View style={[styles.statusBadge, {
            backgroundColor: cfg.bg,
            borderColor: cfg.color + '55',
          }]}>
            <Text style={[styles.statusText, { color: cfg.color }]}>{cfg.label}</Text>
          </View>
        ) : null}
      </LinearGradient>

      {infoText ? (
        <AppModal
          visible={infoVisible}
          onClose={() => setInfoVisible(false)}
          type={infoType}
          icon="ℹ"
          title={infoTitle || label}
          message={infoText}
          actions={[{ label: 'Got it', style: 'primary', onPress: null }]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  cardWrap: { flex: 1, margin: 6 },
  card: {
    borderRadius: 24, padding: 16,
    borderWidth: 1, overflow: 'hidden', minHeight: 190,
  },
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    height: 3, borderTopLeftRadius: 24, borderTopRightRadius: 24, opacity: 0.8,
  },
  labelRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginTop: 8, marginBottom: 8,
  },
  label: {
    fontSize: 12, fontWeight: '700',
    letterSpacing: 0.5, textTransform: 'uppercase',
    flex: 1,
  },
  infoBtn: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, marginLeft: 4,
  },
  value: { fontSize: 36, fontWeight: '900', letterSpacing: -1, marginBottom: 12 },
  unit: { fontSize: 16, fontWeight: '600' },
  progressBg: { height: 4, borderRadius: 2, marginBottom: 6, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 2, opacity: 0.7 },
  ideal: { fontSize: 10, marginBottom: 10 },
  statusBadge: {
    alignSelf: 'flex-start', paddingHorizontal: 10,
    paddingVertical: 4, borderRadius: 10, borderWidth: 1,
  },
  statusText: { fontSize: 11, fontWeight: '700' },
});