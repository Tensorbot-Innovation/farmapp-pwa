# Samposhi Farm Automation — Mobile App (v2.0)

A modern, minimalist, standalone mobile application engineered specifically for **Android** and **iOS** to monitor and control the Samposhi Poultry Automation Master Gateway and ESP-NOW lighting fixture mesh.

---

## 📱 App Highlights & UI/UX Features

- **Pure Pitch OLED Dark Aesthetics (`#04070d`)**: Specially crafted for ultra-low power consumption, high contrast readability in dark poultry sheds, and zero eye fatigue.
- **Dynamic Ambient Shed Aura Reactor**: A real-time radial aura behind the dashboard that dynamically adjusts its color and warmth depending on the shed's photoperiod phase (Night Indigo, Dawn Coral, Full Solar Daylight Amber, Dusk Ember).
- **Interactive 24-Hour Solar Photoperiod Dial**: Real-time sweeping SVG solar arc displaying dawn ramp, photoperiod daylight hours, dusk ramp, and current RTC sun position.
- **CIE 1931 Perceptual Lumens Dimming**: Translates raw 10-bit PWM values (`0..1023`) to biological poultry perception (`0..100%`) for smooth, non-flickering twilight transitions.
- **Haptic Touch Faders & Instant Presets**: Smooth drag dimming with quick preset buttons (`OFF`, `25%`, `50%`, `75%`, `100%`, `AUTO`).
- **Floating Frosted Glass Bottom Dock**: iOS-inspired glassmorphism navigation pill dock positioned within safe-area insets.
- **Integrated Camera QR Scanner**: Built-in 1-tap camera scanner for instantaneous ESP-NOW slave fixture MAC address commissioning and zone assignment.
- **Dual-Mode Engine (Local Direct REST & HiveMQ Cloud MQTT)**:
  - **Local Direct Mode**: Connects directly to the ESP32-S3 Master Gateway hotspot at `http://192.168.4.1` or `http://samposhi.local`.
  - **Remote Cloud Mode**: Connects worldwide via HiveMQ or EMQX Cloud MQTT broker over secure WebSockets (`wss://`).

---

## 📲 Installation Guide

### Android (Google Chrome / Brave)
1. Open the Web App URL (e.g. `http://192.168.4.1/` when connected to Gateway Wi-Fi, or your hosted cloud URL) in **Google Chrome**.
2. Tap the **three dots menu (⋮)** in the top-right corner.
3. Tap **"Install app"** or **"Add to Home screen"**.
4. The system will generate a standalone **WebAPK** with the minimalist Samposhi sunrise icon on your home screen and app drawer.
5. Launching the app opens it in borderless full-screen mode without browser address bars.

### iOS (Apple Safari)
1. Open the Web App URL in **Safari** on your iPhone or iPad.
2. Tap the **Share button (square with arrow pointing up)** in the bottom bar.
3. Scroll down and tap **"Add to Home Screen"**.
4. Tap **"Add"** in the top-right corner.
5. The high-resolution `apple-touch-icon.png` will appear on your iOS home screen.
6. When launched, iOS runs the app as a native standalone web-clip with translucent status bar styling.

---

## 🗂️ File Structure

```
MobileApp_v2/
├── index.html            # Main mobile application markup & views
├── manifest.json         # PWA WebAPK manifest with theme colors & icons
├── sw.js                 # Service Worker caching & offline resilience
├── css/
│   ├── app.css           # Core OLED tokens, safe area padding, layout, & aura reactor
│   └── components.css    # Cards, solar arc widget, faders, dock, & bottom sheets
├── js/
│   ├── app.js            # Dual-mode engine, state controller, fetch interceptor
│   ├── lighting.js       # CIE 1931 dimming math, solar arc calculations, aura reactor
│   └── scanner.js        # Camera QR code detector for fixture MAC provisioning
└── icons/
    ├── apple-touch-icon.png  (180x180 for iOS)
    ├── favicon.png           (64x64)
    ├── icon-192.png          (192x192 for Android)
    ├── icon-512.png          (512x512 for Android splash screen)
    └── icon-maskable-512.png (512x512 maskable for adaptive icons)
```

---

## 🌐 Hosting & Deployment Options

### Option A: Local ESP32-S3 Gateway Direct Hosting
The master firmware `v2/Master_v2/Master_v2.ino` serves files directly from SPIFFS/LittleFS or embedded PROGMEM. When connected to the "SamposhiFarm" hotspot, navigate to `http://192.168.4.1`.

### Option B: Cloud Static CDN / HTTPS (Recommended for Remote Access)
You can deploy the contents of `MobileApp_v2/` to GitHub Pages, Cloudflare Pages, Firebase Hosting, or Netlify. 
- In Cloud Mode, configure your HiveMQ Cloud WebSocket URL:
  `wss://<broker-id>.s1.eu.hivemq.cloud:8884/mqtt`
- The app will securely stream telemetry and dispatch commands anywhere in the world.
