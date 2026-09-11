// ==========================================================================
// SAMPOSHI FARM AUTOMATION — LIGHTING & RADIAL GAUGE ENGINE
// Faithfully inspired by Md Zia Uddin's Dribbble Smart Home UI
// ==========================================================================

const LightingEngine = {
  // CIE 1931 Perceptual Curve
  pwmToPercent(pwm) {
    if (pwm <= 0) return 0;
    if (pwm >= 1023) return 100;
    const ratio = pwm / 1023.0;
    const pct = Math.round(Math.pow(ratio, 1 / 2.8) * 100);
    return Math.min(100, Math.max(0, pct));
  },

  percentToPwm(pct) {
    if (pct <= 0) return 0;
    if (pct >= 100) return 1023;
    const ratio = pct / 100.0;
    const raw = Math.round(Math.pow(ratio, 2.8) * 1023);
    return Math.min(1023, Math.max(1, raw));
  },

  minToTimeStr(m) {
    const h = Math.floor(m / 60) % 24;
    const min = Math.floor(m % 60);
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  },

  timeStrToMin(tStr) {
    if (!tStr) return 0;
    const parts = tStr.split(':');
    return (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
  },

  // Generates the exact radial tick marks for the Screen 1 Gauge
  renderRadialTickGauge(pct, svgId = 'radialSvgTicks') {
    const svg = document.getElementById(svgId);
    if (!svg) return;

    const totalTicks = 38;
    const activeCount = pct > 0 ? Math.round((pct / 100) * totalTicks) : -1;
    const cx = 145;
    const cy = 135;
    const rOuter = 100;
    const rInner = 84;

    // Semicircular arc from 180° (pi, left) to 0° (0, right)
    let ticksSvg = '';
    for (let i = 0; i <= totalTicks; i++) {
      const angleDeg = 180 - (i / totalTicks) * 180;
      const rad = (angleDeg * Math.PI) / 180;

      const x1 = cx + rInner * Math.cos(rad);
      const y1 = cy - rInner * Math.sin(rad);
      const x2 = cx + rOuter * Math.cos(rad);
      const y2 = cy - rOuter * Math.sin(rad);

      const isActive = (pct > 0 && i <= activeCount);
      ticksSvg += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="radial-tick-line ${isActive ? 'active' : ''}" />`;
    }

    svg.innerHTML = ticksSvg;
  }
};

window.LightingEngine = LightingEngine;
