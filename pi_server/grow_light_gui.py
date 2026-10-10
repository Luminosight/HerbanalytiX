#!/usr/bin/env python3
"""
HerbanalytiX — Grow Light Control GUI
Standalone tkinter app that toggles the grow light relay
via the Flask API running on the same Pi (or a remote host).
"""

import tkinter as tk
import threading
import urllib.request
import json

API_BASE = "http://127.0.0.1:5000"

class GrowLightApp:
    def __init__(self, root):
        self.root = root
        self.root.title("HerbanalytiX — Grow Light")
        self.root.resizable(False, False)
        self.root.configure(bg="#0D2818")

        self.light_on = False
        self.busy = False

        # ── Title ─────────────────────────────────────────
        tk.Label(
            root, text="Grow Light Control",
            font=("Helvetica", 16, "bold"), fg="#ECFDF5", bg="#0D2818",
        ).pack(pady=(20, 4))

        tk.Label(
            root, text="HerbanalytiX",
            font=("Helvetica", 9), fg="#74C69D", bg="#0D2818",
        ).pack()

        # ── Status indicator ──────────────────────────────
        self.status_frame = tk.Frame(root, bg="#0D2818")
        self.status_frame.pack(pady=(18, 8))

        self.dot_canvas = tk.Canvas(
            self.status_frame, width=14, height=14,
            bg="#0D2818", highlightthickness=0,
        )
        self.dot_canvas.pack(side=tk.LEFT, padx=(0, 6))
        self.dot = self.dot_canvas.create_oval(2, 2, 12, 12, fill="#555")

        self.status_label = tk.Label(
            self.status_frame, text="OFF",
            font=("Helvetica", 13, "bold"), fg="#888", bg="#0D2818",
        )
        self.status_label.pack(side=tk.LEFT)

        # ── Toggle button ─────────────────────────────────
        self.btn = tk.Button(
            root, text="Turn ON", font=("Helvetica", 14, "bold"),
            fg="#ECFDF5", bg="#2D6A4F", activebackground="#40916C",
            activeforeground="#fff", relief="flat", cursor="hand2",
            width=16, height=2, command=self.toggle,
        )
        self.btn.pack(pady=(12, 20))

        # Fetch initial state
        self._poll_state()

    # ── API helpers ───────────────────────────────────────
    def _post(self, path, body):
        data = json.dumps(body).encode()
        req = urllib.request.Request(
            f"{API_BASE}{path}", data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            return json.loads(resp.read())

    def _get(self, path):
        req = urllib.request.Request(f"{API_BASE}{path}", method="GET")
        with urllib.request.urlopen(req, timeout=5) as resp:
            return json.loads(resp.read())

    # ── Poll current state on startup ─────────────────────
    def _poll_state(self):
        def _do():
            try:
                data = self._get("/api/status")
                on = data.get("light", {}).get("state", False)
                self.root.after(0, lambda: self._update_ui(on))
            except Exception:
                self.root.after(0, lambda: self._set_error("Server offline"))
        threading.Thread(target=_do, daemon=True).start()

    # ── Toggle logic ──────────────────────────────────────
    def toggle(self):
        if self.busy:
            return
        self.busy = True
        new_state = not self.light_on
        self.btn.configure(state="disabled", text="...")

        def _do():
            try:
                self._post("/api/relay", {"relay": "grow_light", "state": new_state})
                self.root.after(0, lambda: self._update_ui(new_state))
            except Exception as e:
                self.root.after(0, lambda: self._set_error(str(e)))
            finally:
                self.root.after(0, self._unlock)

        threading.Thread(target=_do, daemon=True).start()

    def _unlock(self):
        self.busy = False
        self.btn.configure(state="normal")

    # ── UI updates ────────────────────────────────────────
    def _update_ui(self, on: bool):
        self.light_on = on
        if on:
            self.dot_canvas.itemconfig(self.dot, fill="#4ADE80")
            self.status_label.configure(text="ON", fg="#4ADE80")
            self.btn.configure(text="Turn OFF", bg="#7C3AED", activebackground="#6D28D9")
        else:
            self.dot_canvas.itemconfig(self.dot, fill="#555")
            self.status_label.configure(text="OFF", fg="#888")
            self.btn.configure(text="Turn ON", bg="#2D6A4F", activebackground="#40916C")

    def _set_error(self, msg):
        self.status_label.configure(text="Error", fg="#F87171")
        self.btn.configure(text="Retry", bg="#2D6A4F")
        print(f"[GrowLightGUI] {msg}")


if __name__ == "__main__":
    root = tk.Tk()
    root.geometry("300x220")
    app = GrowLightApp(root)
    root.mainloop()
