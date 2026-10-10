import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Image,
    KeyboardAvoidingView,
    Modal,
    Platform,
    ScrollView, StyleSheet, Switch, Text, TextInput,
    TouchableOpacity, View,
} from 'react-native';
import AppModal from '../components/AppModal';
import ConductivityTestModal from '../components/ConductivityTestModal';
import PumpCalibrationModal from '../components/PumpCalibrationModal';
import RelayControlModal from '../components/RelayControlModal';
import { DEFAULT_MISTING_CONFIG, usePlantConfig } from '../context/PlantConfigContext';
import { useSensor } from '../context/SensorContext';
import { useTheme } from '../theme/ThemeContext';
import { triggerReset } from '../utils/resetStore';

const PHASE_LIST = [
  { key: 'seedling',   label: 'Seedlings',         color: '#4ADE80' },
  { key: 'vegetative', label: 'Vegetative Plants',  color: '#60A5FA' },
];

function Stepper({ label, value, onInc, onDec, min, max, unit, theme }) {
  return (
    <View style={stepStyles.row}>
      <Text style={[stepStyles.fieldLabel, { color: theme.textMuted }]}>{label}</Text>
      <View style={stepStyles.controls}>
        <TouchableOpacity
          style={[stepStyles.btn, { borderColor: theme.glassBorder, opacity: value <= min ? 0.35 : 1 }]}
          onPress={onDec} disabled={value <= min} activeOpacity={0.7}
        >
          <Text style={[stepStyles.btnTxt, { color: theme.textPrimary }]}>−</Text>
        </TouchableOpacity>
        <Text style={[stepStyles.val, { color: theme.textPrimary }]}>{value}{unit}</Text>
        <TouchableOpacity
          style={[stepStyles.btn, { borderColor: theme.glassBorder, opacity: value >= max ? 0.35 : 1 }]}
          onPress={onInc} disabled={value >= max} activeOpacity={0.7}
        >
          <Text style={[stepStyles.btnTxt, { color: theme.textPrimary }]}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const stepStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingVertical: 6,
  },
  fieldLabel: { fontSize: 13, fontWeight: '600', flex: 1 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  btn: {
    width: 34, height: 34, borderRadius: 9, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  btnTxt: { fontSize: 20, fontWeight: '600', lineHeight: 24 },
  val: { fontSize: 15, fontWeight: '800', minWidth: 44, textAlign: 'center' },
});

function MistingIntervalsModal({ visible, onClose, theme }) {
  const { mistingConfig, setMistingConfig } = usePlantConfig();
  const [local, setLocal] = useState(() => ({ ...mistingConfig }));

  // Sync local state when modal opens
  React.useEffect(() => {
    if (visible) setLocal({ ...mistingConfig });
  }, [visible]);

  const update = (phase, field, delta) => {
    setLocal(prev => ({
      ...prev,
      [phase]: { ...prev[phase], [field]: prev[phase][field] + delta },
    }));
  };

  const handleSave = () => {
    setMistingConfig(local);
    onClose();
  };

  const handleReset = () => {
    setLocal({ ...DEFAULT_MISTING_CONFIG });
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={miStyles.backdrop}>
        <View style={[miStyles.sheet, {
          backgroundColor: theme.isDark ? '#0D1F16' : '#F0FAF4',
          borderColor: theme.glassBorder,
        }]}>
          <View style={[miStyles.accentBar, { backgroundColor: '#60A5FA' }]} />

          <Text style={[miStyles.title, { color: theme.textPrimary }]}>
            Misting Intervals
          </Text>

          {/* Ideal note */}
          <View style={[miStyles.noteBox, {
            backgroundColor: theme.isDark ? 'rgba(96,165,250,0.08)' : 'rgba(96,165,250,0.1)',
            borderColor: 'rgba(96,165,250,0.25)',
          }]}>
            <Text style={[miStyles.noteText, { color: theme.textSecondary }]}>
              These are already the{' '}
              <Text style={{ color: '#60A5FA', fontWeight: '700' }}>ideal intervals</Text>{' '}
              for each growth phase. You may adjust them depending on the
              development of your plants' roots.
            </Text>
          </View>

          {/* Phase cards */}
          <View style={miStyles.phaseCardsWrap}>
            {PHASE_LIST.map(({ key, label, color }) => (
              <View key={key} style={[miStyles.phaseCard, {
                backgroundColor: theme.isDark
                  ? 'rgba(255,255,255,0.03)'
                  : 'rgba(0,0,0,0.03)',
                borderColor: color + '30',
              }]}>
                {/* Phase tag header */}
                <View style={[miStyles.phaseTag, {
                  backgroundColor: color + '15',
                  borderColor: color + '40',
                }]}>
                  <Text style={[miStyles.phaseTagTxt, { color }]}>{label}</Text>
                </View>

                {/* Steppers */}
                <View style={miStyles.steppersWrap}>
                  <Stepper
                    label="Mist on for"
                    value={local[key]?.onSec ?? 5}
                    min={1} max={60} unit="s"
                    onInc={() => update(key, 'onSec',  1)}
                    onDec={() => update(key, 'onSec', -1)}
                    theme={theme}
                  />
                  <View style={[miStyles.innerDivider, { backgroundColor: theme.divider }]} />
                  <Stepper
                    label="Rest for"
                    value={local[key]?.offMin ?? 5}
                    min={1} max={60} unit="m"
                    onInc={() => update(key, 'offMin',  1)}
                    onDec={() => update(key, 'offMin', -1)}
                    theme={theme}
                  />
                </View>
              </View>
            ))}
          </View>

          {/* Buttons */}
          <TouchableOpacity
            style={[miStyles.resetBtn, { borderColor: theme.glassBorder }]}
            onPress={handleReset} activeOpacity={0.7}
          >
            <Text style={[miStyles.resetBtnTxt, { color: theme.textMuted }]}>↺  Reset to Defaults</Text>
          </TouchableOpacity>
          <View style={miStyles.btnRow}>
            <TouchableOpacity
              style={[miStyles.btn, miStyles.btnGhost, { borderColor: theme.glassBorder }]}
              onPress={onClose} activeOpacity={0.7}
            >
              <Text style={[miStyles.btnTxt, { color: theme.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[miStyles.btn, miStyles.btnPrimary]}
              onPress={handleSave} activeOpacity={0.7}
            >
              <Text style={[miStyles.btnTxt, { color: '#fff' }]}>Save Changes</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const miStyles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderWidth: 1, overflow: 'hidden', paddingBottom: 36,
  },
  accentBar: { height: 4 },
  title: {
    fontSize: 19, fontWeight: '900',
    marginHorizontal: 20, marginTop: 20, marginBottom: 12,
    letterSpacing: -0.3,
  },
  noteBox: {
    marginHorizontal: 20, marginBottom: 14,
    padding: 12, borderRadius: 12, borderWidth: 1,
  },
  noteText: { fontSize: 12, lineHeight: 18 },

  // Phase cards
  phaseCardsWrap: { gap: 10, marginHorizontal: 20, marginBottom: 6 },
  phaseCard: {
    borderRadius: 14, borderWidth: 1,
    paddingHorizontal: 14, paddingTop: 12, paddingBottom: 10,
    gap: 10,
  },
  phaseTag: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 10, borderWidth: 1,
  },
  phaseTagTxt: { fontSize: 12, fontWeight: '800' },
  steppersWrap: { gap: 0 },
  innerDivider: { height: 1, marginVertical: 2 },

  // Buttons
  resetBtn: {
    marginHorizontal: 20, marginTop: 14, marginBottom: 10,
    paddingVertical: 10, borderRadius: 12, borderWidth: 1,
    alignItems: 'center',
  },
  resetBtnTxt: { fontSize: 13, fontWeight: '600' },
  btnRow: {
    flexDirection: 'row', gap: 10,
    marginHorizontal: 20,
  },
  btn: {
    flex: 1, paddingVertical: 13, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
  },
  btnGhost: { borderWidth: 1 },
  btnPrimary: { backgroundColor: '#2D6A4F' },
  btnTxt: { fontSize: 14, fontWeight: '700' },
});

// AM/PM helpers
const to12 = (hour24) => ({ h12: hour24 % 12 || 12, ampm: hour24 < 12 ? 'AM' : 'PM' });
const to24 = (h12, ampm) =>
  ampm === 'AM' ? (h12 === 12 ? 0 : h12) : (h12 === 12 ? 12 : h12 + 12);
const fmt12 = (t) => {
  const { h12, ampm } = to12(t.hour);
  return `${h12}:${String(t.minute).padStart(2, '0')} ${ampm}`;
};

const DRUM_ITEM_H = 46;
const DRUM_H = DRUM_ITEM_H * 3;
const WHEEL_HOURS   = ['01','02','03','04','05','06','07','08','09','10','11','12'];
const WHEEL_MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));
const WHEEL_AMPM    = ['AM', 'PM'];

function WheelColumn({ items, selectedIndex, onChange, theme, width }) {
  const scrollRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: selectedIndex * DRUM_ITEM_H, animated: false });
    }, 60);
    return () => clearTimeout(t);
  }, [selectedIndex]);

  const handleScrollEnd = (e) => {
    const idx = Math.max(0, Math.min(
      Math.round(e.nativeEvent.contentOffset.y / DRUM_ITEM_H),
      items.length - 1,
    ));
    onChange(idx);
  };

  return (
    <View style={{ width, height: DRUM_H, overflow: 'hidden' }}>
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        snapToInterval={DRUM_ITEM_H}
        decelerationRate="fast"
        contentContainerStyle={{ paddingVertical: DRUM_ITEM_H }}
        onMomentumScrollEnd={handleScrollEnd}
        onScrollEndDrag={handleScrollEnd}
        scrollEventThrottle={16}
      >
        {items.map((item, idx) => (
          <View key={idx} style={{ height: DRUM_ITEM_H, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{
              fontSize: idx === selectedIndex ? 20 : 15,
              fontWeight: idx === selectedIndex ? '800' : '400',
              color: idx === selectedIndex ? theme.textPrimary : theme.textMuted,
              opacity: Math.abs(idx - selectedIndex) > 1 ? 0.25 : idx === selectedIndex ? 1 : 0.6,
            }}>{item}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function DrumBlock({ label, local, setLocal, accentColor, theme }) {
  const hIdx  = (local.h12 - 1 + 12) % 12;
  const mIdx  = local.minute;
  const apIdx = local.ampm === 'AM' ? 0 : 1;

  return (
    <View style={[glStyles.drumCard, {
      backgroundColor: theme.isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
      borderColor: accentColor + '55',
    }]}>
      <View style={[glStyles.drumTag, { backgroundColor: accentColor + '25', borderColor: accentColor + '60' }]}>
        <Text style={[glStyles.drumTagTxt, { color: accentColor }]}>{label}</Text>
      </View>
      <View style={{ position: 'relative' }}>
        {/* Shared centre-row highlight */}
        <View pointerEvents="none" style={[glStyles.drumHighlight, {
          backgroundColor: accentColor + '18',
          borderColor: accentColor + '40',
        }]} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
          <WheelColumn
            items={WHEEL_HOURS}
            selectedIndex={hIdx}
            onChange={(i) => setLocal(p => ({ ...p, h12: i + 1 }))}
            theme={theme}
            width={52}
          />
          <Text style={[glStyles.drumColon, { color: theme.textMuted }]}>:</Text>
          <WheelColumn
            items={WHEEL_MINUTES}
            selectedIndex={mIdx}
            onChange={(i) => setLocal(p => ({ ...p, minute: i }))}
            theme={theme}
            width={52}
          />
          <View style={[glStyles.drumDivider, { backgroundColor: theme.glassBorder }]} />
          <WheelColumn
            items={WHEEL_AMPM}
            selectedIndex={apIdx}
            onChange={(i) => setLocal(p => ({ ...p, ampm: WHEEL_AMPM[i] }))}
            theme={theme}
            width={52}
          />
        </View>
      </View>
    </View>
  );
}

function GrowLightScheduleModal({ visible, onClose, onTime, offTime, onSave, theme }) {
  const mkLocal = (t) => ({ ...to12(t.hour), minute: t.minute });
  const [localOn,  setLocalOn]  = useState(() => mkLocal(onTime));
  const [localOff, setLocalOff] = useState(() => mkLocal(offTime));

  React.useEffect(() => {
    if (visible) { setLocalOn(mkLocal(onTime)); setLocalOff(mkLocal(offTime)); }
  }, [visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={glStyles.backdrop}>
        <View style={[glStyles.sheet, {
          backgroundColor: theme.isDark ? '#0D1F16' : '#F0FAF4',
          borderColor: theme.glassBorder,
        }]}>
          <View style={[glStyles.accentBar, { backgroundColor: '#FBBF24' }]} />
          <Text style={[glStyles.title, { color: theme.textPrimary }]}>Grow Light Schedule</Text>
          <View style={glStyles.timeCardsWrap}>
            <DrumBlock label="ON"  local={localOn}  setLocal={setLocalOn}  accentColor="#FBBF24" theme={theme} />
            <DrumBlock label="OFF" local={localOff} setLocal={setLocalOff} accentColor="#94A3B8" theme={theme} />
          </View>
          <Text style={[glStyles.hint, { color: theme.textMuted }]}>
            Overnight schedules (e.g. 8:00 PM → 6:00 AM) are supported.
          </Text>
          <View style={glStyles.btnRow}>
            <TouchableOpacity
              style={[glStyles.btn, glStyles.btnGhost, { borderColor: theme.glassBorder }]}
              onPress={onClose} activeOpacity={0.7}
            >
              <Text style={[glStyles.btnTxt, { color: theme.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[glStyles.btn, glStyles.btnPrimary]}
              onPress={() => {
                onSave(
                  { hour: to24(localOn.h12,  localOn.ampm),  minute: localOn.minute },
                  { hour: to24(localOff.h12, localOff.ampm), minute: localOff.minute },
                );
                onClose();
              }}
              activeOpacity={0.7}
            >
              <Text style={[glStyles.btnTxt, { color: '#fff' }]}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const glStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderWidth: 1, overflow: 'hidden', paddingBottom: 36,
  },
  accentBar: { height: 4 },
  title: {
    fontSize: 19, fontWeight: '900',
    marginHorizontal: 20, marginTop: 20, marginBottom: 16, letterSpacing: -0.3,
  },
  timeCardsWrap: { gap: 10, marginHorizontal: 20, marginBottom: 10 },
  drumCard: {
    borderRadius: 14, borderWidth: 1,
    paddingHorizontal: 14, paddingTop: 12, paddingBottom: 10,
  },
  drumTag: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 10, borderWidth: 1, marginBottom: 8,
  },
  drumTagTxt: { fontSize: 12, fontWeight: '800' },
  drumHighlight: {
    position: 'absolute',
    left: 0, right: 0,
    top: DRUM_ITEM_H,
    height: DRUM_ITEM_H,
    borderTopWidth: 1, borderBottomWidth: 1,
    zIndex: 1,
  },
  drumColon: { fontSize: 22, fontWeight: '800', marginHorizontal: 2 },
  drumDivider: { width: 1, height: 28, marginHorizontal: 8 },
  hint: { fontSize: 11, marginHorizontal: 20, marginBottom: 14, textAlign: 'center', fontStyle: 'italic' },
  btnRow: { flexDirection: 'row', gap: 10, marginHorizontal: 20 },
  btn: {
    flex: 1, paddingVertical: 13, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
  },
  btnGhost: { borderWidth: 1 },
  btnPrimary: { backgroundColor: '#2D6A4F' },
  btnTxt: { fontSize: 14, fontWeight: '700' },
});

function SettingRow({ label, subtitle, value, onToggle, theme }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color: theme.textPrimary }]}>{label}</Text>
        {subtitle && <Text style={[styles.rowSub, { color: theme.textMuted }]}>{subtitle}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: 'rgba(128,128,128,0.3)', true: '#2D6A4F' }}
        thumbColor={value ? '#74C69D' : '#aaa'}
      />
    </View>
  );
}

function Section({ title, children, theme }) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>{title}</Text>
      <View style={[styles.sectionCard, {
        backgroundColor: theme.sectionCardBg,
        borderColor: theme.sectionCardBorder,
      }]}>
        {children}
      </View>
    </View>
  );
}

export default function SettingsScreen() {
  const theme = useTheme();
  const { clearHistory, connected, error, apiBase, updateApiBase, data, setRelay, setLight, refreshNow } = useSensor();
  const { resetPlantConfig } = usePlantConfig();
  const [modalVisible, setModalVisible] = useState(false);
  const [relayModalVisible, setRelayModalVisible] = useState(false);
  const [condTestVisible, setCondTestVisible] = useState(false);
  const [calibModalVisible, setCalibModalVisible] = useState(false);
  const [mistingModalVisible, setMistingModalVisible] = useState(false);
  const [ipModalVisible, setIpModalVisible] = useState(false);
  const [ipInput, setIpInput] = useState('');

  // Grow Light state
  const [growLightScheduleEnabled, setGrowLightScheduleEnabled] = useState(false);
  const [growLightOnTime, setGrowLightOnTime] = useState({ hour: 8, minute: 0 });
  const [growLightOffTime, setGrowLightOffTime] = useState({ hour: 20, minute: 0 });
  const [growLightScheduleModalVisible, setGrowLightScheduleModalVisible] = useState(false);
  // Optimistic pending state for the manual switch (null = follow server state)
  const [pendingGrowLight, setPendingGrowLight] = useState(null);
  // Tracks the last state we commanded so we only call setRelay on actual transitions
  const growLightLastSent = useRef(null);
  // Suppresses live sync while user is editing the schedule modal
  const isEditingScheduleRef = useRef(false);

  // ── Continuous sync of grow light config from Pi ────────────
  useEffect(() => {
    if (isEditingScheduleRef.current) return;
    if (!connected || !data?.light) return;
    const { mode, on_time, off_time } = data.light;
    setGrowLightScheduleEnabled(mode === 'schedule');
    if (on_time) {
      const [h, m] = on_time.split(':').map(Number);
      setGrowLightOnTime({ hour: h, minute: m });
    }
    if (off_time) {
      const [h, m] = off_time.split(':').map(Number);
      setGrowLightOffTime({ hour: h, minute: m });
    }
  }, [connected, data?.light?.mode, data?.light?.on_time, data?.light?.off_time]);

  // Returns true if the grow light *should* be on right now given the schedule
  const shouldGrowLightBeOn = useCallback(() => {
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const onMins  = growLightOnTime.hour  * 60 + growLightOnTime.minute;
    const offMins = growLightOffTime.hour * 60 + growLightOffTime.minute;
    if (onMins === offMins) return false;
    if (onMins < offMins) return nowMins >= onMins && nowMins < offMins;
    // overnight (e.g. 20:00 → 06:00)
    return nowMins >= onMins || nowMins < offMins;
  }, [growLightOnTime, growLightOffTime]);

  const checkGrowLightSchedule = useCallback(() => {
    if (!connected) return;
    const next = shouldGrowLightBeOn();
    if (growLightLastSent.current !== next) {
      growLightLastSent.current = next;
      setRelay('grow_light', next);
    }
  }, [connected, shouldGrowLightBeOn]);

  useEffect(() => {
    if (!growLightScheduleEnabled) {
      growLightLastSent.current = null; // reset so re-enable sends fresh command
      return;
    }

    // Fire immediately so the light snaps to the correct state right away
    checkGrowLightSchedule();

    // Then align to the TOP of the next minute so every subsequent tick fires
    // as close to :00 seconds as possible
    const now = new Date();
    const msUntilNextMinute =
      (60 - now.getSeconds()) * 1000 - now.getMilliseconds();

    let interval;
    const alignTimeout = setTimeout(() => {
      checkGrowLightSchedule();          // tick at the minute boundary
      interval = setInterval(checkGrowLightSchedule, 60_000);
    }, msUntilNextMinute);

    return () => {
      clearTimeout(alignTimeout);
      if (interval) clearInterval(interval);
    };
  }, [growLightScheduleEnabled, checkGrowLightSchedule]);

  const openIpModal = () => {
    setIpInput(apiBase);
    setIpModalVisible(true);
  };

  const saveIp = async () => {
    if (ipInput.trim()) {
      await updateApiBase(ipInput.trim());
    }
    setIpModalVisible(false);
  };

  return (
    <LinearGradient
      colors={[theme.bgGradientTop, theme.bgGradientBot]}
      style={styles.root}
    >
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* Device Card */}
        <LinearGradient
          colors={['rgba(45,106,79,0.5)', 'rgba(26,61,43,0.3)']}
          style={[styles.deviceCard, { borderColor: theme.glassBorder }]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        >
          <View style={styles.raspiWrap}>
            <Image
              source={require('../../assets/images/raspi5.png')}
              style={styles.raspiImg}
              resizeMode="contain"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.deviceName, { color: theme.textPrimary }]}>HerbanalytiX Device</Text>
            <Text style={[styles.deviceSub, { color: theme.textSecondary }]}>Raspberry Pi 5</Text>
            <View style={styles.deviceStatus}>
              <View style={[styles.onlineDot, { backgroundColor: connected ? '#4ADE80' : '#F87171' }]} />
              <Text style={[styles.deviceStatusText, { color: connected ? '#4ADE80' : '#F87171' }]}>
                {connected ? 'Connected via Wi-Fi' : error || 'Not connected'}
              </Text>
            </View>
          </View>
        </LinearGradient>

        {/* App Settings */}
        <Section title="App Settings" theme={theme}>
          <SettingRow
            label="Light Mode"
            subtitle="Switch between dark and light theme"
            value={!theme.isDark}
            onToggle={theme.toggleTheme}
            theme={theme}
          />
          <View style={[styles.divider, { backgroundColor: theme.divider }]} />
          <TouchableOpacity
            style={styles.row}
            onPress={openIpModal}
            activeOpacity={0.7}
          >
            <View style={styles.rowText}>
              <Text style={[styles.rowLabel, { color: theme.textPrimary }]}>Pi Server Address</Text>
              <Text style={[styles.rowSub, { color: theme.textMuted }]} numberOfLines={1}>
                {apiBase}
              </Text>
            </View>
            <Text style={[styles.chevron, { color: theme.textMuted }]}>›</Text>
          </TouchableOpacity>
        </Section>

        {/* Misting Intervals */}
        <Section title="Misting Intervals" theme={theme}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => setMistingModalVisible(true)}
            activeOpacity={0.7}
          >
            <View style={styles.rowText}>
              <Text style={[styles.rowLabel, { color: theme.textPrimary }]}>Misting Intervals</Text>
              <Text style={[styles.rowSub, { color: theme.textMuted }]}>
                Customise on/off durations per plant phase
              </Text>
            </View>
            <Text style={[styles.chevron, { color: theme.textMuted }]}>›</Text>
          </TouchableOpacity>
        </Section>

        {/* Grow Light */}
        <Section title="Grow Light" theme={theme}>
          {/* Manual trigger */}
          <View style={[styles.row, { opacity: growLightScheduleEnabled ? 0.4 : 1 }]}>
            <View style={styles.rowText}>
              <Text style={[styles.rowLabel, { color: theme.textPrimary }]}>Manual</Text>
              <Text style={[styles.rowSub, { color: theme.textMuted }]}>
                {growLightScheduleEnabled
                  ? 'Disabled while schedule is active'
                  : 'Directly toggle the LED grow light'}
              </Text>
            </View>
            <Switch
              value={pendingGrowLight !== null
                ? pendingGrowLight
                : (!growLightScheduleEnabled && !!(data?.relays?.grow_light))}
              onValueChange={async (val) => {
                if (growLightScheduleEnabled || !connected) return;
                setPendingGrowLight(val);
                await setRelay('grow_light', val);
                await refreshNow();
                setPendingGrowLight(null);
              }}
              disabled={growLightScheduleEnabled || !connected}
              trackColor={{ false: 'rgba(128,128,128,0.3)', true: '#FBBF24' }}
              thumbColor={
                (pendingGrowLight !== null ? pendingGrowLight : (!growLightScheduleEnabled && !!(data?.relays?.grow_light)))
                  ? '#FDE68A' : '#aaa'
              }
            />
          </View>
          <View style={[styles.divider, { backgroundColor: theme.divider }]} />
          {/* Schedule toggle */}
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={[styles.rowLabel, { color: theme.textPrimary }]}>Schedule</Text>
              <Text style={[styles.rowSub, { color: theme.textMuted }]}>
                Automatically control grow light by time
              </Text>
            </View>
            <Switch
              value={growLightScheduleEnabled}
              onValueChange={(val) => {
                setGrowLightScheduleEnabled(val);
                const fmt = (t) =>
                  `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;
                if (val) {
                  setLight({ mode: 'schedule', on_time: fmt(growLightOnTime), off_time: fmt(growLightOffTime) });
                } else {
                  setLight({ mode: 'manual', state: !!(data?.relays?.grow_light) });
                }
              }}
              trackColor={{ false: 'rgba(128,128,128,0.3)', true: '#2D6A4F' }}
              thumbColor={growLightScheduleEnabled ? '#74C69D' : '#aaa'}
            />
          </View>
          {growLightScheduleEnabled && (
            <>
              <View style={[styles.divider, { backgroundColor: theme.divider }]} />
              <TouchableOpacity
                style={styles.row}
                onPress={() => {
                  isEditingScheduleRef.current = true;
                  setGrowLightScheduleModalVisible(true);
                }}
                activeOpacity={0.7}
              >
                <View style={styles.rowText}>
                  <Text style={[styles.rowLabel, { color: theme.textPrimary }]}>Schedule Times</Text>
                  <Text style={[styles.rowSub, { color: theme.textMuted }]}>
                    {`ON ${fmt12(growLightOnTime)}  ·  OFF ${fmt12(growLightOffTime)}`}
                  </Text>
                </View>
                <Text style={[styles.chevron, { color: theme.textMuted }]}>›</Text>
              </TouchableOpacity>
            </>
          )}
        </Section>

        {/* About */}
        <Section title="About" theme={theme}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={[styles.rowLabel, { color: theme.textPrimary }]}>App Version</Text>
              <Text style={[styles.rowSub, { color: theme.textMuted }]}>3.0</Text>
            </View>
          </View>
          <View style={[styles.divider, { backgroundColor: theme.divider }]} />
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={[styles.rowLabel, { color: theme.textPrimary }]}>Developers</Text>
              <Text style={[styles.rowSub, { color: theme.textMuted }]}>Ohmmigos</Text>
            </View>
          </View>
        </Section>

        {/* Developer Options */}
        <Section title="Developer Options" theme={theme}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => setRelayModalVisible(true)}
            activeOpacity={0.7}
          >
            <View style={styles.rowText}>
              <Text style={[styles.rowLabel, { color: theme.textPrimary }]}>Manual Relay Control</Text>
              <Text style={[styles.rowSub, { color: theme.textMuted }]}>
                {connected ? 'Toggle pumps and grow light' : 'Requires Pi connection'}
              </Text>
            </View>
            <Text style={[styles.chevron, { color: theme.textMuted }]}>›</Text>
          </TouchableOpacity>
          <View style={[styles.divider, { backgroundColor: theme.divider }]} />
          <TouchableOpacity
            style={styles.row}
            onPress={() => setCondTestVisible(true)}
            activeOpacity={0.7}
          >
            <View style={styles.rowText}>
              <Text style={[styles.rowLabel, { color: theme.textPrimary }]}>Conductivity Test</Text>
              <Text style={[styles.rowSub, { color: theme.textMuted }]}>
                {connected ? 'Manual pump control with probe timing' : 'Requires Pi connection'}
              </Text>
            </View>
            <Text style={[styles.chevron, { color: theme.textMuted }]}>›</Text>
          </TouchableOpacity>
          <View style={[styles.divider, { backgroundColor: theme.divider }]} />
          <TouchableOpacity
            style={styles.row}
            onPress={() => setCalibModalVisible(true)}
            activeOpacity={0.7}
          >
            <View style={styles.rowText}>
              <Text style={[styles.rowLabel, { color: theme.textPrimary }]}>Pump Calibration</Text>
              <Text style={[styles.rowSub, { color: theme.textMuted }]}>
                {connected ? 'Test individual pumps with measured volume' : 'Requires Pi connection'}
              </Text>
            </View>
            <Text style={[styles.chevron, { color: theme.textMuted }]}>›</Text>
          </TouchableOpacity>
        </Section>

        {/* Reset Button */}
        <TouchableOpacity
          style={[styles.resetBtn, { borderColor: '#F8717144' }]}
          onPress={() => setModalVisible(true)}
          activeOpacity={0.8}
        >
          <Text style={styles.resetText}>Reset Device & Clear Data</Text>
          <Text style={styles.resetSub}>Clears sensor history and returns to onboarding</Text>
        </TouchableOpacity>

      </ScrollView>

      {/* Reset confirmation modal */}
      <AppModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        type="danger"
        title="Reset Device?"
        message="This will clear all sensor history and return you to the onboarding screen. This action cannot be undone."
        actions={[
          {
            label: 'Cancel',
            style: 'ghost',
            onPress: null,
          },
          {
            label: 'Reset',
            style: 'destructive',
            onPress: async () => {
              await resetPlantConfig();
              await clearHistory();
              triggerReset();
            },
          },
        ]}
      />

      {/* Relay Control Modal */}
      <RelayControlModal
        visible={relayModalVisible}
        onClose={() => setRelayModalVisible(false)}
      />

      {/* Conductivity Test Modal */}
      <ConductivityTestModal
        visible={condTestVisible}
        onClose={() => setCondTestVisible(false)}
      />

      {/* Pump Calibration Modal */}
      <PumpCalibrationModal
        visible={calibModalVisible}
        onClose={() => setCalibModalVisible(false)}
      />

      {/* Misting Intervals Modal */}
      <MistingIntervalsModal
        visible={mistingModalVisible}
        onClose={() => setMistingModalVisible(false)}
        theme={theme}
      />

      {/* Grow Light Schedule Modal */}
      <GrowLightScheduleModal
        visible={growLightScheduleModalVisible}
        onClose={() => {
          isEditingScheduleRef.current = false;
          setGrowLightScheduleModalVisible(false);
        }}
        onTime={growLightOnTime}
        offTime={growLightOffTime}
        onSave={(newOn, newOff) => {
          isEditingScheduleRef.current = false;
          setGrowLightOnTime(newOn);
          setGrowLightOffTime(newOff);
          const fmt = (t) =>
            `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;
          setLight({ mode: 'schedule', on_time: fmt(newOn), off_time: fmt(newOff) });
        }}
        theme={theme}
      />

      {/* Pi Server Address Modal */}
      <Modal
        visible={ipModalVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setIpModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', paddingHorizontal: 24 }}
        >
          <View style={[
            ipStyles.card,
            { backgroundColor: theme.isDark ? '#0D1F16' : '#F0FAF4', borderColor: theme.glassBorder }
          ]}>
            <Text style={[ipStyles.title, { color: theme.textPrimary }]}>Pi Server Address</Text>
            <Text style={[ipStyles.sub, { color: theme.textMuted }]}>
              {`Enter your Raspberry Pi's IP address and port.\nAll phones must be on the same Wi-Fi network as the Pi.`}
            </Text>
            <TextInput
              style={[
                ipStyles.input,
                { color: theme.textPrimary, borderColor: theme.glassBorder, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }
              ]}
              value={ipInput}
              onChangeText={setIpInput}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="http://192.168.x.x:5000"
              placeholderTextColor={theme.textMuted}
              selectTextOnFocus
            />
            <View style={ipStyles.btnRow}>
              <TouchableOpacity
                style={[ipStyles.btn, ipStyles.btnGhost, { borderColor: theme.glassBorder }]}
                onPress={() => setIpModalVisible(false)}
                activeOpacity={0.7}
              >
                <Text style={[ipStyles.btnTxt, { color: theme.textSecondary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[ipStyles.btn, ipStyles.btnPrimary]}
                onPress={saveIp}
                activeOpacity={0.7}
              >
                <Text style={[ipStyles.btnTxt, { color: '#fff' }]}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  deviceCard: {
    flexDirection: 'row', alignItems: 'center',
    gap: 16, padding: 20, borderRadius: 20,
    borderWidth: 1, marginBottom: 24,
  },
  raspiWrap: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  raspiImg: { width: 56, height: 56 },
  deviceName: { fontSize: 17, fontWeight: '800' },
  deviceSub: { fontSize: 12, marginTop: 2 },
  deviceStatus: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  onlineDot: { width: 7, height: 7, borderRadius: 4 },
  deviceStatusText: { fontSize: 11, fontWeight: '600' },
  section: { marginBottom: 20 },
  sectionTitle: {
    fontSize: 11, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 1,
    marginBottom: 8, marginLeft: 4,
  },
  sectionCard: { borderRadius: 18, borderWidth: 1, overflow: 'hidden' },
  row: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18, paddingVertical: 14,
  },
  rowText: { flex: 1, marginRight: 12 },
  rowLabel: { fontSize: 14, fontWeight: '600' },
  rowSub: { fontSize: 12, marginTop: 2 },
  divider: { height: 1, marginHorizontal: 18 },
  radioOuter: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 2, alignItems: 'center', justifyContent: 'center',
  },
  radioInner: { width: 10, height: 10, borderRadius: 5 },
  resetBtn: {
    marginTop: 8, padding: 18,
    borderRadius: 18, borderWidth: 1,
    backgroundColor: 'rgba(248,113,113,0.06)',
    alignItems: 'center', gap: 4,
  },
  resetText: { color: '#F87171', fontSize: 15, fontWeight: '700' },
  resetSub: { color: 'rgba(248,113,113,0.5)', fontSize: 12 },
  chevron: { fontSize: 22, fontWeight: '300' },
});

const ipStyles = StyleSheet.create({
  card: {
    borderRadius: 20, padding: 24,
    borderWidth: 1,
  },
  title: { fontSize: 17, fontWeight: '800', marginBottom: 6 },
  sub: { fontSize: 12, lineHeight: 18, marginBottom: 16 },
  input: {
    borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginBottom: 20,
  },
  btnRow: { flexDirection: 'row', gap: 10 },
  btn: {
    flex: 1, paddingVertical: 14,
    borderRadius: 12, alignItems: 'center',
  },
  btnGhost: { borderWidth: 1 },
  btnPrimary: { backgroundColor: '#2D6A4F' },
  btnTxt: { fontWeight: '700', fontSize: 14 },
});