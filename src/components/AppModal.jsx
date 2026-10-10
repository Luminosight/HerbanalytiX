import React, { useEffect, useRef } from 'react';
import {
    Animated, Dimensions,
    Modal,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useTheme } from '../theme/ThemeContext';

const { height } = Dimensions.get('window');

/**
 * Universal HerbanalytiX Modal
 *
 * Props:
 * - visible: boolean
 * - onClose: () => void
 * - title: string
 * - message: string
 * - type: 'info' | 'warning' | 'danger' | 'success'  (default: 'info')
 * - actions: [{ label: string, onPress: () => void, style: 'primary' | 'destructive' | 'ghost' }]
 */

const TYPE_CONFIG = {
  info:    { color: '#60A5FA', icon: 'ℹ',  bg: 'rgba(96,165,250,0.12)'  },
  success: { color: '#4ADE80', icon: '✓',  bg: 'rgba(74,222,128,0.12)'  },
  warning: { color: '#FBBF24', icon: '!',  bg: 'rgba(251,191,36,0.12)'  },
  danger:  { color: '#F87171', icon: '✕',  bg: 'rgba(248,113,113,0.12)' },
};

export default function AppModal({
  visible,
  onClose,
  title,
  message,
  type = 'info',
  icon,
  actions = [],
}) {
  const theme = useTheme();
  const slideAnim = useRef(new Animated.Value(60)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.95)).current;

  const baseCfg = TYPE_CONFIG[type] ?? TYPE_CONFIG.info;
  const cfg = icon ? { ...baseCfg, icon } : baseCfg;

  useEffect(() => {
    if (visible) {
      slideAnim.setValue(60);
      fadeAnim.setValue(0);
      scaleAnim.setValue(0.95);
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.spring(slideAnim, { toValue: 0, tension: 70, friction: 12, useNativeDriver: true }),
        Animated.spring(scaleAnim, { toValue: 1, tension: 70, friction: 12, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const dismiss = (onPress) => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 40, duration: 150, useNativeDriver: true }),
    ]).start(() => {
      onClose();
      if (onPress) onPress();
    });
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={() => dismiss(null)}
    >
      {/* Backdrop */}
      <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]}>
        <TouchableOpacity style={styles.backdropTouch} activeOpacity={1} onPress={() => dismiss(null)} />
      </Animated.View>

      {/* Card */}
      <View style={styles.center} pointerEvents="box-none">
        <Animated.View style={[
          styles.card,
          {
            backgroundColor: theme.isDark ? '#0D1F16' : '#F0FAF4',
            borderColor: theme.glassBorder,
            transform: [{ translateY: slideAnim }, { scale: scaleAnim }],
            opacity: fadeAnim,
          },
        ]}>
          {/* Top accent bar */}
          <View style={[styles.accentBar, { backgroundColor: cfg.color }]} />

          {/* Icon */}
          <View style={[styles.iconWrap, {
            backgroundColor: cfg.bg,
            borderColor: cfg.color + '44',
          }]}>
            <Text style={[styles.iconText, { color: cfg.color }]}>{cfg.icon}</Text>
          </View>

          {/* Content */}
          <Text style={[styles.title, { color: theme.textPrimary }]}>{title}</Text>
          {message ? (
            <Text style={[styles.message, { color: theme.textSecondary }]}>{message}</Text>
          ) : null}

          {/* Divider */}
          <View style={[styles.divider, { backgroundColor: theme.divider }]} />

          {/* Actions */}
          <View style={[
            styles.actions,
            actions.length === 2 && styles.actionsRow,
          ]}>
            {actions.map((action, i) => (
              <TouchableOpacity
                key={i}
                style={[
                  styles.actionBtn,
                  actions.length === 2 && styles.actionBtnHalf,
                  action.style === 'primary' && { backgroundColor: cfg.color },
                  action.style === 'destructive' && {
                    backgroundColor: 'rgba(248,113,113,0.12)',
                    borderWidth: 1,
                    borderColor: '#F8717144',
                  },
                  action.style === 'ghost' && {
                    backgroundColor: theme.isDark
                      ? 'rgba(255,255,255,0.06)'
                      : 'rgba(0,0,0,0.05)',
                  },
                ]}
                onPress={() => dismiss(action.onPress)}
                activeOpacity={0.75}
              >
                <Text style={[
                  styles.actionText,
                  action.style === 'primary' && { color: '#FFFFFF' },
                  action.style === 'destructive' && { color: '#F87171' },
                  action.style === 'ghost' && { color: theme.textSecondary },
                ]}>
                  {action.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
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
    paddingHorizontal: 28,
  },
  card: {
    width: '100%',
    borderRadius: 24,
    borderWidth: 1,
    overflow: 'hidden',
    paddingBottom: 20,
  },
  accentBar: { height: 3, width: '100%' },
  iconWrap: {
    width: 52, height: 52, borderRadius: 26,
    alignSelf: 'center',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
    marginTop: 24, marginBottom: 16,
  },
  iconText: { fontSize: 22, fontWeight: '800' },
  title: {
    fontSize: 18, fontWeight: '900',
    textAlign: 'center',
    paddingHorizontal: 24,
    letterSpacing: -0.3,
    marginBottom: 10,
  },
  message: {
    fontSize: 14, lineHeight: 22,
    textAlign: 'center',
    paddingHorizontal: 24,
    marginBottom: 20,
  },
  divider: { height: 1, marginHorizontal: 0, marginBottom: 16 },
  actions: { paddingHorizontal: 20, gap: 10 },
  actionsRow: { flexDirection: 'row', gap: 10 },
  actionBtn: {
    paddingVertical: 14,
    borderRadius: 14, alignItems: 'center',
  },
  actionBtnHalf: { flex: 1 },
  actionText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
});