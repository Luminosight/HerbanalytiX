import dayjs from 'dayjs';
import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import StatusBadge from './StatusBadge';

export default function Header({ status }) {
  const [time, setTime] = useState(dayjs());
  const insets = useSafeAreaInsets();
  const theme = useTheme();

  useEffect(() => {
    const t = setInterval(() => setTime(dayjs()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <View style={[styles.container, {
      paddingTop: insets.top + 8,
      backgroundColor: theme.bgDark,
      borderBottomColor: theme.headerBorder,
    }]}>
      <View style={[styles.glass, { backgroundColor: theme.headerBg }]} />

      <StatusBadge status={status} />

      <Image
        source={require('../../assets/images/hxg.png')}
        style={styles.logo}
        resizeMode="contain"
      />

      <View style={styles.clockWrap}>
        <Text style={[styles.time, { color: theme.light }]}>
          {time.format('hh')}
          <Text style={{ color: theme.teal, opacity: 0.7 }}> : </Text>
          {time.format('mm')}
          <Text style={{ color: theme.teal, opacity: 0.7 }}> : </Text>
          {time.format('ss')}
          <Text style={[styles.ampm, { color: theme.teal }]}> {time.format('A')}</Text>
        </Text>
        <Text style={[styles.date, { color: theme.textSecondary }]}>
          {time.format('MMMM DD, YYYY')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    elevation: 12,
  },
  glass: { ...StyleSheet.absoluteFillObject },
  logo: { width: 120, height: 36 },
  clockWrap: { alignItems: 'flex-end' },
  time: { fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  ampm: { fontSize: 11, fontWeight: '700' },
  date: { fontSize: 9, fontWeight: '600', marginTop: 2, letterSpacing: 0.3 },
});