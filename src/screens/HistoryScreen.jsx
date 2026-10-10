import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import {
    Dimensions,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { useSensor } from '../context/SensorContext';
import { useTheme } from '../theme/ThemeContext';

const { width } = Dimensions.get('window');
const CHART_WIDTH = width - 48;

const SENSORS = [
  { key: 'ph',          label: 'pH Level',    unit: '',     color: '#60A5FA', accessor: h => parseFloat(h.reservoir.ph) || 0 },
  { key: 'tds',         label: 'TDS',         unit: ' ppm', color: '#34D399', accessor: h => parseFloat(h.reservoir.tds) || 0 },
  { key: 'temperature', label: 'Temperature', unit: '°C',   color: '#FB923C', accessor: h => parseFloat(h.environment.temperature) || 0 },
  { key: 'humidity',    label: 'Humidity',    unit: '%',    color: '#A78BFA', accessor: h => parseFloat(h.environment.humidity) || 0 },
];

function formatTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  const s = d.getSeconds().toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function StatBox({ label, value, unit, color, theme }) {
  return (
    <View style={[styles.statBox, {
      backgroundColor: theme.glassWhite,
      borderColor: color + '44',
    }]}>
      <Text style={[styles.statValue, { color }]}>
        {value}<Text style={[styles.statUnit, { color: theme.textMuted }]}>{unit}</Text>
      </Text>
      <Text style={[styles.statLabel, { color: theme.textMuted }]}>{label}</Text>
    </View>
  );
}

function SensorChart({ sensor, history, theme }) {
  // Filter out entries with placeholder '--' values before charting
  const validHistory = history.filter(h => {
    const v = sensor.accessor(h);
    return v !== 0 && !isNaN(v);
  });
  const values = validHistory.map(sensor.accessor);

  if (values.length < 2) {
    return (
      <View style={styles.waitingWrap}>
        <Text style={styles.waitingIcon}>⏳</Text>
        <Text style={[styles.waitingText, { color: theme.textMuted }]}>
          Waiting for data...
        </Text>
        <Text style={[styles.waitingSub, { color: theme.textMuted }]}>
          Readings update every 10 seconds
        </Text>
      </View>
    );
  }

  const displayValues = values.slice(-12);
  const displayHistory = validHistory.slice(-12);

  const minVal = Math.min(...displayValues);
  const maxVal = Math.max(...displayValues);
  const avgVal = displayValues.reduce((a, b) => a + b, 0) / displayValues.length;
  const latest = displayValues[displayValues.length - 1];
  const decimals = sensor.key === 'tds' ? 0 : 1;

  // Only label every 3rd point to avoid clutter
  const labels = displayHistory.map((h, i) =>
    i % 3 === 0 ? formatTime(h.lastUpdated).slice(0, 5) : ''
  );

  const chartConfig = {
    backgroundGradientFrom: 'transparent',
    backgroundGradientTo: 'transparent',
    backgroundGradientFromOpacity: 0,
    backgroundGradientToOpacity: 0,
    color: (opacity = 1) => {
      const hex = Math.round(opacity * 255).toString(16).padStart(2, '0');
      return sensor.color + hex;
    },
    labelColor: () => theme.textMuted,
    strokeWidth: 2.5,
    propsForDots: {
      r: '4',
      strokeWidth: '2',
      stroke: sensor.color,
      fill: theme.isDark ? '#061410' : '#E8F5EE',
    },
    propsForBackgroundLines: {
      stroke: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)',
      strokeDasharray: '4',
    },
    decimalPlaces: decimals,
    fillShadowGradient: sensor.color,
    fillShadowGradientOpacity: 0.2,
  };

  return (
    <View>
      {/* Stats row */}
      <View style={styles.statsRow}>
        <StatBox label="Latest" value={latest.toFixed(decimals)} unit={sensor.unit} color={sensor.color} theme={theme} />
        <StatBox label="Average" value={avgVal.toFixed(decimals)} unit={sensor.unit} color={sensor.color} theme={theme} />
        <StatBox label="Min" value={minVal.toFixed(decimals)} unit={sensor.unit} color={sensor.color} theme={theme} />
        <StatBox label="Max" value={maxVal.toFixed(decimals)} unit={sensor.unit} color={sensor.color} theme={theme} />
      </View>

      {/* Line chart */}
      <LineChart
        data={{ labels, datasets: [{ data: displayValues }] }}
        width={CHART_WIDTH + 16}
        height={180}
        chartConfig={chartConfig}
        bezier
        style={styles.chart}
        withInnerLines={true}
        withOuterLines={false}
        withShadow={true}
        fromZero={false}
      />
    </View>
  );
}

export default function HistoryScreen() {
  const theme = useTheme();
  const { history } = useSensor();
  const [activeTab, setActiveTab] = useState('ph');

  const activeSensor = SENSORS.find(s => s.key === activeTab);

  return (
    <LinearGradient
      colors={[theme.bgGradientTop, theme.bgGradientBot]}
      style={styles.root}
    >
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* Page header */}
        <View style={styles.pageHeader}>
          <Text style={[styles.pageTitle, { color: theme.textPrimary }]}>Sensor History</Text>
          <View style={[styles.countBadge, { backgroundColor: theme.glassWhite, borderColor: theme.glassBorder }]}>
            <Text style={[styles.countText, { color: theme.light }]}>
              {history.length} readings
            </Text>
          </View>
        </View>
        <Text style={[styles.pageSub, { color: theme.textMuted }]}>
          Averaged values · published every 10s
        </Text>

        {/* Sensor selector tabs */}
        <View style={[styles.tabRow, {
          backgroundColor: theme.sectionCardBg,
          borderColor: theme.glassBorder,
        }]}>
          {SENSORS.map(s => (
            <TouchableOpacity
              key={s.key}
              style={[
                styles.tab,
                activeTab === s.key && {
                  backgroundColor: s.color + '22',
                  borderColor: s.color + '66',
                },
              ]}
              onPress={() => setActiveTab(s.key)}
              activeOpacity={0.7}
            >
              <Text style={[
                styles.tabText,
                { color: activeTab === s.key ? s.color : theme.textMuted },
              ]}>
                {s.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Chart card */}
        <View style={[styles.chartCard, {
          backgroundColor: theme.sectionCardBg,
          borderColor: theme.glassBorder,
        }]}>
          <View style={styles.chartHeader}>
            <View style={[styles.chartDot, { backgroundColor: activeSensor.color }]} />
            <Text style={[styles.chartTitle, { color: theme.textPrimary }]}>
              {activeSensor.label}
            </Text>
            <Text style={[styles.chartUnit, { color: theme.textMuted }]}>
              {activeSensor.unit || 'value'} · last 12 readings
            </Text>
          </View>

          <SensorChart sensor={activeSensor} history={history} theme={theme} />
        </View>

        {/* Recent readings table */}
        <View style={[styles.tableCard, {
          backgroundColor: theme.sectionCardBg,
          borderColor: theme.glassBorder,
        }]}>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableTitle, { color: theme.textPrimary }]}>
              Recent Readings
            </Text>
            <Text style={[styles.tableSub, { color: theme.textMuted }]}>
              newest first
            </Text>
          </View>

          {/* Column headers */}
          <View style={[styles.tableRow, styles.tableHead, { borderBottomColor: theme.glassBorder }]}>
            <Text style={[styles.colHead, { color: theme.textMuted, flex: 1.6 }]}>Time</Text>
            <Text style={[styles.colHead, { color: '#60A5FA' }]}>pH</Text>
            <Text style={[styles.colHead, { color: '#34D399' }]}>TDS</Text>
            <Text style={[styles.colHead, { color: '#FB923C' }]}>Temp</Text>
            <Text style={[styles.colHead, { color: '#A78BFA' }]}>Hum</Text>
          </View>

          {history.length === 0 ? (
            <View style={styles.noDataWrap}>
              <Text style={[styles.noData, { color: theme.textMuted }]}>
                ⏳ Waiting for first reading...
              </Text>
            </View>
          ) : (
            [...history].reverse().slice(0, 12).map((h, i) => (
              <View
                key={i}
                style={[
                  styles.tableRow,
                  { borderBottomColor: theme.divider },
                  i === 0 && { backgroundColor: theme.glassWhite, borderRadius: 8 },
                ]}
              >
                <Text style={[styles.tableCell, { color: theme.textSecondary, flex: 1.6 }]}>
                  {formatTime(h.lastUpdated)}
                </Text>
                <Text style={[styles.tableCell, { color: '#60A5FA' }]}>
                  {h.reservoir.ph}
                </Text>
                <Text style={[styles.tableCell, { color: '#34D399' }]}>
                  {h.reservoir.tds}
                </Text>
                <Text style={[styles.tableCell, { color: '#FB923C' }]}>
                  {h.environment.temperature}°
                </Text>
                <Text style={[styles.tableCell, { color: '#A78BFA' }]}>
                  {h.environment.humidity}%
                </Text>
              </View>
            ))
          )}
        </View>

      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },

  pageHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  pageTitle: { fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  countBadge: {
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 10, borderWidth: 1,
  },
  countText: { fontSize: 12, fontWeight: '700' },
  pageSub: { fontSize: 12, marginBottom: 16 },

  // Tabs
  tabRow: {
    flexDirection: 'row', borderRadius: 14,
    borderWidth: 1, padding: 4, marginBottom: 16, gap: 4,
  },
  tab: {
    flex: 1, paddingVertical: 8, borderRadius: 10,
    alignItems: 'center', borderWidth: 1, borderColor: 'transparent',
  },
  tabText: { fontSize: 10, fontWeight: '700' },

  // Chart card
  chartCard: {
    borderRadius: 20, borderWidth: 1,
    padding: 16, marginBottom: 16, overflow: 'hidden',
  },
  chartHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  chartDot: { width: 8, height: 8, borderRadius: 4 },
  chartTitle: { fontSize: 15, fontWeight: '800', flex: 1 },
  chartUnit: { fontSize: 11 },
  chart: { borderRadius: 12, marginLeft: -16 },

  waitingWrap: { height: 180, alignItems: 'center', justifyContent: 'center', gap: 8 },
  waitingIcon: { fontSize: 32 },
  waitingText: { fontSize: 15, fontWeight: '700' },
  waitingSub: { fontSize: 12 },

  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  statBox: { flex: 1, borderRadius: 12, borderWidth: 1, padding: 10, alignItems: 'center' },
  statValue: { fontSize: 15, fontWeight: '900' },
  statUnit: { fontSize: 10, fontWeight: '600' },
  statLabel: { fontSize: 9, fontWeight: '600', marginTop: 2, textTransform: 'uppercase' },

  // Table
  tableCard: { borderRadius: 20, borderWidth: 1, overflow: 'hidden', padding: 16 },
  tableHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  tableTitle: { fontSize: 14, fontWeight: '800' },
  tableSub: { fontSize: 11 },
  tableRow: {
    flexDirection: 'row', paddingVertical: 10,
    paddingHorizontal: 4, borderBottomWidth: 1,
  },
  tableHead: { borderBottomWidth: 1.5, marginBottom: 2 },
  colHead: { flex: 1, fontSize: 10, fontWeight: '800', textAlign: 'center', textTransform: 'uppercase' },
  tableCell: { flex: 1, fontSize: 12, fontWeight: '600', textAlign: 'center' },
  noDataWrap: { paddingVertical: 30, alignItems: 'center' },
  noData: { fontSize: 13 },
});