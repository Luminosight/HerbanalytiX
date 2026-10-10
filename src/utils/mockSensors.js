// mockSensors.js — HerbanalytiX
// Corrected sensor ranges to match system spec.
// NOTE: getMockSensorData() is no longer used by SensorContext
// (which now pulls from the real API), but is kept here for
// unit testing and UI development without a Pi connected.

export const getMockSensorData = () => ({
  reservoir: {
    ph:  (5.8 + Math.random() * 1.4).toFixed(2),
    tds: Math.floor(560 + Math.random() * 280),   // corrected: 560–840 ppm
    distance: (5 + Math.random() * 20).toFixed(1), // cm from sensor
    volume:   (2 + Math.random() * 7).toFixed(1),  // litres
  },
  environment: {
    temperature: (22 + Math.random() * 9).toFixed(1),
    humidity:    (55 + Math.random() * 30).toFixed(1),
  },
  deviceStatus:    Math.random() > 0.15 ? 'Online' : 'Offline',
  mistingActive:   Math.random() > 0.45,
  mistingInterval: 1.08,     // (5s ON + 60s OFF) / 60 = 1.08 min cycle
  mistingOnSec:    5,
  mistingOffSec:   60,
  nextMisting:     Math.floor(Math.random() * 55) + 5,   // 5–60 seconds
  plantPhase:      'seedling',
  slots: Array.from({ length: 6 }, (_, i) => ({
    slot:       i + 1,
    class:      'Seedling',
    confidence: 0.88 + Math.random() * 0.10,
  })),
  relays: {
    submersible:   false,
    mist_pump:     false,
    peristaltic_1: false,
    peristaltic_2: false,
    peristaltic_3: false,
    grow_light:    false,
  },
  dosingActive: false,
  dosingStep:   '',
  light: { mode: 'manual', state: false, on_time: '18:00', off_time: '06:00' },
  tdsTarget: { min: 400, max: 600 },
  lastUpdated: new Date().toISOString(),
});

// ── Sensor ranges (used by SensorCard for progress bar + status) ──
export const SENSOR_RANGES = {
  ph: {
    min: 5.5, max: 6.5,
    unit: '', label: 'pH Level', icon: '⚗️',
    ideal: '5.5–6.5',
  },
  tds: {
    // Phase-dependent: seedling 400–600, vegetative 600–800
    // These are fallback values; SensorCard overrides with tdsTarget from server
    min: 400, max: 800,
    unit: ' ppm', label: 'TDS', icon: '💧',
    ideal: '400–800',
  },
  temperature: {
    min: 17, max: 29,
    unit: '°C', label: 'Temperature', icon: '🌡️',
    ideal: '17–29',
  },
  humidity: {
    min: 58.33, max: 70,
    unit: '%', label: 'Humidity', icon: '🌫️',
    ideal: '58–70',
  },
  reservoir_volume: {
    min: 2, max: 8.0,
    unit: ' L', label: 'Water Level', icon: '🪣',
    ideal: '3–8',
  },
};

// ── Status thresholds ─────────────────────────────────────────
export const getSensorStatus = (key, value, rangeOverride) => {
  const range = rangeOverride || SENSOR_RANGES[key];
  if (!range) return 'normal';
  const v = parseFloat(value);
  if (isNaN(v)) return 'normal';

  switch (key) {
    case 'tds':
      if (v > 1500) return 'danger';
      if (v < range.min || v > range.max) return 'warning';
      return 'normal';
    case 'ph':
      if (v > range.max) return 'too_basic';
      if (v < range.min) return 'too_acidic';
      return 'normal';
    case 'humidity':
      if (v > range.max) return 'too_humid';
      if (v < range.min) return 'too_arid';
      return 'normal';
    case 'reservoir_volume':
      if (v <= 1)         return 'danger';
      if (v < range.min)  return 'warning';
      return 'normal';
    default:
      if (v < range.min || v > range.max) return 'warning';
      return 'normal';
  }
};