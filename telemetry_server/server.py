#!/usr/bin/env python3
"""
Motorsport Telemetry Streaming Server (WebSocket Bridge)
--------------------------------------------------------
Streams vehicle telemetry frames to web dashboard clients over WebSockets.
Can run in:
  1. 'mock' mode: Simulates vehicle CAN bus emissions at a specified Hz.
  2. 'csv' mode: Replays exported sensor / dyno session logs.
  3. 'can' mode: Skeleton hook for cantools + python-can (DBC decoding).
"""

import argparse
import asyncio
import csv
import json
import logging
import math
import os
import random
import sys
import time
from typing import Dict, Any, Optional, Set

import websockets

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("TelemetryServer")

LAP_LEN = 90.0  # seconds per lap


class MockCarSource:
    """Generates continuous physics simulation frames mirroring FSAE car telemetry."""

    def __init__(self, lap_length: float = LAP_LEN):
        self.lap_length = lap_length
        self.t = 0.0

    def next_frame(self, dt: float) -> Dict[str, Any]:
        self.t += dt
        t = self.t
        lap = (t % self.lap_length) / self.lap_length

        # Oscillating throttle/braking dynamics
        throttle = max(0.0, min(100.0, 55.0 + 42.0 * math.sin(lap * math.pi * 4 - 0.5) + random.uniform(-2.5, 2.5)))
        raw_brake = max(0.0, -85.0 * math.sin(lap * math.pi * 4 - 0.5)) * 1.8 + random.uniform(-4, 4)
        brake = max(0.0, min(200.0, raw_brake))
        steering = 72.0 * math.sin(lap * math.pi * 5 + 1.0) + 18.0 * math.sin(lap * math.pi * 11) + random.uniform(-1, 1)

        spd = max(0.0, min(230.0, 22.0 + 115.0 * max(0.0, math.sin(lap * math.pi * 2.5 - 0.4)) + random.uniform(-1.5, 1.5)))
        gear = max(1, min(7, int(round(spd / 28.0)) + 1))
        rpm = max(800.0, min(8000.0, 800.0 + (spd / (gear * 6.0)) * 6200.0 + random.uniform(-100, 100)))

        lap_num = int(t // self.lap_length) + 1
        lap_time = t % self.lap_length

        # G-forces
        gx = (steering / 72.0) * 2.4 + random.uniform(-0.03, 0.03)
        gy = ((throttle / 100.0) - (brake / 200.0)) * 2.0 + random.uniform(-0.03, 0.03)

        # Dampers velocities
        accel_factor = (throttle / 100.0 - brake / 200.0)
        steer_factor = (steering / 72.0)
        susp_fl = max(-400.0, min(400.0, -accel_factor * 180.0 + steer_factor * 120.0 + random.uniform(-60, 60)))
        susp_fr = max(-400.0, min(400.0, -accel_factor * 180.0 - steer_factor * 120.0 + random.uniform(-60, 60)))
        susp_rl = max(-400.0, min(400.0, accel_factor * 120.0 + steer_factor * 90.0 + random.uniform(-75, 75)))
        susp_rr = max(-400.0, min(400.0, accel_factor * 120.0 - steer_factor * 90.0 + random.uniform(-75, 75)))

        return {
            "t": round(t, 2),
            "speed": round(spd, 1),
            "rpm": round(rpm),
            "gear": gear,
            "throttle": round(throttle, 1),
            "brake": round(brake, 1),
            "steering": round(steering, 1),
            "wFL": round(max(0.0, spd - 2.0 + random.uniform(-1.2, 1.2)), 1),
            "wFR": round(max(0.0, spd + 1.5 + random.uniform(-1.2, 1.2)), 1),
            "wRL": round(max(0.0, spd * 1.06 - 1.0 + random.uniform(-1.5, 1.5)), 1),
            "wRR": round(max(0.0, spd * 1.06 + 2.5 + random.uniform(-1.5, 1.5)), 1),
            "volt": round(max(10.0, min(16.0, 13.6 + 0.4 * math.sin(t * 0.1) + random.uniform(-0.05, 0.05))), 2),
            "coolant": round(max(40.0, min(125.0, 89.0 + 12.0 * math.sin(t * 0.03) + random.uniform(-0.1, 0.1))), 1),
            "oilTemp": round(max(50.0, min(135.0, 96.0 + 14.0 * math.sin(t * 0.025 + 0.5) + random.uniform(-0.1, 0.1))), 1),
            "oilPress": round(max(1.0, min(7.0, 4.3 + 0.8 * math.sin(lap * math.pi * 4) + (rpm / 8000.0) * 1.0 + random.uniform(-0.04, 0.04))), 2),
            "fuel": round(max(0.0, 100.0 - (t / self.lap_length) * 3.2), 1),
            "gX": round(gx, 2),
            "gY": round(gy, 2),
            "lapTime": round(lap_time, 2),
            "lapNum": lap_num,
            "suspFL": round(susp_fl, 1),
            "suspFR": round(susp_fr, 1),
            "suspRL": round(susp_rl, 1),
            "suspRR": round(susp_rr, 1),
        }


class CSVReplaySource:
    """Reads recorded telemetry rows from a CSV log and loops when finished."""

    def __init__(self, filepath: str):
        self.filepath = filepath
        self.rows = []
        self.index = 0
        self.load_data()

    def load_data(self):
        if not os.path.exists(self.filepath):
            logger.error(f"CSV file not found: {self.filepath}")
            raise FileNotFoundError(f"CSV file not found: {self.filepath}")

        with open(self.filepath, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            self.rows = list(reader)
        logger.info(f"Loaded {len(self.rows)} rows from {self.filepath}")

    def next_frame(self, dt: float) -> Dict[str, Any]:
        if not self.rows:
            return {}
        row = self.rows[self.index]
        self.index = (self.index + 1) % len(self.rows)

        # Convert numeric fields
        out = {}
        for k, v in row.items():
            try:
                out[k] = float(v) if "." in str(v) else int(v)
            except ValueError:
                out[k] = v
        return out


class TelemetryServer:
    def __init__(self, host: str, port: int, rate: float, mode: str, csv_path: Optional[str]):
        self.host = host
        self.port = port
        self.rate = max(1.0, min(100.0, rate))
        self.dt = 1.0 / self.rate
        self.mode = mode
        self.csv_path = csv_path
        self.clients: Set[websockets.WebSocketServerProtocol] = set()

        if mode == "csv" and csv_path:
            self.source = CSVReplaySource(csv_path)
        else:
            self.source = MockCarSource()

    async def register(self, websocket):
        self.clients.add(websocket)
        client_ip = getattr(websocket, "remote_address", "unknown")
        logger.info(f"Client connected from {client_ip}. Active clients: {len(self.clients)}")
        try:
            # Send initial server metadata handshake
            await websocket.send(
                json.dumps(
                    {
                        "type": "handshake",
                        "server": "Formula SAE Telemetry Bridge",
                        "rate": self.rate,
                        "mode": self.mode,
                        "timestamp": time.time(),
                    }
                )
            )
            # Listen for client messages (like ping/pong or rate changes)
            async for message in websocket:
                try:
                    data = json.loads(message)
                    if data.get("type") == "ping":
                        await websocket.send(json.dumps({"type": "pong", "clientTime": data.get("time")}))
                except json.JSONDecodeError:
                    pass
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            self.clients.remove(websocket)
            logger.info(f"Client disconnected. Active clients: {len(self.clients)}")

    async def broadcast_loop(self):
        logger.info(f"Starting broadcast stream at {self.rate} Hz ({self.mode} mode)...")
        frame_counter = 0
        last_log_time = time.time()

        while True:
            start_time = asyncio.get_event_loop().time()

            frame = self.source.next_frame(self.dt)
            if self.clients and frame:
                payload = json.dumps(frame)
                # Broadcast concurrently to all connected clients
                disconnected_clients = set()
                for client in self.clients:
                    try:
                        await client.send(payload)
                    except websockets.exceptions.ConnectionClosed:
                        disconnected_clients.add(client)
                for client in disconnected_clients:
                    self.clients.discard(client)

            frame_counter += 1
            now = time.time()
            if now - last_log_time >= 10.0:
                logger.info(f"Stream heartbeat: {frame_counter} frames emitted, {len(self.clients)} active clients")
                last_log_time = now

            elapsed = asyncio.get_event_loop().time() - start_time
            sleep_time = max(0.0, self.dt - elapsed)
            await asyncio.sleep(sleep_time)

    async def start(self):
        server = await websockets.serve(self.register, self.host, self.port)
        logger.info(f"Telemetry WebSocket Server listening on ws://{self.host}:{self.port}")
        await self.broadcast_loop()


def main():
    parser = argparse.ArgumentParser(description="Motorsport Telemetry Streaming Server")
    parser.add_argument("--host", default="0.0.0.0", help="Host interface to bind (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=8765, help="Port to listen on (default: 8765)")
    parser.add_argument("--rate", type=float, default=10.0, help="Broadcast rate in Hz (default: 10.0)")
    parser.add_argument("--mode", choices=["mock", "csv"], default="mock", help="Data source mode (default: mock)")
    parser.add_argument("--file", help="Path to CSV telemetry file when using --mode csv")

    args = parser.parse_args()

    if args.mode == "csv" and not args.file:
        logger.error("--file is required when running with --mode csv")
        sys.exit(1)

    server = TelemetryServer(
        host=args.host,
        port=args.port,
        rate=args.rate,
        mode=args.mode,
        csv_path=args.file,
    )

    try:
        asyncio.run(server.start())
    except KeyboardInterrupt:
        logger.info("Server stopped by user.")


if __name__ == "__main__":
    main()
