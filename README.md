# Samposhi Farm Automation — Progressive Web App (PWA)

A responsive, high-performance Progressive Web App for controlling the Samposhi Poultry Lighting Automation System with **0ms instant response**, offline caching, and dual-mode connectivity (Local ESP32 Direct + Remote Cloud MQTT).

---

## Features
- 📱 **Installable PWA**: Install directly onto any Android, iOS, tablet, or desktop device via browser ("Add to Home Screen").
- ⚡ **Zero-Delay Control**: Optimistic UI rendering with direct hardware dispatch (< 15 ms).
- 📶 **Dual Connection Transport**:
  - **Local Direct Mode**: Direct cleartext HTTP REST calls to the Master Gateway (`http://192.168.4.1` or router IP).
  - **Remote Cloud Mode**: MQTT over WebSockets (`wss://broker.emqx.io:8084/mqtt` or HiveMQ) for remote monitoring.
- 🔄 **Offline Asset Caching**: Service worker (`sw.js`) caches all assets locally for instant offline launch.
- 📦 **Single-File Option**: Includes `standalone_mobile.html` containing all HTML, CSS, and JS in one portable file.

---

## File Structure
```text
SamposhiFarm_PWA/
├── index.html               # Main PWA entrypoint
├── manifest.json            # Web app manifest (name, icons, colors, display)
├── sw.js                    # Service worker for offline caching & updates
├── standalone_mobile.html   # Fully self-contained portable single-file bundle
├── css/
│   ├── app.css              # Typography & Neo-Glassmorphic theme
│   └── components.css       # Interactive UI components & diagnostics modal
├── js/
│   ├── app.js               # Dual-mode engine & real-time farm state manager
│   ├── lighting.js          # Photoperiod & radial tick gauge renderer
│   └── scanner.js           # QR/barcode MAC address scanner
└── icons/                   # High-res PWA icons & favicon
```

---

## How to Run & Test Locally

### 1. Using Python (Built-in Web Server)
Open a terminal in this folder and run:
```bash
python3 -m http.server 8080
```
Then open your browser to:
```text
http://localhost:8080
```

### 2. Using Node.js `serve` / `http-server`
```bash
npx serve .
```

---

## 1-Click Cloud Deployment (Free)

### GitHub Pages
1. Push this folder to a GitHub repository.
2. Go to **Repository Settings** > **Pages**.
3. Under **Branch**, select `main` (or root) and click **Save**.
4. Your PWA will be live at `https://<username>.github.io/<repo-name>/`.

### Vercel / Netlify
- Drag and drop the `SamposhiFarm_PWA` folder directly into [Netlify Drop](https://app.netlify.com/drop) or import via Vercel for instant worldwide hosting with free HTTPS.

---

## Installing on Mobile Devices
1. Open the hosted PWA URL in **Chrome** (Android) or **Safari** (iOS).
2. **Android**: Tap the menu (three dots) > **"Add to Home screen"** or **"Install app"**.
3. **iOS (iPhone/iPad)**: Tap the Share button > **"Add to Home Screen"**.
