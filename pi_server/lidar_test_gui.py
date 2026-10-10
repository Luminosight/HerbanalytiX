#!/usr/bin/env python3
# ============================================================
#  HerbanalytiX — VL53L0X LiDAR Test GUI
#  Raspberry Pi 5  |  Python 3.13  |  Tkinter
#
#  Standalone tool for testing the VL53L0X time-of-flight
#  sensor on the Pi's I2C bus (GPIO 2 SDA, GPIO 3 SCL).
#
#  Install:
#    pip install adafruit-circuitpython-vl53l0x
#
#  Run:
#    python3 lidar_test_gui.py
# ============================================================

import threading
import time
import tkinter as tk
from tkinter import ttk
from collections import deque
from statistics import median

# ── Sensor imports (graceful fallback) ────────────────────────
try:
    import board
    import busio
    import adafruit_vl53l0x
    HAS_LIDAR = True
except ImportError:
    HAS_LIDAR = False


# ══════════════════════════════════════════════════════════════
#  CONFIG  — match these to your HerbanalytiX reservoir setup
# ══════════════════════════════════════════════════════════════
VOL_OFFSET    = 8.1      # volume = OFFSET - (dist / DIVISOR)
VOL_DIVISOR   = 3.8
VOLUME_MAX    = 8.0      # litres (8 L = 100 %)
VOLUME_MIN    = 0.0
VOLUME_STEP   = 0.8      # bracket to nearest 0.8 L (10 % steps)
LIDAR_OFFSET  = -6.4     # calibration offset in cm
AVG_WINDOW    = 10       # moving-average sample count (larger = smoother)
OUTLIER_CM    = 3.0      # reject readings that deviate > this from median
TIMING_BUDGET = 200_000  # VL53L0X measurement timing budget µs (max accuracy)
INIT_RETRIES  = 5        # boot-time retries
READ_INTERVAL = 0.3      # seconds between reads
MAX_RANGE_CM  = 120.0    # max display range for gauge
HISTORY_LEN   = 60       # how many readings to graph


# ══════════════════════════════════════════════════════════════
#  SENSOR MANAGER  (runs in background thread)
# ══════════════════════════════════════════════════════════════
class SensorManager:
    """Manages I2C connection and reads VL53L0X in a background thread."""

    def __init__(self, on_update, on_status):
        self._on_update = on_update   # callback(dist_cm, avg_cm, vol_L, raw_mm)
        self._on_status = on_status   # callback(status_str, ok: bool)
        self._i2c    = None
        self._sensor = None
        self._readings = deque(maxlen=AVG_WINDOW)
        self._history  = deque(maxlen=HISTORY_LEN)
        self._running  = False
        self._thread   = None
        self._read_count = 0
        self._error_count = 0

    @property
    def history(self):
        return list(self._history)

    @property
    def read_count(self):
        return self._read_count

    @property
    def error_count(self):
        return self._error_count

    def start(self):
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False
        self._cleanup()

    def _cleanup(self):
        """Release I2C bus so the next init starts clean."""
        self._sensor = None
        if self._i2c is not None:
            try:
                self._i2c.deinit()
            except Exception:
                pass
            self._i2c = None

    def _try_init(self):
        self._cleanup()                       # always start fresh
        try:
            self._i2c = busio.I2C(board.SCL, board.SDA)
            # Unlock bus if a previous crash left SDA low
            while not self._i2c.try_lock():
                pass
            self._i2c.unlock()
            self._sensor = adafruit_vl53l0x.VL53L0X(self._i2c)
            # Increase timing budget for best accuracy (default ~33 ms)
            self._sensor.measurement_timing_budget = TIMING_BUDGET
            self._on_status("VL53L0X initialized OK", True)
            return self._sensor
        except Exception as e:
            self._on_status(f"Init failed: {e}", False)
            self._cleanup()
            return None

    def _run(self):
        if not HAS_LIDAR:
            self._on_status("adafruit-circuitpython-vl53l0x not installed", False)
            return

        # Boot retries
        for attempt in range(1, INIT_RETRIES + 1):
            self._on_status(f"Init attempt {attempt}/{INIT_RETRIES}...", False)
            self._try_init()
            if self._sensor:
                break
            if attempt < INIT_RETRIES:
                time.sleep(1)

        if not self._sensor:
            self._on_status("All init attempts failed — retrying periodically", False)

        # Continuous read loop
        while self._running:
            time.sleep(READ_INTERVAL)

            if self._sensor is None:
                self._try_init()
                if self._sensor is None:
                    continue

            try:
                raw_mm = self._sensor.range
                dist_cm = raw_mm / 10.0 + LIDAR_OFFSET
                self._read_count += 1

                if dist_cm < 0 or dist_cm > 200:
                    self._on_status(f"Out of range: {dist_cm:.1f} cm", True)
                    continue

                # Moving average
                self._readings.append(dist_cm)
                avg = sum(self._readings) / len(self._readings)

                # Volume — bracket to nearest VOLUME_STEP
                vol = VOL_OFFSET - avg / VOL_DIVISOR
                vol = max(VOLUME_MIN, min(VOLUME_MAX, vol))
                vol = round(vol / VOLUME_STEP) * VOLUME_STEP
                vol = max(VOLUME_MIN, min(VOLUME_MAX, vol))

                self._history.append(avg)
                self._on_update(dist_cm, avg, vol, raw_mm)
                self._on_status(f"Reading OK — {len(self._readings)}/{AVG_WINDOW} avg samples", True)

            except OSError as e:
                self._error_count += 1
                self._on_status(f"I2C error {e.errno} — resetting bus...", False)
                self._cleanup()
                self._readings.clear()
                self._force_reinit()
            except Exception as e:
                self._error_count += 1
                self._on_status(f"Error: {e}", False)
                self._cleanup()
                self._readings.clear()
                self._force_reinit()

    def _force_reinit(self):
        """Keep retrying init every 2 s until the sensor comes back."""
        attempt = 0
        while self._running and self._sensor is None:
            attempt += 1
            self._on_status(
                f"Re-init attempt {attempt}...", False)
            time.sleep(2)
            self._try_init()


# ══════════════════════════════════════════════════════════════
#  GUI
# ══════════════════════════════════════════════════════════════
class LidarTestApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("HerbanalytiX — VL53L0X LiDAR Test")
        self.geometry("520x700")
        self.configure(bg="#1e1e2e")
        self.resizable(False, False)

        # ── Styles ───────────────────────────────────────────
        self._bg       = "#1e1e2e"
        self._card     = "#2a2a3c"
        self._fg       = "#e0e0e0"
        self._accent   = "#4fc3f7"
        self._ok       = "#66bb6a"
        self._warn     = "#ffa726"
        self._err      = "#ef5350"
        self._dim      = "#888888"

        style = ttk.Style(self)
        style.theme_use("clam")
        style.configure("Card.TFrame", background=self._card)
        style.configure("Card.TLabel",
                        background=self._card, foreground=self._fg,
                        font=("Segoe UI", 11))
        style.configure("Big.TLabel",
                        background=self._card, foreground=self._accent,
                        font=("Segoe UI", 28, "bold"))
        style.configure("Unit.TLabel",
                        background=self._card, foreground=self._dim,
                        font=("Segoe UI", 12))
        style.configure("Head.TLabel",
                        background=self._bg, foreground=self._fg,
                        font=("Segoe UI", 14, "bold"))
        style.configure("Status.TLabel",
                        background=self._bg, foreground=self._dim,
                        font=("Segoe UI", 9))

        self._build_ui()

        # ── Sensor manager ───────────────────────────────────
        self._sensor = SensorManager(
            on_update=self._on_sensor_update,
            on_status=self._on_sensor_status,
        )
        self._sensor.start()

        # Periodic UI refresh for graph + stats
        self._tick()

        self.protocol("WM_DELETE_WINDOW", self._on_close)

    # ── Build UI ─────────────────────────────────────────────
    def _build_ui(self):
        pad = {"padx": 12, "pady": 6}

        # Title
        ttk.Label(self, text="VL53L0X LiDAR Test", style="Head.TLabel",
                  background=self._bg).pack(pady=(14, 4))

        # Status bar
        self._status_var = tk.StringVar(value="Initializing...")
        self._status_lbl = ttk.Label(self, textvariable=self._status_var,
                                     style="Status.TLabel", background=self._bg)
        self._status_lbl.pack(pady=(0, 8))

        # ── Main readings card ───────────────────────────────
        card = ttk.Frame(self, style="Card.TFrame")
        card.pack(fill="x", **pad)

        # Distance row
        row1 = ttk.Frame(card, style="Card.TFrame")
        row1.pack(fill="x", padx=16, pady=(12, 2))
        ttk.Label(row1, text="Distance", style="Card.TLabel").pack(side="left")
        self._dist_var = tk.StringVar(value="--")
        ttk.Label(row1, textvariable=self._dist_var, style="Big.TLabel").pack(side="right")
        ttk.Label(row1, text="cm", style="Unit.TLabel").pack(side="right", padx=(0, 6))

        # Avg distance row
        row2 = ttk.Frame(card, style="Card.TFrame")
        row2.pack(fill="x", padx=16, pady=2)
        ttk.Label(row2, text="Avg Distance", style="Card.TLabel").pack(side="left")
        self._avg_var = tk.StringVar(value="--")
        ttk.Label(row2, textvariable=self._avg_var, style="Big.TLabel").pack(side="right")
        ttk.Label(row2, text="cm", style="Unit.TLabel").pack(side="right", padx=(0, 6))

        # Volume row
        row3 = ttk.Frame(card, style="Card.TFrame")
        row3.pack(fill="x", padx=16, pady=2)
        ttk.Label(row3, text="Volume", style="Card.TLabel").pack(side="left")
        self._vol_var = tk.StringVar(value="--")
        ttk.Label(row3, textvariable=self._vol_var, style="Big.TLabel").pack(side="right")
        ttk.Label(row3, text="L", style="Unit.TLabel").pack(side="right", padx=(0, 6))

        # Raw mm row
        row4 = ttk.Frame(card, style="Card.TFrame")
        row4.pack(fill="x", padx=16, pady=(2, 12))
        ttk.Label(row4, text="Raw Reading", style="Card.TLabel").pack(side="left")
        self._raw_var = tk.StringVar(value="--")
        ttk.Label(row4, textvariable=self._raw_var, style="Big.TLabel").pack(side="right")
        ttk.Label(row4, text="mm", style="Unit.TLabel").pack(side="right", padx=(0, 6))

        # ── Distance gauge ───────────────────────────────────
        gauge_frame = ttk.Frame(self, style="Card.TFrame")
        gauge_frame.pack(fill="x", **pad)
        ttk.Label(gauge_frame, text="Distance Gauge (0 – 120 cm)",
                  style="Card.TLabel").pack(pady=(8, 4))
        self._gauge_canvas = tk.Canvas(gauge_frame, width=470, height=36,
                                       bg=self._card, highlightthickness=0)
        self._gauge_canvas.pack(padx=16, pady=(0, 10))

        # ── Volume gauge ─────────────────────────────────────
        vol_frame = ttk.Frame(self, style="Card.TFrame")
        vol_frame.pack(fill="x", **pad)
        ttk.Label(vol_frame, text=f"Volume Gauge (0 – {VOLUME_MAX} L)",
                  style="Card.TLabel").pack(pady=(8, 4))
        self._vol_canvas = tk.Canvas(vol_frame, width=470, height=36,
                                     bg=self._card, highlightthickness=0)
        self._vol_canvas.pack(padx=16, pady=(0, 10))

        # ── History graph ────────────────────────────────────
        graph_frame = ttk.Frame(self, style="Card.TFrame")
        graph_frame.pack(fill="x", **pad)
        ttk.Label(graph_frame, text="Distance History (last 60 readings)",
                  style="Card.TLabel").pack(pady=(8, 4))
        self._graph_canvas = tk.Canvas(graph_frame, width=470, height=120,
                                       bg="#1a1a2a", highlightthickness=0)
        self._graph_canvas.pack(padx=16, pady=(0, 10))

        # ── Stats row ────────────────────────────────────────
        stats_frame = tk.Frame(self, bg=self._bg)
        stats_frame.pack(fill="x", padx=12, pady=(4, 10))
        self._reads_var  = tk.StringVar(value="Reads: 0")
        self._errors_var = tk.StringVar(value="Errors: 0")
        tk.Label(stats_frame, textvariable=self._reads_var,
                 bg=self._bg, fg=self._dim, font=("Segoe UI", 9)).pack(side="left")
        tk.Label(stats_frame, textvariable=self._errors_var,
                 bg=self._bg, fg=self._err, font=("Segoe UI", 9)).pack(side="right")

    # ── Sensor callbacks (called from bg thread) ─────────────
    def _on_sensor_update(self, dist_cm, avg_cm, vol_L, raw_mm):
        # Schedule UI update on main thread
        self.after(0, self._update_readings, dist_cm, avg_cm, vol_L, raw_mm)

    def _on_sensor_status(self, msg, ok):
        self.after(0, self._update_status, msg, ok)

    # ── UI updates (main thread) ─────────────────────────────
    def _update_readings(self, dist_cm, avg_cm, vol_L, raw_mm):
        self._dist_var.set(f"{dist_cm:.1f}")
        self._avg_var.set(f"{avg_cm:.1f}")
        self._vol_var.set(f"{vol_L:.2f}")
        self._raw_var.set(f"{raw_mm}")

        # Distance gauge
        self._draw_gauge(self._gauge_canvas, avg_cm / MAX_RANGE_CM,
                         f"{avg_cm:.1f} cm", self._accent)

        # Volume gauge — invert color (higher = greener)
        vol_pct = vol_L / VOLUME_MAX if VOLUME_MAX > 0 else 0
        if vol_pct > 0.5:
            color = self._ok
        elif vol_pct > 0.2:
            color = self._warn
        else:
            color = self._err
        self._draw_gauge(self._vol_canvas, vol_pct,
                         f"{vol_L:.1f} L", color)

    def _update_status(self, msg, ok):
        self._status_var.set(msg)
        color = self._ok if ok else self._warn
        # ttk label foreground via configure
        self._status_lbl.configure(foreground=color)

    def _draw_gauge(self, canvas, pct, label, color):
        pct = max(0.0, min(1.0, pct))
        w = 470
        h = 36
        canvas.delete("all")
        # Background track
        canvas.create_rectangle(0, 8, w, h - 8, fill="#3a3a4e", outline="")
        # Filled bar
        bar_w = int(pct * w)
        if bar_w > 0:
            canvas.create_rectangle(0, 8, bar_w, h - 8, fill=color, outline="")
        # Label
        canvas.create_text(w // 2, h // 2, text=label, fill="white",
                           font=("Segoe UI", 10, "bold"))

    def _draw_graph(self):
        canvas = self._graph_canvas
        w, h = 470, 120
        canvas.delete("all")

        history = self._sensor.history
        if len(history) < 2:
            canvas.create_text(w // 2, h // 2, text="Waiting for data...",
                               fill=self._dim, font=("Segoe UI", 10))
            return

        # Grid lines
        for i in range(5):
            y = int(i * h / 4)
            canvas.create_line(0, y, w, y, fill="#333345", dash=(2, 4))
            val = MAX_RANGE_CM - (i * MAX_RANGE_CM / 4)
            canvas.create_text(4, y + 6, text=f"{val:.0f}", anchor="w",
                               fill=self._dim, font=("Segoe UI", 7))

        # Plot line
        n = len(history)
        step = w / max(n - 1, 1)
        points = []
        for i, val in enumerate(history):
            x = i * step
            y = (val / MAX_RANGE_CM) * h
            y = max(2, min(h - 2, y))
            points.append((x, y))

        for i in range(1, len(points)):
            x0, y0 = points[i - 1]
            x1, y1 = points[i]
            canvas.create_line(x0, y0, x1, y1, fill=self._accent, width=2)

        # Dots on last 3 points
        for x, y in points[-3:]:
            canvas.create_oval(x - 3, y - 3, x + 3, y + 3,
                               fill=self._accent, outline="")

    def _tick(self):
        """Periodic refresh for graph and stats."""
        self._draw_graph()
        self._reads_var.set(f"Reads: {self._sensor.read_count}")
        self._errors_var.set(f"Errors: {self._sensor.error_count}")
        self.after(1000, self._tick)

    def _on_close(self):
        self._sensor.stop()
        self.destroy()


# ══════════════════════════════════════════════════════════════
#  MAIN
# ══════════════════════════════════════════════════════════════
if __name__ == "__main__":
    app = LidarTestApp()
    app.mainloop()
