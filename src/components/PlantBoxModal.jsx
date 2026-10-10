import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSensor } from '../context/SensorContext';
import { useTheme } from '../theme/ThemeContext';

const CLASS_COLORS = {
  Empty:      '#888888',
  Seedling:   '#4ADE80',
  Vegetative: '#60A5FA',
};

function DetectionBadge({ detection, theme }) {
  const color = CLASS_COLORS[detection.className] || '#aaa';
  return (
    <View style={[styles.detBadge, {
      backgroundColor: color + '15',
      borderColor: color + '40',
    }]}>
      <View style={[styles.detDot, { backgroundColor: color }]} />
      <Text style={[styles.detClass, { color }]}>{detection.className}</Text>
      <Text style={[styles.detConf, { color: theme.textMuted }]}>
        {(detection.confidence * 100).toFixed(0)}%
      </Text>
    </View>
  );
}

function SlotCard({ slot, theme }) {
  const color = CLASS_COLORS[slot.class] || '#888';
  return (
    <View style={[styles.slotCard, {
      backgroundColor: theme.isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
      borderColor: color + '30',
    }]}>
      <Text style={[styles.slotNum, { color: theme.textMuted }]}>Slot {slot.slot}</Text>
      <Text style={[styles.slotClass, { color }]}>{slot.class}</Text>
      <Text style={[styles.slotConf, { color: theme.textMuted }]}>
        {slot.confidence > 0 ? `${slot.confidence}%` : '—'}
      </Text>
    </View>
  );
}

export default function PlantBoxModal({ visible, onClose }) {
  const theme = useTheme();
  const { connected, fetchCvStatus, cvFrameUrl } = useSensor();
  const slideAnim = useRef(new Animated.Value(80)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const [cvData, setCvData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [frameKey, setFrameKey] = useState(0);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (visible) {
      slideAnim.setValue(80);
      fadeAnim.setValue(0);
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.spring(slideAnim, { toValue: 0, tension: 70, friction: 12, useNativeDriver: true }),
      ]).start();

      // Start polling CV status
      setLoading(true);
      const poll = async () => {
        const result = await fetchCvStatus();
        if (result) {
          setCvData(result);
          setLoading(false);
        }
        // Refresh the frame image
        setFrameKey(k => k + 1);
      };
      poll();
      intervalRef.current = setInterval(poll, 2000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [visible, fetchCvStatus]);

  const dismiss = () => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 40, duration: 150, useNativeDriver: true }),
    ]).start(() => onClose());
  };

  const detections = cvData?.detections || [];
  const slots = cvData?.slots || [];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={dismiss}
    >
      <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]}>
        <TouchableOpacity style={styles.backdropTouch} activeOpacity={1} onPress={dismiss} />
      </Animated.View>

      <View style={styles.center} pointerEvents="box-none">
        <Animated.View style={[
          styles.card,
          {
            backgroundColor: theme.isDark ? '#0D1F16' : '#F0FAF4',
            borderColor: theme.glassBorder,
            transform: [{ translateY: slideAnim }],
            opacity: fadeAnim,
          },
        ]}>
          <View style={[styles.accentBar, { backgroundColor: '#A78BFA' }]} />

          <Text style={[styles.title, { color: theme.textPrimary }]}>
            Plant Box — CV Monitor
          </Text>

          {!connected ? (
            <View style={styles.offlineWrap}>
              <Text style={styles.offlineIcon}>⚠</Text>
              <Text style={[styles.offlineText, { color: theme.textSecondary }]}>
                Not connected to Pi. CV feed is unavailable.
              </Text>
            </View>
          ) : loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="large" color={theme.light} />
              <Text style={[styles.loadingText, { color: theme.textMuted }]}>
                Connecting to camera...
              </Text>
            </View>
          ) : (
            <View style={styles.contentWrap}>
              {/* Live frame */}
              <View style={[styles.frameWrap, { borderColor: theme.glassBorder }]}>
                <Image
                  key={frameKey}
                  source={{ uri: `${cvFrameUrl}?t=${frameKey}` }}
                  style={styles.frameImage}
                  resizeMode="contain"
                />
                {/* Stats overlay */}
                <View style={styles.statsOverlay}>
                  <Text style={styles.statText}>
                    FPS: {cvData?.fps ?? '—'}
                  </Text>
                  <Text style={styles.statText}>
                    INF: {cvData?.inferenceMs ?? '—'}ms
                  </Text>
                </View>
              </View>

              {/* Phase badge */}
              <View style={styles.phaseRow}>
                <Text style={[styles.phaseLabel, { color: theme.textSecondary }]}>
                  Detected Phase:
                </Text>
                <View style={[styles.phaseBadge, {
                  backgroundColor: 'rgba(74,222,128,0.12)',
                  borderColor: 'rgba(74,222,128,0.3)',
                }]}>
                  <Text style={styles.phaseText}>
                    {(cvData?.plantPhase || 'empty').charAt(0).toUpperCase() +
                     (cvData?.plantPhase || 'empty').slice(1)}
                  </Text>
                </View>
              </View>

              {/* Detections */}
              {detections.length > 0 && (
                <View style={styles.detRow}>
                  {detections.map((d, i) => (
                    <DetectionBadge key={i} detection={d} theme={theme} />
                  ))}
                </View>
              )}

              {/* Slots grid */}
              <View style={styles.slotsGrid}>
                {slots.map((s, i) => (
                  <SlotCard key={i} slot={s} theme={theme} />
                ))}
              </View>
            </View>
          )}

          <View style={[styles.divider, { backgroundColor: theme.divider }]} />

          <TouchableOpacity
            style={[styles.closeBtn, {
              backgroundColor: theme.isDark
                ? 'rgba(255,255,255,0.06)'
                : 'rgba(0,0,0,0.05)',
            }]}
            onPress={dismiss}
            activeOpacity={0.75}
          >
            <Text style={[styles.closeBtnText, { color: theme.textSecondary }]}>Close</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  backdropTouch: { flex: 1 },
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  card: {
    width: '100%',
    maxHeight: '90%',
    borderRadius: 24,
    borderWidth: 1,
    overflow: 'hidden',
    paddingBottom: 16,
  },
  accentBar: { height: 3, width: '100%' },
  title: {
    fontSize: 18, fontWeight: '900',
    textAlign: 'center',
    paddingHorizontal: 24,
    letterSpacing: -0.3,
    marginTop: 20,
    marginBottom: 12,
  },
  contentWrap: { paddingHorizontal: 16 },
  frameWrap: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    backgroundColor: '#000',
    marginBottom: 12,
  },
  frameImage: {
    width: '100%',
    height: 200,
  },
  statsOverlay: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    flexDirection: 'row',
    gap: 10,
  },
  statText: {
    color: '#4ADE80',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  phaseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  phaseLabel: { fontSize: 12, fontWeight: '600' },
  phaseBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
  },
  phaseText: { color: '#4ADE80', fontSize: 12, fontWeight: '700' },
  detRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  detBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    gap: 5,
  },
  detDot: { width: 6, height: 6, borderRadius: 3 },
  detClass: { fontSize: 11, fontWeight: '700' },
  detConf: { fontSize: 10 },
  slotsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  slotCard: {
    width: '31%',
    borderRadius: 10,
    borderWidth: 1,
    padding: 8,
    alignItems: 'center',
  },
  slotNum: { fontSize: 9, fontWeight: '600', marginBottom: 2 },
  slotClass: { fontSize: 12, fontWeight: '800' },
  slotConf: { fontSize: 10, marginTop: 1 },
  offlineWrap: {
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingVertical: 24,
    gap: 12,
  },
  offlineIcon: { fontSize: 32 },
  offlineText: { fontSize: 14, textAlign: 'center', lineHeight: 21 },
  loadingWrap: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 12,
  },
  loadingText: { fontSize: 13 },
  divider: { height: 1, marginHorizontal: 0, marginTop: 8, marginBottom: 12 },
  closeBtn: {
    marginHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  closeBtnText: { fontSize: 15, fontWeight: '700' },
});
