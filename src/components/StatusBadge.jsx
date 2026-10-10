import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import colors from '../theme/colors';

export default function StatusBadge({ status }) {
  const pulse = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0.6)).current;
  const isOnline = status === 'Online';

  useEffect(() => {
    const anim = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.7, duration: 800, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(opacity, { toValue: 0.05, duration: 800, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.6, duration: 800, useNativeDriver: true }),
        ]),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [status]);

  const dotColor = isOnline ? colors.online : colors.offline;

  return (
    <View style={[styles.badge, {
      backgroundColor: isOnline ? 'rgba(13,43,31,0.8)' : 'rgba(40,10,10,0.8)',
      borderColor: isOnline ? 'rgba(74,222,128,0.35)' : 'rgba(248,113,113,0.35)',
    }]}>
      <View style={styles.dotWrap}>
        <Animated.View style={[
          styles.dotRing,
          { backgroundColor: dotColor, transform: [{ scale: pulse }], opacity }
        ]} />
        <View style={[styles.dot, { backgroundColor: dotColor }]} />
      </View>
      <Text style={[styles.label, { color: isOnline ? colors.online : colors.offline }]}>
        {status}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    gap: 7,
    minWidth: 95,
    justifyContent: 'center',
  },
  dotWrap: { width: 12, height: 12, alignItems: 'center', justifyContent: 'center' },
  dotRing: { position: 'absolute', width: 12, height: 12, borderRadius: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { fontWeight: '700', fontSize: 12, letterSpacing: 0.5 },
});
