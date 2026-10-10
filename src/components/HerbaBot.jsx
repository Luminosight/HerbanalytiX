import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { usePlantConfig } from '../context/PlantConfigContext';
import { useSensor } from '../context/SensorContext';
import { useTheme } from '../theme/ThemeContext';

// ── Robot face assets ─────────────────────────────────────────
const FACES = {
  happy:   require('../../assets/images/happy.png'),
  anxious: require('../../assets/images/anxious.png'),
  calm:    require('../../assets/images/calm.png'),
  worried: require('../../assets/images/worried.png'),
};

// ── Rotation interval (ms) ────────────────────────────────────
const ROTATE_INTERVAL = 5 * 60 * 1000; // 5 minutes

// ── Rolling tips pool — basil-focused growing advice ──────────
const ROLLING_TIPS = [
  "Basil tip: Pinch off flower buds as soon as they appear — this redirects energy into leaf growth and keeps the plant bushy.",
  "Basil tip: Harvest from the top down. Cut right above a leaf pair to encourage two new branches to grow.",
  "Basil tip: The ideal nutrient pH sweet spot for basil is 5.8–6.2. If pH drifts to 5.5–5.7, use pH Up; for 6.3–6.5, use pH Down.",
  "Basil tip: Basil loves warmth! Keep the environment between 17–29°C. Below 17°C, growth slows dramatically.",
  "Basil tip: Aim for 58–70% humidity around your basil. Too dry and leaf tips brown; too humid invites fungal issues.",
  "Basil tip: Basil seedlings prefer lower TDS (400–600 ppm). Once they enter vegetative growth, bump it up to 600–800 ppm.",
  "Basil tip: Provide 14–16 hours of light for vegetative basil. Too much (18 h+) can stress the plant.",
  "Basil tip: If leaves are small and stems are leggy, the light may be too far away. Move it closer or increase intensity.",
  "Basil tip: Yellow lower leaves often mean the plant needs more nitrogen. Check your nutrient solution strength.",
  "Basil tip: Basil roots should be white and firm. Brown or slimy roots indicate root rot — improve aeration immediately.",
  "Basil tip: After a big harvest, reduce nutrient strength for a few days to avoid overloading recovering plants.",
  "Basil tip: Sweet basil (Genovese) is the most popular variety for aeroponics — it grows fast and tastes great in pesto!",
  "Basil tip: If your basil tastes bitter, it might be getting too much light or the nutrients are too concentrated.",
  "Basil tip: Adding a small fan to simulate a light breeze strengthens basil stems and reduces the risk of mold.",
  "Basil tip: Basil essential oils are most concentrated in the morning — harvest early for the best flavor.",
  "Temp tip: If your room temperature rises above 29°C, basil may bolt (flower prematurely). Improve ventilation to cool down.",
  "Temp tip: Below 17°C, basil growth stalls and leaves may darken. Move the setup to a warmer area or add a small heater nearby.",
  "Humidity tip: Below 58% humidity, basil leaf edges may crisp up. Place a shallow tray of water near the setup to raise moisture.",
  "Humidity tip: Above 70% humidity, basil is prone to downy mildew. Increase airflow with a fan to bring it down.",
  "Basil tip: Space basil plants evenly in the aeroponics setup so each gets adequate light and airflow.",
  "Basil tip: Never remove more than one-third of the plant at once during harvest — it needs leaves to keep photosynthesizing.",
  "Basil tip: Wilting leaves with moist roots usually means the environment is too hot. Cool it down!",
  "Basil tip: Clean your misting nozzles regularly — mineral buildup can clog them and starve roots of moisture.",
  "Basil tip: If you notice white specks on the undersides of leaves, check for spider mites. Increase humidity to deter them.",
];

// ── Sensor issue detection ─────────────────────────────────────
// Health is based on TDS + pH ONLY.
// Temp & humidity generate TIPS (shown in tip mode), not health issues.
function getSensorIssues(data) {
  const issues = [];
  const ph  = parseFloat(data.reservoir?.ph);
  const tds = parseFloat(data.reservoir?.tds);
  const tdsTarget = data.tdsTarget ?? {};

  // ── pH (acceptable: 5.5–6.5; sweet spot 5.8–6.2) ───
  if (!isNaN(ph)) {
    if (ph < 5.5)
      issues.push({ sensor: 'pH', msg: `pH is critically low at ${ph}. Add pH Up solution to bring it back above 5.5.` });
    else if (ph >= 5.5 && ph < 5.8)
      issues.push({ sensor: 'pH', msg: `pH is at ${ph} — acceptable, but the sweet spot is 5.8–6.2. Consider a small dose of pH Up.` });
    else if (ph > 6.5)
      issues.push({ sensor: 'pH', msg: `pH is too high at ${ph}. Add pH Down solution to bring it back below 6.5.` });
    else if (ph > 6.2 && ph <= 6.5)
      issues.push({ sensor: 'pH', msg: `pH is at ${ph} — acceptable, but the sweet spot is 5.8–6.2. A small dose of pH Down would help.` });
  }

  // ── TDS (phase-dependent range from server) ─────────
  if (!isNaN(tds) && tdsTarget.min != null && tdsTarget.max != null) {
    if (tds < tdsTarget.min)
      issues.push({ sensor: 'TDS', msg: `TDS is low at ${tds} ppm. Your basil needs more nutrients — add fresh nutrient solution to reach ${tdsTarget.min}–${tdsTarget.max} ppm.` });
    else if (tds > tdsTarget.max)
      issues.push({ sensor: 'TDS', msg: `TDS is high at ${tds} ppm. Dilute with clean water to bring it within ${tdsTarget.min}–${tdsTarget.max} ppm.` });
  }

  return issues;
}

// ── Environment tips (NOT health status) ──────────────────────
function getEnvTips(data) {
  const tips = [];
  const temp = parseFloat(data.environment?.temperature);
  const hum  = parseFloat(data.environment?.humidity);

  if (!isNaN(temp)) {
    if (temp < 17)
      tips.push(`Temperature is ${temp}°C — basil growth slows below 17°C. Move the setup to a warmer spot or reduce ventilation.`);
    else if (temp > 29)
      tips.push(`Temperature is ${temp}°C — above 29°C basil may bolt prematurely. Improve airflow or move away from heat sources.`);
  }

  if (!isNaN(hum)) {
    if (hum < 58.33)
      tips.push(`Humidity is ${hum}% — below 58% basil leaf edges may crisp. Place a water tray nearby to raise ambient moisture.`);
    else if (hum > 70)
      tips.push(`Humidity is ${hum}% — above 70% invites downy mildew on basil. Increase ventilation or use a small fan.`);
  }

  return tips;
}

// ── Healthy status messages ─────────────────────────────────────
const HEALTHY_MSGS = [
  "Your basil is thriving! pH and TDS are right in the sweet spot.",
  "All systems green \u2014 your basil couldn't be happier!",
  "Looking good! Nutrient levels are perfectly balanced for your basil.",
  "Perfect conditions! Keep it up and you'll have a great harvest.",
  "Great job! pH and TDS are both within ideal range for healthy basil growth.",
];

// ══════════════════════════════════════════════════════════════
//  HerbaBot Component
// ══════════════════════════════════════════════════════════════
export default function HerbaBot() {
  const theme  = useTheme();
  const { data } = useSensor();
  const { confirmedPhase } = usePlantConfig();

  // 'status' = sensor health or idle; 'tip' = rolling fun tip
  const [mode, setMode]       = useState('status');
  const [tipIndex, setTipIndex] = useState(() => Math.floor(Math.random() * ROLLING_TIPS.length));
  const [issueIndex, setIssueIndex] = useState(0);
  const timerRef = useRef(null);
  const bounceAnim = useRef(new Animated.Value(1)).current;

  // Compute derived data on every render
  const isEmpty  = !confirmedPhase || confirmedPhase === 'empty';
  const issues   = useMemo(() => getSensorIssues(data), [data]);
  const envTips  = useMemo(() => getEnvTips(data), [data]);
  const hasIssue = issues.length > 0;

  // Build combined tip pool: environment tips (live) + rolling tips (static)
  const allTips = useMemo(() => [...envTips, ...ROLLING_TIPS], [envTips]);

  // Pick content based on current mode
  const content = useMemo(() => {
    if (isEmpty) {
      return {
        face: 'calm',
        text: "No plants detected yet. Place your basil in the plant box \u2014 I'll detect them automatically!",
      };
    }

    if (mode === 'status') {
      if (hasIssue) {
        const issue = issues[issueIndex % issues.length];
        return { face: 'anxious', text: issue.msg };
      }
      return {
        face: 'happy',
        text: HEALTHY_MSGS[Math.floor(Math.random() * HEALTHY_MSGS.length)],
      };
    }

    // mode === 'tip' — env tips first, then rolling pool
    return {
      face: 'worried',
      text: allTips[tipIndex % allTips.length],
    };
  }, [mode, isEmpty, hasIssue, issues, issueIndex, tipIndex, allTips]);

  // Auto-rotate: status → tip → status → tip ...
  const advance = useCallback(() => {
    setMode(prev => {
      if (prev === 'status') {
        setTipIndex(i => (i + 1) % Math.max(allTips.length, 1));
        return 'tip';
      }
      setIssueIndex(i => (i + 1));
      return 'status';
    });
  }, [allTips.length]);

  useEffect(() => {
    timerRef.current = setInterval(advance, ROTATE_INTERVAL);
    return () => clearInterval(timerRef.current);
  }, [advance]);

  // Manual tap cycles immediately
  const handlePress = useCallback(() => {
    // Reset timer so the next auto-rotate starts fresh from now
    clearInterval(timerRef.current);
    timerRef.current = setInterval(advance, ROTATE_INTERVAL);
    advance();

    // Bounce animation
    Animated.sequence([
      Animated.timing(bounceAnim, { toValue: 0.92, duration: 80, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      Animated.timing(bounceAnim, { toValue: 1, duration: 150, easing: Easing.elastic(1.3), useNativeDriver: true }),
    ]).start();
  }, [advance, bounceAnim]);

  const faceSource = FACES[content.face];

  return (
    <TouchableOpacity activeOpacity={0.85} onPress={handlePress}>
      <Animated.View style={[hbStyles.card, {
        backgroundColor: theme.sectionCardBg ?? 'rgba(13,40,24,0.6)',
        borderColor: theme.glassBorder,
        transform: [{ scale: bounceAnim }],
      }]}>
        {/* Header */}
        <View style={hbStyles.header}>
          <Text style={[hbStyles.title, { color: theme.textPrimary }]}>HerbaBot</Text>
          <View style={[hbStyles.modeBadge, {
            backgroundColor: mode === 'status'
              ? (hasIssue && !isEmpty ? 'rgba(251,191,36,0.12)' : 'rgba(74,222,128,0.12)')
              : 'rgba(167,139,250,0.12)',
            borderColor: mode === 'status'
              ? (hasIssue && !isEmpty ? 'rgba(251,191,36,0.3)' : 'rgba(74,222,128,0.3)')
              : 'rgba(167,139,250,0.3)',
          }]}>
            <Text style={[hbStyles.modeText, {
              color: mode === 'status'
                ? (hasIssue && !isEmpty ? '#FBBF24' : '#4ADE80')
                : '#A78BFA',
            }]}>
              {isEmpty ? 'Idle' : mode === 'status' ? 'Status' : 'Tip'}
            </Text>
          </View>
        </View>

        {/* Body */}
        <View style={hbStyles.body}>
          {/* Avatar */}
          <View style={[hbStyles.avatarRing, {
            borderColor:
              content.face === 'happy'   ? '#4ADE80' :
              content.face === 'anxious' ? '#FBBF24' :
              content.face === 'worried' ? '#A78BFA' :
                                           '#60A5FA',
          }]}>
            <Image source={faceSource} style={hbStyles.avatarImg} resizeMode="cover" />
          </View>

          {/* Message */}
          <Text style={[hbStyles.message, { color: theme.textSecondary }]}>
            {content.text}
          </Text>
        </View>

        {/* Tap hint */}
        <Text style={[hbStyles.tapHint, { color: theme.textMuted }]}>
          Tap to {mode === 'status' ? 'see a tip' : 'check status'}
        </Text>
      </Animated.View>
    </TouchableOpacity>
  );
}

const hbStyles = StyleSheet.create({
  card: {
    borderRadius: 16, borderWidth: 1,
    padding: 14, marginBottom: 12,
  },
  header: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 10,
  },
  title: { fontSize: 15, fontWeight: '900', letterSpacing: 0.3 },
  modeBadge: {
    paddingHorizontal: 10, paddingVertical: 3,
    borderRadius: 10, borderWidth: 1,
  },
  modeText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  body: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
  },
  avatarRing: {
    width: 56, height: 56, borderRadius: 28,
    borderWidth: 2, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  avatarImg: {
    width: 44, height: 44, borderRadius: 22,
  },
  message: {
    flex: 1, fontSize: 13, lineHeight: 19, fontWeight: '500',
  },
  tapHint: {
    fontSize: 10, fontWeight: '600', textAlign: 'right',
    marginTop: 8, letterSpacing: 0.3,
  },
});
