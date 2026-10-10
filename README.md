# HerbanalytiX 🌿📷

**HerbanalytiX** is an automated aeroponics monitoring and control system powered by computer vision. It leverages real-time visual analysis to dynamically regulate nutrient pump dosing cycles and optimize grow-light scheduling for improved plant growth and resource efficiency.

---

## 🔑 Key Features

* **Visual Growth & Health Monitoring:** Real-time camera feed analysis using computer vision to track plant health and growth stages.
* **Automated Pump Management:** Smart timing and adaptive duty cycles for high-pressure nutrient misting based on visual plant metrics.
* **Dynamic Lighting Schedules:** Visual detection-assisted light control to adjust photoperiod duration and intensity.
* **Dataset Management:** Integrated dataset annotation and preprocessing pipeline (CVAT / Roboflow).

---

## 🏗️ System Architecture

```text
  [ Camera / CV Sensor ] ───► [ Computer Vision Pipeline ]
                                       │
                                       ▼
 [ Actuators: Pumps & Lights ] ◄─── [ Control Logic / Decision Engine ]
