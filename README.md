# Montrack (₹)

A minimalist, mobile-first, **100% offline** personal expense tracker built with vanilla HTML, CSS, JavaScript, and IndexedDB.

## Features
- **Zero-Latency Entry & Smart Memory**: Remembers frequent and recent places, automatically links merchants to categories, descriptions, and amounts, and provides one-tap quick-log chips.
- **100% Offline & Private**: Stores everything locally in your device's IndexedDB. Works completely offline via Service Worker caching—no login or cloud database required.
- **Visual Analytics & Automated Reports**: Interactive HTML5 Canvas charts (Category Donut, Daily Bar, Monthly Trend Line, Top Locations) plus automated weekly and monthly comparison insights.
- **Data Portability**: One-click CSV export (Excel-compatible) and full JSON backup/restore.

## Deploy on GitHub Pages
1. Create a new repository named `montrack` on GitHub and upload all 6 files to the root folder.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, select **Deploy from a branch** → `main` → `/ (root)` and click **Save**.
4. Open `https://<your-username>.github.io/montrack/` on your phone and tap **"Add to Home Screen"** (or **"Install App"**) to install it as an offline app.
