#!/usr/bin/env python3
# ============================================================
#  HerbanalytiX — Flask API Server
#  Raspberry Pi 5  |  Python 3.13
#
#  Serves live sensor data to the React Native mobile app.
#  Reads pH/TDS from Arduino (serial), temperature/humidity
#  from DHT22 (GPIO 26), controls relays via GPIO, and runs
#  ONNX-based computer vision for plant growth-stage detection.
#
#  The mobile app polls GET /api/status every 10 seconds.
#
#  Install:
#    pip install flask flask-cors adafruit-circuitpython-dht pyserial gpiozero opencv-python onnxruntime adafruit-circuitpython-vl53l0x
#    sudo apt install libgpiod3
#
#  Run:
#    python3 herbanalytix_server.py
#
#  The server binds to 0.0.0.0:5000 so it's reachable from
#  any device on the same Wi-Fi network.
#
#  Tip: install avahi-daemon so the Pi is discoverable as
#       herbanalytix.local  (sudo apt install avahi-daemon)
#       Then set the Pi's hostname:
#         sudo hostnamectl set-hostname herbanalytix
# ============================================================

import glob
import json
import os
os.environ["ORT_LOGGING_LEVEL"] = "3"   # suppress ONNX Runtime warnings
import re
import subprocess
import threading
import time
from collections import deque
from datetime import datetime, timezone
from statistics import median as _median
from io import BytesIO

from flask import Flask, Response, jsonify, request
from flask_cors import CORS

# ── Hardware imports (graceful fallback for dev/testing) ──────
try:
    import serial
    HAS_SERIAL = True
except ImportError:
    HAS_SERIAL = False
    print("[WARN] pyserial not installed — serial readings disabled")

try:
    import board
    import adafruit_dht
    HAS_DHT = True
except (ImportError, NotImplementedError):
    HAS_DHT = False
    print("[WARN] adafruit-circuitpython-dht not available — DHT22 disabled")

try:
    from gpiozero import OutputDevice
    HAS_GPIO = True
except ImportError:
    HAS_GPIO = False
    print("[WARN] gpiozero not installed — relay control disabled")

try:
    import busio
    import adafruit_vl53l0x
    HAS_LIDAR = True
except ImportError:
    HAS_LIDAR = False
    print("[WARN] adafruit-circuitpython-vl53l0x not installed — LiDAR disabled")

try:
    import cv2
    import numpy as np
    HAS_CV = True
except ImportError:
    HAS_CV = False
    print("[WARN] opencv-python not installed — camera disabled")

try:
    import onnxruntime as ort
    HAS_ONNX = True
except ImportError:
    HAS_ONNX = False
    print("[WARN] onnxruntime not installed — CV inference disabled")


# ══════════════════════════════════════════════════════════════
#  CONFIG — adjust these to match your wiring
# ══════════════════════════════════════════════════════════════
SERIAL_PORT   = "/dev/ttyUSB0"
SERIAL_BAUD   = 9600
DHT_PIN       = board.D26 if HAS_DHT else None
CAMERA_INDEX  = 0             # fallback; auto-scan preferred
DHT_REFRESH_S = 10           # seconds between DHT22 reads
HISTORY_MAX   = 60          # max entries kept in memory
MISTING_ON_S  = 5           # misting ON duration (seconds)
MISTING_OFF_S = 60          # misting OFF duration (seconds)

# ── LiDAR (VL53L0X) config — I2C on Pi GPIO 2 (SDA) / GPIO 3 (SCL) ─
LIDAR_SAMPLES       = 5       # median-filter window (fills in 5 s at 1 Hz)
LIDAR_VOL_OFFSET    = 8.1     # volume = OFFSET - (dist / DIVISOR)
LIDAR_VOL_DIVISOR   = 3.8
LIDAR_OFFSET        = -6.4    # calibration offset in cm
LIDAR_INIT_RETRIES   = 5       # attempts at boot
LIDAR_READ_INTERVAL  = 1.0     # seconds between reads
I2C_LOCK_TIMEOUT_SEC = 3.0     # max seconds to wait for I2C bus lock
VOLUME_MAX          = 8.0     # 8 L = 100 %
VOLUME_MIN          = 0.0
VOLUME_STEP         = 0.8     # bracket to nearest 0.8 L (10 % steps)

# ── CV / ONNX config ──────────────────────────────────────────
MODEL_PATH    = "/home/ohmmigos/thesis/pump_control/HerbanalytiX.onnx"
CONF_THRESH   = 0.40
IOU_THRESH    = 0.45
INPUT_SIZE    = 640
CLASS_NAMES   = ["Empty", "Seedling", "Vegetative"]
CLASS_COLORS  = {
    "Empty":      (120, 120, 120),
    "Seedling":   (80,  210,  80),
    "Vegetative": (80,  180, 255),
}

RELAY_PINS = {
    "submersible":   17,    # Diaphragm 1
    "mist_pump":     27,    # Diaphragm 2
    "peristaltic_1": 22,
    "peristaltic_2": 24,
    "peristaltic_3": 23,
    "grow_light":    25,
}

# ── Conductivity threshold presets (server-side flow detection) ──
COND_PRESETS = {
    "nutrient": {"tube_1": 2.0, "tube_2": 3.5, "tube_3": 3.0},   # Grow / Chelate / Bloom
    "water":    {"tube_1": 4.3, "tube_2": 4.3, "tube_3": 4.3},   # Plain water (dev testing)
}
COND_DEFAULT_PRESET = "nutrient"

# ── TDS target (phase-dependent) ──────────────────────────────
TDS_TARGET = {
    "seedling":   {"min": 400, "max": 600},
    "vegetative": {"min": 600, "max": 800},
}

# ── Phase consensus config (automatic phase detection) ────────
# Sliding window: votes are kept for this many seconds.
# ~35 inference results at ~7 inferences/sec (every 2nd frame).
CONSENSUS_WINDOW_S  = 10      # 10-second sliding window
CONSENSUS_EVAL_S    = 2       # evaluate consensus every 2 seconds
CONSENSUS_THRESHOLD = 0.70    # 70% agreement required for transition
CONF_FLOOR          = 0.55    # minimum detection confidence to count as a vote
COOLDOWN_S          = 10      # seconds to wait after a transition before allowing another

# ── Persistent config file ────────────────────────────────────
CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "herbanalytix_config.json")

MISTING_CONFIG_DEFAULTS = {
    "seedling":    {"on_sec": 5,  "off_sec": 115},   # 5 s mist, 1 min 55 s rest
    "vegetative":  {"on_sec": 3,  "off_sec": 177},   # 3 s mist, 2 min 57 s rest
}

# Dynamic misting durations — updated at runtime via /api/misting/config
_misting_lock   = threading.Lock()
_misting_on_s   = MISTING_ON_S
_misting_off_s  = MISTING_OFF_S
_misting_config_app = {}   # per-phase intervals in app format for /api/status


def _load_config() -> dict:
    """Load persisted config from disk. Returns the loaded dict."""
    global _misting_on_s, _misting_off_s
    try:
        with open(CONFIG_PATH, "r") as f:
            cfg = json.load(f)
        print(f"[Config] Loaded from {CONFIG_PATH}")

        # Restore misting intervals for saved phase
        phase = cfg.get("plant_phase", "empty")
        mc    = cfg.get("misting_config", {})

        with state_lock:
            sensor_state["plant_phase"] = phase
            sensor_state["phase_locked"] = False   # consensus can override
            # If saved phase is empty, ensure misting stays paused on reboot
            if phase == "empty":
                sensor_state["misting_manual"] = True

        if phase in mc:
            with _misting_lock:
                _misting_on_s  = mc[phase].get("on_sec",  MISTING_ON_S)
                _misting_off_s = mc[phase].get("off_sec", MISTING_OFF_S)
        print(f"[Config] Phase={phase}, ON={_misting_on_s}s, OFF={_misting_off_s}s")

        # Build app-format misting config for status response
        global _misting_config_app
        _misting_config_app = {}
        for p, vals in mc.items():
            _misting_config_app[p] = {
                "onSec": vals.get("on_sec", 5),
                "offMin": round(vals.get("off_sec", 300) / 60),
            }

        # Restore grow light config
        light = cfg.get("light")
        if light:
            with state_lock:
                for key in ("mode", "state", "on_time", "off_time"):
                    if key in light:
                        sensor_state["light"][key] = light[key]
            # If mode was manual and light was on, restore the relay
            if light.get("mode") == "manual" and light.get("state") is True:
                # Relay objects are initialized after _load_config, so defer via flag
                sensor_state["light"]["_restore_on"] = True
            print(f"[Config] Light mode={light.get('mode')}, state={light.get('state')}, on={light.get('on_time')}, off={light.get('off_time')}")

        # Restore CV schedule config
        cv_sched = cfg.get("cv_schedule")
        if cv_sched:
            with state_lock:
                for key in ("enabled", "on_time", "off_time"):
                    if key in cv_sched:
                        sensor_state["cv_schedule"][key] = cv_sched[key]
            print(f"[Config] CV schedule enabled={cv_sched.get('enabled')}, on={cv_sched.get('on_time')}, off={cv_sched.get('off_time')}")

        # Restore CV ROI config
        cv_roi = cfg.get("cv_roi")
        if cv_roi:
            with state_lock:
                for key in ("enabled", "x_pct", "y_pct", "w_pct", "h_pct"):
                    if key in cv_roi:
                        sensor_state["cv_roi"][key] = cv_roi[key]
            print(f"[Config] CV ROI enabled={cv_roi.get('enabled')}, x={cv_roi.get('x_pct')}%, y={cv_roi.get('y_pct')}%, w={cv_roi.get('w_pct')}%, h={cv_roi.get('h_pct')}%")

        # Restore conductivity threshold preset
        cond_preset = cfg.get("conductivity_preset", COND_DEFAULT_PRESET)
        if cond_preset in COND_PRESETS:
            thresholds = COND_PRESETS[cond_preset]
            with state_lock:
                sensor_state["conductivity_preset"] = cond_preset
                for tube_key, thresh in thresholds.items():
                    if tube_key in sensor_state["conductivity"]:
                        sensor_state["conductivity"][tube_key]["threshold"] = thresh
            print(f"[Config] Conductivity preset={cond_preset}")

        return cfg
    except FileNotFoundError:
        print(f"[Config] No saved config found — using defaults")
        return {}
    except Exception as e:
        print(f"[Config] Load error: {e} — using defaults")
        return {}


def _save_config(phase: str, misting_config: dict):
    """Persist plant phase and per-phase misting config to disk."""
    try:
        existing = {}
        try:
            with open(CONFIG_PATH, "r") as f:
                existing = json.load(f)
        except Exception:
            pass
        existing["plant_phase"]    = phase
        existing["misting_config"] = misting_config
        with open(CONFIG_PATH, "w") as f:
            json.dump(existing, f, indent=2)
    except Exception as e:
        print(f"[Config] Save error: {e}")


def _clear_config():
    """Delete persisted config (called on full app reset)."""
    global _misting_on_s, _misting_off_s, _misting_config_app
    try:
        if os.path.exists(CONFIG_PATH):
            os.remove(CONFIG_PATH)
        with _misting_lock:
            _misting_on_s  = MISTING_ON_S
            _misting_off_s = MISTING_OFF_S
        _misting_config_app = {}
        with state_lock:
            sensor_state["plant_phase"] = "empty"
            sensor_state["phase_locked"] = False   # allow consensus to detect new plants
            sensor_state["misting_manual"] = True   # stop misting until plants detected
            sensor_state["phase_event"] = None
            sensor_state["consensus_phase"] = None
            sensor_state["consensus_agreement"] = 0.0
            sensor_state["consensus_votes"] = 0
            sensor_state["consensus_cooldown"] = False
            sensor_state["light"] = {"mode": "manual", "state": False, "on_time": "06:30", "off_time": "21:30"}
            sensor_state["cv_schedule"] = {"enabled": True, "on_time": "06:30", "off_time": "21:30"}
            sensor_state["cv_roi"] = {"enabled": False, "x_pct": 0, "y_pct": 0, "w_pct": 100, "h_pct": 100}
        # Clear vote buffer so consensus starts fresh
        with _vote_lock:
            _vote_buffer.clear()
        print("[Config] Cleared")
    except Exception as e:
        print(f"[Config] Clear error: {e}")


def _save_cv_schedule_config():
    """Persist CV schedule (Night Guard) config to disk."""
    try:
        existing = {}
        try:
            with open(CONFIG_PATH, "r") as f:
                existing = json.load(f)
        except Exception:
            pass
        with state_lock:
            existing["cv_schedule"] = {
                "enabled":  sensor_state["cv_schedule"]["enabled"],
                "on_time":  sensor_state["cv_schedule"]["on_time"],
                "off_time": sensor_state["cv_schedule"]["off_time"],
            }
        with open(CONFIG_PATH, "w") as f:
            json.dump(existing, f, indent=2)
        print("[Config] CV schedule config saved")
    except Exception as e:
        print(f"[Config] CV schedule save error: {e}")


def _save_cv_roi_config():
    """Persist CV ROI (Region of Interest) config to disk."""
    try:
        existing = {}
        try:
            with open(CONFIG_PATH, "r") as f:
                existing = json.load(f)
        except Exception:
            pass
        with state_lock:
            existing["cv_roi"] = {
                "enabled": sensor_state["cv_roi"]["enabled"],
                "x_pct":   sensor_state["cv_roi"]["x_pct"],
                "y_pct":   sensor_state["cv_roi"]["y_pct"],
                "w_pct":   sensor_state["cv_roi"]["w_pct"],
                "h_pct":   sensor_state["cv_roi"]["h_pct"],
            }
        with open(CONFIG_PATH, "w") as f:
            json.dump(existing, f, indent=2)
        print("[Config] CV ROI config saved")
    except Exception as e:
        print(f"[Config] CV ROI save error: {e}")


def _save_light_config():
    """Persist current grow light schedule config to disk."""
    try:
        existing = {}
        try:
            with open(CONFIG_PATH, "r") as f:
                existing = json.load(f)
        except Exception:
            pass
        with state_lock:
            existing["light"] = {
                "mode":     sensor_state["light"]["mode"],
                "state":    sensor_state["light"]["state"],
                "on_time":  sensor_state["light"]["on_time"],
                "off_time": sensor_state["light"]["off_time"],
            }
        with open(CONFIG_PATH, "w") as f:
            json.dump(existing, f, indent=2)
        print("[Config] Light config saved")
    except Exception as e:
        print(f"[Config] Light save error: {e}")


# ══════════════════════════════════════════════════════════════
#  RELAY WRAPPER
# ══════════════════════════════════════════════════════════════
class Relay:
    """Thin wrapper around gpiozero OutputDevice (active-low)."""

    def __init__(self, pin):
        if HAS_GPIO:
            self._dev = OutputDevice(pin, active_high=False, initial_value=False)
        else:
            self._dev = None
        self.state = False

    def on(self):
        if self._dev:
            self._dev.on()
        self.state = True

    def off(self):
        if self._dev:
            self._dev.off()
        self.state = False

    def set(self, state: bool):
        self.on() if state else self.off()

    def close(self):
        self.off()
        if self._dev:
            self._dev.close()


# ══════════════════════════════════════════════════════════════
#  ONNX CV HELPERS
# ══════════════════════════════════════════════════════════════
def _letterbox(img, size):
    h, w   = img.shape[:2]
    scale  = size / max(h, w)
    nh, nw = int(h * scale), int(w * scale)
    img    = cv2.resize(img, (nw, nh))
    canvas = np.full((size, size, 3), 114, dtype=np.uint8)
    pt, pl = (size - nh) // 2, (size - nw) // 2
    canvas[pt:pt+nh, pl:pl+nw] = img
    return canvas


def _preprocess(frame):
    img = _letterbox(frame, INPUT_SIZE)
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    return np.expand_dims(np.transpose(img, (2, 0, 1)), 0)


def _nms(boxes, scores, thr):
    x1, y1, x2, y2 = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
    areas = (x2 - x1) * (y2 - y1)
    order = scores.argsort()[::-1]
    keep  = []
    while order.size:
        i = order[0]; keep.append(i)
        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])
        inter = np.maximum(0, xx2 - xx1) * np.maximum(0, yy2 - yy1)
        iou   = inter / (areas[i] + areas[order[1:]] - inter + 1e-6)
        order = order[1:][iou <= thr]
    return keep


def _postprocess(output, orig_h, orig_w):
    preds      = output[0].T
    class_prob = preds[:, 4:]
    class_ids  = np.argmax(class_prob, axis=1)
    confs      = class_prob[np.arange(len(class_ids)), class_ids]
    mask       = confs >= CONF_THRESH
    if not mask.any():
        return []
    bxy       = preds[mask, :4]
    confs     = confs[mask]
    class_ids = class_ids[mask]
    scale     = INPUT_SIZE / max(orig_h, orig_w)
    pt        = (INPUT_SIZE - int(orig_h * scale)) // 2
    pl        = (INPUT_SIZE - int(orig_w * scale)) // 2
    cx, cy, bw, bh = bxy[:, 0], bxy[:, 1], bxy[:, 2], bxy[:, 3]
    x1 = ((cx - bw / 2 - pl) / scale).clip(0, orig_w)
    x2 = ((cx + bw / 2 - pl) / scale).clip(0, orig_w)
    y1 = ((cy - bh / 2 - pt) / scale).clip(0, orig_h)
    y2 = ((cy + bh / 2 - pt) / scale).clip(0, orig_h)
    boxes = np.stack([x1, y1, x2, y2], axis=1)
    keep  = _nms(boxes, confs, IOU_THRESH)
    out   = []
    for i in keep:
        cid  = int(class_ids[i])
        name = CLASS_NAMES[cid] if cid < len(CLASS_NAMES) else f"cls{cid}"
        out.append({
            "x1": int(x1[i]), "y1": int(y1[i]),
            "x2": int(x2[i]), "y2": int(y2[i]),
            "confidence": round(float(confs[i]), 3),
            "classId": cid, "className": name,
        })
    return out


def _draw_detections(frame, detections):
    for d in detections:
        color = CLASS_COLORS.get(d["className"], (255, 255, 255))
        cv2.rectangle(frame, (d["x1"], d["y1"]), (d["x2"], d["y2"]), color, 2)
        label = f"{d['className']} {d['confidence']*100:.0f}%"
        (lw, lh), bl = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 2)
        cv2.rectangle(frame, (d["x1"], d["y1"] - lh - bl - 4),
                      (d["x1"] + lw + 4, d["y1"]), color, -1)
        cv2.putText(frame, label, (d["x1"] + 2, d["y1"] - bl - 2),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 0), 2, cv2.LINE_AA)
    return frame


# ══════════════════════════════════════════════════════════════
#  SHARED STATE (thread-safe via GIL for simple reads/writes)
# ══════════════════════════════════════════════════════════════
state_lock = threading.RLock()     # RLock: re-entrant so helpers like
                                   # _get_current_tds()/_get_tds_target()
                                   # can be called from inside a locked block

sensor_state = {
    # Reservoir (from Arduino serial)
    "ph":  "--",
    "tds": "--",

    # Reservoir level (from VL53L0X LiDAR on Pi I2C)
    "reservoir_distance": "--",   # cm from sensor to water surface
    "reservoir_volume":   "--",   # litres estimated from distance

    # Conductivity probes (from Arduino serial — three 2-prong sensors)
    # Thresholds determined server-side; Arduino only reports voltage + µS.
    # Pin mapping: A3→tube_1 (Grow), A4→tube_2 (Chelate), A5→tube_3 (Bloom)
    # Relay mapping: peristaltic_3 (GPIO 23) → tube_1 (A3 Grow)
    #                peristaltic_2 (GPIO 24) → tube_2 (A4 Chelate)
    #                peristaltic_1 (GPIO 22) → tube_3 (A5 Bloom)
    "conductivity_preset": COND_DEFAULT_PRESET,
    "conductivity": {
        "tube_1": {"conducting": False, "micro_siemens": 0.0, "voltage": 0.0, "threshold": 2.0, "last_update": 0},
        "tube_2": {"conducting": False, "micro_siemens": 0.0, "voltage": 0.0, "threshold": 3.5, "last_update": 0},
        "tube_3": {"conducting": False, "micro_siemens": 0.0, "voltage": 0.0, "threshold": 3.0, "last_update": 0},
    },

    # Environment (from DHT22)
    "temperature": "--",
    "humidity":    "--",

    # Misting
    "misting_active":        False,
    "misting_cycle_start":   time.time(),
    "misting_manual":        True,     # True = misting paused (default: paused until plants detected)
    "misting_cycle_phase":   "off",    # 'on' or 'off'
    "misting_cycle_elapsed": 0.0,      # seconds elapsed in current phase
    "misting_phase_end_epoch": 0.0,    # absolute epoch when current phase ends

    # Plant phase (detected by CV consensus)
    "plant_phase": "empty",
    "phase_locked": False,   # True = saved config phase; CV consensus overrides

    # Consensus metadata (exposed to app via /api/status)
    "consensus_phase":      None,    # latest consensus result (or None if no consensus yet)
    "consensus_agreement":  0.0,     # 0.0-1.0 agreement ratio in current window
    "consensus_votes":      0,       # total votes in current window
    "consensus_cooldown":   False,   # True while in post-transition cooldown
    "phase_event":          None,    # e.g. {"from": "seedling", "to": "vegetative", "ts": "..."}

    # Slots (updated by CV thread)
    "slots": [
        {"slot": i + 1, "class": "Empty", "confidence": 0}
        for i in range(6)
    ],

    # CV detections (raw list from latest inference)
    "cv_detections": [],
    "cv_fps": 0.0,
    "cv_inference_ms": 0.0,
    "cv_active": False,

    # Dosing
    "dosing_active": False,
    "dosing_step":   "",
    "dosing_countdown": 0,   # seconds remaining in current timed phase
    "dosing_tds":       0,   # live TDS reading during dosing
    "dosing_tds_phase": "",  # "", "in_range", "above_range", "below_range", "unavailable"
    "dosing_tds_target": {}, # {"min": X, "max": Y} for the current plant phase

    # Grow light
    "light": {
        "mode":     "manual",
        "state":    False,
        "on_time":  "06:30",
        "off_time": "21:30",
    },

    # CV Schedule (Night Guard — prevents false phase changes during poor lighting)
    "cv_schedule": {
        "enabled":  True,
        "on_time":  "06:30",   # CV active from
        "off_time": "21:30",   # CV pauses after
    },

    # CV ROI (Region of Interest — crop before inference to reduce background noise)
    "cv_roi": {
        "enabled":  False,
        "x_pct":    0,    # left edge (% of frame width,  0-100)
        "y_pct":    0,    # top edge  (% of frame height, 0-100)
        "w_pct":    100,  # crop width  (% of frame width)
        "h_pct":    100,  # crop height (% of frame height)
    },

    # Timestamps
    "last_updated": datetime.now(timezone.utc).isoformat(),
}

# History buffer — last N averaged readings
history_buffer: list[dict] = []

# Relay instances
relays: dict[str, Relay] = {}

# Latest annotated frame (JPEG bytes) for streaming
_latest_frame_lock = threading.Lock()
_latest_frame_jpeg: bytes | None = None

# ONNX session (initialized in main)
_onnx_session = None
_onnx_input_name = None

# ── Consensus vote buffer ─────────────────────────────────────
# Each entry: (timestamp, phase_string)  e.g. (1709550000.0, "seedling")
_vote_buffer: deque = deque()
_vote_lock = threading.Lock()
_last_transition_time = 0.0   # epoch of last auto-phase transition


# ══════════════════════════════════════════════════════════════
#  SERIAL READER THREAD  (Arduino → pH + TDS + DHT + Conductivity)
#  Expected format:  [MM:SS] pH: X.XX | TDS: XXX.X ppm | Temp: XX.X C | Hum: XX.X %
# ══════════════════════════════════════════════════════════════
# Serial format (no more Dist/Vol — LiDAR is on Pi now):
# [MM:SS] pH: X.XX | TDS: XXX.X ppm | Temp: XX.X C | Hum: XX.X %
_serial_re = re.compile(
    r"\[(\d+:\d+)\]\s+pH:\s*([\d.]+|---)\s*\|\s*TDS:\s*([\d.]+|---)"
)
_serial_dht_re = re.compile(
    r"Temp:\s*([\d.]+)\s*C\s*\|\s*Hum:\s*([\d.]+)\s*%"
)
# Conductivity probe lines — 2-prong sensor report (no State field)
# Arduino now sends raw data only; threshold comparison is server-side.
# Format: "A3 GROW     | ADC: 512 | Voltage: 2.50 V | Conductivity: 123.4 uS"
_serial_cond_re = re.compile(
    r"A(\d)\s+(GROW|CHELATE|BLOOM)\s*\|\s*ADC:\s*\d+\s*\|\s*Voltage:\s*([\d.]+)\s*V\s*\|\s*Conductivity:\s*([\d.]+)\s*uS"
)
# Map Arduino pin labels → tube keys
# Physical wiring: peristaltic_3→A3(Grow), peristaltic_2→A4(Chelate), peristaltic_1→A5(Bloom)
_cond_pin_to_tube = {"3": "tube_1", "4": "tube_2", "5": "tube_3"}


def serial_thread():
    """Continuously reads Arduino serial and updates sensor_state."""
    if not HAS_SERIAL:
        return

    while True:
        try:
            with serial.Serial(SERIAL_PORT, SERIAL_BAUD, timeout=2) as ser:
                print(f"[Serial] Connected to {SERIAL_PORT}")
                while True:
                    raw = ser.readline()
                    if not raw:
                        continue
                    line = raw.decode("utf-8", errors="ignore").strip()
                    if not line:
                        continue
                    m = _serial_re.search(line)
                    if m:
                        ph  = m.group(2)
                        tds = m.group(3)
                        with state_lock:
                            sensor_state["ph"]  = ph
                            sensor_state["tds"] = tds
                            sensor_state["last_updated"] = (
                                datetime.now(timezone.utc).isoformat()
                            )
                        # DHT22 fields (temperature / humidity from Arduino)
                        m_dht = _serial_dht_re.search(line)
                        if m_dht:
                            temp_val = m_dht.group(1)
                            hum_val  = m_dht.group(2)
                            if float(temp_val) > 0:
                                with state_lock:
                                    sensor_state["temperature"] = temp_val
                                    sensor_state["humidity"]    = hum_val
                    # Conductivity probe status (2-prong sensor report)
                    m_cond = _serial_cond_re.search(line)
                    if m_cond:
                        pin_num   = m_cond.group(1)            # '3', '4', or '5'
                        voltage   = float(m_cond.group(3))
                        micro_s   = float(m_cond.group(4))
                        key = _cond_pin_to_tube.get(pin_num)
                        if key:
                            with state_lock:
                                # Server-side threshold comparison
                                preset = sensor_state.get("conductivity_preset", COND_DEFAULT_PRESET)
                                thresholds = COND_PRESETS.get(preset, COND_PRESETS[COND_DEFAULT_PRESET])
                                thresh = thresholds.get(key, 2.0)
                                conducting = (voltage < thresh)
                                sensor_state["conductivity"][key] = {
                                    "conducting": conducting,
                                    "micro_siemens": round(micro_s, 1),
                                    "voltage": round(voltage, 2),
                                    "threshold": thresh,
                                    "last_update": time.time(),
                                }
        except serial.SerialException as e:
            print(f"[Serial] Error: {e} — retrying in 3s")
            time.sleep(3)
        except Exception as e:
            print(f"[Serial] Unexpected: {e} — retrying in 3s")
            time.sleep(3)


# ══════════════════════════════════════════════════════════════
#  VL53L0X LiDAR READER THREAD  (I2C on Pi GPIO 2 SDA / GPIO 3 SCL)
#  Reads distance every LIDAR_READ_INTERVAL seconds, computes
#  reservoir volume with 5-sample moving average.
#  Boot protection: retries LIDAR_INIT_RETRIES times before
#  falling back to periodic re-init attempts.
#
#  Recovery: top-level safety net restarts the whole init+read
#  sequence if any unexpected exception escapes.
# ══════════════════════════════════════════════════════════════
def _i2c_bus_reset():
    """Attempt a kernel-level I2C bus reset via i2cdetect (non-destructive probe)."""
    try:
        subprocess.run(
            ["i2cdetect", "-y", "1"],
            capture_output=True, timeout=5,
        )
        print("[LiDAR] I2C bus probed via i2cdetect")
    except FileNotFoundError:
        print("[LiDAR] i2cdetect not found (install i2c-tools)")
    except Exception as e:
        print(f"[LiDAR] i2cdetect failed: {e}")


def lidar_thread():
    """Reads VL53L0X over Pi I2C (GPIO 2/3) and updates reservoir data."""
    if not HAS_LIDAR:
        print("[LiDAR] Library not available — thread exiting")
        return

    while True:                # ← safety net: auto-restart on crash
        vl53 = None
        i2c_bus = None
        readings = []  # moving-average buffer

        def cleanup():
            nonlocal vl53, i2c_bus
            vl53 = None
            if i2c_bus is not None:
                try:
                    i2c_bus.deinit()
                except Exception:
                    pass
                i2c_bus = None

        def try_init():
            """Clean up old bus, then init VL53L0X. Returns sensor or None."""
            nonlocal vl53, i2c_bus
            cleanup()
            try:
                # Probe I2C bus at kernel level first (helps unstick the bus)
                _i2c_bus_reset()

                i2c_bus = busio.I2C(board.SCL, board.SDA)

                # Timeout-guarded lock — prevents infinite hang
                deadline = time.time() + I2C_LOCK_TIMEOUT_SEC
                while not i2c_bus.try_lock():
                    if time.time() > deadline:
                        raise TimeoutError(
                            f"I2C bus lock timed out after {I2C_LOCK_TIMEOUT_SEC}s"
                        )
                    time.sleep(0.05)
                i2c_bus.unlock()

                vl53 = adafruit_vl53l0x.VL53L0X(i2c_bus)
                vl53.measurement_timing_budget = 200_000  # max accuracy
                print("[LiDAR] VL53L0X initialized OK on Pi I2C (GPIO 2/3)")
                return vl53
            except Exception as e:
                print(f"[LiDAR] Init failed: {e}")
                cleanup()
                return None

        def force_reinit():
            """Keep retrying every 2 s until the sensor comes back."""
            nonlocal vl53
            attempt = 0
            while vl53 is None:
                attempt += 1
                print(f"[LiDAR] Re-init attempt {attempt}...")
                time.sleep(2)
                try_init()

        try:
            # ── Boot-time retry loop ─────────────────────────
            for attempt in range(1, LIDAR_INIT_RETRIES + 1):
                print(f"[LiDAR] Init attempt {attempt}/{LIDAR_INIT_RETRIES}")
                vl53 = try_init()
                if vl53:
                    break
                if attempt < LIDAR_INIT_RETRIES:
                    print("[LiDAR] Retrying in 1s...")
                    time.sleep(1)
                else:
                    print("[LiDAR] All boot attempts failed — will retry periodically")

            # ── Continuous read loop ─────────────────────────
            while True:
                time.sleep(LIDAR_READ_INTERVAL)

                # Auto-recover if sensor isn't ready
                if vl53 is None:
                    vl53 = try_init()
                    if vl53 is None:
                        continue

                try:
                    distance_mm = vl53.range
                    distance_cm = distance_mm / 10.0 + LIDAR_OFFSET

                    # Sanity check — VL53L0X max range ~200 cm
                    if distance_cm < 0 or distance_cm > 200:
                        continue

                    # Median filter (robust to water-surface noise)
                    readings.append(distance_cm)
                    if len(readings) > LIDAR_SAMPLES:
                        readings.pop(0)
                    avg_dist = _median(readings)

                    # Compute volume & bracket to nearest VOLUME_STEP (0.8 L = 10 %)
                    vol = LIDAR_VOL_OFFSET - avg_dist / LIDAR_VOL_DIVISOR
                    vol = max(VOLUME_MIN, min(VOLUME_MAX, vol))
                    vol = round(vol / VOLUME_STEP) * VOLUME_STEP
                    vol = max(VOLUME_MIN, min(VOLUME_MAX, vol))

                    with state_lock:
                        sensor_state["reservoir_distance"] = f"{avg_dist:.1f}"
                        sensor_state["reservoir_volume"]   = f"{vol:.1f}"

                except OSError as e:
                    print(f"[LiDAR] I2C error {e.errno} — resetting bus...")
                    cleanup()
                    readings.clear()
                    force_reinit()
                except Exception as e:
                    print(f"[LiDAR] Unexpected: {e}")
                    cleanup()
                    readings.clear()
                    force_reinit()

        except Exception as e:
            print(f"[LiDAR] Fatal error: {e} — restarting in 3s…")
            cleanup()
            time.sleep(3)


# ══════════════════════════════════════════════════════════════
#  DHT22 READER THREAD  (Temperature + Humidity)
# ══════════════════════════════════════════════════════════════
def dht_thread():
    """Reads DHT22 sensor every DHT_REFRESH_S seconds."""
    if not HAS_DHT:
        return

    try:
        dht = adafruit_dht.DHT22(DHT_PIN)
    except Exception as e:
        print(f"[DHT22] Init failed: {e}")
        return

    while True:
        try:
            tc = dht.temperature
            rh = dht.humidity
            if tc is not None and rh is not None:
                with state_lock:
                    sensor_state["temperature"] = f"{tc:.1f}"
                    sensor_state["humidity"]    = f"{rh:.1f}"
                    sensor_state["last_updated"] = (
                        datetime.now(timezone.utc).isoformat()
                    )
        except RuntimeError as e:
            # DHT22 commonly throws transient errors — just retry
            print(f"[DHT22] Read error: {e}")
        except Exception as e:
            print(f"[DHT22] Unexpected: {e}")
        time.sleep(DHT_REFRESH_S)


# ══════════════════════════════════════════════════════════════
#  MISTING CYCLE THREAD
#  Automatic ON/OFF cycle for the mist pump relay.
# ══════════════════════════════════════════════════════════════
def misting_thread():
    """Auto misting cycle thread.
    Runs ON/OFF cycle using dynamic _misting_on_s / _misting_off_s.
    If misting_manual is True the pump is slave to app relay commands only.
    Cycle always starts with the OFF (rest) phase so the pump is safe at boot.
    """
    # Ensure pump starts OFF
    if "mist_pump" in relays:
        relays["mist_pump"].off()
    with state_lock:
        sensor_state["misting_active"]          = False
        sensor_state["misting_cycle_phase"]     = "off"
        sensor_state["misting_cycle_elapsed"]   = 0.0
        sensor_state["misting_cycle_start"]     = time.time()
        sensor_state["misting_phase_end_epoch"] = 0.0

    TICK = 0.25   # resolution of the elapsed-time counter (seconds)

    while True:
        # ── OFF (rest) phase ──────────────────────────────────
        with state_lock:
            manual = sensor_state["misting_manual"]

        if not manual and "mist_pump" in relays:
            relays["mist_pump"].off()

        phase_start = time.time()
        with _misting_lock:
            off_duration = _misting_off_s
        with state_lock:
            sensor_state["misting_active"]          = False
            sensor_state["misting_cycle_phase"]     = "off"
            sensor_state["misting_cycle_start"]     = phase_start
            sensor_state["misting_cycle_elapsed"]   = 0.0
            sensor_state["misting_phase_end_epoch"] = phase_start + off_duration

        while True:
            time.sleep(TICK)
            with _misting_lock:
                off_duration = _misting_off_s
            elapsed = time.time() - phase_start
            with state_lock:
                sensor_state["misting_cycle_elapsed"]   = round(elapsed, 1)
                sensor_state["misting_phase_end_epoch"] = phase_start + off_duration
            if elapsed >= off_duration:
                break
            with state_lock:
                if sensor_state["misting_manual"]:
                    # If manual mode kicked in mid-rest, just keep ticking
                    pass

        # ── ON (misting) phase ────────────────────────────────
        with state_lock:
            manual  = sensor_state["misting_manual"]
            phase   = sensor_state["plant_phase"]
            dosing  = sensor_state["dosing_active"]

        # Guard: never mist when phase is empty or dosing is active
        should_mist = (not manual) and (phase != "empty") and (not dosing)

        if should_mist and "mist_pump" in relays:
            relays["mist_pump"].on()

        phase_start = time.time()
        with _misting_lock:
            on_duration = _misting_on_s
        with state_lock:
            sensor_state["misting_active"]          = should_mist
            sensor_state["misting_cycle_phase"]     = "on"
            sensor_state["misting_cycle_start"]     = phase_start
            sensor_state["misting_cycle_elapsed"]   = 0.0
            sensor_state["misting_phase_end_epoch"] = phase_start + on_duration

        while True:
            time.sleep(TICK)
            # Re-check manual/phase/dosing every tick so we can cut the ON phase short
            with state_lock:
                manual_now = sensor_state["misting_manual"]
                phase_now  = sensor_state["plant_phase"]
                dosing_now = sensor_state["dosing_active"]
            if manual_now or phase_now == "empty" or dosing_now:
                if should_mist and "mist_pump" in relays:
                    relays["mist_pump"].off()
                    should_mist = False
                with state_lock:
                    sensor_state["misting_active"] = False
            with _misting_lock:
                on_duration = _misting_on_s
            elapsed = time.time() - phase_start
            with state_lock:
                sensor_state["misting_cycle_elapsed"]   = round(elapsed, 1)
                sensor_state["misting_phase_end_epoch"] = phase_start + on_duration
            if elapsed >= on_duration:
                break

        # Turn pump off as soon as ON phase ends
        if "mist_pump" in relays:
            relays["mist_pump"].off()
        with state_lock:
            sensor_state["misting_active"] = False


# ══════════════════════════════════════════════════════════════
#  CAMERA + CV THREAD
#  Captures frames, runs ONNX inference, stores detections
#  and the latest annotated JPEG for the mobile app.
#
#  Recovery:
#    - Retries camera open with exponential back-off (2→4→8…30 s)
#    - Re-opens on persistent read failures (>30 consecutive)
#    - Top-level try/except prevents silent thread death
# ══════════════════════════════════════════════════════════════
_CV_MAX_READ_FAILS  = 30      # consecutive failures before re-open
_CV_RETRY_BASE_SEC  = 2       # initial retry delay
_CV_RETRY_MAX_SEC   = 30      # cap for exponential back-off
_CV_SCAN_INDICES    = [0, 1, 2, 3, 4]   # camera indices to try


def _find_camera():
    """
    Scan for a working camera.  Tries /dev/video* devices and common
    indices with both the default and V4L2 backends.  Returns an
    opened cv2.VideoCapture or None.

    Prefers MJPEG mode — each frame is a self-contained JPEG so
    there is zero risk of V4L2 scanline / DMA tearing.
    """
    MJPEG_FOURCC = cv2.VideoWriter_fourcc(*'MJPG')

    def _try_open(idx, backend=None):
        cap = cv2.VideoCapture(idx, backend) if backend is not None else cv2.VideoCapture(idx)
        if not cap.isOpened():
            cap.release()
            return None
        # Force MJPEG to get atomically-complete frames
        cap.set(cv2.CAP_PROP_FOURCC, MJPEG_FOURCC)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH,  640)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        # Flush first few frames (driver may deliver stale/partial data)
        for _ in range(5):
            cap.read()
        ret, _ = cap.read()
        if ret:
            actual_cc = int(cap.get(cv2.CAP_PROP_FOURCC))
            cc_str = "".join(chr((actual_cc >> (8 * i)) & 0xFF) for i in range(4))
            w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            print(f"[CV] Camera idx={idx} opened: {w}x{h} fourcc={cc_str}")
            return cap
        cap.release()
        return None

    # 1 ── Try explicit /dev/video paths (Pi 5 can shift indices) ──
    for dev in sorted(glob.glob("/dev/video*")):
        try:
            idx = int(dev.replace("/dev/video", ""))
        except ValueError:
            continue
        for backend in (cv2.CAP_V4L2, cv2.CAP_ANY):
            cap = _try_open(idx, backend)
            if cap:
                return cap

    # 2 ── Fallback: try indices without explicit backend ──────────
    for idx in _CV_SCAN_INDICES:
        cap = _try_open(idx)
        if cap:
            return cap

    return None


def camera_cv_thread():
    """Captures camera frames, runs ONNX inference, updates state."""
    global _latest_frame_jpeg

    if not HAS_CV:
        print("[CV] OpenCV not available — camera thread exiting")
        return

    while True:                # ← outer loop: auto-restart on failure
        cap = None
        try:
            # ── Open camera with retry + auto-scan ────────────
            delay = _CV_RETRY_BASE_SEC
            while True:
                cap = _find_camera()
                if cap is not None:
                    break
                print(f"[CV] No camera found — retrying in {delay}s…")
                with state_lock:
                    sensor_state["cv_active"] = False
                time.sleep(delay)
                delay = min(delay * 2, _CV_RETRY_MAX_SEC)

            # Camera was already configured in _find_camera():
            #   MJPEG fourcc, 640x480, buffersize=1, flushed

            with state_lock:
                sensor_state["cv_active"] = True

            print(f"[CV] Camera ready (index {CAMERA_INDEX})")
            prev_time     = time.time()
            frame_count   = 0
            read_fails    = 0
            detections    = []
            inf_ms        = 0.0

            # ── Frame read loop ───────────────────────────────
            while True:
                ret, frame = cap.read()
                if not ret:
                    read_fails += 1
                    if read_fails >= _CV_MAX_READ_FAILS:
                        print(f"[CV] {read_fails} consecutive read failures — re-opening camera…")
                        break           # → outer loop will re-open
                    time.sleep(0.05)
                    continue
                read_fails = 0

                frame_count += 1
                full_h, full_w = frame.shape[:2]

                # ── ROI crop (if enabled) ─────────────────────
                with state_lock:
                    roi = dict(sensor_state["cv_roi"])

                roi_x1 = roi_y1 = 0
                if roi["enabled"]:
                    roi_x1 = int(full_w * max(0, min(roi["x_pct"], 100)) / 100)
                    roi_y1 = int(full_h * max(0, min(roi["y_pct"], 100)) / 100)
                    roi_x2 = int(full_w * max(0, min(roi["x_pct"] + roi["w_pct"], 100)) / 100)
                    roi_y2 = int(full_h * max(0, min(roi["y_pct"] + roi["h_pct"], 100)) / 100)
                    # Ensure at least 32 px in each dimension
                    if roi_x2 - roi_x1 >= 32 and roi_y2 - roi_y1 >= 32:
                        inf_frame = frame[roi_y1:roi_y2, roi_x1:roi_x2]
                    else:
                        inf_frame = frame
                        roi_x1 = roi_y1 = 0
                else:
                    inf_frame = frame

                orig_h, orig_w = inf_frame.shape[:2]

                # Run inference every frame for first 4, then every 2nd
                if _onnx_session and (frame_count <= 4 or frame_count % 2 == 0):
                    try:
                        t0   = time.time()
                        blob = _preprocess(inf_frame)
                        out  = _onnx_session.run(None, {_onnx_input_name: blob})
                        detections = _postprocess(out[0], orig_h, orig_w)
                        # Offset detection coords back to full-frame space
                        if roi_x1 or roi_y1:
                            for d in detections:
                                d["x1"] += roi_x1
                                d["x2"] += roi_x1
                                d["y1"] += roi_y1
                                d["y2"] += roi_y1
                        inf_ms = (time.time() - t0) * 1000
                    except Exception as e:
                        print(f"[CV] Inference error: {e}")

                now = time.time()
                fps = 1.0 / max(now - prev_time, 1e-6)
                prev_time = now

                # Update shared state
                with state_lock:
                    sensor_state["cv_detections"]   = detections
                    sensor_state["cv_fps"]          = round(fps, 1)
                    sensor_state["cv_inference_ms"] = round(inf_ms, 1)

                    if detections:
                        phase_map = {"Empty": "empty", "Seedling": "seedling", "Vegetative": "vegetative"}
                        for d in detections:
                            if d["confidence"] >= CONF_FLOOR:
                                vote_phase = phase_map.get(d["className"], "empty")
                                with _vote_lock:
                                    _vote_buffer.append((now, vote_phase))

                        slots = []
                        for sidx, d in enumerate(detections[:6]):
                            slots.append({
                                "slot": sidx + 1,
                                "class": d["className"],
                                "confidence": round(d["confidence"] * 100, 1),
                            })
                        while len(slots) < 6:
                            slots.append({"slot": len(slots) + 1, "class": "Empty", "confidence": 0})
                        sensor_state["slots"] = slots

                # Draw detections and ROI boundary on annotated JPEG
                annotated = _draw_detections(frame.copy(), detections)
                if roi["enabled"] and (roi_x1 or roi_y1 or orig_w < full_w or orig_h < full_h):
                    # Draw ROI rectangle (cyan dashed)
                    rx2 = roi_x1 + orig_w
                    ry2 = roi_y1 + orig_h
                    cv2.rectangle(annotated, (roi_x1, roi_y1), (rx2, ry2), (255, 255, 0), 2)
                    cv2.putText(annotated, "ROI", (roi_x1 + 4, roi_y1 + 16),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 0), 1, cv2.LINE_AA)
                _, jpeg = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 70])
                with _latest_frame_lock:
                    _latest_frame_jpeg = jpeg.tobytes()

        except Exception as e:
            print(f"[CV] Unexpected error: {e} — restarting in 3s…")
        finally:
            if cap is not None:
                try:
                    cap.release()
                except Exception:
                    pass
            with state_lock:
                sensor_state["cv_active"] = False

        time.sleep(3)          # brief pause before retry


# ══════════════════════════════════════════════════════════════
#  CV SCHEDULE HELPER  (Night Guard)
#  Returns True when CV phase transitions are allowed.
#  NOTE: Does NOT acquire state_lock — caller must pass in the
#        schedule values to avoid deadlocks.
# ══════════════════════════════════════════════════════════════
def _cv_in_active_window(enabled: bool, on_time_str: str, off_time_str: str) -> bool:
    """Check if the current time falls within the CV active window."""
    if not enabled:
        return True                        # schedule off → always allowed

    now      = datetime.now()
    now_mins = now.hour * 60 + now.minute
    on_h,  on_m  = map(int, on_time_str.split(":"))
    off_h, off_m = map(int, off_time_str.split(":"))
    on_mins  = on_h  * 60 + on_m
    off_mins = off_h * 60 + off_m

    if on_mins == off_mins:
        return False
    elif on_mins < off_mins:
        return on_mins <= now_mins < off_mins
    else:                                  # overnight (e.g. 18:00 → 06:00)
        return now_mins >= on_mins or now_mins < off_mins


# ══════════════════════════════════════════════════════════════
#  PHASE CONSENSUS THREAD
#  Evaluates the sliding vote window every CONSENSUS_EVAL_S seconds.
#  Transitions plant_phase automatically (including to 'empty').
# ══════════════════════════════════════════════════════════════
def phase_consensus_thread():
    """Evaluates CV vote buffer and auto-transitions plant phase."""
    global _last_transition_time
    _ng_was_blocked = False       # tracks Night Guard blocked→active edge

    while True:
        time.sleep(CONSENSUS_EVAL_S)

        now = time.time()
        cutoff = now - CONSENSUS_WINDOW_S

        # ── Prune old votes and snapshot current buffer ──────
        with _vote_lock:
            while _vote_buffer and _vote_buffer[0][0] < cutoff:
                _vote_buffer.popleft()
            votes = list(_vote_buffer)

        if not votes:
            with state_lock:
                sensor_state["consensus_phase"]     = None
                sensor_state["consensus_agreement"] = 0.0
                sensor_state["consensus_votes"]     = 0
            continue

        # ── Count votes per phase ────────────────────────────
        counts = {}
        for _, phase in votes:
            counts[phase] = counts.get(phase, 0) + 1

        total     = len(votes)
        dominant  = max(counts, key=counts.get)
        agreement = counts[dominant] / total

        # ── Check cooldown ───────────────────────────────────
        in_cooldown = (now - _last_transition_time) < COOLDOWN_S

        with state_lock:
            sensor_state["consensus_phase"]     = dominant
            sensor_state["consensus_agreement"] = round(agreement, 3)
            sensor_state["consensus_votes"]     = total
            sensor_state["consensus_cooldown"]  = in_cooldown

            current_phase = sensor_state["plant_phase"]

        # ── Skip if no change needed ─────────────────────────
        if dominant == current_phase:
            continue

        # ── Skip if in cooldown ──────────────────────────────
        if in_cooldown:
            continue

        # ── Skip if CV Night Guard blocks transitions ────────
        with state_lock:
            _ng = sensor_state["cv_schedule"]
            _ng_enabled  = _ng["enabled"]
            _ng_on_time  = _ng["on_time"]
            _ng_off_time = _ng["off_time"]
        _ng_active_now = _cv_in_active_window(_ng_enabled, _ng_on_time, _ng_off_time)
        if not _ng_active_now:
            _ng_was_blocked = True
            continue

        # ── Flush stale votes on blocked → active transition ─
        if _ng_was_blocked:
            _ng_was_blocked = False
            with _vote_lock:
                _vote_buffer.clear()
            print("[Consensus] Night Guard window opened — vote buffer cleared")
            continue          # let fresh votes accumulate

        # ── Check threshold ──────────────────────────────────
        if agreement < CONSENSUS_THRESHOLD:
            continue

        # ── TRANSITION ───────────────────────────────────────
        _last_transition_time = now
        ts = datetime.now(timezone.utc).isoformat()

        with state_lock:
            old_phase = sensor_state["plant_phase"]
            sensor_state["plant_phase"] = dominant
            sensor_state["phase_locked"] = False
            sensor_state["phase_event"] = {
                "from": old_phase,
                "to":   dominant,
                "ts":   ts,
                "agreement": round(agreement, 3),
            }

        print(f"[Consensus] Phase transition: {old_phase} → {dominant}  "
              f"(agreement={agreement:.0%}, votes={total})")

        # ── Apply misting config for new phase ───────────────
        if dominant == "empty":
            # Empty = no plants → stop misting immediately
            with state_lock:
                sensor_state["misting_manual"] = True
            print("[Consensus] Transitioned to empty — misting paused")
        else:
            mc = MISTING_CONFIG_DEFAULTS.get(dominant)
            if mc:
                with _misting_lock:
                    global _misting_on_s, _misting_off_s
                    _misting_on_s  = mc["on_sec"]
                    _misting_off_s = mc["off_sec"]
                print(f"[Consensus] Misting updated: ON={mc['on_sec']}s, OFF={mc['off_sec']}s")

                # Also update misting_manual so the misting cycle runs
                with state_lock:
                    sensor_state["misting_manual"] = False

        # ── Persist to disk ──────────────────────────────────
        _save_config(dominant, {p: v for p, v in MISTING_CONFIG_DEFAULTS.items()})

        # ── Clear the vote buffer to avoid re-triggering ─────
        with _vote_lock:
            _vote_buffer.clear()


# ══════════════════════════════════════════════════════════════
#  HISTORY SNAPSHOT THREAD
#  Takes a snapshot of current sensor values every 10 seconds
#  and appends to the history buffer (max HISTORY_MAX entries).
# ══════════════════════════════════════════════════════════════
def history_thread():
    """Records sensor snapshots every 10 seconds."""
    while True:
        time.sleep(10)
        with state_lock:
            entry = {
                "reservoir": {
                    "ph":  sensor_state["ph"],
                    "tds": sensor_state["tds"],
                    "distance": sensor_state["reservoir_distance"],
                    "volume":   sensor_state["reservoir_volume"],
                },
                "environment": {
                    "temperature": sensor_state["temperature"],
                    "humidity":    sensor_state["humidity"],
                },
                "plantPhase":    sensor_state["plant_phase"],
                "mistingActive": sensor_state["misting_active"],
                "lastUpdated":   sensor_state["last_updated"],
                "timestamp":     datetime.now(timezone.utc).isoformat(),
            }
            history_buffer.append(entry)
            # Trim to max size
            while len(history_buffer) > HISTORY_MAX:
                history_buffer.pop(0)


def light_schedule_thread():
    """Background thread: enforces grow light on/off times when mode is 'schedule'."""
    while True:
        time.sleep(30)  # check every 30 seconds
        try:
            with state_lock:
                mode         = sensor_state["light"]["mode"]
                on_time_str  = sensor_state["light"]["on_time"]
                off_time_str = sensor_state["light"]["off_time"]

            if mode != "schedule":
                continue

            now      = datetime.now()
            now_mins = now.hour * 60 + now.minute
            on_h,  on_m  = map(int, on_time_str.split(":"))
            off_h, off_m = map(int, off_time_str.split(":"))
            on_mins  = on_h  * 60 + on_m
            off_mins = off_h * 60 + off_m

            if on_mins == off_mins:
                should_be_on = False
            elif on_mins < off_mins:
                should_be_on = on_mins <= now_mins < off_mins
            else:  # overnight schedule (e.g. 20:00 → 06:00)
                should_be_on = now_mins >= on_mins or now_mins < off_mins

            if "grow_light" in relays:
                current = relays["grow_light"].state
                if current != should_be_on:
                    relays["grow_light"].set(should_be_on)
                    print(f"[LightSchedule] → {'ON' if should_be_on else 'OFF'} at {now.strftime('%H:%M')}")
        except Exception as e:
            print(f"[LightSchedule] Error: {e}")


# ══════════════════════════════════════════════════════════════
#  HELPER — build the /api/status response
# ══════════════════════════════════════════════════════════════



def build_status_response() -> dict:
    """Assembles the JSON payload that the mobile app expects."""
    # Read misting timing globals first (short lock)
    with _misting_lock:
        on_s  = _misting_on_s
        off_s = _misting_off_s

    # Then read sensor state (separate lock to avoid contention with DHT thread)
    with state_lock:
        misting_active  = sensor_state["misting_active"]
        cycle_phase     = sensor_state["misting_cycle_phase"]    # 'on' | 'off'
        cycle_elapsed   = sensor_state["misting_cycle_elapsed"]  # seconds into current phase

        # Remaining seconds in current phase
        if misting_active:   # ON phase
            remaining_s = max(0.0, on_s  - cycle_elapsed)
        else:                # OFF phase
            remaining_s = max(0.0, off_s - cycle_elapsed)

        next_misting = round(remaining_s / 60, 2)     # minutes
        misting_interval = round((on_s + off_s) / 60, 2)
        # Use the epoch stored directly by misting_thread — no recomputation drift
        cycle_end_epoch = sensor_state["misting_phase_end_epoch"]

        return {
            "reservoir": {
                "ph":  sensor_state["ph"],
                "tds": sensor_state["tds"],
                "distance": sensor_state["reservoir_distance"],
                "volume":   sensor_state["reservoir_volume"],
            },
            "environment": {
                "temperature": sensor_state["temperature"],
                "humidity":    sensor_state["humidity"],
            },
            "mistingActive":        misting_active,
            "mistingInterval":      misting_interval,
            "mistingOnSec":         on_s,
            "mistingOffSec":        off_s,
            "mistingCyclePhase":    cycle_phase,
            "mistingCycleElapsed":  cycle_elapsed,
            "mistingCycleEndEpoch": cycle_end_epoch,
            "nextMisting":          next_misting,
            "plantPhase":           sensor_state["plant_phase"],
            "slots":                sensor_state["slots"],
            "relays": {
                name: relay.state for name, relay in relays.items()
            },
            "conductivity":        sensor_state["conductivity"],
            "conductivityPreset":  sensor_state.get("conductivity_preset", COND_DEFAULT_PRESET),
            "conductivityPresets": {k: v for k, v in COND_PRESETS.items()},
            "dosingActive":    sensor_state["dosing_active"],
            "dosingStep":      sensor_state["dosing_step"],
            "light":           sensor_state["light"],
            "tdsTarget":       TDS_TARGET.get(sensor_state["plant_phase"], {}),
            "mistingManual":   sensor_state["misting_manual"],
            "mistingConfig":   dict(_misting_config_app),
            "consensus": {
                "phase":     sensor_state["consensus_phase"],
                "agreement": sensor_state["consensus_agreement"],
                "votes":     sensor_state["consensus_votes"],
                "cooldown":  sensor_state["consensus_cooldown"],
                "windowSec": CONSENSUS_WINDOW_S,
                "threshold": CONSENSUS_THRESHOLD,
            },
            "phaseEvent":      sensor_state["phase_event"],
            "cvSchedule": {
                "enabled":  sensor_state["cv_schedule"]["enabled"],
                "on_time":  sensor_state["cv_schedule"]["on_time"],
                "off_time": sensor_state["cv_schedule"]["off_time"],
                "active":   _cv_in_active_window(
                    sensor_state["cv_schedule"]["enabled"],
                    sensor_state["cv_schedule"]["on_time"],
                    sensor_state["cv_schedule"]["off_time"],
                ),
            },
            "cvRoi": {
                "enabled": sensor_state["cv_roi"]["enabled"],
                "x_pct":   sensor_state["cv_roi"]["x_pct"],
                "y_pct":   sensor_state["cv_roi"]["y_pct"],
                "w_pct":   sensor_state["cv_roi"]["w_pct"],
                "h_pct":   sensor_state["cv_roi"]["h_pct"],
            },
            "lastUpdated":     sensor_state["last_updated"],
        }


# ══════════════════════════════════════════════════════════════
#  FLASK APP
# ══════════════════════════════════════════════════════════════
app = Flask(__name__)
CORS(app)  # Allow cross-origin requests from the mobile app


# ── GET /api/status ───────────────────────────────────────────
@app.route("/api/status", methods=["GET"])
def api_status():
    """Returns current sensor readings and device state."""
    return jsonify(build_status_response())


# ── GET /api/health ───────────────────────────────────────────
@app.route("/api/health", methods=["GET"])
def api_health():
    """
    Diagnostic endpoint — shows subsystem status so you can tell
    what's working and what isn't without SSH.
    """
    # Check I2C for LiDAR
    i2c_ok = False
    i2c_addrs = []
    try:
        result = subprocess.run(
            ["i2cdetect", "-y", "1"],
            capture_output=True, text=True, timeout=5,
        )
        # Parse addresses from i2cdetect output (0x29 = VL53L0X default)
        for line in result.stdout.splitlines():
            for token in line.split():
                if len(token) == 2 and all(c in "0123456789abcdef" for c in token):
                    i2c_addrs.append(f"0x{token}")
        i2c_ok = "0x29" in i2c_addrs
    except Exception as e:
        i2c_addrs = [f"error: {e}"]

    # Check available /dev/video devices
    video_devs = sorted(glob.glob("/dev/video*"))

    with state_lock:
        cv_active = sensor_state["cv_active"]
        cv_fps    = sensor_state["cv_fps"]
        reservoir = sensor_state["reservoir_volume"]
        last_upd  = sensor_state["last_updated"]

    return jsonify({
        "subsystems": {
            "serial":  {"available": HAS_SERIAL, "port": SERIAL_PORT},
            "dht22":   {"available": HAS_DHT},
            "lidar":   {
                "available": HAS_LIDAR,
                "i2c_ok":    i2c_ok,
                "i2c_addrs": i2c_addrs,
                "volume":    reservoir,
            },
            "cv":      {
                "available":    HAS_CV,
                "onnx":         HAS_ONNX,
                "active":       cv_active,
                "fps":          cv_fps,
                "video_devs":   video_devs,
                "model_path":   MODEL_PATH,
                "model_exists": os.path.isfile(MODEL_PATH),
            },
            "gpio":    {"available": HAS_GPIO},
        },
        "lastUpdated": last_upd,
    })


# ── GET /api/history ──────────────────────────────────────────
@app.route("/api/history", methods=["GET"])
def api_history():
    """Returns the last N sensor snapshots."""
    with state_lock:
        return jsonify({"history": list(history_buffer)})


# ── POST /api/relay ───────────────────────────────────────────
@app.route("/api/relay", methods=["POST"])
def api_relay():
    """
    Toggle a relay on or off.
    Body: { "relay": "mist_pump", "state": true }
    Valid relay names: submersible, mist_pump, peristaltic_1,
                       peristaltic_2, peristaltic_3, grow_light
    """
    body = request.get_json(silent=True) or {}
    relay_name = body.get("relay")
    new_state  = body.get("state")

    if relay_name not in relays:
        return jsonify({"error": f"Unknown relay: {relay_name}"}), 400
    if not isinstance(new_state, bool):
        return jsonify({"error": "state must be true or false"}), 400

    # When the app manually controls mist_pump, pause the auto-misting cycle
    # so the thread doesn't immediately override the user's command.
    if relay_name == "mist_pump":
        with state_lock:
            sensor_state["misting_manual"] = True

    relays[relay_name].set(new_state)

    # Keep grow light state in sync so it persists across reboots
    if relay_name == "grow_light":
        with state_lock:
            sensor_state["light"]["state"] = new_state
        _save_light_config()

    print(f"[Relay] {relay_name} → {'ON' if new_state else 'OFF'}")
    return jsonify({"ok": True, "relay": relay_name, "state": new_state})


# ── POST /api/dose ────────────────────────────────────────────


# ── GET /api/conductivity/status ───────────────────────────────
@app.route("/api/conductivity/status", methods=["GET"])
def api_conductivity_status():
    """
    Lightweight endpoint returning ONLY conductivity data.
    Designed for fast polling (~500 ms) from the mobile app
    while the Conductivity Test modal is open.
    """
    with state_lock:
        return jsonify({
            "conductivity":       sensor_state.get("conductivity", {}),
            "conductivityPreset": sensor_state.get("conductivity_preset", COND_DEFAULT_PRESET),
        })


# ── POST /api/conductivity/preset ─────────────────────────────
@app.route("/api/conductivity/preset", methods=["POST"])
def api_conductivity_preset():
    """
    Switch the conductivity threshold preset.
    Body: { "preset": "nutrient" }  or  { "preset": "water" }
    """
    body = request.get_json(silent=True) or {}
    preset = body.get("preset", "").lower()

    if preset not in COND_PRESETS:
        return jsonify({"error": f"Unknown preset '{preset}'. Valid: {list(COND_PRESETS.keys())}"}), 400

    thresholds = COND_PRESETS[preset]
    with state_lock:
        sensor_state["conductivity_preset"] = preset
        # Update thresholds on existing conductivity data immediately
        for tube_key, thresh in thresholds.items():
            if tube_key in sensor_state["conductivity"]:
                entry = sensor_state["conductivity"][tube_key]
                entry["threshold"] = thresh
                # Re-evaluate conducting status with new threshold
                entry["conducting"] = (entry.get("voltage", 0.0) < thresh)

    # Persist preset to config file
    try:
        existing = {}
        try:
            with open(CONFIG_PATH, "r") as f:
                existing = json.load(f)
        except Exception:
            pass
        existing["conductivity_preset"] = preset
        with open(CONFIG_PATH, "w") as f:
            json.dump(existing, f, indent=2)
    except Exception as e:
        print(f"[Config] Failed to save conductivity preset: {e}")

    print(f"[Conductivity] Preset switched to '{preset}': {thresholds}")
    return jsonify({"ok": True, "preset": preset, "thresholds": thresholds})


@app.route("/api/dose", methods=["POST"])
def api_dose():
    """
    Trigger nutrient dosing sequence.
    Body: { "liters": 2 }        (min 2, max 8 - current_volume)

    New flow:
      Step 0 — CALIBRATION:
        All 3 nutrient pumps ON simultaneously; each stops on conduction
        (or soft 10 s timeout).  Ensures tubes are primed.

      Step 1 — Bloom 2 mL timed dose → pump OFF
      Step 2 — Mix (submersible ON)
      Step 3 — Iron Chelate 2 mL timed dose → pump OFF
      Step 4 — Mix
      Step 5 — Grow 2 mL timed dose → pump OFF
      Step 6 — Mix 1 min (submersible keeps running)

      Step 7 — TDS CHECK (adaptive):
        If plant phase is seedling (target 400–600 ppm) or vegetative
        (target 600–800 ppm):
          • TDS in range → DONE
          • TDS above range → mixer ON, instruct user to add water,
            keep running until manually aborted or TDS drops in range
          • TDS below range → compensation loop:
              Bloom 1 s → 10 s mix → Chelate 1 s → 10 s mix →
              Grow 1 s → 20 s mix → recheck TDS; repeat if still low
    """
    body = request.get_json(silent=True) or {}
    liters = body.get("liters")

    if not isinstance(liters, (int, float)) or liters < 2 or liters > 8:
        return jsonify({"error": "liters must be 2–8"}), 400

    with state_lock:
        if sensor_state["dosing_active"]:
            return jsonify({"error": "Dosing already in progress"}), 409

    # Run dosing in a background thread
    threading.Thread(
        target=_run_dosing, args=(int(liters),), daemon=True
    ).start()

    return jsonify({"ok": True, "liters": int(liters)})


# The three nutrient pumps in dosing order:
#   Bloom  → peristaltic_1, conductivity tube_3 (A5)
#   Chelate→ peristaltic_2, conductivity tube_2 (A4)
#   Grow   → peristaltic_3, conductivity tube_1 (A3)
_DOSE_SEQUENCE = [
    {"name": "Bloom Solution",   "relay": "peristaltic_1", "tube": "tube_3"},
    {"name": "Chelate Solution", "relay": "peristaltic_2", "tube": "tube_2"},
    {"name": "Grow Solution",    "relay": "peristaltic_3", "tube": "tube_1"},
]

# Pump flow rate (mL per second) — calibrate per pump if needed
PUMP_FLOW_RATES = {
    "peristaltic_1": 1.0,   # Bloom  pump — mL/s
    "peristaltic_2": 1.0,   # Chelate pump — mL/s
    "peristaltic_3": 1.0,   # Grow   pump — mL/s
}

# Pump timing calibration table (seconds needed for exact mL)
# From empirical testing.  Used for the fixed 2 mL initial dose.
# Column key = mL target → seconds to run the pump.
PUMP_SEC_TABLE = {
    "peristaltic_1": {2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7.5, 8: 8.67},  # Bloom
    "peristaltic_2": {2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7,   8: 8},     # Iron Chelate
    "peristaltic_3": {2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 6.5, 8: 7.5},   # Grow
}

# Fixed initial dose (mL) for all nutrients regardless of refill liters
_INITIAL_DOSE_ML = 2

# Compensation pulse duration (seconds of pump-on per micro-dose)
_COMP_PULSE_SEC = 1
_COMP_MIX_SHORT_SEC = 10   # mix after Bloom and Chelate compensation pulse
_COMP_MIX_LONG_SEC  = 20   # mix after Grow compensation pulse before TDS recheck

# Maximum compensation loops before giving up
_COMP_MAX_LOOPS = 10

# Pre-pump timeout (seconds): how long to wait for conduction before
# assuming the tube was already full.  At 1 mL/s, ~8 s = typical tube
# fill time from bottle to tip.  Using 10 s for margin.
# If conduction is detected sooner, pre-pump ends immediately.
# If not detected after this time, we skip to timed dose.
_PREPUMP_TIMEOUT_SEC = 10

# How long the submersible mixer runs between initial nutrient doses
_MIX_BETWEEN_SEC  = 10    # short mix between Bloom → Chelate → Grow
# How long the final mix runs after all 3 initial doses
_MIX_FINAL_SEC    = 60    # 1 minute final mix
# Legacy waits kept for reference
_MIXER_TAIL_SEC = 120     # 2 minutes (unused now — kept for calibration modal)
_WAIT_BETWEEN_SEC = 30    # (unused now — kept for calibration modal)

# Threading event used to abort a running dosing sequence
_dosing_abort_event = threading.Event()


# Minimum voltage for a reading to be considered valid.  A reading of 0 V
# means the probe circuit is unpowered / Arduino not reporting, and must NOT
# be treated as "conducting".
_COND_MIN_VOLTAGE = 0.1
# Maximum age (seconds) of a conductivity reading before it goes stale.
_COND_MAX_AGE_SEC = 2.0


def _tube_conducting(tube_key: str) -> bool:
    """Check if a conductivity tube is currently conducting (thread-safe).

    Guards against false positives:
      • voltage ≤ 0.1 V  → probe unpowered / no real data  → False
      • last_update older than 2 s → stale reading           → False
    """
    with state_lock:
        entry = sensor_state["conductivity"].get(tube_key, {})
        # Reject default / unpowered readings (voltage ≈ 0)
        if entry.get("voltage", 0.0) < _COND_MIN_VOLTAGE:
            return False
        # Reject stale data (serial reader hasn't updated recently)
        age = time.time() - entry.get("last_update", 0)
        if age > _COND_MAX_AGE_SEC:
            return False
        return bool(entry.get("conducting", False))


def _interruptible_sleep(seconds: int, step_label: str = "") -> bool:
    """
    Sleep for `seconds` while updating dosing_countdown each second.
    Returns True if the sleep completed, False if aborted.
    """
    for remaining in range(seconds, 0, -1):
        if _dosing_abort_event.is_set():
            return False
        with state_lock:
            sensor_state["dosing_countdown"] = remaining
            if step_label:
                sensor_state["dosing_step"] = step_label
        time.sleep(1)
    with state_lock:
        sensor_state["dosing_countdown"] = 0
    return True


def _get_current_tds() -> float:
    """Return the current TDS reading as a float, or -1 if unavailable."""
    with state_lock:
        raw = sensor_state.get("tds", "--")
    try:
        return float(raw)
    except (ValueError, TypeError):
        return -1.0


def _get_tds_target() -> dict:
    """Return {"min": X, "max": Y} for the current plant phase, or {} if N/A."""
    with state_lock:
        phase = sensor_state.get("plant_phase", "empty")
    return TDS_TARGET.get(phase, {})


def _dose_pump_sec(relay_key: str, ml: int) -> float:
    """Return how many seconds to run a pump for a given mL target.
    Uses PUMP_SEC_TABLE if available, falls back to mL / flow_rate."""
    table = PUMP_SEC_TABLE.get(relay_key, {})
    if ml in table:
        return table[ml]
    return max(1, round(ml / PUMP_FLOW_RATES.get(relay_key, 1.0)))


def _dosing_cleanup():
    """Safety: turn off all dosing-related relays and reset state."""
    for step in _DOSE_SEQUENCE:
        if step["relay"] in relays:
            relays[step["relay"]].off()
    if "submersible" in relays:
        relays["submersible"].off()
    with state_lock:
        sensor_state["dosing_active"]    = False
        sensor_state["dosing_step"]      = ""
        sensor_state["dosing_countdown"] = 0
        sensor_state["dosing_tds"]       = 0
        sensor_state["dosing_tds_phase"] = ""
        sensor_state["dosing_tds_target"] = {}


def _run_dosing(liters: int):
    """
    Background task — calibration + fixed 2 mL dose + TDS adaptive compensation.

    1. CALIBRATION — all 3 pumps ON simultaneously, stop on conduction
    2. Bloom 2 mL → mix → Chelate 2 mL → mix → Grow 2 mL → 1 min mix
    3. TDS CHECK:
       - In range → done
       - Above → mixer ON, step says "Add water", wait for abort/range
       - Below → compensation loop (1 s per pump, mix, recheck)
    """
    _dosing_abort_event.clear()

    try:
        with state_lock:
            sensor_state["dosing_active"]    = True
            sensor_state["dosing_step"]      = "Starting dosing sequence…"
            sensor_state["dosing_countdown"] = 0
            sensor_state["dosing_tds"]       = _get_current_tds()
            sensor_state["dosing_tds_phase"] = ""
            sensor_state["dosing_tds_target"] = _get_tds_target()

        # ═══════════════════════════════════════════════════════
        #  CALIBRATION — all 3 pumps ON, stop each on conduction
        # ═══════════════════════════════════════════════════════
        with state_lock:
            sensor_state["dosing_step"] = "Calibrating — priming all tubes…"
            sensor_state["dosing_countdown"] = 0

        pending = {}
        for step in _DOSE_SEQUENCE:
            rk = step["relay"]
            if rk in relays:
                relays[rk].on()
            pending[rk] = step["tube"]

        print("[Dose] Calibration started — all 3 pumps ON")

        calib_start = time.time()
        while pending and (time.time() - calib_start < _PREPUMP_TIMEOUT_SEC):
            if _dosing_abort_event.is_set():
                for rk in list(pending):
                    if rk in relays:
                        relays[rk].off()
                raise InterruptedError("Dosing aborted")

            for rk, tk in list(pending.items()):
                if _tube_conducting(tk):
                    if rk in relays:
                        relays[rk].off()
                    elapsed = round(time.time() - calib_start, 1)
                    sol = next((s["name"] for s in _DOSE_SEQUENCE if s["relay"] == rk), rk)
                    print(f"[Dose] Calibration: {sol} primed in {elapsed}s")
                    del pending[rk]

            with state_lock:
                remaining = max(0, round(_PREPUMP_TIMEOUT_SEC - (time.time() - calib_start)))
                sensor_state["dosing_countdown"] = remaining

            time.sleep(0.2)

        for rk in list(pending):
            if rk in relays:
                relays[rk].off()
            elapsed = round(time.time() - calib_start, 1)
            sol = next((s["name"] for s in _DOSE_SEQUENCE if s["relay"] == rk), rk)
            print(f"[Dose] Calibration: {sol} no conduction after {elapsed}s — assumed full")

        if _dosing_abort_event.is_set():
            raise InterruptedError("Dosing aborted")

        print("[Dose] Calibration complete — all tubes primed")

        # ═══════════════════════════════════════════════════════
        #  INITIAL FIXED 2 mL DOSES — sequential
        # ═══════════════════════════════════════════════════════
        for idx, step in enumerate(_DOSE_SEQUENCE):
            pump_name = step["relay"]
            sol_name  = step["name"]
            dose_sec  = _dose_pump_sec(pump_name, _INITIAL_DOSE_ML)

            # Turn pump ON for timed dose
            if pump_name in relays:
                relays[pump_name].on()

            ok = _interruptible_sleep(
                int(round(dose_sec)),
                f"{sol_name} — dosing {_INITIAL_DOSE_ML} mL…",
            )
            if pump_name in relays:
                relays[pump_name].off()
            if not ok:
                raise InterruptedError("Dosing aborted")

            print(f"[Dose] {sol_name} dosed {_INITIAL_DOSE_ML} mL ({dose_sec}s)")

            # Submersible mixer ON after first nutrient
            if idx == 0:
                if "submersible" in relays:
                    relays["submersible"].on()

            # Mix between nutrients (short mix)
            if idx < len(_DOSE_SEQUENCE) - 1:
                ok = _interruptible_sleep(
                    _MIX_BETWEEN_SEC,
                    f"{sol_name} done ✓ — mixing before next nutrient…",
                )
                if not ok:
                    raise InterruptedError("Dosing aborted")

        # ═══════════════════════════════════════════════════════
        #  FINAL MIX — 1 minute
        # ═══════════════════════════════════════════════════════
        if "submersible" not in relays or not relays["submersible"].state:
            if "submersible" in relays:
                relays["submersible"].on()

        ok = _interruptible_sleep(
            _MIX_FINAL_SEC,
            f"Initial dose complete — mixing for {_MIX_FINAL_SEC}s…",
        )
        if not ok:
            raise InterruptedError("Dosing aborted")

        # ═══════════════════════════════════════════════════════
        #  TDS CHECK — adaptive compensation
        # ═══════════════════════════════════════════════════════
        target = _get_tds_target()
        if target:
            tds_min = target["min"]
            tds_max = target["max"]

            # Update live TDS in status
            current_tds = _get_current_tds()
            with state_lock:
                sensor_state["dosing_tds"] = current_tds
                sensor_state["dosing_tds_target"] = target

            if current_tds < 0:
                # TDS sensor unavailable — skip adaptive, finish
                print("[Dose] TDS unavailable — skipping adaptive check")
                with state_lock:
                    sensor_state["dosing_tds_phase"] = "unavailable"

            elif current_tds >= tds_min and current_tds <= tds_max:
                # ── IN RANGE → done ──
                print(f"[Dose] TDS {current_tds} ppm in range [{tds_min}–{tds_max}] ✓")
                with state_lock:
                    sensor_state["dosing_tds_phase"] = "in_range"
                    sensor_state["dosing_step"] = f"TDS {current_tds:.0f} ppm — in range ✓"

            elif current_tds > tds_max:
                # ── ABOVE RANGE → instruct user to add water ──
                print(f"[Dose] TDS {current_tds} ppm ABOVE {tds_max} — requesting water ")
                with state_lock:
                    sensor_state["dosing_tds_phase"] = "above_range"
                    sensor_state["dosing_step"] = (
                        f"TDS {current_tds:.0f} ppm too high (max {tds_max}) — "
                        f"add water to dilute, watching TDS…"
                    )
                # Keep mixer running; stay active so app can poll TDS.
                # Loop until TDS falls into range or user aborts.
                while True:
                    if _dosing_abort_event.is_set():
                        raise InterruptedError("Dosing aborted")
                    time.sleep(2)
                    current_tds = _get_current_tds()
                    with state_lock:
                        sensor_state["dosing_tds"] = current_tds
                        sensor_state["dosing_step"] = (
                            f"TDS {current_tds:.0f} ppm — add water to dilute "
                            f"(target ≤ {tds_max})"
                        )
                    if 0 < current_tds <= tds_max:
                        print(f"[Dose] TDS dropped to {current_tds:.0f} — in range ✓")
                        with state_lock:
                            sensor_state["dosing_tds_phase"] = "in_range"
                            sensor_state["dosing_step"] = f"TDS {current_tds:.0f} ppm — in range ✓"
                        break

            else:
                # ── BELOW RANGE → compensation loop ──
                comp_round = 0
                while current_tds < tds_min and comp_round < _COMP_MAX_LOOPS:
                    comp_round += 1
                    print(f"[Dose] TDS {current_tds:.0f} < {tds_min} — compensation round {comp_round}")

                    with state_lock:
                        sensor_state["dosing_tds_phase"] = "below_range"
                        sensor_state["dosing_tds"] = current_tds

                    for cidx, cstep in enumerate(_DOSE_SEQUENCE):
                        cpump = cstep["relay"]
                        csol  = cstep["name"]

                        # Pulse pump for _COMP_PULSE_SEC
                        with state_lock:
                            sensor_state["dosing_step"] = (
                                f"Compensation #{comp_round}: {csol} — "
                                f"{_COMP_PULSE_SEC}s pulse"
                            )
                        if cpump in relays:
                            relays[cpump].on()
                        ok = _interruptible_sleep(
                            _COMP_PULSE_SEC,
                            f"Compensation #{comp_round}: {csol} — "
                            f"{_COMP_PULSE_SEC}s pulse",
                        )
                        if cpump in relays:
                            relays[cpump].off()
                        if not ok:
                            raise InterruptedError("Dosing aborted")

                        # Mix after each pump:
                        #   Bloom, Chelate → short mix
                        #   Grow (last) → longer mix before TDS recheck
                        if cidx < len(_DOSE_SEQUENCE) - 1:
                            mix_sec = _COMP_MIX_SHORT_SEC
                            mix_label = f"Compensation #{comp_round}: mixing {mix_sec}s…"
                        else:
                            mix_sec = _COMP_MIX_LONG_SEC
                            mix_label = f"Compensation #{comp_round}: final mix {mix_sec}s — checking TDS…"

                        if "submersible" in relays and not relays["submersible"].state:
                            relays["submersible"].on()

                        ok = _interruptible_sleep(mix_sec, mix_label)
                        if not ok:
                            raise InterruptedError("Dosing aborted")

                    # Re-read TDS
                    current_tds = _get_current_tds()
                    with state_lock:
                        sensor_state["dosing_tds"] = current_tds

                    if current_tds < 0:
                        print("[Dose] TDS unavailable during compensation — stopping")
                        break
                    if current_tds >= tds_min:
                        print(f"[Dose] TDS {current_tds:.0f} now in range after {comp_round} round(s) ✓")
                        with state_lock:
                            sensor_state["dosing_tds_phase"] = "in_range"
                            sensor_state["dosing_step"] = f"TDS {current_tds:.0f} ppm — in range ✓"
                        break

                if current_tds >= 0 and current_tds < tds_min:
                    print(f"[Dose] TDS {current_tds:.0f} still below after {_COMP_MAX_LOOPS} rounds")
                    with state_lock:
                        sensor_state["dosing_step"] = (
                            f"TDS {current_tds:.0f} ppm — still below {tds_min} after "
                            f"{_COMP_MAX_LOOPS} compensation rounds"
                        )
        else:
            print("[Dose] No plant phase set — skipping TDS adaptive check")

        # ═══════════════════════════════════════════════════════
        #  CLEANUP — mixer OFF, done
        # ═══════════════════════════════════════════════════════
        if "submersible" in relays:
            relays["submersible"].off()

        with state_lock:
            sensor_state["dosing_active"]    = False
            sensor_state["dosing_step"]      = ""
            sensor_state["dosing_countdown"] = 0
            sensor_state["dosing_tds"]       = 0
            sensor_state["dosing_tds_phase"] = ""
            sensor_state["dosing_tds_target"] = {}

        print(f"[Dose] Completed {liters}L dosing sequence")

    except InterruptedError:
        print(f"[Dose] Aborted by user")
        _dosing_cleanup()
    except Exception as e:
        print(f"[Dose] ERROR: {e}")
        _dosing_cleanup()
        with state_lock:
            sensor_state["dosing_step"] = f"Error: {e}"


# ── GET /api/dose/status ──────────────────────────────────────
@app.route("/api/dose/status", methods=["GET"])
def api_dose_status():
    """Returns current dosing state including countdown and live TDS."""
    with state_lock:
        return jsonify({
            "active":    sensor_state["dosing_active"],
            "step":      sensor_state["dosing_step"],
            "countdown": sensor_state.get("dosing_countdown", 0),
            "tds":       sensor_state.get("dosing_tds", 0),
            "tdsPhase":  sensor_state.get("dosing_tds_phase", ""),
            "tdsTarget": sensor_state.get("dosing_tds_target", {}),
        })


# ── POST /api/dose/abort ──────────────────────────────────────
@app.route("/api/dose/abort", methods=["POST"])
def api_dose_abort():
    """Abort a running dosing sequence. Pumps and mixer are turned off."""
    _dosing_abort_event.set()
    # Give the background thread a moment to react
    time.sleep(0.5)
    # Safety fallback: force everything off
    _dosing_cleanup()
    print("[Dose] Abort requested by client")
    return jsonify({"ok": True})


# ══════════════════════════════════════════════════════════════
#  PUMP CALIBRATION — single-pump developer tool
# ══════════════════════════════════════════════════════════════
# Mapping from user-friendly pump name → (relay, tube_key)
_CALIB_PUMPS = {
    "bloom":   {"relay": "peristaltic_1", "tube": "tube_3"},
    "chelate": {"relay": "peristaltic_2", "tube": "tube_2"},
    "grow":    {"relay": "peristaltic_3", "tube": "tube_1"},
}

# Calibration state — independent from the main dosing state
_calib_state = {
    "active": False,
    "pump":   "",
    "step":   "",
    "countdown": 0,
}
_calib_abort = threading.Event()
_calib_lock  = threading.Lock()


def _run_calibration(pump_name: str, ml: int = 0, seconds: int = 0, mode: str = "ml"):
    """
    Background task — single-pump calibration.

    mode="ml" (default):
      Phase A — PRE-PUMP: Pump ON, wait for conductivity (soft 10 s timeout).
      Phase B — TIMED DOSE: Pump stays ON for (ml / flow_rate) seconds.

    mode="timed":
      No pre-pump / conduction check.  Pump ON for exactly `seconds` seconds,
      then OFF.  Raw time-based dispensing for calibration.
    """
    info = _CALIB_PUMPS[pump_name]
    relay_key = info["relay"]
    tube_key  = info["tube"]

    if mode == "timed":
        run_sec = max(1, seconds)
        label   = f"{run_sec}s"
    else:
        flow_rate = PUMP_FLOW_RATES.get(relay_key, 1.0)
        run_sec   = max(1, round(ml / flow_rate))
        label     = f"{ml} mL"

    _calib_abort.clear()

    try:
        with _calib_lock:
            _calib_state["active"]    = True
            _calib_state["pump"]      = pump_name
            _calib_state["countdown"] = 0

        # ── Phase A: PRE-PUMP (mL mode only) ───────────────────
        if mode == "ml":
            with _calib_lock:
                _calib_state["step"] = "Pre-pump — waiting for conduction…"

            if relay_key in relays:
                relays[relay_key].on()

            prepump_start = time.time()
            conduction_detected = False
            while time.time() - prepump_start < _PREPUMP_TIMEOUT_SEC:
                if _calib_abort.is_set():
                    if relay_key in relays:
                        relays[relay_key].off()
                    raise InterruptedError("Calibration aborted")
                if _tube_conducting(tube_key):
                    conduction_detected = True
                    break
                time.sleep(0.2)

            elapsed = round(time.time() - prepump_start, 1)
            if conduction_detected:
                print(f"[Calib] {pump_name} tube primed in {elapsed}s")
            else:
                print(f"[Calib] {pump_name} no conduction after {elapsed}s — proceeding")
        else:
            # timed mode — turn pump on, no conduction wait
            if relay_key in relays:
                relays[relay_key].on()

        # ── Phase B: TIMED RUN ─────────────────────────────────
        for remaining in range(run_sec, 0, -1):
            if _calib_abort.is_set():
                if relay_key in relays:
                    relays[relay_key].off()
                raise InterruptedError("Calibration aborted")
            with _calib_lock:
                _calib_state["step"]      = f"Pumping {pump_name} — {remaining}s left ({label})"
                _calib_state["countdown"] = remaining
            time.sleep(1)

        # Pump OFF
        if relay_key in relays:
            relays[relay_key].off()

        with _calib_lock:
            _calib_state["active"]    = False
            _calib_state["pump"]      = ""
            _calib_state["step"]      = ""
            _calib_state["countdown"] = 0

        print(f"[Calib] {pump_name} done — {label} ({run_sec}s)")

    except InterruptedError:
        print(f"[Calib] {pump_name} aborted by user")
        with _calib_lock:
            _calib_state["active"]    = False
            _calib_state["pump"]      = ""
            _calib_state["step"]      = ""
            _calib_state["countdown"] = 0
    except Exception as e:
        print(f"[Calib] ERROR: {e}")
        # Safety: turn off the pump
        if relay_key in relays:
            relays[relay_key].off()
        with _calib_lock:
            _calib_state["active"]    = False
            _calib_state["pump"]      = ""
            _calib_state["step"]      = f"Error: {e}"
            _calib_state["countdown"] = 0


@app.route("/api/pump/calibrate", methods=["POST"])
def api_pump_calibrate():
    """
    Start a single-pump calibration run.

    mL mode  (default):  { "pump": "bloom", "ml": 5 }
      → pre-pump conduction + timed dose (ml ÷ flow_rate seconds)

    Timed mode:          { "pump": "bloom", "seconds": 5, "mode": "timed" }
      → no conduction, raw pump-on for exactly N seconds
    """
    body = request.get_json(silent=True) or {}
    pump = body.get("pump", "").lower()
    mode = body.get("mode", "ml").lower()

    if pump not in _CALIB_PUMPS:
        return jsonify({"error": f"Unknown pump '{pump}'. Valid: bloom, chelate, grow"}), 400

    if mode == "timed":
        seconds = body.get("seconds")
        if not isinstance(seconds, (int, float)) or seconds < 1 or seconds > 9:
            return jsonify({"error": "seconds must be 1–9"}), 400
        seconds = int(seconds)
        ml = 0
    else:
        mode = "ml"
        ml = body.get("ml")
        if not isinstance(ml, (int, float)) or ml < 1 or ml > 8:
            return jsonify({"error": "ml must be 1–8"}), 400
        ml = int(ml)
        seconds = 0

    with _calib_lock:
        if _calib_state["active"]:
            return jsonify({"error": f"Calibration already running ({_calib_state['pump']})"}), 409

    with state_lock:
        if sensor_state["dosing_active"]:
            return jsonify({"error": "Cannot calibrate while dosing is active"}), 409

    threading.Thread(
        target=_run_calibration,
        args=(pump,),
        kwargs={"ml": ml, "seconds": seconds, "mode": mode},
        daemon=True,
    ).start()

    resp = {"ok": True, "pump": pump, "mode": mode}
    resp["seconds" if mode == "timed" else "ml"] = seconds if mode == "timed" else ml
    return jsonify(resp)


@app.route("/api/pump/calibrate/status", methods=["GET"])
def api_pump_calibrate_status():
    """Returns current calibration state."""
    with _calib_lock:
        return jsonify({
            "active":    _calib_state["active"],
            "pump":      _calib_state["pump"],
            "step":      _calib_state["step"],
            "countdown": _calib_state["countdown"],
        })


@app.route("/api/pump/calibrate/abort", methods=["POST"])
def api_pump_calibrate_abort():
    """Abort a running calibration. The pump is turned off."""
    _calib_abort.set()
    time.sleep(0.5)
    # Safety: force all peristaltic pumps off
    for info in _CALIB_PUMPS.values():
        if info["relay"] in relays:
            relays[info["relay"]].off()
    with _calib_lock:
        _calib_state["active"]    = False
        _calib_state["pump"]      = ""
        _calib_state["step"]      = ""
        _calib_state["countdown"] = 0
    print("[Calib] Abort requested by client")
    return jsonify({"ok": True})


# ── POST /api/light ───────────────────────────────────────────
@app.route("/api/light", methods=["POST"])
def api_light():
    """
    Control the grow light.
    Body: { "mode": "manual", "state": true }
       or { "mode": "schedule", "on_time": "18:00", "off_time": "06:00" }
    """
    body = request.get_json(silent=True) or {}
    mode = body.get("mode")

    if mode not in ("manual", "schedule"):
        return jsonify({"error": "mode must be 'manual' or 'schedule'"}), 400

    with state_lock:
        sensor_state["light"]["mode"] = mode

        if mode == "manual":
            state = body.get("state", False)
            sensor_state["light"]["state"] = bool(state)
            if "grow_light" in relays:
                relays["grow_light"].set(bool(state))
            print(f"[Light] Manual → {'ON' if state else 'OFF'}")

        elif mode == "schedule":
            on_time  = body.get("on_time",  sensor_state["light"]["on_time"])
            off_time = body.get("off_time", sensor_state["light"]["off_time"])
            sensor_state["light"]["on_time"]  = on_time
            sensor_state["light"]["off_time"] = off_time
            print(f"[Light] Schedule → ON {on_time}, OFF {off_time}")

    _save_light_config()
    return jsonify({"ok": True})


# ── POST /api/cv/schedule ────────────────────────────────────
@app.route("/api/cv/schedule", methods=["POST"])
def api_cv_schedule():
    """
    Control CV Night Guard schedule.
    Body: { "enabled": true }
       or { "enabled": true, "on_time": "06:00", "off_time": "18:00" }
    """
    body = request.get_json(silent=True) or {}

    with state_lock:
        if "enabled" in body:
            sensor_state["cv_schedule"]["enabled"] = bool(body["enabled"])
        if "on_time" in body:
            sensor_state["cv_schedule"]["on_time"] = body["on_time"]
        if "off_time" in body:
            sensor_state["cv_schedule"]["off_time"] = body["off_time"]
        sched = dict(sensor_state["cv_schedule"])

    _save_cv_schedule_config()
    active = _cv_in_active_window(sched["enabled"], sched["on_time"], sched["off_time"])
    print(f"[CVSchedule] enabled={sched['enabled']}, on={sched['on_time']}, off={sched['off_time']}, active_now={active}")
    return jsonify({"ok": True, "active": active})


# ── POST /api/cv/roi ─────────────────────────────────────────
@app.route("/api/cv/roi", methods=["POST"])
def api_cv_roi():
    """
    Set the CV Region of Interest (crop area for inference).
    Body: { "enabled": true, "x_pct": 10, "y_pct": 5, "w_pct": 80, "h_pct": 90 }
       or { "enabled": false }                 — disable ROI (full frame)
    All _pct values are 0-100 (percentage of frame dimensions).
    """
    body = request.get_json(silent=True) or {}

    with state_lock:
        if "enabled" in body:
            sensor_state["cv_roi"]["enabled"] = bool(body["enabled"])
        for key in ("x_pct", "y_pct", "w_pct", "h_pct"):
            if key in body:
                val = max(0, min(100, float(body[key])))
                sensor_state["cv_roi"][key] = round(val, 1)
        roi = dict(sensor_state["cv_roi"])

    _save_cv_roi_config()
    print(f"[CV ROI] enabled={roi['enabled']}, x={roi['x_pct']}%, y={roi['y_pct']}%, w={roi['w_pct']}%, h={roi['h_pct']}%")
    return jsonify({"ok": True, **roi})


# ── DELETE /api/history ──────────────────────────────────────
@app.route("/api/history", methods=["DELETE"])
def api_history_clear():
    """Clears the server-side history buffer and resets all persisted config.
    Also aborts any running dosing sequence."""
    # Abort dosing if running
    _dosing_abort_event.set()
    time.sleep(0.3)
    _dosing_cleanup()
    with state_lock:
        history_buffer.clear()
    _clear_config()
    print("[History] Cleared, dosing aborted, and config reset by app reset")
    return jsonify({"ok": True})


# ── POST /api/misting ─────────────────────────────────────────
@app.route("/api/misting", methods=["POST"])
def api_misting_mode():
    """
    Switch misting between auto-cycle and manual (user-controlled) mode.
    Body: { "mode": "auto" }  — re-enables the timed misting cycle.
          { "mode": "manual" } — pauses the cycle (manual relay control).
    """
    body = request.get_json(silent=True) or {}
    mode = body.get("mode")
    if mode not in ("auto", "manual"):
        return jsonify({"error": "mode must be 'auto' or 'manual'"}), 400
    with state_lock:
        sensor_state["misting_manual"] = (mode == "manual")
    print(f"[Misting] Mode set to: {mode}")
    return jsonify({"ok": True, "mode": mode})


# ── POST /api/phase ───────────────────────────────────────────
@app.route("/api/phase", methods=["POST"])
def api_phase():
    """
    Manually set plant phase to 'empty' only (trash-bin / reset action).
    For seedling/vegetative the consensus system handles transitions.
    Body: { "phase": "empty" }
    """
    global _last_transition_time
    body = request.get_json(silent=True) or {}
    phase = body.get("phase", "").lower()

    if phase not in ("seedling", "vegetative", "empty"):
        return jsonify({"error": "Invalid phase"}), 400

    # Enforce consensus cooldown so CV doesn't immediately override
    _last_transition_time = time.time()

    with state_lock:
        old = sensor_state["plant_phase"]
        sensor_state["plant_phase"] = phase
        sensor_state["phase_locked"] = False   # consensus can override
        if phase == "empty":
            sensor_state["misting_manual"] = True  # stop misting when emptied
        sensor_state["phase_event"] = {
            "from": old, "to": phase,
            "ts": datetime.now(timezone.utc).isoformat(),
            "manual": True,
        }

    # Clear vote buffer so consensus starts fresh
    with _vote_lock:
        _vote_buffer.clear()

    print(f"[Phase] Manually set to: {phase}")
    return jsonify({"ok": True, "phase": phase})


# ── GET /api/misting/config ───────────────────────────────────
@app.route("/api/misting/config", methods=["GET"])
def api_get_misting_config():
    """
    Returns the persisted plant phase and per-phase misting intervals
    in the same format the app uses, so any phone can read the current
    schedule without relying on its own local AsyncStorage.
    """
    try:
        with open(CONFIG_PATH, "r") as f:
            cfg = json.load(f)
        phase       = cfg.get("plant_phase", "empty")
        mc_internal = cfg.get("misting_config", {})
        # Convert internal seconds format → app format (onSec / offMin)
        mc_app = {}
        for p, vals in mc_internal.items():
            mc_app[p] = {
                "onSec":  vals.get("on_sec", 5),
                "offMin": round(vals.get("off_sec", 300) / 60),
            }
        return jsonify({"phase": phase, "mistingConfig": mc_app})
    except FileNotFoundError:
        return jsonify({"phase": "empty", "mistingConfig": {}})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── POST /api/misting/config ──────────────────────────────────
@app.route("/api/misting/config", methods=["POST"])
def api_misting_config():
    """
    Set per-phase misting intervals and activate cycle for the given phase.
    Body: {
        "phase": "seedling",          -- current active phase
        "mistingConfig": {            -- all per-phase intervals
            "seedling": { "onSec": 5, "offMin": 2 },
            "vegetative": { "onSec": 3, "offMin": 3 }
        }
    }
    """
    global _misting_on_s, _misting_off_s, _misting_config_app
    body   = request.get_json(silent=True) or {}
    phase  = body.get("phase", "").lower()
    mc_app = body.get("mistingConfig", {})

    if phase not in ("seedling", "vegetative", "empty"):
        return jsonify({"error": "Invalid phase"}), 400

    # Build internal config (seconds)
    mc_internal = {}
    for p, vals in mc_app.items():
        on_sec  = int(vals.get("onSec",  5))
        off_sec = int(vals.get("offMin", 5)) * 60
        mc_internal[p] = {"on_sec": on_sec, "off_sec": off_sec}

    _misting_config_app = dict(mc_app)

    # Update live intervals for the active phase
    if phase != "empty" and phase in mc_internal:
        with _misting_lock:
            _misting_on_s  = mc_internal[phase]["on_sec"]
            _misting_off_s = mc_internal[phase]["off_sec"]
        print(f"[Misting/Config] Phase={phase}, ON={_misting_on_s}s, OFF={_misting_off_s}s")

    # Update server plant phase
    with state_lock:
        sensor_state["plant_phase"]    = phase
        sensor_state["phase_locked"]   = False   # consensus can still override
        sensor_state["misting_manual"] = (phase == "empty")

    # Persist to disk
    _save_config(phase, mc_internal)

    return jsonify({"ok": True, "phase": phase,
                    "onSec": _misting_on_s, "offSec": _misting_off_s})


# ── POST /api/misting/reset ───────────────────────────────────
@app.route("/api/misting/reset", methods=["POST"])
def api_misting_reset():
    """
    Reset misting intervals to factory defaults.
    """
    global _misting_on_s, _misting_off_s, _last_transition_time
    with _misting_lock:
        _misting_on_s  = MISTING_ON_S
        _misting_off_s = MISTING_OFF_S
    # Enforce consensus cooldown so CV doesn't immediately re-detect
    _last_transition_time = time.time()
    with state_lock:
        old_phase = sensor_state["plant_phase"]   # capture before overwrite
        sensor_state["plant_phase"]    = "empty"
        sensor_state["phase_locked"]   = False   # allow consensus to detect new plants
        sensor_state["misting_manual"] = True
        sensor_state["consensus_phase"]     = None
        sensor_state["consensus_agreement"] = 0.0
        sensor_state["consensus_votes"]     = 0
        sensor_state["consensus_cooldown"]  = False
        sensor_state["phase_event"] = {
            "from": old_phase,
            "to":   "empty",
            "ts":   datetime.now(timezone.utc).isoformat(),
            "agreement": 1.0,
        }
    # Clear vote buffer
    with _vote_lock:
        _vote_buffer.clear()
    # Save phase + misting changes only (preserve Night Guard, ROI, light, etc.)
    _save_config("empty", {})
    print("[Misting/Reset] Phase emptied — awaiting consensus detection")
    return jsonify({"ok": True})


# ── GET /api/cv/status ────────────────────────────────────────
@app.route("/api/cv/status", methods=["GET"])
def api_cv_status():
    """Returns current CV detections and stats."""
    with state_lock:
        return jsonify({
            "active":      sensor_state["cv_active"],
            "fps":         sensor_state["cv_fps"],
            "inferenceMs": sensor_state["cv_inference_ms"],
            "detections":  sensor_state["cv_detections"],
            "slots":       sensor_state["slots"],
            "plantPhase":  sensor_state["plant_phase"],
        })


# ── GET /api/cv/frame ─────────────────────────────────────────
@app.route("/api/cv/frame", methods=["GET"])
def api_cv_frame():
    """Returns the latest annotated camera frame as JPEG."""
    with _latest_frame_lock:
        jpeg = _latest_frame_jpeg
    if jpeg is None:
        return Response("No frame available", status=503)
    return Response(jpeg, mimetype="image/jpeg",
                    headers={"Cache-Control": "no-store"})


# ── GET /api/cv/stream (MJPEG) ────────────────────────────────
@app.route("/api/cv/stream", methods=["GET"])
def api_cv_stream():
    """Streams annotated frames as MJPEG (for browser / debug)."""
    def generate():
        while True:
            with _latest_frame_lock:
                jpeg = _latest_frame_jpeg
            if jpeg:
                yield (b"--frame\r\n"
                       b"Content-Type: image/jpeg\r\n\r\n" + jpeg + b"\r\n")
            time.sleep(0.1)   # ~10 fps stream
    return Response(generate(), mimetype="multipart/x-mixed-replace; boundary=frame")


# ══════════════════════════════════════════════════════════════
#  STARTUP
# ══════════════════════════════════════════════════════════════
def main():
    global _onnx_session, _onnx_input_name

    print("=" * 56)
    print("  HerbanalytiX API Server")
    print("  Listening on http://0.0.0.0:5000")
    print("=" * 56)

    # Initialize ONNX model
    if HAS_ONNX and os.path.exists(MODEL_PATH):
        try:
            _onnx_session   = ort.InferenceSession(
                MODEL_PATH, providers=["CPUExecutionProvider"]
            )
            _onnx_input_name = _onnx_session.get_inputs()[0].name
            print(f"  [ONNX] Model loaded: {MODEL_PATH}")
            # Warm-up: first inference compiles the graph and is ~2-3× slower.
            # Running a dummy pass here moves that cost to startup instead
            # of delaying the first real camera frame.
            _dummy = np.zeros((1, 3, INPUT_SIZE, INPUT_SIZE), dtype=np.float32)
            _onnx_session.run(None, {_onnx_input_name: _dummy})
            print(f"  [ONNX] Warm-up inference complete")
        except Exception as e:
            print(f"  [ONNX] Load failed: {e}")
    else:
        print("  [ONNX] Model not available — CV inference disabled")

    # Load persisted config (phase + misting intervals)
    _load_config()

    # Initialize relays
    for name, pin in RELAY_PINS.items():
        relays[name] = Relay(pin)
        print(f"  [Relay] {name:16s} → GPIO {pin}")

    # Restore grow light relay state if it was manually ON before reboot
    with state_lock:
        should_restore = sensor_state["light"].pop("_restore_on", False)
    if should_restore and "grow_light" in relays:
        relays["grow_light"].on()
        print("  [Light] Restored grow_light → ON (from saved config)")

    # Start background threads
    threads = [
        ("Serial",        serial_thread),
        ("DHT22",         dht_thread),
        ("LiDAR",         lidar_thread),
        ("Misting",       misting_thread),
        ("History",       history_thread),
        ("LightSchedule", light_schedule_thread),
        ("Camera/CV",     camera_cv_thread),
        ("Consensus",     phase_consensus_thread),
    ]
    for label, target in threads:
        t = threading.Thread(target=target, daemon=True)
        t.start()
        print(f"  [Thread] {label} started")

    print()

    # Run Flask (use_reloader=False because we manage our own threads)
    app.run(host="0.0.0.0", port=5000, debug=False, use_reloader=False, threaded=True)


if __name__ == "__main__":
    main()
