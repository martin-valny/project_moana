#!/bin/bash
# Diagnostic checks for the all-null fetch result. Run on a machine with
# real internet access and paste the full output back.
set -x

echo "=== 1. real-world current date ==="
date -u

echo "=== 2. basic marine API sanity check (recent dates, no model param) ==="
curl -s "https://marine-api.open-meteo.com/v1/marine?latitude=42&longitude=-56&start_date=$(date -v-3d +%F 2>/dev/null || date -d '-3 days' +%F)&end_date=$(date +%F)&hourly=swell_wave_height,swell_wave_period" | head -c 1500
echo

echo "=== 3. same recent dates, WITH models=era5_ocean ==="
curl -s "https://marine-api.open-meteo.com/v1/marine?latitude=42&longitude=-56&start_date=$(date -v-3d +%F 2>/dev/null || date -d '-3 days' +%F)&end_date=$(date +%F)&hourly=swell_wave_height,swell_wave_period&models=era5_ocean" | head -c 1500
echo

echo "=== 4. the exact Dec 2025 window, no model param ==="
curl -s "https://marine-api.open-meteo.com/v1/marine?latitude=42&longitude=-56&start_date=2025-12-11&end_date=2025-12-24&hourly=swell_wave_height,swell_wave_period" | head -c 1500
echo
