import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Animated,
    Dimensions,
    Image,
    Modal,
    PanResponder,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSensor } from '../context/SensorContext';
import { useTheme } from '../theme/ThemeContext';

const { width } = Dimensions.get('window');

const PHASE_COLORS = {
  seedling:   '#4ADE80',
  vegetative: '#60A5FA',
  empty:      '#888888',
};

const PHASE_LABELS = {
  seedling:   'Seedling',
  vegetative: 'Vegetative',
  empty:      'Empty',
};

// ── Consensus status badge ───────────────────────────────────
function ConsensusCard({ data, theme }) {
  const consensus = data?.consensus;
  const plantPhase = data?.plantPhase ?? 'empty';
  const phaseColor = PHASE_COLORS[plantPhase] ?? '#888';

  if (!consensus) return null;

  const { phase: votedPhase, agreement, votes, cooldown } = consensus;
  const pct = Math.round((agreement ?? 0) * 100);
  const votedColor = PHASE_COLORS[votedPhase] ?? '#888';

  return (
    <View style={[csStyles.card, {
      backgroundColor: theme.sectionCardBg,
      borderColor: theme.glassBorder,
    }]}>
      {/* Current phase */}
      <View style={csStyles.row}>
        <Text style={[csStyles.label, { color: theme.textSecondary }]}>
          Active Phase
        </Text>
        <View style={[csStyles.badge, {
          backgroundColor: phaseColor + '18',
          borderColor: phaseColor + '50',
        }]}>
          <Text style={[csStyles.badgeText, { color: phaseColor }]}>
            {(PHASE_LABELS[plantPhase] ?? plantPhase).toUpperCase()}
          </Text>
        </View>
      </View>

      {/* Separator */}
      <View style={[csStyles.sep, {
        backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
      }]} />

      {/* Consensus info */}
      <Text style={[csStyles.sectionLabel, { color: theme.textMuted }]}>
        Live Consensus
      </Text>
      <View style={csStyles.row}>
        <Text style={[csStyles.label, { color: theme.textSecondary }]}>
          Dominant Vote
        </Text>
        {votedPhase ? (
          <View style={[csStyles.badge, {
            backgroundColor: votedColor + '18',
            borderColor: votedColor + '50',
          }]}>
            <Text style={[csStyles.badgeText, { color: votedColor }]}>
              {(PHASE_LABELS[votedPhase] ?? votedPhase).toUpperCase()}
            </Text>
          </View>
        ) : (
          <Text style={[csStyles.value, { color: theme.textMuted }]}>—</Text>
        )}
      </View>

      <View style={csStyles.row}>
        <Text style={[csStyles.label, { color: theme.textSecondary }]}>
          Agreement
        </Text>
        <Text style={[csStyles.value, {
          color: pct >= 70 ? '#4ADE80' : pct >= 40 ? '#FBBF24' : theme.textMuted,
        }]}>
          {votes > 0 ? `${pct}%` : '—'}
        </Text>
      </View>

      <View style={csStyles.row}>
        <Text style={[csStyles.label, { color: theme.textSecondary }]}>
          Votes in Window
        </Text>
        <Text style={[csStyles.value, { color: theme.textPrimary }]}>
          {votes ?? 0}
        </Text>
      </View>

      {/* Agreement bar */}
      {votes > 0 && (
        <View style={[csStyles.barTrack, {
          backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
        }]}>
          <View style={[csStyles.barFill, {
            width: `${pct}%`,
            backgroundColor: pct >= 70 ? '#4ADE80' : pct >= 40 ? '#FBBF24' : '#888',
          }]} />
        </View>
      )}

      {cooldown && (
        <Text style={[csStyles.cooldownText, { color: '#FBBF24' }]}>
          ⏱ Cooldown active — waiting before next transition
        </Text>
      )}

      <Text style={[csStyles.hint, { color: theme.textMuted }]}>
        Phase transitions automatically when agreement ≥ 70% over 10 seconds.
      </Text>
    </View>
  );
}

const csStyles = StyleSheet.create({
  card: {
    borderRadius: 16, borderWidth: 1, padding: 14,
    marginBottom: 14, gap: 8,
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: { fontSize: 12, fontWeight: '600' },
  value: { fontSize: 13, fontWeight: '800' },
  badge: {
    paddingHorizontal: 12, paddingVertical: 4,
    borderRadius: 10, borderWidth: 1,
  },
  badgeText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  sectionLabel: {
    fontSize: 10, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 1, marginTop: 2,
  },
  sep: { height: 1, alignSelf: 'stretch' },
  barTrack: {
    height: 6, borderRadius: 3, overflow: 'hidden', marginTop: 2,
  },
  barFill: { height: '100%', borderRadius: 3 },
  cooldownText: {
    fontSize: 11, fontWeight: '600', textAlign: 'center', marginTop: 2,
  },
  hint: { fontSize: 10, lineHeight: 15, textAlign: 'center', marginTop: 4 },
});

// ══════════════════════════════════════════════════════════════
//  NIGHT GUARD — CV Schedule (time picker + toggle)
// ══════════════════════════════════════════════════════════════
const to12 = (h24) => ({ h12: h24 % 12 || 12, ampm: h24 < 12 ? 'AM' : 'PM' });
const to24 = (h12, ampm) =>
  ampm === 'AM' ? (h12 === 12 ? 0 : h12) : (h12 === 12 ? 12 : h12 + 12);
const fmt12 = (t) => {
  const { h12, ampm } = to12(t.hour);
  return `${h12}:${String(t.minute).padStart(2, '0')} ${ampm}`;
};
const pad2 = (n) => String(n).padStart(2, '0');

const NG_DRUM_H_ITEM = 46;
const NG_DRUM_H = NG_DRUM_H_ITEM * 3;
const NG_HOURS   = ['01','02','03','04','05','06','07','08','09','10','11','12'];
const NG_MINUTES = Array.from({ length: 60 }, (_, i) => pad2(i));
const NG_AMPM    = ['AM', 'PM'];

function NgWheelColumn({ items, selectedIndex, onChange, theme, colWidth }) {
  const scrollRef = useRef(null);
  useEffect(() => {
    const t = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: selectedIndex * NG_DRUM_H_ITEM, animated: false });
    }, 60);
    return () => clearTimeout(t);
  }, [selectedIndex]);
  const handleEnd = (e) => {
    const idx = Math.max(0, Math.min(
      Math.round(e.nativeEvent.contentOffset.y / NG_DRUM_H_ITEM),
      items.length - 1,
    ));
    onChange(idx);
  };
  return (
    <View style={{ width: colWidth, height: NG_DRUM_H, overflow: 'hidden' }}>
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        snapToInterval={NG_DRUM_H_ITEM}
        decelerationRate="fast"
        contentContainerStyle={{ paddingVertical: NG_DRUM_H_ITEM }}
        onMomentumScrollEnd={handleEnd}
        onScrollEndDrag={handleEnd}
        scrollEventThrottle={16}
      >
        {items.map((item, idx) => (
          <View key={idx} style={{ height: NG_DRUM_H_ITEM, alignItems: 'center', justifyContent: 'center' }}>
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

function NgDrumBlock({ label, local, setLocal, accentColor, theme }) {
  const hIdx  = (local.h12 - 1 + 12) % 12;
  const mIdx  = local.minute;
  const apIdx = local.ampm === 'AM' ? 0 : 1;
  return (
    <View style={[ngStyles.drumCard, {
      backgroundColor: theme.isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
      borderColor: accentColor + '55',
    }]}>
      <View style={[ngStyles.drumTag, { backgroundColor: accentColor + '25', borderColor: accentColor + '60' }]}>
        <Text style={[ngStyles.drumTagTxt, { color: accentColor }]}>{label}</Text>
      </View>
      <View style={{ position: 'relative' }}>
        <View pointerEvents="none" style={[ngStyles.drumHighlight, {
          backgroundColor: accentColor + '18',
          borderColor: accentColor + '40',
        }]} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
          <NgWheelColumn items={NG_HOURS} selectedIndex={hIdx}
            onChange={(i) => setLocal(p => ({ ...p, h12: i + 1 }))} theme={theme} colWidth={52} />
          <Text style={[ngStyles.drumColon, { color: theme.textMuted }]}>:</Text>
          <NgWheelColumn items={NG_MINUTES} selectedIndex={mIdx}
            onChange={(i) => setLocal(p => ({ ...p, minute: i }))} theme={theme} colWidth={52} />
          <View style={[ngStyles.drumDivider, { backgroundColor: theme.glassBorder }]} />
          <NgWheelColumn items={NG_AMPM} selectedIndex={apIdx}
            onChange={(i) => setLocal(p => ({ ...p, ampm: NG_AMPM[i] }))} theme={theme} colWidth={52} />
        </View>
      </View>
    </View>
  );
}

function NightGuardScheduleModal({ visible, onClose, onTime, offTime, onSave, theme }) {
  const mkLocal = (t) => ({ ...to12(t.hour), minute: t.minute });
  const [localOn,  setLocalOn]  = useState(() => mkLocal(onTime));
  const [localOff, setLocalOff] = useState(() => mkLocal(offTime));
  React.useEffect(() => {
    if (visible) { setLocalOn(mkLocal(onTime)); setLocalOff(mkLocal(offTime)); }
  }, [visible]);
  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={ngStyles.backdrop}>
        <View style={[ngStyles.sheet, {
          backgroundColor: theme.isDark ? '#0D1F16' : '#F0FAF4',
          borderColor: theme.glassBorder,
        }]}>
          <View style={[ngStyles.accentBar, { backgroundColor: '#818CF8' }]} />
          <Text style={[ngStyles.modalTitle, { color: theme.textPrimary }]}>CV Active Hours</Text>
          <Text style={[ngStyles.modalHint, { color: theme.textMuted }]}>
            Phase transitions will only occur during these hours.
            {'\n'}Overnight schedules (e.g. 6:00 PM → 6:00 AM) are supported.
          </Text>
          <View style={ngStyles.timeCardsWrap}>
            <NgDrumBlock label="FROM" local={localOn}  setLocal={setLocalOn}  accentColor="#818CF8" theme={theme} />
            <NgDrumBlock label="UNTIL" local={localOff} setLocal={setLocalOff} accentColor="#94A3B8" theme={theme} />
          </View>
          <View style={ngStyles.btnRow}>
            <TouchableOpacity
              style={[ngStyles.btn, ngStyles.btnGhost, { borderColor: theme.glassBorder }]}
              onPress={onClose} activeOpacity={0.7}
            >
              <Text style={[ngStyles.btnTxt, { color: theme.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[ngStyles.btn, ngStyles.btnPrimary]}
              onPress={() => {
                onSave(
                  { hour: to24(localOn.h12,  localOn.ampm),  minute: localOn.minute },
                  { hour: to24(localOff.h12, localOff.ampm), minute: localOff.minute },
                );
                onClose();
              }}
              activeOpacity={0.7}
            >
              <Text style={[ngStyles.btnTxt, { color: '#fff' }]}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function NightGuardCard({ data, theme, onToggle, onEditSchedule }) {
  const sched = data?.cvSchedule;
  if (!sched) return null;

  const { enabled, on_time, off_time } = sched;

  // Compute 'active' client-side using the phone's local clock
  // so the display matches what the user sees (avoids Pi timezone mismatch).
  const active = React.useMemo(() => {
    if (!enabled) return true;
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const [onH, onM] = (on_time ?? '06:00').split(':').map(Number);
    const [offH, offM] = (off_time ?? '21:30').split(':').map(Number);
    const onMins  = onH  * 60 + onM;
    const offMins = offH * 60 + offM;
    if (onMins === offMins) return false;
    if (onMins < offMins) return nowMins >= onMins && nowMins < offMins;
    return nowMins >= onMins || nowMins < offMins; // overnight
  }, [enabled, on_time, off_time]);

  // Parse for display
  const fmtTime = (str) => {
    const [h, m] = (str ?? '06:00').split(':').map(Number);
    return fmt12({ hour: h, minute: m });
  };

  return (
    <View style={[csStyles.card, {
      backgroundColor: theme.sectionCardBg,
      borderColor: enabled ? '#818CF855' : theme.glassBorder,
    }]}>
      {/* Header row with switch */}
      <View style={[csStyles.row, { marginBottom: 2 }]}>
        <View style={{ flex: 1, marginRight: 12 }}>
          <Text style={{ fontSize: 14, fontWeight: '800', color: theme.textPrimary }}>
            Night Guard
          </Text>
          <Text style={{ fontSize: 11, color: theme.textMuted, marginTop: 2, lineHeight: 16 }}>
            Prevents false phase changes caused by poor lighting at night
          </Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={onToggle}
          trackColor={{ false: 'rgba(120,120,128,0.32)', true: '#818CF880' }}
          thumbColor={enabled ? '#818CF8' : '#f4f3f4'}
        />
      </View>

      {enabled && (
        <>
          <View style={[csStyles.sep, {
            backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
          }]} />

          {/* Status indicator */}
          <View style={[csStyles.row, { marginTop: 4 }]}>
            <Text style={[csStyles.label, { color: theme.textSecondary }]}>
              Status
            </Text>
            <View style={[csStyles.badge, {
              backgroundColor: active ? '#4ADE8018' : '#F8717118',
              borderColor: active ? '#4ADE8050' : '#F8717150',
            }]}>
              <Text style={[csStyles.badgeText, { color: active ? '#4ADE80' : '#F87171' }]}>
                {active ? 'CV ACTIVE' : 'CV PAUSED'}
              </Text>
            </View>
          </View>

          {/* Active hours + edit button */}
          <TouchableOpacity
            style={[ngStyles.scheduleRow, {
              backgroundColor: theme.isDark ? 'rgba(129,140,248,0.08)' : 'rgba(129,140,248,0.06)',
              borderColor: '#818CF830',
            }]}
            onPress={onEditSchedule}
            activeOpacity={0.7}
          >
            <View>
              <Text style={{ fontSize: 10, fontWeight: '700', color: theme.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                Active Hours
              </Text>
              <Text style={{ fontSize: 15, fontWeight: '800', color: '#818CF8', marginTop: 3 }}>
                {fmtTime(on_time)} — {fmtTime(off_time)}
              </Text>
            </View>
            <Text style={{ fontSize: 18, color: theme.textMuted }}>✎</Text>
          </TouchableOpacity>

          {!active && (
            <Text style={{ fontSize: 10, color: '#F87171', textAlign: 'center', fontStyle: 'italic', marginTop: 4 }}>
              Outside active hours — phase transitions are paused until {fmtTime(on_time)}
            </Text>
          )}
        </>
      )}
    </View>
  );
}

const ngStyles = StyleSheet.create({
  // Schedule row inside the card
  scheduleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderRadius: 12, borderWidth: 1, padding: 12, marginTop: 6,
  },
  // Modal styles
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderWidth: 1, overflow: 'hidden', paddingBottom: 36,
  },
  accentBar: { height: 4 },
  modalTitle: {
    fontSize: 19, fontWeight: '900',
    marginHorizontal: 20, marginTop: 20, marginBottom: 4, letterSpacing: -0.3,
  },
  modalHint: { fontSize: 11, marginHorizontal: 20, marginBottom: 14, lineHeight: 17 },
  timeCardsWrap: { gap: 10, marginHorizontal: 20, marginBottom: 14 },
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
    position: 'absolute', left: 0, right: 0,
    top: NG_DRUM_H_ITEM, height: NG_DRUM_H_ITEM,
    borderTopWidth: 1, borderBottomWidth: 1, zIndex: 1,
  },
  drumColon: { fontSize: 22, fontWeight: '800', marginHorizontal: 2 },
  drumDivider: { width: 1, height: 28, marginHorizontal: 8 },
  btnRow: { flexDirection: 'row', gap: 10, marginHorizontal: 20 },
  btn: {
    flex: 1, paddingVertical: 13, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
  },
  btnGhost: { borderWidth: 1 },
  btnPrimary: { backgroundColor: '#4338CA' },
  btnTxt: { fontSize: 14, fontWeight: '700' },
});


// ══════════════════════════════════════════════════════════════
//  ROI CROP — Region of Interest (drag-to-select crop area)
// ══════════════════════════════════════════════════════════════
const ROI_ACCENT = '#F59E0B';          // amber

function RoiCropCard({ data, theme, onToggle, onEdit }) {
  const roi = data?.cvRoi;
  if (!roi) return null;

  const { enabled, x_pct, y_pct, w_pct, h_pct } = roi;

  return (
    <View style={[csStyles.card, {
      backgroundColor: theme.sectionCardBg,
      borderColor: enabled ? ROI_ACCENT + '55' : theme.glassBorder,
    }]}>
      <View style={[csStyles.row, { marginBottom: 2 }]}>
        <View style={{ flex: 1, marginRight: 12 }}>
          <Text style={{ fontSize: 14, fontWeight: '800', color: theme.textPrimary }}>
            ROI Crop
          </Text>
          <Text style={{ fontSize: 11, color: theme.textMuted, marginTop: 2, lineHeight: 16 }}>
            Restrict inference to a region of the camera frame to reduce background noise
          </Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={onToggle}
          trackColor={{ false: 'rgba(120,120,128,0.32)', true: ROI_ACCENT + '80' }}
          thumbColor={enabled ? ROI_ACCENT : '#f4f3f4'}
        />
      </View>

      {enabled && (
        <>
          <View style={[csStyles.sep, {
            backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
          }]} />

          {/* Compact summary */}
          <TouchableOpacity
            style={[roiStyles.summaryRow, {
              backgroundColor: theme.isDark ? `${ROI_ACCENT}14` : `${ROI_ACCENT}0A`,
              borderColor: ROI_ACCENT + '30',
            }]}
            onPress={onEdit}
            activeOpacity={0.7}
          >
            <View>
              <Text style={{ fontSize: 10, fontWeight: '700', color: theme.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                Crop Area
              </Text>
              <Text style={{ fontSize: 14, fontWeight: '800', color: ROI_ACCENT, marginTop: 3 }}>
                X {Math.round(x_pct)}%   Y {Math.round(y_pct)}%   W {Math.round(w_pct)}%   H {Math.round(h_pct)}%
              </Text>
            </View>
            <Text style={{ fontSize: 18, color: theme.textMuted }}>✎</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

/**
 * ROI Editor Modal — shows a thumbnail of the camera frame with a
 * draggable / resizable rectangle overlay for the crop area.
 */
function RoiEditorModal({ visible, onClose, roi, onSave, cvFrameUrl, frameKey, theme }) {
  // Local state: percentage values
  const [xp, setXp] = useState(roi.x_pct);
  const [yp, setYp] = useState(roi.y_pct);
  const [wp, setWp] = useState(roi.w_pct);
  const [hp, setHp] = useState(roi.h_pct);

  // Container layout (the preview image area inside the modal)
  const [layout, setLayout] = useState({ width: 0, height: 0 });

  // Sync when modal opens
  useEffect(() => {
    if (visible) {
      setXp(roi.x_pct);
      setYp(roi.y_pct);
      setWp(roi.w_pct);
      setHp(roi.h_pct);
    }
  }, [visible, roi]);

  // Preview image: use 3:4 aspect so the modal fits on screen without clipping
  const previewW = width - 56;
  const previewH = previewW * 3 / 4;

  // Refs that always hold the latest values so PanResponder callbacks
  // never read stale closures
  const valRef = useRef({ xp: 0, yp: 0, wp: 100, hp: 100 });
  const layRef = useRef({ width: 0, height: 0 });
  useEffect(() => { valRef.current = { xp, yp, wp, hp }; });
  useEffect(() => { layRef.current = layout; }, [layout]);

  // Move PanResponder (drag the rectangle)
  const moveStart = useRef({ sx: 0, sy: 0 });
  const movePan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        moveStart.current = { sx: valRef.current.xp, sy: valRef.current.yp };
      },
      onPanResponderMove: (_, gs) => {
        const L = layRef.current;
        if (!L.width) return;
        const dx = (gs.dx / L.width)  * 100;
        const dy = (gs.dy / L.height) * 100;
        const { wp: cw, hp: ch } = valRef.current;
        setXp(Math.max(0, Math.min(100 - cw, moveStart.current.sx + dx)));
        setYp(Math.max(0, Math.min(100 - ch, moveStart.current.sy + dy)));
      },
    })
  ).current;

  // Resize PanResponder (bottom-right corner handle)
  const resStart = useRef({ sw: 0, sh: 0 });
  const resPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        resStart.current = { sw: valRef.current.wp, sh: valRef.current.hp };
      },
      onPanResponderMove: (_, gs) => {
        const L = layRef.current;
        if (!L.width) return;
        const dw = (gs.dx / L.width)  * 100;
        const dh = (gs.dy / L.height) * 100;
        const { xp: cx, yp: cy } = valRef.current;
        setWp(Math.max(10, Math.min(100 - cx, resStart.current.sw + dw)));
        setHp(Math.max(10, Math.min(100 - cy, resStart.current.sh + dh)));
      },
    })
  ).current;

  // Pixel values for the overlay rectangle
  const rLeft   = (xp / 100) * (layout.width  || previewW);
  const rTop    = (yp / 100) * (layout.height || previewH);
  const rWidth  = (wp / 100) * (layout.width  || previewW);
  const rHeight = (hp / 100) * (layout.height || previewH);

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={roiStyles.backdrop}>
        <View style={[roiStyles.sheet, {
          backgroundColor: theme.isDark ? '#1A1400' : '#FFFBEB',
          borderColor: theme.glassBorder,
        }]}>
          <View style={[roiStyles.accentBar, { backgroundColor: ROI_ACCENT }]} />
          <Text style={[roiStyles.title, { color: theme.textPrimary }]}>Adjust ROI Crop</Text>
          <Text style={[roiStyles.hint, { color: theme.textMuted }]}>
            Drag the rectangle to move. Drag the corner handle ◢ to resize.{'\n'}
            Only the area inside the box will be used for inference.
          </Text>

          {/* Preview area */}
          <View
            style={[roiStyles.previewWrap, { width: previewW, height: previewH }]}
            onLayout={(e) => setLayout({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
          >
            {/* Background camera frame */}
            {frameKey > 0 && (
              <Image
                source={{ uri: `${cvFrameUrl}?t=${frameKey}`, cache: 'reload' }}
                style={StyleSheet.absoluteFill}
                resizeMode="cover"
              />
            )}

            {/* Dim outside ROI */}
            {layout.width > 0 && (
              <>
                {/* Top bar */}
                <View style={[roiStyles.dim, { top: 0, left: 0, right: 0, height: rTop }]} />
                {/* Bottom bar */}
                <View style={[roiStyles.dim, { top: rTop + rHeight, left: 0, right: 0, bottom: 0 }]} />
                {/* Left bar */}
                <View style={[roiStyles.dim, { top: rTop, left: 0, width: rLeft, height: rHeight }]} />
                {/* Right bar */}
                <View style={[roiStyles.dim, { top: rTop, left: rLeft + rWidth, right: 0, height: rHeight }]} />
              </>
            )}

            {/* ROI rectangle (draggable) */}
            <View
              style={[roiStyles.roiRect, {
                left: rLeft, top: rTop, width: rWidth, height: rHeight,
                borderColor: ROI_ACCENT,
              }]}
              {...movePan.panHandlers}
            >
              {/* Label */}
              <Text style={roiStyles.roiLabel}>ROI</Text>
            </View>

            {/* Resize handle (bottom-right) */}
            <View
              style={[roiStyles.resizeHandle, {
                left: rLeft + rWidth - 16,
                top:  rTop  + rHeight - 16,
                backgroundColor: ROI_ACCENT,
              }]}
              {...resPan.panHandlers}
            >
              <Text style={roiStyles.resizeIcon}>◢</Text>
            </View>
          </View>

          {/* Current values */}
          <View style={roiStyles.valuesRow}>
            {[
              ['X', xp], ['Y', yp], ['W', wp], ['H', hp],
            ].map(([lbl, v]) => (
              <View key={lbl} style={roiStyles.valueChip}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: theme.textMuted }}>{lbl}</Text>
                <Text style={{ fontSize: 14, fontWeight: '800', color: ROI_ACCENT }}>{Math.round(v)}%</Text>
              </View>
            ))}
          </View>

          {/* Buttons */}
          <View style={roiStyles.btnRow}>
            <TouchableOpacity
              style={[roiStyles.btn, roiStyles.btnGhost, { borderColor: theme.glassBorder }]}
              onPress={onClose} activeOpacity={0.7}
            >
              <Text style={[roiStyles.btnTxt, { color: theme.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[roiStyles.btn, { backgroundColor: ROI_ACCENT }]}
              onPress={() => {
                onSave({
                  enabled: true,
                  x_pct: Math.round(xp * 10) / 10,
                  y_pct: Math.round(yp * 10) / 10,
                  w_pct: Math.round(wp * 10) / 10,
                  h_pct: Math.round(hp * 10) / 10,
                });
                onClose();
              }}
              activeOpacity={0.7}
            >
              <Text style={[roiStyles.btnTxt, { color: '#000' }]}>Apply</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const roiStyles = StyleSheet.create({
  summaryRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderRadius: 12, borderWidth: 1, padding: 12, marginTop: 6,
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderWidth: 1, overflow: 'hidden', paddingBottom: 36,
    maxHeight: '88%',
  },
  accentBar: { height: 4 },
  title: {
    fontSize: 19, fontWeight: '900',
    marginHorizontal: 20, marginTop: 20, marginBottom: 4, letterSpacing: -0.3,
  },
  hint: { fontSize: 11, marginHorizontal: 20, marginBottom: 14, lineHeight: 17 },
  previewWrap: {
    alignSelf: 'center', borderRadius: 12, overflow: 'hidden',
    backgroundColor: '#000', marginBottom: 14,
  },
  dim: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.55)' },
  roiRect: {
    position: 'absolute', borderWidth: 2, borderStyle: 'dashed',
  },
  roiLabel: {
    position: 'absolute', top: 2, left: 4,
    fontSize: 10, fontWeight: '800', color: ROI_ACCENT,
  },
  resizeHandle: {
    position: 'absolute', width: 32, height: 32,
    borderRadius: 6, alignItems: 'center', justifyContent: 'center',
  },
  resizeIcon: { fontSize: 14, color: '#000', fontWeight: '900' },
  valuesRow: {
    flexDirection: 'row', justifyContent: 'center', gap: 16,
    marginHorizontal: 20, marginBottom: 14,
  },
  valueChip: { alignItems: 'center', gap: 2 },
  btnRow: { flexDirection: 'row', gap: 10, marginHorizontal: 20 },
  btn: {
    flex: 1, paddingVertical: 13, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
  },
  btnGhost: { borderWidth: 1 },
  btnTxt: { fontSize: 14, fontWeight: '700' },
});


// ── Main screen ──────────────────────────────────────────────
export default function CameraScreen() {
  const theme = useTheme();
  const { connected, data, fetchCvStatus, cvFrameUrl, resetAt, setCvSchedule, setCvRoi } = useSensor();
  const [cvData, setCvData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  const [paused, setPaused] = useState(false);
  const [focusKey, setFocusKey] = useState(0);
  const intervalRef = useRef(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Night Guard state
  const [ngModalVisible, setNgModalVisible] = useState(false);
  const ngOnTime = React.useMemo(() => {
    const [h, m] = (data?.cvSchedule?.on_time ?? '06:00').split(':').map(Number);
    return { hour: h, minute: m };
  }, [data?.cvSchedule?.on_time]);
  const ngOffTime = React.useMemo(() => {
    const [h, m] = (data?.cvSchedule?.off_time ?? '18:00').split(':').map(Number);
    return { hour: h, minute: m };
  }, [data?.cvSchedule?.off_time]);

  const handleNgToggle = useCallback(async (val) => {
    await setCvSchedule({ enabled: val });
  }, [setCvSchedule]);

  const handleNgSave = useCallback(async (onT, offT) => {
    const on_time  = `${pad2(onT.hour)}:${pad2(onT.minute)}`;
    const off_time = `${pad2(offT.hour)}:${pad2(offT.minute)}`;
    await setCvSchedule({
      enabled: true,
      on_time,
      off_time,
    });
  }, [setCvSchedule]);

  // ROI Crop state
  const [roiModalVisible, setRoiModalVisible] = useState(false);

  const handleRoiToggle = useCallback(async (val) => {
    await setCvRoi({ enabled: val });
  }, [setCvRoi]);

  const handleRoiSave = useCallback(async (payload) => {
    await setCvRoi(payload);
  }, [setCvRoi]);

  const poll = useCallback(async () => {
    const result = await fetchCvStatus();
    if (result) {
      setCvData(result);
      setLoading(false);
    }
    setFrameKey(Date.now());
  }, [fetchCvStatus]);

  useFocusEffect(useCallback(() => {
    setCvData(null);
    setLoading(true);
    setFrameKey(0);
    fadeAnim.setValue(0);
    Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start();
    setFocusKey(k => k + 1);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []));

  useEffect(() => {
    if (resetAt === 0) return;
    setCvData(null);
    setLoading(true);
    setFrameKey(0);
    setFocusKey(k => k + 1);
  }, [resetAt]);

  useEffect(() => {
    if (!connected || paused) return;
    poll();
    intervalRef.current = setInterval(poll, 2000);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [connected, paused, poll, focusKey]);

  const onRefresh = async () => {
    setRefreshing(true);
    await poll();
    setRefreshing(false);
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
        <Animated.View style={{ opacity: fadeAnim }}>
          {/* Title */}
          <View style={styles.titleRow}>
            <View>
              <Text style={[styles.title, { color: theme.textPrimary }]}>
                Plant Vision
              </Text>
              <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
                Automatic phase detection via ONNX consensus
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.pauseBtn, {
                backgroundColor: paused
                  ? 'rgba(74,222,128,0.12)'
                  : 'rgba(248,113,113,0.12)',
                borderColor: paused
                  ? 'rgba(74,222,128,0.3)'
                  : 'rgba(248,113,113,0.3)',
              }]}
              onPress={() => setPaused(p => !p)}
              activeOpacity={0.7}
            >
              <Text style={[styles.pauseBtnText, {
                color: paused ? '#4ADE80' : '#F87171',
              }]}>
                {paused ? 'Resume' : 'Pause'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Connection status */}
          {!connected ? (
            <View style={[styles.offlineCard, {
              backgroundColor: theme.sectionCardBg,
              borderColor: theme.glassBorder,
            }]}>
              <Text style={[styles.offlineTitle, { color: theme.textPrimary }]}>
                Not Connected
              </Text>
              <Text style={[styles.offlineDesc, { color: theme.textMuted }]}>
                Connect to the Raspberry Pi to see the live camera feed and
                automatic plant detection.
              </Text>
            </View>
          ) : loading ? (
            <View style={[styles.loadingCard, {
              backgroundColor: theme.sectionCardBg,
              borderColor: theme.glassBorder,
            }]}>
              <ActivityIndicator size="large" color={theme.light} />
              <Text style={[styles.loadingText, { color: theme.textMuted }]}>
                Connecting to camera...
              </Text>
            </View>
          ) : (
            <>
              {/* Live frame */}
              <View style={[styles.frameCard, { borderColor: theme.glassBorder }]}>
                {frameKey > 0 && (
                  <Image
                    key={frameKey}
                    source={{ uri: `${cvFrameUrl}?t=${frameKey}`, cache: 'reload' }}
                    style={styles.frameImage}
                    resizeMode="contain"
                  />
                )}
                <View style={styles.statsOverlay}>
                  <Text style={styles.statText}>FPS {cvData?.fps ?? '—'}</Text>
                  <Text style={styles.statText}>{cvData?.inferenceMs ?? '—'} ms</Text>
                </View>
                {paused && (
                  <View style={styles.pausedOverlay}>
                    <Text style={styles.pausedText}>PAUSED</Text>
                  </View>
                )}
              </View>

              {/* Consensus card — replaces old Scan Plants card */}
              <ConsensusCard data={data} theme={theme} />

              {/* Night Guard — CV Schedule */}
              <NightGuardCard
                data={data}
                theme={theme}
                onToggle={handleNgToggle}
                onEditSchedule={() => setNgModalVisible(true)}
              />

              {/* ROI Crop — Region of Interest */}
              <RoiCropCard
                data={data}
                theme={theme}
                onToggle={handleRoiToggle}
                onEdit={() => setRoiModalVisible(true)}
              />
            </>
          )}
        </Animated.View>
      </ScrollView>

      {/* Night Guard schedule modal */}
      <NightGuardScheduleModal
        visible={ngModalVisible}
        onClose={() => setNgModalVisible(false)}
        onTime={ngOnTime}
        offTime={ngOffTime}
        onSave={handleNgSave}
        theme={theme}
      />

      {/* ROI editor modal */}
      <RoiEditorModal
        visible={roiModalVisible}
        onClose={() => setRoiModalVisible(false)}
        roi={data?.cvRoi ?? { enabled: false, x_pct: 0, y_pct: 0, w_pct: 100, h_pct: 100 }}
        onSave={handleRoiSave}
        cvFrameUrl={cvFrameUrl}
        frameKey={frameKey}
        theme={theme}
      />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 12, paddingTop: 16, paddingBottom: 40 },

  titleRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 16, paddingHorizontal: 4,
  },
  title: { fontSize: 20, fontWeight: '900', letterSpacing: -0.3 },
  subtitle: { fontSize: 12, marginTop: 2 },
  pauseBtn: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 12, borderWidth: 1,
  },
  pauseBtnText: { fontSize: 12, fontWeight: '700' },

  offlineCard: {
    borderRadius: 20, borderWidth: 1, padding: 32,
    alignItems: 'center', gap: 12, marginBottom: 20,
  },
  offlineTitle: { fontSize: 17, fontWeight: '800' },
  offlineDesc: { fontSize: 13, textAlign: 'center', lineHeight: 20 },
  loadingCard: {
    borderRadius: 20, borderWidth: 1,
    padding: 40, alignItems: 'center', gap: 12,
  },
  loadingText: { fontSize: 13 },

  frameCard: {
    borderRadius: 16, borderWidth: 1, overflow: 'hidden',
    backgroundColor: '#000', marginBottom: 14,
  },
  frameImage: { width: '100%', height: width * 0.56 },
  statsOverlay: {
    position: 'absolute', top: 8, right: 8,
    backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4,
    flexDirection: 'row', gap: 10,
  },
  statText: {
    color: '#4ADE80', fontSize: 10, fontWeight: '700', fontFamily: 'monospace',
  },
  pausedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
  pausedText: { color: '#F87171', fontSize: 18, fontWeight: '900', letterSpacing: 2 },
});