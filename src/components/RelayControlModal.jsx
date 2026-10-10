import React, { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Animated,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSensor } from '../context/SensorContext';
import { useTheme } from '../theme/ThemeContext';

const RELAY_LABELS = {
  submersible:   { name: 'Submersible',   tag: 'SUB' },
  mist_pump:     { name: 'Mist Pump',     tag: 'MST' },
  peristaltic_1: { name: 'Peristaltic 1', tag: 'P-1' },
  peristaltic_2: { name: 'Peristaltic 2', tag: 'P-2' },
  peristaltic_3: { name: 'Peristaltic 3', tag: 'P-3' },
};

function RelayButton({ relayKey, isOn, onToggle, theme, disabled }) {
  const info = RELAY_LABELS[relayKey] || { name: relayKey, tag: '???' };

  return (
    <TouchableOpacity
      style={[
        styles.relayCard,
        {
          backgroundColor: isOn
            ? 'rgba(74,222,128,0.08)'
            : theme.isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
          borderColor: isOn
            ? 'rgba(74,222,128,0.3)'
            : theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
          opacity: disabled ? 0.4 : 1,
        },
      ]}
      onPress={() => !disabled && onToggle(relayKey, !isOn)}
      activeOpacity={disabled ? 1 : 0.7}
      disabled={disabled}
    >
      <View style={[styles.relayTag, {
        backgroundColor: isOn ? 'rgba(74,222,128,0.15)' : theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
      }]}>
        <Text style={[styles.relayTagText, { color: isOn ? '#4ADE80' : theme.textMuted }]}>{info.tag}</Text>
      </View>
      <View style={styles.relayInfo}>
        <Text style={[styles.relayName, { color: theme.textPrimary }]}>{info.name}</Text>
      </View>
      <View style={[
        styles.statusPill,
        {
          backgroundColor: isOn ? 'rgba(74,222,128,0.15)' : 'rgba(128,128,128,0.1)',
          borderColor: isOn ? 'rgba(74,222,128,0.4)' : 'rgba(128,128,128,0.2)',
        },
      ]}>
        <View style={[
          styles.statusDot,
          { backgroundColor: isOn ? '#4ADE80' : '#666' },
        ]} />
        <Text style={[
          styles.statusLabel,
          { color: isOn ? '#4ADE80' : '#888' },
        ]}>
          {isOn ? 'ON' : 'OFF'}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export default function RelayControlModal({ visible, onClose }) {
  const theme = useTheme();
  const { data, connected, setRelay, refreshNow } = useSensor();
  const slideAnim = useRef(new Animated.Value(80)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [toggling, setToggling] = useState(null);
  // Optimistic relay state overrides while a toggle is in-flight
  const [pendingRelays, setPendingRelays] = useState({});
  // Prevents accidental touches during open animation
  const [ready, setReady] = useState(false);
  const readyTimerRef = useRef(null);

  useEffect(() => {
    if (visible) {
      setReady(false);
      setToggling(null);
      setPendingRelays({});
      slideAnim.setValue(80);
      fadeAnim.setValue(0);
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.spring(slideAnim, { toValue: 0, tension: 70, friction: 12, useNativeDriver: true }),
      ]).start();
      // Allow interaction only after animation settles
      readyTimerRef.current = setTimeout(() => setReady(true), 350);
    } else {
      setReady(false);
      if (readyTimerRef.current) clearTimeout(readyTimerRef.current);
    }
    return () => {
      if (readyTimerRef.current) clearTimeout(readyTimerRef.current);
    };
  }, [visible]);

  const dismiss = () => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 40, duration: 150, useNativeDriver: true }),
    ]).start(() => onClose());
  };

  const handleToggle = async (relayName, newState) => {
    if (!ready || toggling !== null) return;
    setToggling(relayName);
    // Immediately reflect the intended new state so the card doesn't look stuck
    setPendingRelays(prev => ({ ...prev, [relayName]: newState }));
    await setRelay(relayName, newState);
    // Re-fetch immediately so the button reflects the actual Pi state
    // (not just the optimistic local update), catching any server-side overrides.
    await refreshNow();
    setPendingRelays(prev => { const n = { ...prev }; delete n[relayName]; return n; });
    setToggling(null);
  };

  const relays = data.relays || {};

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
          <View style={[styles.accentBar, { backgroundColor: '#60A5FA' }]} />

          <Text style={[styles.title, { color: theme.textPrimary }]}>
            Manual Relay Control
          </Text>

          {!connected ? (
            <View style={styles.offlineWrap}>
              <Text style={[styles.offlineText, { color: theme.textSecondary }]}>
                Not connected to Pi. Relay controls are unavailable.
              </Text>
            </View>
          ) : (
            <ScrollView style={styles.relayList} showsVerticalScrollIndicator={false}>
              {Object.keys(RELAY_LABELS).map((key) => (
                <RelayButton
                  key={key}
                  relayKey={key}
                  isOn={key in pendingRelays ? pendingRelays[key] : !!relays[key]}
                  onToggle={handleToggle}
                  theme={theme}
                  disabled={!ready || toggling !== null}
                />
              ))}
              {toggling !== null && (
                <View style={styles.togglingRow}>
                  <ActivityIndicator size="small" color={theme.light} />
                  <Text style={[styles.togglingText, { color: theme.textMuted }]}>
                    Sending command...
                  </Text>
                </View>
              )}
            </ScrollView>
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
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxHeight: '80%',
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
    marginBottom: 16,
  },
  relayList: { paddingHorizontal: 16, maxHeight: 380 },
  relayCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 8,
    gap: 12,
  },
  relayTag: {
    width: 44, height: 36, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  relayTagText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  relayInfo: { flex: 1 },
  togglingRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 8, paddingVertical: 8,
  },
  togglingText: { fontSize: 12 },
  relayName: { fontSize: 14, fontWeight: '700' },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    gap: 5,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusLabel: { fontSize: 11, fontWeight: '800' },
  offlineWrap: {
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingVertical: 24,
    gap: 12,
  },
  offlineText: { fontSize: 14, textAlign: 'center', lineHeight: 21 },
  divider: { height: 1, marginHorizontal: 0, marginTop: 8, marginBottom: 12 },
  closeBtn: {
    marginHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  closeBtnText: { fontSize: 15, fontWeight: '700' },
});
