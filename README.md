Tool Vision Inventory Monorepo

This repository contains:

- tool-vision-inventory/: React + Vite app (Supabase) for managing tools, printing labels via WebUSB.
- brother_ql_web/: Python Bottle service for label rendering (text + QR), returning raster data for Brother QL printers.

Dev

- Brother web service
  - Create venv and install requirements
  - Run on port 8013

```
cd brother_ql_web
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python brother_ql_web.py --port 8013 --loglevel INFO
```

- Frontend

```
cd tool-vision-inventory
npm i
npm run dev
```

Set VITE_BROTHER_WEB_URL in tool-vision-inventory/.env.local if not using default http://localhost:8013.

Printing

- Uses WebUSB to send raster data prepared by brother_ql_web endpoints.
- Configure label size and presets in the app’s Print Settings.

Vision (optional)

- Client can capture frames from the camera and attempt quick identification via barcode or TFJS coco-ssd.
- For robust SKU-level identification, integrate a hosted model (e.g., Roboflow/Azure Custom Vision) via a Supabase Edge Function.

