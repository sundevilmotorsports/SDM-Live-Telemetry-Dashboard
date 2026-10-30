# Motorsport Telemetry Streaming Server (WebSocket Bridge)

This server streams vehicle telemetry frames over WebSockets to the Dark-Mode Motorsport Telemetry Dashboard.

## Setup

```bash
cd telemetry_server
pip install -r requirements.txt
```

## Running the Server

### 1. Simulated Live Stream (Default)
Generates realistic vehicle dynamics and CAN signals at 10 Hz (or custom rate):
```bash
python3 server.py --port 8765 --rate 10
```

### 2. CSV Session Replay
Replay a recorded run or dyno test CSV log:
```bash
python3 server.py --mode csv --file sample_log.csv --rate 10
```

### 3. Remote/Cellular Gateway (Pit Wall or On-Vehicle)
To listen on all network interfaces (e.g. from an on-vehicle LTE modem or Wi-Fi hotspot):
```bash
python3 server.py --host 0.0.0.0 --port 8765
```

## Command-Line Arguments
- `--host`: Network interface to bind (default: `0.0.0.0`)
- `--port`: Port number (default: `8765`)
- `--rate`: Telemetry emission rate in Hz (default: `10.0`)
- `--mode`: Source mode (`mock` or `csv`, default: `mock`)
- `--file`: Path to CSV file when using `--mode csv`
