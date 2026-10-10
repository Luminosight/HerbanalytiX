// ████████████████████████████████████████████████████████████
// ██                                                      ██
// ██   HerbanalytiX — Standalone TDS Sensor Sketch        ██
// ██   Reads TDS on A0, prints ppm every 2 seconds        ██
// ██                                                      ██
// ████████████████████████████████████████████████████████████
//
// ┌──────────────────────────────────────────────────────────┐
// │                      PIN MAP                             │
// ├──────────────────────────────────────────────────────────┤
// │  D10  → TDS sensor power (HIGH = ON)                    │
// │  A0   → TDS sensor analog output                        │
// └──────────────────────────────────────────────────────────┘
//
//  The TDS module is power-switched via D10 to avoid
//  electrode degradation from continuous current.
//
//  Cycle (2 s total):
//    0.0 s  – Power ON (D10 HIGH)
//    1.5 s  – Sample A0 (10 reads, drop min/max, average)
//    1.5 s  – Power OFF, compute & print ppm
//    2.0 s  – Repeat
//
//  Serial output (9600 baud):
//    TDS: 482.3 ppm | Voltage: 1.83 V | Raw: 374.5
//
//  Calibration formula (from HerbanalytiX main sketch):
//    mapped  = raw * (500 / 1023)
//    tds_ppm = 3.8 * mapped - 15.0
//    Clamp to ≥ 0
//
//  No external libraries required.
// ============================================================


// ── Pin definitions ─────────────────────────────────────────
#define TDS_PWR_PIN   10       // Digital pin controlling TDS power
#define TDS_PIN       A0       // Analog input from TDS probe

// ── Timing ──────────────────────────────────────────────────
#define WARMUP_MS     1500UL   // Let sensor stabilise after power-on
#define CYCLE_MS      2000UL   // Total loop period

// ── Sampling ────────────────────────────────────────────────
#define SAMPLE_COUNT       10
#define SAMPLE_INTERVAL_MS 50UL

// ── Reference ───────────────────────────────────────────────
#define VREF           5.0f
#define ADC_MAX        1023.0f


// ══════════════════════════════════════════════════════════════
//  ADC helper — 10 samples, drop min & max, return average
// ══════════════════════════════════════════════════════════════
float sampledRead() {
  int readings[SAMPLE_COUNT];

  for (int i = 0; i < SAMPLE_COUNT; i++) {
    readings[i] = analogRead(TDS_PIN);
    delay(SAMPLE_INTERVAL_MS);
  }

  int  minVal = readings[0];
  int  maxVal = readings[0];
  long sum    = 0;

  for (int i = 0; i < SAMPLE_COUNT; i++) {
    if (readings[i] < minVal) minVal = readings[i];
    if (readings[i] > maxVal) maxVal = readings[i];
    sum += readings[i];
  }

  sum -= minVal;
  sum -= maxVal;

  return (float)sum / (SAMPLE_COUNT - 2);
}


// ══════════════════════════════════════════════════════════════
//  TDS calibration (matches main HerbanalytiX formula)
// ══════════════════════════════════════════════════════════════
float computeTDS(float raw) {
  float mapped  = raw * (500.0f / ADC_MAX);
  float tds_ppm = 3.8f * mapped - 15.0f;
  if (tds_ppm < 0.0f) tds_ppm = 0.0f;
  return tds_ppm;
}


// ══════════════════════════════════════════════════════════════
//  Setup
// ══════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(9600);

  pinMode(TDS_PWR_PIN, OUTPUT);
  digitalWrite(TDS_PWR_PIN, LOW);   // Start with sensor OFF

  Serial.println(F("=== HerbanalytiX — TDS Sensor (A0) ==="));
  Serial.println(F("Power: D10 | Signal: A0"));
  Serial.println(F("Cycle: 2 s (1.5 s warm-up → sample → OFF)"));
  Serial.println();
}


// ══════════════════════════════════════════════════════════════
//  Loop — one read per cycle
// ══════════════════════════════════════════════════════════════
void loop() {
  // ── Power ON ──────────────────────────────────────────────
  digitalWrite(TDS_PWR_PIN, HIGH);
  delay(WARMUP_MS);

  // ── Sample ────────────────────────────────────────────────
  float raw     = sampledRead();
  float voltage = raw * (VREF / ADC_MAX);
  float ppm     = computeTDS(raw);

  // ── Power OFF ─────────────────────────────────────────────
  digitalWrite(TDS_PWR_PIN, LOW);

  // ── Print ─────────────────────────────────────────────────
  Serial.print(F("TDS: "));
  Serial.print(ppm, 1);
  Serial.print(F(" ppm | Voltage: "));
  Serial.print(voltage, 2);
  Serial.print(F(" V | Raw: "));
  Serial.println(raw, 1);

  // ── Wait remainder of cycle ───────────────────────────────
  unsigned long remaining = CYCLE_MS - WARMUP_MS
                          - (SAMPLE_COUNT * SAMPLE_INTERVAL_MS);
  if (remaining > 0 && remaining < CYCLE_MS) {
    delay(remaining);
  }
}
