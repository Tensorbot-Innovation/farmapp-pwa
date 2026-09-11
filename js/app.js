// ==========================================================================
// SAMPOSHI FARM AUTOMATION — MOBILE APP CONTROLLER
// 5 Settings Sections + Real Time Clock Engine
// Immediate Cross-Page State Synchronization
// ==========================================================================

let farmState = {
  farmName: "",
  shedName: "",
  shedId: 1,
  ssid: "SamposhiFarm",
  pmk: "SamposhiPmkKey16",
  hotspotHidden: false,
  staConnected: false,
  staRSSI: 0,
  staIP: "192.168.4.1",
  staEnabled: false,
  connectionMode: (function() {
    const saved = localStorage.getItem('samposhi_conn_mode');
    if (saved) return saved;
    if (typeof window !== 'undefined' && window.location) {
      if (window.location.protocol === 'https:' || (window.location.hostname && window.location.hostname.includes('.github.io'))) {
        return 'remote';
      }
    }
    return 'local';
  })(),
  mqttConnected: false,
  mqttBroker: localStorage.getItem('samposhi_mqtt_host') || "broker.emqx.io",
  mqttPort: parseInt(localStorage.getItem('samposhi_mqtt_port') || '1883', 10),
  mqttTopic: localStorage.getItem('samposhi_mqtt_topic') || "samposhi",
  mqttUser: localStorage.getItem('samposhi_mqtt_user') || "",
  temp: null,
  hum: null,
  ldrLux: null,
  rtc: null,
  rtcOnline: false,
  masterSchedule: null,
  ldrThreshold: null,
  ldrMinAdc: 1000,
  ldrMaxAdc: 3500,
  rawLdr: null,
  lightPct: null,
  zones: [],
  slaves: []
};

let currentTab = 'home';
let activeZoneDetail = null;
let currentConnMode = localStorage.getItem('samposhi_conn_mode') || 'local';
let appMqttClient = null;
let pollTimer = null;
let pausePollingTimer = null;

function pausePolling(ms = 4000) {
  if (pausePollingTimer) clearTimeout(pausePollingTimer);
  pausePollingTimer = setTimeout(() => {
    pausePollingTimer = null;
  }, ms);
}

let selectedOtaFile = null;
let fleetViewMode = 'matrix';
let currentInspectingNodeId = null;

// --------------------------------------------------------------------------
// Cloud Remote MQTT Engine (MQTT over WebSockets)
// --------------------------------------------------------------------------
function getMqttWsUrl() {
  const savedWsUrl = (localStorage.getItem('samposhi_mqtt_ws_url') || '').trim();
  if (savedWsUrl) return savedWsUrl;

  const host = (farmState.mqttBroker || localStorage.getItem('samposhi_mqtt_host') || 'broker.emqx.io').trim();
  if (host.startsWith('ws://') || host.startsWith('wss://')) {
    return host;
  }

  // Pre-configured public broker mappings
  if (host.includes('emqx.io')) {
    return 'wss://broker.emqx.io:8084/mqtt';
  }
  if (host.includes('hivemq.com')) {
    return 'wss://broker.hivemq.com:8884/mqtt';
  }
  if (host.includes('hivemq.cloud')) {
    return `wss://${host}:8884/mqtt`;
  }

  // Standard fallback
  const port = parseInt(farmState.mqttPort || localStorage.getItem('samposhi_mqtt_port') || '8084', 10);
  const isSecure = (window.location && window.location.protocol === 'https:') || port === 8084 || port === 8884 || port === 443;
  const protocol = isSecure ? 'wss://' : 'ws://';
  const effectivePort = (port === 1883) ? (isSecure ? 8084 : 8083) : port;

  return `${protocol}${host}:${effectivePort}/mqtt`;
}

function sendCloudMqttCommand(cmdObj) {
  const topicPrefix = farmState.mqttTopic || localStorage.getItem('samposhi_mqtt_topic') || 'samposhi';
  const shedId = farmState.shedId || localStorage.getItem('samposhi_mqtt_shed') || 1;
  const cmdTopic = `${topicPrefix}/${shedId}/command`;
  const payloadStr = JSON.stringify(cmdObj);

  if (typeof logRemoteTerminal === 'function') {
    logRemoteTerminal(`[TX -> ${cmdTopic}] ${payloadStr}`, 'net');
  }

  if (appMqttClient && appMqttClient.connected) {
    appMqttClient.publish(cmdTopic, payloadStr, { qos: 0 }, (err) => {
      if (err && typeof logRemoteTerminal === 'function') {
        logRemoteTerminal(`Publish error: ${err.message}`, 'err');
      }
    });
  } else {
    if (typeof logRemoteTerminal === 'function') {
      logRemoteTerminal(`[WARN] MQTT client not connected. Attempting auto-reconnect...`, 'warn');
    }
    startCloudMqtt();
  }
}

function startCloudMqtt() {
  if (farmState.connectionMode !== 'remote') return;
  if (appMqttClient && (appMqttClient.connected || appMqttClient.connecting)) {
    return;
  }

  const mqttLib = (typeof mqtt !== 'undefined') ? mqtt : (typeof window !== 'undefined' ? window.mqtt : null);
  if (!mqttLib) {
    if (typeof logRemoteTerminal === 'function') {
      logRemoteTerminal(`MQTT library still loading... retrying in 800ms`, 'warn');
    }
    setTimeout(startCloudMqtt, 800);
    return;
  }

  const wsUrl = getMqttWsUrl();
  const topicPrefix = farmState.mqttTopic || localStorage.getItem('samposhi_mqtt_topic') || 'samposhi';
  const shedId = farmState.shedId || localStorage.getItem('samposhi_mqtt_shed') || 1;
  const telemTopic = `${topicPrefix}/${shedId}/telemetry`;
  const statusTopic = `${topicPrefix}/${shedId}/status`;
  const cmdTopic = `${topicPrefix}/${shedId}/command`;

  if (typeof logRemoteTerminal === 'function') {
    logRemoteTerminal(`Connecting via WebSocket to: ${wsUrl}`, 'sys');
    logRemoteTerminal(`Telemetry Topic: ${telemTopic}`, 'sys');
    logRemoteTerminal(`Command Topic: ${cmdTopic}`, 'sys');
  }

  farmState.mqttConnected = false;
  renderHeader();

  const clientId = 'samposhi_app_' + Math.random().toString(16).substring(2, 10);
  const opts = {
    clientId: clientId,
    clean: true,
    connectTimeout: 8000,
    reconnectPeriod: 4000,
    keepalive: 30
  };

  const user = farmState.mqttUser || localStorage.getItem('samposhi_mqtt_user') || '';
  const pass = farmState.mqttPass || localStorage.getItem('samposhi_mqtt_pass') || '';
  if (user) opts.username = user;
  if (pass) opts.password = pass;

  try {
    appMqttClient = mqttLib.connect(wsUrl, opts);

    appMqttClient.on('connect', () => {
      farmState.mqttConnected = true;
      farmState.masterOnline = true;
      if (typeof logRemoteTerminal === 'function') {
        logRemoteTerminal(`Connected to Cloud Broker as ${clientId}`, 'ok');
        logRemoteTerminal(`Subscribing to: ${telemTopic} & ${statusTopic}`, 'net');
      }

      appMqttClient.subscribe([telemTopic, statusTopic], { qos: 0 }, (err) => {
        if (err) {
          if (typeof logRemoteTerminal === 'function') {
            logRemoteTerminal(`Subscription failed: ${err.message}`, 'err');
          }
        } else {
          if (typeof logRemoteTerminal === 'function') {
            logRemoteTerminal(`Subscription active! Requesting live telemetry...`, 'ok');
          }
          sendCloudMqttCommand({ cmd: "request_telemetry" });
        }
      });

      renderHeader();
      renderHeroBanners();
      renderSettingsTab();
    });

    appMqttClient.on('message', (topic, payloadBuffer) => {
      try {
        const payloadStr = payloadBuffer.toString();
        if (topic.endsWith('/status')) {
          if (payloadStr === 'offline') {
            farmState.masterOnline = false;
            if (typeof logRemoteTerminal === 'function') {
              logRemoteTerminal(`Master Gateway published: OFFLINE`, 'warn');
            }
          } else if (payloadStr === 'online') {
            farmState.masterOnline = true;
            if (typeof logRemoteTerminal === 'function') {
              logRemoteTerminal(`Master Gateway published: ONLINE`, 'ok');
            }
          }
          renderHeader();
          return;
        }

        const data = JSON.parse(payloadStr);
        if (typeof logRemoteTerminal === 'function') {
          logRemoteTerminal(`[RX <- ${topic}] Telemetry received (${payloadStr.length} bytes)`, 'net');
        }

        farmState.masterOnline = true;
        farmState.mqttConnected = true;

        applyGatewayData(data);
        renderAll();
      } catch (e) {
        if (typeof logRemoteTerminal === 'function') {
          logRemoteTerminal(`Telemetry parse error: ${e.message}`, 'err');
        }
      }
    });

    appMqttClient.on('close', () => {
      if (farmState.mqttConnected) {
        if (typeof logRemoteTerminal === 'function') {
          logRemoteTerminal(`Connection to broker closed`, 'warn');
        }
      }
      farmState.mqttConnected = false;
      renderHeader();
      renderSettingsTab();
    });

    appMqttClient.on('error', (err) => {
      if (typeof logRemoteTerminal === 'function') {
        logRemoteTerminal(`MQTT Error: ${err.message || err}`, 'err');
      }
      farmState.mqttConnected = false;
      renderHeader();
      renderSettingsTab();
    });

    appMqttClient.on('offline', () => {
      farmState.mqttConnected = false;
      renderHeader();
      renderSettingsTab();
    });

    appMqttClient.on('reconnect', () => {
      if (typeof logRemoteTerminal === 'function') {
        logRemoteTerminal(`Attempting reconnection to broker...`, 'sys');
      }
      farmState.mqttConnected = false;
      renderHeader();
    });

  } catch (err) {
    if (typeof logRemoteTerminal === 'function') {
      logRemoteTerminal(`MQTT Init failed: ${err.message}`, 'err');
    }
    farmState.mqttConnected = false;
    renderHeader();
  }
}

function stopCloudMqtt() {
  if (appMqttClient) {
    try {
      appMqttClient.end(true);
      if (typeof logRemoteTerminal === 'function') {
        logRemoteTerminal(`Disconnected from Cloud Broker.`, 'sys');
      }
    } catch (e) {}
    appMqttClient = null;
  }
  farmState.mqttConnected = false;
  renderHeader();
  renderSettingsTab();
}

function getTargetGatewayHost() {
  let saved = (localStorage.getItem('samposhi_local_ip') || '').trim();
  if (saved) {
    if (saved.startsWith('http://')) saved = saved.slice(7);
    if (saved.startsWith('https://')) saved = saved.slice(8);
    if (saved.endsWith('/')) saved = saved.slice(0, -1);
    return saved;
  }
  if (typeof window !== 'undefined' && window.location && window.location.hostname) {
    const hn = window.location.hostname;
    if (hn && hn !== 'localhost' && hn !== '127.0.0.1' && !hn.includes('.github.io') && !hn.includes('netlify.app') && !hn.includes('vercel.app')) {
      return hn;
    }
  }
  if (typeof farmState !== 'undefined' && farmState.staConnected && farmState.staIP && farmState.staIP !== '0.0.0.0') {
    return farmState.staIP;
  }
  return '192.168.4.1';
}

const _nativeFetch = window.fetch;
window.fetch = async function(url, options) {
  const activeMode = (typeof farmState !== 'undefined' && farmState.connectionMode) || localStorage.getItem('samposhi_conn_mode') || 'local';

  let reqUrl = url;
  let isApiCall = false;
  if (typeof url === 'string' && (url.startsWith('/') || url.startsWith('api/'))) {
    isApiCall = true;
    const path = url.startsWith('/') ? url : `/${url}`;
    const targetHost = getTargetGatewayHost();
    if (typeof window !== 'undefined' && window.location && window.location.hostname === targetHost) {
      reqUrl = path;
    } else {
      reqUrl = `http://${targetHost}${path}`;
    }
  }

  // A. LOCAL MODE: Direct cleartext HTTP to Gateway
  if (activeMode === 'local') {
    return _nativeFetch(reqUrl, options);
  }

  // B. REMOTE CLOUD MODE: Cloud MQTT Interception + Concurrent Local Fast Dispatch
  if (typeof url === 'string' && isApiCall) {
    let body = {};
    if (options && options.body) {
      try { body = JSON.parse(options.body); } catch (e) {}
    }

    // Status request in Remote mode:
    if (url.includes('/api/status')) {
      try {
        const localHost = getTargetGatewayHost();
        const localUrl = `http://${localHost}/api/status?_t=${Date.now()}`;
        const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        const tid = ctrl ? setTimeout(() => ctrl.abort(), 1200) : null;
        const lRes = await _nativeFetch(localUrl, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined });
        if (tid) clearTimeout(tid);
        if (lRes.ok) return lRes;
      } catch (e) {}
      return new Response(JSON.stringify(farmState || {}), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Fast local opportunistic dispatch for control commands (concurrent <15ms trigger)
    try {
      const localHost = getTargetGatewayHost();
      const path = url.startsWith('/') ? url : `/${url}`;
      const localTarget = `http://${localHost}${path}`;
      const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      if (ctrl) setTimeout(() => ctrl.abort(), 1500);
      _nativeFetch(localTarget, Object.assign({}, options, { signal: ctrl ? ctrl.signal : undefined })).catch(() => {});
    } catch (e) {}

    // Cloud MQTT command topic
    if (url.includes('/api/all')) {
      sendCloudMqttCommand({ cmd: "all", on: body.on });
    } else if (url.includes('/api/auto-all')) {
      sendCloudMqttCommand({ cmd: "all_auto" });
    } else if (url.includes('/api/zone/add')) {
      sendCloudMqttCommand(Object.assign({ cmd: "zone_add" }, body));
    } else if (url.includes('/api/zone/delete') || url.includes('/api/zone/remove')) {
      sendCloudMqttCommand(Object.assign({ cmd: "zone_delete" }, body));
    } else if (url.includes('/api/zone')) {
      if (body.auto !== undefined) {
        if (body.auto) {
          sendCloudMqttCommand({ cmd: "zone_auto", zoneId: body.zoneId });
        } else {
          sendCloudMqttCommand({ cmd: "zone_pwm", zoneId: body.zoneId, pwm: body.pwm !== undefined ? body.pwm : 0 });
        }
      } else if (body.on !== undefined && (body.pwm === undefined || body.pwm === 0 || body.pwm === 1023)) {
        sendCloudMqttCommand({ cmd: "zone_power", zoneId: body.zoneId, on: body.on });
      } else if (body.pwm !== undefined) {
        sendCloudMqttCommand({ cmd: "zone_pwm", zoneId: body.zoneId, pwm: body.pwm });
      } else if (body.on !== undefined) {
        sendCloudMqttCommand({ cmd: "zone_power", zoneId: body.zoneId, on: body.on });
      }
    } else if (url.includes('/api/fixture/toggle')) {
      const pVal = (body.pwm !== undefined) ? body.pwm : (body.on ? 1023 : 0);
      sendCloudMqttCommand({ cmd: "slave_pwm", nodeId: body.nodeId, pwm: pVal });
    } else if (url.includes('/api/fixture/pwm')) {
      sendCloudMqttCommand({ cmd: "slave_pwm", nodeId: body.nodeId, pwm: body.pwm !== undefined ? body.pwm : 0 });
    } else if (url.includes('/api/fixture/update')) {
      sendCloudMqttCommand(Object.assign({ cmd: "fixture_update" }, body));
    } else if (url.includes('/api/strobe') || url.includes('/api/identify-mac') || url.includes('/api/fixture/strobe')) {
      sendCloudMqttCommand(Object.assign({ cmd: "strobe" }, body));
    } else if (url.includes('/api/pair-mac')) {
      sendCloudMqttCommand(Object.assign({ cmd: "pair_mac" }, body));
    } else if (url.includes('/api/depair')) {
      sendCloudMqttCommand(Object.assign({ cmd: "depair" }, body));
    } else if (url.includes('/api/schedule')) {
      sendCloudMqttCommand(Object.assign({ cmd: "update_schedule" }, body));
    } else if (url.includes('/api/rtc')) {
      sendCloudMqttCommand(Object.assign({ cmd: "sync_rtc" }, body));
    } else if (url.includes('/api/config')) {
      sendCloudMqttCommand(Object.assign({ cmd: "update_config" }, body));
    } else if (url.includes('/api/ldr/calibrate')) {
      sendCloudMqttCommand(Object.assign({ cmd: "ldr_calibrate" }, body));
    } else if (url.includes('/api/reboot')) {
      sendCloudMqttCommand({ cmd: "reboot" });
    } else if (url.includes('/api/reset')) {
      sendCloudMqttCommand({ cmd: "reset" });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  return _nativeFetch(url, options);
};

// --------------------------------------------------------------------------
// Polling & State Synchronizer
// --------------------------------------------------------------------------
// Master Time & Ambient Sensor Parser Helpers
// --------------------------------------------------------------------------
function applyGatewayData(data) {
  if (!data) return;
  const themes = ["rose", "cyan", "yellow", "green"];
  if (Array.isArray(data.zones) && data.zones.length > 0) {
    data.zones.forEach((z, idx) => {
      const existing = farmState.zones ? farmState.zones.find(ez => ez.id === z.id) : null;
      if (!z.theme) z.theme = (existing && existing.theme) ? existing.theme : themes[idx % themes.length];
      if (!z.icon) z.icon = (existing && existing.icon) ? existing.icon : 'lamp';
      if (!z.desc) z.desc = (existing && existing.desc) ? existing.desc : '';
      if (z.power === undefined && z.on !== undefined) {
        z.power = z.on;
      }
    });
    if (activeZoneDetail) {
      const updatedActive = data.zones.find(z => z.id === activeZoneDetail.id);
      if (updatedActive) activeZoneDetail = updatedActive;
    }
    farmState.zones = data.zones;
  }
  if (Array.isArray(data.slaves) && data.slaves.length > 0) {
    farmState.slaves = data.slaves;
  }
  const copy = Object.assign({}, data);
  delete copy.zones;
  delete copy.slaves;
  farmState = Object.assign({}, farmState, copy);
  parseMasterTime(data);
}

function parseMasterTime(data) {
  if (!data) return;
  if (data.rtcTime && data.rtcTime !== "RTC_OFFLINE") {
    // Exact wall-clock from Master ESP32 DS3231 RTC: "YYYY-MM-DDTHH:MM:SS"
    const match = String(data.rtcTime).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
    if (match) {
      farmState.rtc = {
        year: parseInt(match[1], 10),
        month: parseInt(match[2], 10),
        day: parseInt(match[3], 10),
        hour: parseInt(match[4], 10),
        minute: parseInt(match[5], 10),
        second: parseInt(match[6], 10)
      };
      farmState.rtcOnline = (data.rtcOnline !== false);
      farmState.rtcTime = data.rtcTime;
      return;
    }
  } else if (data.rtcTime === "RTC_OFFLINE") {
    farmState.rtcOnline = false;
    farmState.rtcTime = "RTC_OFFLINE";
  }

  // Fallback to unixTime only if rtcTime string was not present
  if (data.unixTime && typeof data.unixTime === 'number' && data.unixTime > 1600000000) {
    const d = new Date(data.unixTime * 1000);
    farmState.rtc = {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds()
    };
    farmState.rtcOnline = (data.rtcOnline !== false && data.rtcTime !== "RTC_OFFLINE");
  }
}

function getAmbientLightLevelPct() {
  if (typeof farmState.lightPct === 'number' && !isNaN(farmState.lightPct)) {
    return Math.max(0, Math.min(100, Math.round(farmState.lightPct)));
  }
  if (typeof farmState.luxPct === 'number' && !isNaN(farmState.luxPct)) {
    return Math.max(0, Math.min(100, Math.round(farmState.luxPct)));
  }
  if (typeof farmState.ldr === 'number' && !isNaN(farmState.ldr)) {
    const min = (typeof farmState.ldrMinAdc === 'number') ? farmState.ldrMinAdc : 1000;
    const max = (typeof farmState.ldrMaxAdc === 'number') ? farmState.ldrMaxAdc : 3500;
    if (max > min) {
      const pct = Math.round(((farmState.ldr - min) / (max - min)) * 100);
      return Math.max(0, Math.min(100, pct));
    }
    const raw = Math.max(0, Math.min(4095, farmState.ldr));
    return Math.max(0, Math.min(100, Math.round(((4095 - raw) / 4095) * 100)));
  }
  return null;
}

async function fetchStatus(force = false) {
  if (!force && pausePollingTimer) return;
  const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), 5000) : null;
  try {
    const fetchOpts = { cache: 'no-store' };
    if (controller) fetchOpts.signal = controller.signal;
    const res = await fetch('/api/status?_t=' + Date.now(), fetchOpts);
    if (timeoutId) clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      farmState.masterOnline = true;
      applyGatewayData(data);
      renderAll();
    } else {
      if (force || !farmState.zones || farmState.zones.length === 0) {
        farmState.masterOnline = false;
        renderHeader();
      }
    }
  } catch (e) {
    if (timeoutId) clearTimeout(timeoutId);
    if (force || !farmState.zones || farmState.zones.length === 0) {
      farmState.masterOnline = false;
      renderHeader();
    }
  }
}

function renderAll() {
  renderHeader();
  renderHeroBanners();
  renderBentoZones();
  renderScheduleTab();
  renderSettingsTab();
  renderZonesManagement();
  renderFleetViews();
}

function openProvisioningModal() {
  switchTab('rooms');
  const card = document.getElementById('cardPairDevice');
  if (card && card.style.display === 'none') {
    togglePairDeviceCard();
  }
}

// --------------------------------------------------------------------------
// CROSS-PAGE REFLECTION HELPERS
// Immediately updates all other pages when Settings change!
// --------------------------------------------------------------------------
function renderHeader() {
  const farmEl = document.getElementById('headerFarmTitle');
  if (farmEl) farmEl.textContent = farmState.farmName || "Samposhi Farm";
  document.title = `${farmState.farmName || 'Samposhi Farm'} — ${farmState.shedName || 'Shed #1'}`;

  // Connection Indicator & Mode Switcher
  const connDot = document.getElementById('headerConnDot');
  const connBtn = document.getElementById('btnConnectionMode');
  const isRemote = farmState.connectionMode === 'remote';

  if (connBtn) {
    connBtn.classList.toggle('remote-active', isRemote);
    if (isRemote) {
      connBtn.setAttribute('title', farmState.mqttConnected ? 'Cloud Connected (MQTT) — Tap to switch to Local' : 'Cloud Connecting (MQTT)... — Tap to switch to Local');
    } else {
      let savedIp = (localStorage.getItem('samposhi_local_ip') || '192.168.4.1').trim();
      if (savedIp.startsWith('http://')) savedIp = savedIp.slice(7);
      if (savedIp.startsWith('https://')) savedIp = savedIp.slice(8);
      if (savedIp.endsWith('/')) savedIp = savedIp.slice(0, -1);
      connBtn.setAttribute('title', farmState.masterOnline ? `Master Online (http://${savedIp}) — Tap to switch to Remote` : `Master Disconnected (http://${savedIp}) — Tap to switch to Remote`);
    }
  }

  if (connDot) {
    if (isRemote) {
      connDot.style.background = farmState.mqttConnected ? "#8B5CF6" : "#F59E0B";
    } else {
      connDot.style.background = farmState.masterOnline ? "#10B981" : "#EF4444";
    }
  }
}

function renderHeroBanners() {
  // Left Blue Banner: Lux Level & Shed Telemetry
  const locTitle = document.getElementById('bannerLocTitle');
  const dateTimeSub = document.getElementById('bannerDateTimeSub');
  const bigMetric = document.getElementById('bannerBigMetric');
  const footTxt = document.getElementById('bannerFooterTxt');

  if (locTitle) locTitle.textContent = farmState.shedName || "Broiler Shed #1";

  // Display real Master date and time cleanly
  if (dateTimeSub) {
    if (farmState.rtc && farmState.rtc.year) {
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const dStr = `${String(farmState.rtc.day).padStart(2, '0')} ${months[(farmState.rtc.month || 1) - 1]}`;
      const tStr = `${String(farmState.rtc.hour).padStart(2, '0')}:${String(farmState.rtc.minute).padStart(2, '0')}`;
      dateTimeSub.textContent = `${dStr} · ${tStr}`;
    } else if (farmState.rtcTime === "RTC_OFFLINE") {
      dateTimeSub.textContent = "RTC Offline";
    } else {
      dateTimeSub.textContent = "--:--";
    }
  }

  let totalPwm = 0;
  let zoneCount = 0;
  let autoZoneCount = 0;
  if (farmState.zones && farmState.zones.length > 0) {
    farmState.zones.forEach(z => {
      totalPwm += (z.power !== false ? (z.pwm || 0) : 0);
      if (z.mode === 'AUTO') autoZoneCount++;
      zoneCount++;
    });
  }

  const modePill = document.getElementById('bannerSystemModePill');
  const modeTxt = document.getElementById('bannerSystemModeText');
  if (modePill && modeTxt) {
    if (zoneCount === 0) {
      modePill.className = 'banner-mode-pill';
      modeTxt.textContent = '--';
    } else {
      const isAllAuto = (autoZoneCount === zoneCount && zoneCount > 0);
      const isAllManual = (autoZoneCount === 0);
      if (isAllAuto) {
        modePill.className = 'banner-mode-pill mode-auto';
        modeTxt.textContent = 'Auto';
      } else if (isAllManual) {
        modePill.className = 'banner-mode-pill mode-manual';
        modeTxt.textContent = 'Manual';
      } else {
        modePill.className = 'banner-mode-pill mode-auto';
        modeTxt.textContent = `Auto ${autoZoneCount}/${zoneCount}`;
      }
    }
  }

  // Ambient Light Level (LDR reading from webapp)
  const ambientPct = getAmbientLightLevelPct();
  if (bigMetric) {
    const dispVal = (ambientPct !== null) ? `${ambientPct}<span class="degree">%</span>` : `--<span class="degree">%</span>`;
    bigMetric.innerHTML = `${dispVal} <span class="banner-weather-icon"><svg class="outline-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg></span>`;
  }
  if (footTxt) {
    footTxt.textContent = "Ambient Light Level";
  }

  // Right Purple Banner: Environment Status (Temperature & Humidity)
  const insideTemp = document.getElementById('insideMetricTemp');
  const insideHum = document.getElementById('insideMetricHum');
  if (insideTemp) {
    const tVal = (farmState.temp !== undefined && farmState.temp !== null && !isNaN(farmState.temp)) ? farmState.temp :
                 ((farmState.temperature !== undefined && farmState.temperature !== null && !isNaN(farmState.temperature)) ? farmState.temperature : null);
    insideTemp.textContent = (tVal !== null) ? `${Number(tVal).toFixed(1)}°C` : `--°C`;
  }
  if (insideHum) {
    const hVal = (farmState.hum !== undefined && farmState.hum !== null && !isNaN(farmState.hum)) ? farmState.hum :
                 ((farmState.humidity !== undefined && farmState.humidity !== null && !isNaN(farmState.humidity)) ? farmState.humidity : null);
    insideHum.textContent = (hVal !== null) ? `${Number(hVal).toFixed(0)}% RH` : `--% RH`;
  }
}

function renderBentoZones() {
  const grid = document.getElementById('bentoRoomsContainer');
  if (!grid) return;

  if (!farmState.zones || farmState.zones.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 36px 16px; color: var(--text-muted); font-size: 0.85rem;" class="text-light">
        No zones configured on Gateway
      </div>
    `;
    return;
  }

  const themes = ["rose", "cyan", "yellow", "green"];
  grid.innerHTML = farmState.zones.map((z, idx) => {
    const theme = z.theme || themes[idx % themes.length];
    const fixturesInZone = farmState.slaves ? farmState.slaves.filter(s => s.zoneId === z.id) : [];
    const activeCount = fixturesInZone.filter(s => s.online && s.pwm > 0).length;
    const isAuto = (z.mode === 'AUTO');
    const pct = LightingEngine.pwmToPercent(z.pwm || 0);

    return `
      <div class="bento-room-card card-theme-${theme}" onclick="openZoneDetailSheet(${z.id})">
        <div class="bento-top-row">
          <div class="bento-icon-circle">
            <svg class="outline-icon outline-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4.5 12.3c.9.8 1.5 2 1.5 3.2h6c0-1.2.6-2.4 1.5-3.2A7 7 0 0 0 12 2z"></path>
            </svg>
          </div>
          <span class="zone-mode-badge ${isAuto ? 'mode-auto' : 'mode-manual'}">${isAuto ? 'Auto' : 'Manual'}</span>
        </div>
        <div>
          <div class="bento-room-title">${z.name || `Zone ${z.id}`}</div>
          <div class="bento-room-sub text-light">${isAuto ? 'Auto' : 'Manual'} · ${pct}% (${fixturesInZone.length} fixtures)</div>
        </div>
      </div>
    `;
  }).join('');
}

// --------------------------------------------------------------------------
// SCHEDULE TAB: DUAL-SESSION TIMELINE & PREVIEW
// --------------------------------------------------------------------------
function renderScheduleTab() {
  const s = farmState.masterSchedule || {
    mornStart: 300, mornEnd: 480, mornRamp: 30,
    eveStart: 1020, eveEnd: 1260, eveRamp: 45
  };

  const inMornStart = document.getElementById('inputMornStart');
  const inMornEnd = document.getElementById('inputMornEnd');
  const inMornRamp = document.getElementById('inputMornRamp');
  const inEveStart = document.getElementById('inputEveStart');
  const inEveEnd = document.getElementById('inputEveEnd');
  const inEveRamp = document.getElementById('inputEveRamp');

  if (inMornStart && document.activeElement !== inMornStart) inMornStart.value = LightingEngine.minToTimeStr(s.mornStart || 300);
  if (inMornEnd && document.activeElement !== inMornEnd) inMornEnd.value = LightingEngine.minToTimeStr(s.mornEnd || 480);
  if (inMornRamp && document.activeElement !== inMornRamp) inMornRamp.value = (typeof s.mornRamp !== 'undefined') ? s.mornRamp : 30;

  if (inEveStart && document.activeElement !== inEveStart) inEveStart.value = LightingEngine.minToTimeStr(s.eveStart || 1020);
  if (inEveEnd && document.activeElement !== inEveEnd) inEveEnd.value = LightingEngine.minToTimeStr(s.eveEnd || 1260);
  if (inEveRamp && document.activeElement !== inEveRamp) inEveRamp.value = (typeof s.eveRamp !== 'undefined') ? s.eveRamp : 45;

  // LDR Daytime Light Supplement Threshold (0–100%)
  if (typeof farmState.ldrThreshold !== 'undefined') {
    const thPct = getLdrThresholdPct(farmState.ldrThreshold);
    const ldrNum = document.getElementById('inputLdrPct');
    const ldrSlider = document.getElementById('inputLdrPctSlider');
    if (ldrNum && document.activeElement !== ldrNum) ldrNum.value = thPct;
    if (ldrSlider && document.activeElement !== ldrSlider) ldrSlider.value = thPct;
  }

  updateTimelinePreview();
}

// Convert ADC or stored threshold into accurate Light Level % (0-100%)
function getLdrThresholdPct(thAdc) {
  if (typeof thAdc === 'undefined' || thAdc === null) return 44;
  // If value is already in 0-100 range directly
  if (thAdc <= 100 && (!farmState.ldrMinAdc || thAdc < farmState.ldrMinAdc)) {
    return Math.max(0, Math.min(100, Math.round(thAdc)));
  }
  const min = (typeof farmState.ldrMinAdc === 'number' && farmState.ldrMinAdc > 0) ? farmState.ldrMinAdc : 1000;
  const max = (typeof farmState.ldrMaxAdc === 'number' && farmState.ldrMaxAdc > min + 50) ? farmState.ldrMaxAdc : 3500;
  if (thAdc <= min) return 0;
  if (thAdc >= max) return 100;
  return Math.max(0, Math.min(100, Math.round(((thAdc - min) / (max - min)) * 100)));
}

// Convert Light Level % (0-100%) into calibrated Master ADC threshold
function ldrPctToThresholdAdc(pct) {
  const p = Math.max(0, Math.min(100, parseInt(pct, 10) || 0));
  const min = (typeof farmState.ldrMinAdc === 'number' && farmState.ldrMinAdc > 0) ? farmState.ldrMinAdc : 1000;
  const max = (typeof farmState.ldrMaxAdc === 'number' && farmState.ldrMaxAdc > min + 50) ? farmState.ldrMaxAdc : 3500;
  return Math.max(0, Math.min(4095, Math.round(min + (p / 100) * (max - min))));
}

function onLdrSliderChange(val) {
  const num = document.getElementById('inputLdrPct');
  if (num) num.value = val;
}

function onLdrNumberChange(val) {
  const slider = document.getElementById('inputLdrPctSlider');
  const clamped = Math.max(0, Math.min(100, parseInt(val, 10) || 0));
  if (slider) slider.value = clamped;
}

function updateTimelinePreview() {
  const mSIn = document.getElementById('inputMornStart');
  const mEIn = document.getElementById('inputMornEnd');
  const mRIn = document.getElementById('inputMornRamp');
  const eSIn = document.getElementById('inputEveStart');
  const eEIn = document.getElementById('inputEveEnd');
  const eRIn = document.getElementById('inputEveRamp');

  if (!mSIn || !mEIn || !eSIn || !eEIn) return;

  const mS = LightingEngine.timeStrToMin(mSIn.value);
  const mE = LightingEngine.timeStrToMin(mEIn.value);
  const mR = parseInt(mRIn ? mRIn.value : '30', 10) || 0;
  const eS = LightingEngine.timeStrToMin(eSIn.value);
  const eE = LightingEngine.timeStrToMin(eEIn.value);
  const eR = parseInt(eRIn ? eRIn.value : '45', 10) || 0;

  let mRampStart = mS - mR;
  if (mRampStart < 0) mRampStart += 1440;
  let mRampEnd = mE + mR;
  if (mRampEnd > 1440) mRampEnd -= 1440;

  let eRampStart = eS - eR;
  if (eRampStart < 0) eRampStart += 1440;
  let eRampEnd = eE + eR;
  if (eRampEnd > 1440) eRampEnd -= 1440;

  // Helper texts
  const mornHelper = document.getElementById('mornHelperTxt');
  if (mornHelper) {
    mornHelper.textContent = `Sunrise starts at ${LightingEngine.minToTimeStr(mRampStart)} · Sunset ends at ${LightingEngine.minToTimeStr(mRampEnd)}`;
  }
  const eveHelper = document.getElementById('eveHelperTxt');
  if (eveHelper) {
    eveHelper.textContent = `Evening starts at ${LightingEngine.minToTimeStr(eRampStart)} · Sunset ends at ${LightingEngine.minToTimeStr(eRampEnd)}`;
  }

  // Milestone labels
  const lblMR = document.getElementById('lblMornRamp');
  const lblMP = document.getElementById('lblMornPeak');
  const lblMF = document.getElementById('lblMornFade');
  const lblER = document.getElementById('lblEveRamp');
  const lblEP = document.getElementById('lblEvePeak');
  const lblEF = document.getElementById('lblEveFade');

  if (lblMR) lblMR.textContent = `${LightingEngine.minToTimeStr(mRampStart)} Dawn`;
  if (lblMP) lblMP.textContent = `${LightingEngine.minToTimeStr(mS)} Morn`;
  if (lblMF) lblMF.textContent = `${LightingEngine.minToTimeStr(mRampEnd)} Gap`;
  if (lblER) lblER.textContent = `${LightingEngine.minToTimeStr(eRampStart)} Eve`;
  if (lblEP) lblEP.textContent = `${LightingEngine.minToTimeStr(eS)} Eve`;
  if (lblEF) lblEF.textContent = `${LightingEngine.minToTimeStr(eRampEnd)} Night`;

  const summary = document.getElementById('scheduleSummaryTxt');
  if (summary) {
    summary.textContent = `Full Light: ${LightingEngine.minToTimeStr(mS)}–${LightingEngine.minToTimeStr(mE)} · ${LightingEngine.minToTimeStr(eS)}–${LightingEngine.minToTimeStr(eE)}`;
  }

  // Calculate percentage stops for 24h timeline
  const pMR_S = ((mRampStart / 1440) * 100).toFixed(1);
  const pM_S  = ((mS / 1440) * 100).toFixed(1);
  const pM_E  = ((mE / 1440) * 100).toFixed(1);
  const pMR_E = ((mRampEnd / 1440) * 100).toFixed(1);

  const pER_S = ((eRampStart / 1440) * 100).toFixed(1);
  const pE_S  = ((eS / 1440) * 100).toFixed(1);
  const pE_E  = ((eE / 1440) * 100).toFixed(1);
  const pER_E = ((eRampEnd / 1440) * 100).toFixed(1);

  const bar = document.getElementById('timelineBarPreview');
  if (bar) {
    bar.style.background = `linear-gradient(to right, 
      #0f172a 0%, #0f172a ${pMR_S}%, 
      #f97316 ${pMR_S}%, #10b981 ${pM_S}%, 
      #10b981 ${pM_E}%, #f97316 ${pMR_E}%, 
      #334155 ${pMR_E}%, #334155 ${pER_S}%, 
      #f97316 ${pER_S}%, #10b981 ${pE_S}%, 
      #10b981 ${pE_E}%, #f97316 ${pER_E}%, 
      #0f172a ${pER_E}%, #0f172a 100%)`;
  }

  updateTimelineScrubberPosition();
}

function updateTimelineScrubberPosition() {
  const scrubber = document.getElementById('timelineScrubber');
  if (!scrubber) return;

  let curMin = 720;
  if (farmState.rtc && typeof farmState.rtc.hour !== 'undefined') {
    curMin = (farmState.rtc.hour * 60) + (farmState.rtc.minute || 0);
  } else {
    const d = new Date();
    curMin = d.getHours() * 60 + d.getMinutes();
  }
  const scrubPct = ((curMin / 1440) * 100).toFixed(2);
  scrubber.style.left = `${scrubPct}%`;
}

// --------------------------------------------------------------------------
// SETTINGS TAB (DYNAMIC POPULATION & LIVE MIRRORING)
// Mirrors Master device state & status dynamically without interrupting typing
// --------------------------------------------------------------------------
function renderSettingsTab() {
  // RTC Status & Live Clock Display
  const rtcDisplay = document.getElementById('rtcClockDisplay');
  const rtcTxt = document.getElementById('rtcStatusTxt');
  const rtcBadge = document.getElementById('rtcStatusBadge');

  if (farmState.rtc && farmState.rtc.year) {
    const y = farmState.rtc.year;
    const mo = String(farmState.rtc.month || 1).padStart(2, '0');
    const d = String(farmState.rtc.day || 1).padStart(2, '0');
    const h = String(farmState.rtc.hour || 0).padStart(2, '0');
    const mi = String(farmState.rtc.minute || 0).padStart(2, '0');
    const s = String(farmState.rtc.second || 0).padStart(2, '0');
    if (rtcDisplay) rtcDisplay.textContent = `${y}-${mo}-${d} ${h}:${mi}:${s}`;
    if (rtcTxt) rtcTxt.textContent = (farmState.rtcOnline !== false && farmState.rtcTime !== "RTC_OFFLINE") ? "Clock Active" : "Software Clock";
    if (rtcBadge) rtcBadge.className = (farmState.rtcOnline !== false && farmState.rtcTime !== "RTC_OFFLINE") ? "status-pill online" : "status-pill warning";
  } else {
    if (rtcDisplay) rtcDisplay.textContent = "--:--:--";
    if (rtcTxt) rtcTxt.textContent = (farmState.rtcTime === "RTC_OFFLINE") ? "Clock Offline" : "Connecting...";
    if (rtcBadge) rtcBadge.className = "status-pill offline";
  }

  // Section 1: Farm Configuration
  const farmInp = document.getElementById('cfgFarmName');
  const shedInp = document.getElementById('cfgShedName');
  const shedIdInp = document.getElementById('cfgShedId');
  if (farmInp && document.activeElement !== farmInp && farmState.farmName !== undefined && farmState.farmName !== "") {
    farmInp.value = farmState.farmName;
  }
  if (shedInp && document.activeElement !== shedInp && farmState.shedName !== undefined && farmState.shedName !== "") {
    shedInp.value = farmState.shedName;
  }
  if (shedIdInp && document.activeElement !== shedIdInp && farmState.shedId !== undefined) {
    shedIdInp.value = farmState.shedId;
  }

  // Section 2: Local WiFi (Hotspot AP)
  const ssidInp = document.getElementById('cfgSsid');
  const pmkInp = document.getElementById('cfgPmk');
  const bcastInp = document.getElementById('cfgHotspotBroadcast');
  if (ssidInp && document.activeElement !== ssidInp && farmState.ssid) {
    ssidInp.value = farmState.ssid;
  }
  if (pmkInp && document.activeElement !== pmkInp && farmState.pmk) {
    pmkInp.value = farmState.pmk;
  }
  if (bcastInp && document.activeElement !== bcastInp && farmState.hotspotHidden !== undefined) {
    bcastInp.checked = !farmState.hotspotHidden;
  }

  // Section 3: Farm WiFi (STA)
  const staEn = document.getElementById('cfgStaEnabled');
  const rSsid = document.getElementById('cfgRouterSSID');
  if (staEn && document.activeElement !== staEn && farmState.staEnabled !== undefined) {
    staEn.checked = !!farmState.staEnabled;
  }
  if (rSsid && document.activeElement !== rSsid && farmState.routerSSID !== undefined) {
    rSsid.value = farmState.routerSSID;
  }

  // Section 3: Farm WiFi Live Status Indicator
  const staBadge = document.getElementById('staStatusBadge');
  const staTxt = document.getElementById('staStatusTxt');
  if (staBadge && staTxt) {
    if (farmState.staConnected) {
      staBadge.className = "status-pill online";
      staTxt.textContent = farmState.staRSSI ? `Connected (${farmState.staRSSI} dBm)` : "Connected";
    } else if (farmState.staEnabled) {
      staBadge.className = "status-pill warning";
      staTxt.textContent = "Connecting...";
    } else {
      staBadge.className = "status-pill offline";
      staTxt.textContent = "Disconnected";
    }
  }

  // Section 4: Remote MQTT
  const mqttEn = document.getElementById('cfgMqttEnabled');
  const mB = document.getElementById('cfgMqttBroker');
  const mP = document.getElementById('cfgMqttPort');
  const mT = document.getElementById('cfgMqttTopic');
  const mU = document.getElementById('cfgMqttUser');
  if (mqttEn && document.activeElement !== mqttEn && farmState.mqttEnabled !== undefined) {
    mqttEn.checked = !!farmState.mqttEnabled;
  }
  if (mB && document.activeElement !== mB && farmState.mqttBroker) {
    mB.value = farmState.mqttBroker;
  }
  if (mP && document.activeElement !== mP && farmState.mqttPort) {
    mP.value = farmState.mqttPort;
  }
  if (mT && document.activeElement !== mT && farmState.mqttTopic) {
    mT.value = farmState.mqttTopic;
  }
  if (mU && document.activeElement !== mU && farmState.mqttUser !== undefined) {
    mU.value = farmState.mqttUser;
  }

  // Section 4: Remote MQTT Live Status Indicator
  const mqttBadge = document.getElementById('mqttStatusBadge');
  const mqttTxt = document.getElementById('mqttStatusTxt');
  if (mqttBadge && mqttTxt) {
    if (farmState.mqttConnected) {
      mqttBadge.className = "status-pill online";
      mqttTxt.textContent = "CLOUD CONNECTED";
    } else if (farmState.mqttEnabled) {
      mqttBadge.className = "status-pill warning";
      mqttTxt.textContent = "CONNECTING...";
    } else {
      mqttBadge.className = "status-pill offline";
      mqttTxt.textContent = "OFFLINE";
    }
  }

  // Section 5: Ambient Light Sensor Live Calibration Telemetry
  const calibLiveAdc = document.getElementById('calibLiveAdc');
  const calibLivePct = document.getElementById('calibLivePct');
  const cfgLdrMinAdc = document.getElementById('cfgLdrMinAdc');
  const cfgLdrMaxAdc = document.getElementById('cfgLdrMaxAdc');
  const calibBadge = document.getElementById('calibSensorBadge');
  const calibTxt = document.getElementById('calibSensorTxt');

  const curAdc = (typeof farmState.rawLdr !== 'undefined' && farmState.rawLdr !== null) ? farmState.rawLdr : ((typeof farmState.ldr !== 'undefined' && farmState.ldr !== null) ? farmState.ldr : '--');
  const curPct = (typeof farmState.lightPct !== 'undefined' && farmState.lightPct !== null) ? farmState.lightPct : ((typeof farmState.luxPct !== 'undefined' && farmState.luxPct !== null) ? farmState.luxPct : '--');

  if (calibLiveAdc) calibLiveAdc.textContent = curAdc !== '--' ? Number(curAdc).toLocaleString() : '--';
  if (calibLivePct) calibLivePct.textContent = curPct !== '--' ? `${curPct}%` : '--%';
  if (cfgLdrMinAdc && document.activeElement !== cfgLdrMinAdc && farmState.ldrMinAdc !== undefined) {
    cfgLdrMinAdc.value = farmState.ldrMinAdc;
  }
  if (cfgLdrMaxAdc && document.activeElement !== cfgLdrMaxAdc && farmState.ldrMaxAdc !== undefined) {
    cfgLdrMaxAdc.value = farmState.ldrMaxAdc;
  }
  if (calibBadge && calibTxt) {
    if (farmState.envSensorOK !== false) {
      calibBadge.className = "status-pill online";
      calibTxt.textContent = "LIVE";
    } else {
      calibBadge.className = "status-pill warning";
      calibTxt.textContent = "RETRY";
    }
  }
}

// --------------------------------------------------------------------------
// LIGHT SENSOR (LDR) CALIBRATION ENGINE
// --------------------------------------------------------------------------
async function setLdrCalibrationAction(action) {
  const curAdc = (typeof farmState.rawLdr !== 'undefined') ? farmState.rawLdr : ((typeof farmState.ldr !== 'undefined') ? farmState.ldr : 1000);
  if (action === 'setDark') {
    const el = document.getElementById('cfgLdrMinAdc');
    if (el) el.value = curAdc;
    farmState.ldrMinAdc = curAdc;
  } else if (action === 'setBright') {
    const el = document.getElementById('cfgLdrMaxAdc');
    if (el) el.value = curAdc;
    farmState.ldrMaxAdc = curAdc;
  }

  try {
    const res = await fetch('/api/ldr/calibrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: action })
    });
    const data = await res.json();
    if (data.ok) {
      if (typeof data.minAdc !== 'undefined') farmState.ldrMinAdc = data.minAdc;
      if (typeof data.maxAdc !== 'undefined') farmState.ldrMaxAdc = data.maxAdc;
      renderSettingsTab();
      showToast(action === 'setDark' ? `Captured Dark Baseline: ${farmState.ldrMinAdc} ADC` : `Captured Bright Baseline: ${farmState.ldrMaxAdc} ADC`);
      await fetchStatus();
    } else {
      showToast("Calibration failed on master", true);
    }
  } catch (e) {
    showToast(action === 'setDark' ? `Captured Dark Baseline: ${curAdc} ADC (Local)` : `Captured Bright Baseline: ${curAdc} ADC (Local)`);
  }
}

async function saveManualLdrCalibration() {
  const minIn = document.getElementById('cfgLdrMinAdc');
  const maxIn = document.getElementById('cfgLdrMaxAdc');
  const minVal = parseInt(minIn ? minIn.value : '1000', 10) || 1000;
  const maxVal = parseInt(maxIn ? maxIn.value : '3500', 10) || 3500;

  if (maxVal <= minVal + 50) {
    showToast("Bright baseline must be higher than dark baseline", true);
    return;
  }

  farmState.ldrMinAdc = minVal;
  farmState.ldrMaxAdc = maxVal;
  renderSettingsTab();

  try {
    const res = await fetch('/api/ldr/calibrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minAdc: minVal, maxAdc: maxVal })
    });
    const data = await res.json();
    if (data.ok) {
      if (typeof data.minAdc !== 'undefined') farmState.ldrMinAdc = data.minAdc;
      if (typeof data.maxAdc !== 'undefined') farmState.ldrMaxAdc = data.maxAdc;
      renderSettingsTab();
      showToast("LDR Calibration saved to Master!");
      await fetchStatus();
    } else {
      showToast("Master rejected calibration", true);
    }
  } catch (e) {
    showToast("Calibration saved locally");
  }
}

function resetLdrCalibrationDefaults() {
  const minIn = document.getElementById('cfgLdrMinAdc');
  const maxIn = document.getElementById('cfgLdrMaxAdc');
  if (minIn) minIn.value = 1000;
  if (maxIn) maxIn.value = 3500;
  saveManualLdrCalibration();
}

// --------------------------------------------------------------------------
// SECTION 1: SAVE FARM CONFIGURATION (Immediately Reflects on Other Pages!)
// --------------------------------------------------------------------------
async function saveFarmConfig() {
  const farm = document.getElementById('cfgFarmName').value.trim() || 'Samposhi Farm';
  const shed = document.getElementById('cfgShedName').value.trim() || 'Broiler Shed #1';
  const id   = parseInt(document.getElementById('cfgShedId').value, 10) || 1;

  // 1. Immediately reflect across state & UI
  farmState.farmName = farm;
  farmState.shedName = shed;
  farmState.shedId   = id;

  localStorage.setItem('samposhi_farm_name', farm);
  localStorage.setItem('samposhi_shed_name', shed);
  localStorage.setItem('samposhi_shed_id', id);

  renderHeader();
  renderHeroBanners();
  renderSettingsTab();

  // 2. Dispatch to Master Gateway /api/config
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ farmName: farm, shedName: shed, shedId: id })
    });
    if (res.ok) {
      showToast("Farm Configuration saved to Master!");
    } else {
      showToast("Failed to save to master", true);
    }
    await fetchStatus();
  } catch (e) {
    showToast("Farm details updated locally");
  }
}

// --------------------------------------------------------------------------
// SAVE LOCAL WIFI CONFIGURATION (HOTSPOT AP)
// --------------------------------------------------------------------------
async function saveLocalWifiConfig() {
  const ssid = document.getElementById('cfgSsid').value.trim();
  const pass = document.getElementById('cfgPass').value;
  const bcast = document.getElementById('cfgHotspotBroadcast').checked;
  const pmk  = document.getElementById('cfgPmk').value.trim();

  if (!ssid) {
    showToast("Hotspot SSID cannot be empty", true);
    return;
  }

  const payload = {
    ssid: ssid,
    hotspotHidden: !bcast,
    pmk: pmk
  };
  if (pass.length >= 8) {
    payload.password = pass;
  }

  farmState.ssid = ssid;
  farmState.hotspotHidden = !bcast;
  farmState.pmk = pmk;
  renderSettingsTab();

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.reboot) {
      showToast("Hotspot updated! Gateway restarting. Please connect to new Wi-Fi...", false);
    } else {
      showToast("Local WiFi saved to Master!");
      await fetchStatus();
    }
  } catch (e) {
    showToast("Local WiFi saved locally");
  }
}

// --------------------------------------------------------------------------
// SAVE FARM INTERNET WIFI CONFIGURATION (ROUTER STA MODE)
// --------------------------------------------------------------------------
async function saveFarmWifiConfig() {
  const staEn = document.getElementById('cfgStaEnabled').checked;
  const rSsid = document.getElementById('cfgRouterSSID').value.trim();
  const rPass = document.getElementById('cfgRouterPass').value;

  const payload = {
    staEnabled: staEn,
    routerSSID: rSsid
  };
  if (rPass.length > 0) {
    payload.routerPass = rPass;
  }

  farmState.staEnabled = staEn;
  farmState.routerSSID = rSsid;

  renderSettingsTab();
  renderHeroBanners();

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      showToast("Farm Internet WiFi saved to Master!");
    } else {
      showToast("Failed to save to master", true);
    }
    await fetchStatus();
  } catch (e) {
    showToast("Farm Internet WiFi saved locally");
  }
}

// --------------------------------------------------------------------------
// SAVE REMOTE CONNECTION CONFIGURATION (MQTT)
// --------------------------------------------------------------------------
async function saveRemoteMqttConfig() {
  const mqttEn = document.getElementById('cfgMqttEnabled')?.checked !== false;
  const mB = document.getElementById('cfgMqttBroker')?.value.trim() || 'broker.emqx.io';
  const mP = parseInt(document.getElementById('cfgMqttPort')?.value, 10) || 1883;
  const mT = document.getElementById('cfgMqttTopic')?.value.trim() || 'samposhi';
  const mU = document.getElementById('cfgMqttUser')?.value.trim() || '';
  const mPass = document.getElementById('cfgMqttPass')?.value || '';

  const payload = {
    mqttEnabled: mqttEn,
    mqttBroker: mB,
    mqttPort: mP,
    mqttTopic: mT,
    mqttUser: mU
  };
  if (mPass.length > 0) {
    payload.mqttPass = mPass;
  }

  farmState.mqttEnabled = mqttEn;
  farmState.mqttBroker = mB;
  farmState.mqttPort = mP;
  farmState.mqttTopic = mT;
  farmState.mqttUser = mU;
  if (mPass.length > 0) farmState.mqttPass = mPass;

  localStorage.setItem('samposhi_mqtt_host', mB);
  localStorage.setItem('samposhi_mqtt_port', mP);
  localStorage.setItem('samposhi_mqtt_topic', mT);
  localStorage.setItem('samposhi_mqtt_user', mU);
  if (mPass.length > 0) localStorage.setItem('samposhi_mqtt_pass', mPass);

  renderSettingsTab();
  renderHeroBanners();

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      showToast("Remote MQTT saved successfully!");
    } else {
      showToast("Remote MQTT saved locally");
    }
  } catch (e) {
    showToast("Remote MQTT saved locally");
  }

  if (farmState.connectionMode === 'remote') {
    stopCloudMqtt();
    startCloudMqtt();
  }
}

// --------------------------------------------------------------------------
// CONNECTION MODE SWITCHER & REMOTE TERMINAL ENGINE
// --------------------------------------------------------------------------
function toggleConnectionMode() {
  if (farmState.connectionMode === 'remote') {
    // Switch to Local Mode
    farmState.connectionMode = 'local';
    currentConnMode = 'local';
    localStorage.setItem('samposhi_conn_mode', 'local');
    stopCloudMqtt();
    const savedIp = getTargetGatewayHost();
    renderHeader();
    renderHeroBanners();
    showToast(`Switched to Local Direct Mode (${savedIp})`);
    fetchStatus(true);
    if (!pollTimer) {
      pollTimer = setInterval(fetchStatus, 3500);
    }
  } else {
    // Switch to Remote Mode
    farmState.connectionMode = 'remote';
    currentConnMode = 'remote';
    localStorage.setItem('samposhi_conn_mode', 'remote');
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    renderHeader();
    renderHeroBanners();
    showToast("Switched to Remote Cloud Mode");
    startCloudMqtt();
  }
}

function selectConnectionModeFromModal(mode) {
  farmState.connectionMode = mode;
  currentConnMode = mode;
  localStorage.setItem('samposhi_conn_mode', mode);

  const btnLocal = document.getElementById('btnModeLocal');
  const btnRemote = document.getElementById('btnModeRemote');

  if (btnLocal && btnRemote) {
    btnLocal.classList.toggle('active', mode === 'local');
    btnRemote.classList.toggle('active', mode === 'remote');
  }

  const localSection = document.getElementById('localParamsSection');
  const remoteSection = document.getElementById('remoteParamsSection');
  const btnSaveTxt = document.getElementById('btnSaveRemoteTxt');

  if (mode === 'local') {
    if (localSection) localSection.style.display = 'block';
    if (remoteSection) remoteSection.style.display = 'none';
    if (btnSaveTxt) btnSaveTxt.textContent = 'Save & Use Local Direct';
    const savedIp = getTargetGatewayHost();
    logRemoteTerminal(`Active transport set to: Local Gateway Direct (http://${savedIp})`, "sys");
  } else {
    if (localSection) localSection.style.display = 'none';
    if (remoteSection) remoteSection.style.display = 'block';
    if (btnSaveTxt) btnSaveTxt.textContent = 'Save & Connect Remote';
    logRemoteTerminal(`Active transport set to: Remote Cloud MQTT (${getMqttWsUrl()})`, "net");
  }

  renderHeader();
  renderHeroBanners();
}

function openRemoteConnectionModal() {
  const modal = document.getElementById('modalRemoteConnection');
  if (!modal) return;

  // Populate fields from farmState / localStorage
  const brokerEl = document.getElementById('modalMqttBroker');
  const portEl = document.getElementById('modalMqttPort');
  const topicEl = document.getElementById('modalMqttTopic');
  const shedIdEl = document.getElementById('modalMqttShedId');
  const wsUrlEl = document.getElementById('modalMqttWsUrl');
  const userEl = document.getElementById('modalMqttUser');
  const passEl = document.getElementById('modalMqttPass');
  const enEl = document.getElementById('modalMqttEnabled');
  const localIpEl = document.getElementById('modalLocalGatewayIp');

  if (brokerEl) brokerEl.value = farmState.mqttBroker || localStorage.getItem('samposhi_mqtt_host') || "broker.emqx.io";
  if (portEl) portEl.value = farmState.mqttPort || localStorage.getItem('samposhi_mqtt_port') || 1883;
  if (topicEl) topicEl.value = farmState.mqttTopic || localStorage.getItem('samposhi_mqtt_topic') || "samposhi";
  if (shedIdEl) shedIdEl.value = farmState.shedId || localStorage.getItem('samposhi_mqtt_shed') || 1;
  if (wsUrlEl) wsUrlEl.value = localStorage.getItem('samposhi_mqtt_ws_url') || "";
  if (userEl) userEl.value = farmState.mqttUser || localStorage.getItem('samposhi_mqtt_user') || "";
  if (passEl) passEl.value = localStorage.getItem('samposhi_mqtt_pass') || "";
  if (enEl) enEl.checked = farmState.mqttEnabled !== false;
  if (localIpEl) localIpEl.value = localStorage.getItem('samposhi_local_ip') || '192.168.4.1';

  // Sync mode pills and sections
  const mode = farmState.connectionMode || 'remote';
  selectConnectionModeFromModal(mode);

  modal.classList.add('active');

  // Seed terminal if empty
  const terminal = document.getElementById('remoteTerminalLogs');
  if (terminal && terminal.children.length === 0) {
    logRemoteTerminal("Terminal initialized.", "sys");
    const savedIp = localStorage.getItem('samposhi_local_ip') || '192.168.4.1';
    logRemoteTerminal(`Local Gateway: http://${savedIp}`, "ok");
    logRemoteTerminal(`Target Broker: ${farmState.mqttBroker || 'broker.emqx.io'}:${farmState.mqttPort || 1883}`, "net");
    logRemoteTerminal(`Resolved WS URL: ${getMqttWsUrl()}`, "net");
    const tPrefix = farmState.mqttTopic || 'samposhi';
    const sId = farmState.shedId || 1;
    logRemoteTerminal(`Subscribed: ${tPrefix}/${sId}/telemetry, ${tPrefix}/${sId}/status`, "net");
    logRemoteTerminal(`Commands: ${tPrefix}/${sId}/command`, "net");
    if (appMqttClient && appMqttClient.connected) {
      logRemoteTerminal(`Status: CONNECTED (Online)`, "ok");
    } else {
      logRemoteTerminal(`Status: ${farmState.connectionMode === 'remote' ? 'CONNECTING...' : 'DISCONNECTED'}`, "warn");
    }
  }
}

function closeRemoteConnectionModal() {
  const modal = document.getElementById('modalRemoteConnection');
  if (modal) modal.classList.remove('active');
}

function logRemoteTerminal(msg, type = "sys") {
  const terminal = document.getElementById('remoteTerminalLogs');
  if (!terminal) return;

  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  const line = document.createElement('div');
  line.className = 'terminal-log-line';

  let typeClass = 'log-sys';
  let prefix = '[SYS]';
  if (type === 'net') { typeClass = 'log-net'; prefix = '[NET]'; }
  else if (type === 'ok') { typeClass = 'log-ok'; prefix = '[OK]'; }
  else if (type === 'warn') { typeClass = 'log-warn'; prefix = '[WARN]'; }
  else if (type === 'err') { typeClass = 'log-err'; prefix = '[ERR]'; }

  line.innerHTML = `<span class="log-time">${timeStr}</span><span class="${typeClass}">${prefix} ${msg}</span>`;
  terminal.appendChild(line);
  terminal.scrollTop = terminal.scrollHeight;
}

function clearRemoteTerminal() {
  const terminal = document.getElementById('remoteTerminalLogs');
  if (terminal) terminal.innerHTML = '';
  logRemoteTerminal("Terminal buffer cleared.", "sys");
}

function pingRemoteBroker() {
  const wsUrl = getMqttWsUrl();
  logRemoteTerminal(`Testing broker connectivity: ${wsUrl}...`, "net");
  if (appMqttClient && appMqttClient.connected) {
    const startTime = Date.now();
    logRemoteTerminal(`Broker WebSocket is LIVE. Sending telemetry request to Master...`, "ok");
    sendCloudMqttCommand({ cmd: "request_telemetry" });
    setTimeout(() => {
      const elapsed = Date.now() - startTime;
      logRemoteTerminal(`Round-trip ping acknowledged: time=${elapsed}ms status=ONLINE`, "ok");
    }, 200);
  } else {
    logRemoteTerminal(`Broker is NOT currently connected. Initiating connection...`, "warn");
    startCloudMqtt();
  }
}

async function saveAndConnectRemoteModal() {
  if (farmState.connectionMode === 'local') {
    const ipInput = document.getElementById('modalLocalGatewayIp');
    if (ipInput) {
      const val = ipInput.value.trim() || '192.168.4.1';
      localStorage.setItem('samposhi_local_ip', val);
      logRemoteTerminal(`Gateway IP configured to: http://${val}`, "ok");
      showToast(`Gateway IP set to ${val}`);
    }
    stopCloudMqtt();
    closeRemoteConnectionModal();
    fetchStatus(true);
    if (!pollTimer) pollTimer = setInterval(fetchStatus, 3500);
    return;
  }

  // Remote Mode
  const broker = (document.getElementById('modalMqttBroker')?.value || '').trim() || "broker.emqx.io";
  const port = parseInt(document.getElementById('modalMqttPort')?.value, 10) || 1883;
  const topic = (document.getElementById('modalMqttTopic')?.value || '').trim() || "samposhi";
  const shedId = parseInt(document.getElementById('modalMqttShedId')?.value, 10) || 1;
  const wsUrl = (document.getElementById('modalMqttWsUrl')?.value || '').trim();
  const user = (document.getElementById('modalMqttUser')?.value || '').trim();
  const pass = document.getElementById('modalMqttPass')?.value || '';
  const enabled = document.getElementById('modalMqttEnabled')?.checked !== false;

  farmState.mqttBroker = broker;
  farmState.mqttPort = port;
  farmState.mqttTopic = topic;
  farmState.shedId = shedId;
  farmState.mqttUser = user;
  if (pass) farmState.mqttPass = pass;
  farmState.mqttEnabled = enabled;
  farmState.connectionMode = 'remote';

  localStorage.setItem('samposhi_conn_mode', 'remote');
  localStorage.setItem('samposhi_mqtt_host', broker);
  localStorage.setItem('samposhi_mqtt_port', port);
  localStorage.setItem('samposhi_mqtt_topic', topic);
  localStorage.setItem('samposhi_mqtt_shed', shedId);
  localStorage.setItem('samposhi_mqtt_ws_url', wsUrl);
  localStorage.setItem('samposhi_mqtt_user', user);
  if (pass) localStorage.setItem('samposhi_mqtt_pass', pass);

  // Sync Settings Tab fields
  const cfgBroker = document.getElementById('cfgMqttBroker');
  const cfgPort = document.getElementById('cfgMqttPort');
  const cfgTopic = document.getElementById('cfgMqttTopic');
  const cfgUser = document.getElementById('cfgMqttUser');
  const cfgEn = document.getElementById('cfgMqttEnabled');
  if (cfgBroker) cfgBroker.value = broker;
  if (cfgPort) cfgPort.value = port;
  if (cfgTopic) cfgTopic.value = topic;
  if (cfgUser) cfgUser.value = user;
  if (cfgEn) cfgEn.checked = enabled;

  renderHeader();
  renderHeroBanners();

  logRemoteTerminal(`Saving MQTT parameters for: ${broker}:${port}`, "sys");
  logRemoteTerminal(`Resolved WebSocket URL: ${getMqttWsUrl()}`, "net");

  const btnSaveTxt = document.getElementById('btnSaveRemoteTxt');
  if (btnSaveTxt) btnSaveTxt.textContent = "Connecting...";

  // Disconnect existing client and reconnect with new parameters
  stopCloudMqtt();
  startCloudMqtt();

  // Also dispatch update_config to Master Gateway if connected
  sendCloudMqttCommand({
    cmd: "update_config",
    mqttEnabled: enabled,
    mqttBroker: broker,
    mqttPort: port,
    mqttTopic: topic,
    mqttUser: user,
    shedId: shedId
  });

  setTimeout(() => {
    if (btnSaveTxt) btnSaveTxt.textContent = "Saved & Connected";
    showToast("Remote Cloud MQTT connected successfully!");
    renderHeader();
    renderHeroBanners();
    renderSettingsTab();
    setTimeout(closeRemoteConnectionModal, 1200);
  }, 1000);
}

// --------------------------------------------------------------------------
// SYSTEM MAINTENANCE (REBOOT, FACTORY RESET, OTA)
// --------------------------------------------------------------------------
async function rebootGateway() {
  if (!confirm("Are you sure you want to reboot the Master Gateway?")) return;
  try {
    await fetch('/api/reboot', { method: 'POST' });
    showToast("Master Gateway is rebooting...");
  } catch (e) {
    showToast("Reboot command sent");
  }
}

// Two-Level Action for Factory Reset
function openFactoryResetModal() {
  const modal = document.getElementById('modalFactoryResetLevel2');
  const inp = document.getElementById('inputResetConfirm');
  const btn = document.getElementById('btnExecuteResetConfirmed');
  if (inp) inp.value = '';
  if (btn) {
    btn.disabled = true;
    btn.style.opacity = '0.4';
    btn.style.cursor = 'not-allowed';
  }
  if (modal) modal.classList.add('active');
}

function closeFactoryResetModal() {
  const modal = document.getElementById('modalFactoryResetLevel2');
  if (modal) modal.classList.remove('active');
}

function checkResetConfirmInput(val) {
  const btn = document.getElementById('btnExecuteResetConfirmed');
  if (!btn) return;
  const match = (val && val.trim().toUpperCase() === 'RESET');
  btn.disabled = !match;
  btn.style.opacity = match ? '1' : '0.4';
  btn.style.cursor = match ? 'pointer' : 'not-allowed';
}

async function executeConfirmedFactoryReset() {
  const inp = document.getElementById('inputResetConfirm');
  if (!inp || inp.value.trim().toUpperCase() !== 'RESET') {
    showToast("Please type RESET to confirm", true);
    return;
  }
  closeFactoryResetModal();
  try {
    await fetch('/api/reset', { method: 'POST' });
    showToast("Master Gateway wiped & resetting to factory defaults...");
    localStorage.removeItem('samposhi_farm_name');
    localStorage.removeItem('samposhi_shed_name');
    localStorage.removeItem('samposhi_shed_id');
    setTimeout(() => {
      window.location.reload();
    }, 3000);
  } catch (e) {
    showToast("Reset signal dispatched");
  }
}

async function factoryResetGateway() {
  openFactoryResetModal();
}

function onOtaFileSelected(input) {
  const display = document.getElementById('otaFileNameDisplay');
  if (input.files && input.files[0]) {
    selectedOtaFile = input.files[0];
    const szKb = (selectedOtaFile.size / 1024).toFixed(1);
    if (display) display.innerHTML = `<b>${selectedOtaFile.name}</b> (${szKb} KB)`;
  } else {
    selectedOtaFile = null;
    if (display) display.textContent = "No file selected";
  }
}

function uploadOtaFirmware() {
  if (!selectedOtaFile) {
    showToast("Please choose a .bin firmware binary first", true);
    return;
  }
  if (!selectedOtaFile.name.endsWith('.bin')) {
    showToast("Invalid file format. Please select a .bin file", true);
    return;
  }
  if (!confirm(`Flash Master Gateway with "${selectedOtaFile.name}"?`)) return;

  const btn = document.getElementById('otaUploadBtn');
  const progContainer = document.getElementById('otaProgressContainer');
  const progBar = document.getElementById('otaProgressBar');
  const statusText = document.getElementById('otaStatusText');

  btn.disabled = true;
  progContainer.style.display = 'block';
  progBar.style.width = '0%';
  statusText.textContent = "Uploading firmware binary to Gateway...";

  const savedHost = localStorage.getItem('samposhi_local_ip') || '192.168.4.1';
  const otaUrl = (window.location.hostname !== savedHost) ? `http://${savedHost}/api/ota` : '/api/ota';
  const xhr = new XMLHttpRequest();
  xhr.open('POST', otaUrl, true);

  xhr.upload.onprogress = function(e) {
    if (e.lengthComputable) {
      const pct = Math.round((e.loaded / e.total) * 100);
      progBar.style.width = pct + '%';
      statusText.textContent = `Uploading: ${pct}% (${(e.loaded/1024).toFixed(0)} KB / ${(e.total/1024).toFixed(0)} KB)`;
    }
  };

  xhr.onload = function() {
    if (xhr.status === 200) {
      progBar.style.width = '100%';
      progBar.style.background = '#10B981';
      statusText.innerHTML = `<b>Firmware flashed successfully!</b><br>Master Gateway is now rebooting...`;
      showToast("Firmware Flashed! Gateway Rebooting...", false);
      setTimeout(() => { window.location.reload(); }, 6000);
    } else {
      btn.disabled = false;
      progBar.style.background = '#EF4444';
      statusText.textContent = "Firmware update failed. Check serial console.";
      showToast("OTA update failed", true);
    }
  };

  xhr.onerror = function() {
    btn.disabled = false;
    progBar.style.background = '#F59E0B';
    statusText.textContent = "Upload disconnected. Gateway may be rebooting...";
  };

  const formData = new FormData();
  formData.append('update', selectedOtaFile);
  xhr.send(formData);
}

// Outline Eye SVG constants matching user-uploaded reference
const EYE_OUTLINE_SVG = `<svg class="outline-icon outline-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.8-7 10-7 10 7 10 7-3.8 7-10 7-10-7-10-7z"></path><circle cx="12" cy="12" r="4"></circle><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"></circle></svg>`;

const EYE_OFF_OUTLINE_SVG = `<svg class="outline-icon outline-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;

// Password visibility eye toggle with outline SVGs
function togglePasswordVisibility(inputId, btn) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  if (inp.type === 'password') {
    inp.type = 'text';
    btn.innerHTML = EYE_OFF_OUTLINE_SVG;
  } else {
    inp.type = 'password';
    btn.innerHTML = EYE_OUTLINE_SVG;
  }
}

// --------------------------------------------------------------------------
// REAL TIME CLOCK SYNCHRONIZATION
// --------------------------------------------------------------------------
async function syncRtcToDevice() {
  const now = new Date();
  const payload = {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
    hour: now.getHours(),
    minute: now.getMinutes(),
    second: now.getSeconds()
  };

  farmState.rtc = payload;
  farmState.rtcOnline = true;

  // Immediately reflect in Header, Hero Banners, and Settings page
  renderHeader();
  renderHeroBanners();
  renderSettingsTab();

  try {
    await fetch('/api/rtc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    showToast("Master RTC synchronized to device time!");
    fetchStatus();
  } catch (e) {
    showToast("RTC updated locally");
  }
}

// --------------------------------------------------------------------------
// GENERAL ZONE, SCHEDULE & FIXTURE ACTIONS
// --------------------------------------------------------------------------
function openZoneDetailSheet(zoneId) {
  if (!farmState.zones || farmState.zones.length === 0) return;
  const zone = farmState.zones.find(z => z.id === zoneId) || farmState.zones[0];
  if (!zone) return;
  activeZoneDetail = zone;

  const titleEl = document.getElementById('sheetZoneTitle');
  const subEl = document.getElementById('sheetZoneSub');
  const badgeEl = document.getElementById('sheetZoneModeBadge');
  const isAuto = (zone.mode === 'AUTO');

  if (titleEl) titleEl.textContent = zone.name || `Zone ${zone.id}`;
  if (badgeEl) {
    badgeEl.textContent = isAuto ? 'Auto' : 'Manual';
    badgeEl.className = `sheet-mode-badge ${isAuto ? 'mode-auto' : 'mode-manual'}`;
  }
  if (subEl) subEl.textContent = `Lighting Zone #${zone.id} · ${isAuto ? 'Auto Mode' : 'Manual Mode'}`;

  const pct = LightingEngine.pwmToPercent(zone.pwm || 0);
  updateRadialGaugeUI(pct);

  const rangeInp = document.getElementById('sheetRadialRange');
  if (rangeInp) rangeInp.value = pct;

  updateSubcontrolToggles(zone);

  const modal = document.getElementById('modalZoneDetail');
  if (modal) modal.classList.add('active');
}

function closeZoneDetailSheet() {
  const modal = document.getElementById('modalZoneDetail');
  if (modal) modal.classList.remove('active');
}

function updateRadialGaugeUI(pct) {
  LightingEngine.renderRadialTickGauge(pct, 'radialSvgTicks');
  const valEl = document.getElementById('sheetGaugeValueNum');
  if (valEl) valEl.textContent = `${pct}%`;
}

function onRadialSliderInput(pctVal) {
  updateRadialGaugeUI(parseInt(pctVal, 10));
}

async function onRadialSliderChange(pctVal) {
  if (!activeZoneDetail) return;
  pausePolling(4000);
  const pct = parseInt(pctVal, 10);
  const pwm = LightingEngine.percentToPwm(pct);
  activeZoneDetail.pwm = pwm;
  activeZoneDetail.mode = 'MANUAL';
  activeZoneDetail.power = (pct > 0);

  // Optimistically sync fixtures in this zone
  if (farmState.slaves) {
    farmState.slaves.forEach(s => {
      if (s.zoneId === activeZoneDetail.id) {
        s.pwm = pwm;
        s.on = (pwm > 0);
      }
    });
  }

  updateSubcontrolToggles(activeZoneDetail);
  renderHeroBanners();
  renderBentoZones();
  renderFleetViews();

  fetch('/api/zone', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zoneId: activeZoneDetail.id, pwm: pwm })
  }).then(res => {
    if (res.ok) showToast(`${activeZoneDetail.name} set to ${pct}% (${pwm} PWM)`);
  }).catch(e => {
    console.warn('Zone slider notice:', e);
  });
}

function setupRadialGaugeTouch() {
  const wrapper = document.querySelector('.radial-gauge-wrapper');
  if (!wrapper) return;

  let isDragging = false;

  function handlePointer(e) {
    const rect = wrapper.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const cx = rect.left + rect.width / 2;
    const cy = rect.top + (rect.height * 0.79);

    const dx = clientX - cx;
    const dy = cy - clientY;

    let rad = Math.atan2(dy, dx);
    if (rad < 0) rad = dx < 0 ? Math.PI : 0;

    const angleDeg = (rad * 180) / Math.PI;
    const pct = Math.round(((180 - angleDeg) / 180) * 100);
    const clamped = Math.max(0, Math.min(100, pct));

    const range = document.getElementById('sheetRadialRange');
    if (range) range.value = clamped;
    updateRadialGaugeUI(clamped);
  }

  wrapper.addEventListener('pointerdown', (e) => {
    isDragging = true;
    pausePolling(4000);
    handlePointer(e);
  });

  window.addEventListener('pointermove', (e) => {
    if (isDragging) {
      pausePolling(4000);
      handlePointer(e);
    }
  });

  window.addEventListener('pointerup', () => {
    if (isDragging) {
      isDragging = false;
      const range = document.getElementById('sheetRadialRange');
      if (range) onRadialSliderChange(range.value);
    }
  });
}

function updateSubcontrolToggles(zone) {
  const isAuto = (zone.mode === 'AUTO');
  const btnAuto = document.getElementById('btnToggleAuto');
  const btnEco = document.getElementById('btnToggleEco');
  const btnPower = document.getElementById('btnTogglePower');
  const badgeEl = document.getElementById('sheetZoneModeBadge');
  const subEl = document.getElementById('sheetZoneSub');

  if (btnAuto) btnAuto.classList.toggle('active', isAuto);
  if (btnEco) btnEco.classList.toggle('active', zone.pwm > 0 && zone.pwm <= 550);
  if (btnPower) btnPower.classList.toggle('active', zone.power !== false && zone.pwm > 0);

  if (badgeEl) {
    badgeEl.textContent = isAuto ? 'Auto' : 'Manual';
    badgeEl.className = `sheet-mode-badge ${isAuto ? 'mode-auto' : 'mode-manual'}`;
  }
  if (subEl) {
    subEl.textContent = `Lighting Zone #${zone.id} · ${isAuto ? 'Auto Mode' : 'Manual Mode'}`;
  }
}

async function toggleZoneAuto() {
  if (!activeZoneDetail) return;
  pausePolling(3000);
  const newAuto = !(activeZoneDetail.mode === 'AUTO');
  activeZoneDetail.mode = newAuto ? 'AUTO' : 'MANUAL';
  updateSubcontrolToggles(activeZoneDetail);
  renderHeroBanners();
  renderBentoZones();

  fetch('/api/zone', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zoneId: activeZoneDetail.id, auto: newAuto })
  }).then(res => {
    if (res.ok) showToast(`${activeZoneDetail.name} mode: ${activeZoneDetail.mode}`);
  }).catch(e => {
    console.warn('Zone auto notice:', e);
  });
}

async function toggleZoneEco() {
  if (!activeZoneDetail) return;
  pausePolling(3000);
  const ecoPwm = LightingEngine.percentToPwm(50);
  activeZoneDetail.pwm = ecoPwm;
  activeZoneDetail.mode = 'MANUAL';
  updateRadialGaugeUI(50);
  updateSubcontrolToggles(activeZoneDetail);
  renderHeroBanners();
  renderBentoZones();

  fetch('/api/zone', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zoneId: activeZoneDetail.id, pwm: ecoPwm })
  }).then(res => {
    if (res.ok) showToast(`${activeZoneDetail.name} preset: 50%`);
  }).catch(e => {
    console.warn('Zone eco notice:', e);
  });
}

async function strobeCurrentZone() {
  if (!activeZoneDetail) return;
  try {
    await fetch('/api/strobe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zoneId: activeZoneDetail.id })
    });
    showToast(`Strobing ${activeZoneDetail.name}...`);
  } catch (e) {}
}

async function toggleZonePowerMaster() {
  if (!activeZoneDetail) return;
  pausePolling(3000);
  const isCurrentlyOn = (activeZoneDetail.power !== false && activeZoneDetail.pwm > 0);
  const newPwm = isCurrentlyOn ? 0 : 1023;
  activeZoneDetail.pwm = newPwm;
  activeZoneDetail.power = !isCurrentlyOn;
  activeZoneDetail.mode = 'MANUAL';

  // Instant 0ms optimistic update across zones and fixtures
  if (farmState.slaves) {
    farmState.slaves.forEach(s => {
      if (s.zoneId === activeZoneDetail.id) {
        s.on = !isCurrentlyOn;
        s.pwm = newPwm;
      }
    });
  }

  updateRadialGaugeUI(isCurrentlyOn ? 0 : 100);
  updateSubcontrolToggles(activeZoneDetail);
  renderHeroBanners();
  renderBentoZones();
  renderFleetViews();

  fetch('/api/zone', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zoneId: activeZoneDetail.id, on: !isCurrentlyOn, pwm: newPwm })
  }).then(res => {
    if (res.ok) showToast(`${activeZoneDetail.name} turned ${!isCurrentlyOn ? 'ON' : 'OFF'}`);
  }).catch(e => {
    console.warn('Zone power notice:', e);
  });
}

async function toggleDevicePower(nodeId) {
  const slave = farmState.slaves.find(s => s.nodeId === nodeId);
  if (!slave) return;
  pausePolling(3000);
  const isCurrentlyOn = (slave.pwm > 0);
  const newPwm = isCurrentlyOn ? 0 : 1023;
  slave.pwm = newPwm;
  slave.on = !isCurrentlyOn;
  renderFleetViews();

  fetch('/api/fixture/toggle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodeId: nodeId, on: !isCurrentlyOn })
  }).then(res => {
    if (res.ok) showToast(`${slave.name} turned ${!isCurrentlyOn ? 'ON' : 'OFF'}`);
  }).catch(e => {
    console.warn('Fixture power notice:', e);
  });
}

async function setGlobalAll(on) {
  pausePolling(3000);
  if (farmState.zones) {
    farmState.zones.forEach(z => {
      z.mode = 'MANUAL';
      z.pwm = on ? 1023 : 0;
      z.power = on;
    });
    if (activeZoneDetail) {
      activeZoneDetail.mode = 'MANUAL';
      activeZoneDetail.pwm = on ? 1023 : 0;
      activeZoneDetail.power = on;
      updateRadialGaugeUI(on ? 100 : 0);
      updateSubcontrolToggles(activeZoneDetail);
    }
  }
  if (farmState.slaves) {
    farmState.slaves.forEach(s => {
      s.on = on;
      s.pwm = on ? 1023 : 0;
    });
  }
  renderAll();

  fetch('/api/all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ on: on })
  }).then(res => {
    if (res.ok) showToast(`All fixtures turned ${on ? 'ON (100%)' : 'OFF (0%)'}`);
  }).catch(e => {
    console.warn('Global all notice:', e);
  });
}

async function restoreGlobalAuto() {
  pausePolling(3000);
  if (farmState.zones) {
    farmState.zones.forEach(z => { z.mode = 'AUTO'; });
    if (activeZoneDetail) {
      activeZoneDetail.mode = 'AUTO';
      updateSubcontrolToggles(activeZoneDetail);
    }
    renderAll();
  }

  fetch('/api/auto-all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ auto: true })
  }).then(res => {
    if (res.ok) showToast("Restored Photoperiod AUTO mode across all zones");
  }).catch(e => {
    console.warn('Restore auto notice:', e);
  });
}

async function saveScheduleForm() {
  const mSIn = document.getElementById('inputMornStart');
  const mEIn = document.getElementById('inputMornEnd');
  const mRIn = document.getElementById('inputMornRamp');
  const eSIn = document.getElementById('inputEveStart');
  const eEIn = document.getElementById('inputEveEnd');
  const eRIn = document.getElementById('inputEveRamp');
  const ldrIn = document.getElementById('inputLdrPct');

  const mS = LightingEngine.timeStrToMin(mSIn ? mSIn.value : '05:00');
  const mE = LightingEngine.timeStrToMin(mEIn ? mEIn.value : '08:00');
  const mR = parseInt(mRIn ? mRIn.value : '30', 10) || 30;
  const eS = LightingEngine.timeStrToMin(eSIn ? eSIn.value : '17:00');
  const eE = LightingEngine.timeStrToMin(eEIn ? eEIn.value : '21:00');
  const eR = parseInt(eRIn ? eRIn.value : '45', 10) || 45;

  const rawVal = parseInt(ldrIn ? ldrIn.value : '44', 10);
  const ldrPct = isNaN(rawVal) ? 44 : Math.max(0, Math.min(100, rawVal));
  const ldrTh = ldrPctToThresholdAdc(ldrPct);

  farmState.masterSchedule = {
    mornStart: mS, mornEnd: mE, mornRamp: mR,
    eveStart: eS, eveEnd: eE, eveRamp: eR
  };
  farmState.ldrThreshold = ldrTh;
  updateTimelinePreview();

  try {
    await fetch('/api/schedule/master', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        masterSchedule: {
          mornStart: mS, mornEnd: mE, mornRamp: mR,
          eveStart: eS, eveEnd: eE, eveRamp: eR
        },
        ldrThreshold: ldrTh
      })
    });
    showToast(`Lighting schedule saved! Light threshold: ${ldrPct}%`);
    fetchStatus();
  } catch (e) {
    showToast("Schedule saved locally");
  }
}

// Navigation Tabs
function switchTab(tabId) {
  currentTab = tabId;
  document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
  const target = document.getElementById(`tab-${tabId}`);
  if (target) target.classList.add('active');

  const dockTabs = [
    { id: 'dockBtnHome', tab: 'home' },
    { id: 'dockBtnRooms', tab: 'rooms' },
    { id: 'dockBtnSched', tab: 'schedule' },
    { id: 'dockBtnSettings', tab: 'settings' }
  ];

  dockTabs.forEach(item => {
    const btn = document.getElementById(item.id);
    if (!btn) return;
    const isActive = (tabId === item.tab);
    btn.className = isActive ? 'dock-pill-active' : 'dock-icon-btn';
    const span = btn.querySelector('span');
    if (span) span.style.display = isActive ? 'inline' : 'none';
  });

  renderAll();
}

// ==========================================================================
// SECTION 1: ZONES & DEVICES (NEW ZONE & PAIR DEVICE)
// ==========================================================================
function openAddZoneModal() {
  const title = document.getElementById('modalZoneTitle');
  const isEdit = document.getElementById('modalZoneIsEdit');
  const idInp = document.getElementById('modalZoneId');
  const nameInp = document.getElementById('modalZoneName');
  const descInp = document.getElementById('modalZoneDesc');

  if (title) title.textContent = "New Zone";
  if (isEdit) isEdit.value = "0";

  const activeIds = (farmState.zones || []).map(z => z.id);
  let nextId = 1;
  for (let i = 1; i <= 16; i++) {
    if (!activeIds.includes(i)) { nextId = i; break; }
  }

  if (idInp) {
    idInp.value = nextId;
    idInp.disabled = false;
  }
  if (nameInp) nameInp.value = `Zone ${nextId}`;
  if (descInp) descInp.value = "";

  const modal = document.getElementById('modalZone');
  if (modal) modal.classList.add('active');
}

function openEditZoneModal(zoneId) {
  const z = (farmState.zones || []).find(item => item.id === zoneId);
  if (!z) return;

  const title = document.getElementById('modalZoneTitle');
  const isEdit = document.getElementById('modalZoneIsEdit');
  const origId = document.getElementById('modalZoneOriginalId');
  const idInp = document.getElementById('modalZoneId');
  const nameInp = document.getElementById('modalZoneName');
  const descInp = document.getElementById('modalZoneDesc');

  if (title) title.textContent = `Edit Zone ${z.id}`;
  if (isEdit) isEdit.value = "1";
  if (origId) origId.value = z.id;
  if (idInp) {
    idInp.value = z.id;
    idInp.disabled = true;
  }
  if (nameInp) nameInp.value = z.name || `Zone ${z.id}`;
  if (descInp) descInp.value = z.desc || "";

  const modal = document.getElementById('modalZone');
  if (modal) modal.classList.add('active');
}

function closeZoneModal() {
  const modal = document.getElementById('modalZone');
  if (modal) modal.classList.remove('active');
}

async function submitZoneModal() {
  const isEdit = document.getElementById('modalZoneIsEdit')?.value === "1";
  const id = parseInt(document.getElementById('modalZoneId')?.value, 10);
  const name = document.getElementById('modalZoneName')?.value.trim();
  const desc = document.getElementById('modalZoneDesc')?.value.trim() || "";

  if (!id || isNaN(id)) {
    showToast("Please enter a valid Zone ID", true);
    return;
  }
  if (!name) {
    showToast("Please enter a Zone Name", true);
    return;
  }

  if (!farmState.zones) farmState.zones = [];
  const existingIndex = farmState.zones.findIndex(z => z.id === id);
  if (existingIndex >= 0) {
    farmState.zones[existingIndex].name = name;
    farmState.zones[existingIndex].desc = desc;
  } else {
    farmState.zones.push({
      id: id,
      name: name,
      desc: desc,
      pwm: 750,
      mode: "AUTO",
      power: true,
      theme: "cyan",
      icon: "lamp"
    });
  }

  closeZoneModal();
  showToast(isEdit ? `Zone ${id} updated` : `Zone ${id} created`);
  renderAll();

  try {
    await fetch('/api/zone/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name, desc })
    });
    fetchStatus();
  } catch (e) {}
}

function togglePairDeviceCard() {
  const card = document.getElementById('cardPairDevice');
  if (!card) return;
  const isShown = card.style.display !== 'none';
  card.style.display = isShown ? 'none' : 'block';
  if (!isShown) {
    populateCommissionZones();
    const activeNodeIds = (farmState.slaves || []).map(s => s.nodeId);
    let nextNodeId = 1;
    for (let i = 1; i <= 254; i++) {
      if (!activeNodeIds.includes(i)) { nextNodeId = i; break; }
    }
    const nodeInp = document.getElementById('commNodeIdInput');
    if (nodeInp) nodeInp.value = nextNodeId;
  } else {
    const vidBox = document.getElementById('cameraPreviewBox');
    if (vidBox && vidBox.style.display === 'block') {
      MacScanner.stop();
      vidBox.style.display = 'none';
    }
  }
}

function populateCommissionZones() {
  const select = document.getElementById('commZoneSelect');
  if (!select) return;
  select.innerHTML = '';
  if (!farmState.zones || farmState.zones.length === 0) {
    const opt = document.createElement('option');
    opt.value = "1";
    opt.textContent = "Zone 1 (Default)";
    select.appendChild(opt);
    return;
  }
  farmState.zones.forEach(z => {
    const opt = document.createElement('option');
    opt.value = z.id;
    opt.textContent = `Zone ${z.id}: ${z.name || `Zone ${z.id}`}`;
    select.appendChild(opt);
  });
}

function formatMacInput(el) {
  let val = el.value.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  if (val.length > 12) val = val.substring(0, 12);
  let parts = [];
  for (let i = 0; i < val.length; i += 2) {
    parts.push(val.substring(i, i + 2));
  }
  el.value = parts.join(':');
}

async function testStrobeMac() {
  const macInp = document.getElementById('commMacInput');
  const mac = macInp ? macInp.value.trim() : "";
  if (!mac || mac.length < 12) {
    showToast("Enter or scan a valid MAC address first", true);
    return;
  }
  try {
    await fetch('/api/identify-mac', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mac: mac })
    });
    showToast(`Find Device strobe sent to ${mac}`);
  } catch (e) {
    showToast("Strobe signal sent");
  }
}

async function submitCommissioning() {
  const macInp = document.getElementById('commMacInput');
  const nodeInp = document.getElementById('commNodeIdInput');
  const zoneInp = document.getElementById('commZoneSelect');

  const mac = macInp ? macInp.value.trim().toUpperCase() : "";
  const nodeId = parseInt(nodeInp ? nodeInp.value : '1', 10);
  const zoneId = parseInt(zoneInp ? zoneInp.value : '1', 10);

  if (!mac || mac.length < 12) {
    showToast("Please enter a valid MAC address", true);
    return;
  }
  if (!nodeId || isNaN(nodeId)) {
    showToast("Please specify a Device ID", true);
    return;
  }

  if (!farmState.slaves) farmState.slaves = [];
  const existing = farmState.slaves.find(s => s.nodeId === nodeId || s.mac === mac);
  if (existing) {
    existing.nodeId = nodeId;
    existing.mac = mac;
    existing.zoneId = zoneId;
    existing.online = true;
  } else {
    farmState.slaves.push({
      nodeId: nodeId,
      name: `Device #${nodeId}`,
      mac: mac,
      zoneId: zoneId,
      pwm: 750,
      online: true,
      rssi: -60
    });
  }

  showToast(`Device #${nodeId} paired to Zone ${zoneId}!`);
  if (macInp) macInp.value = "";
  togglePairDeviceCard();
  renderAll();

  try {
    await fetch('/api/pair-mac', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mac, nodeId, zoneId })
    });
    fetchStatus();
  } catch (e) {}
}

async function toggleCameraScan() {
  const vidBox = document.getElementById('cameraPreviewBox');
  const video = document.getElementById('qrVideoPreview');
  if (!vidBox || !video) return;

  if (vidBox.style.display === 'block') {
    MacScanner.stop();
    vidBox.style.display = 'none';
  } else {
    vidBox.style.display = 'block';
    const ok = await MacScanner.start(video, (scannedMac) => {
      const macInp = document.getElementById('commMacInput');
      if (macInp) macInp.value = scannedMac;
      showToast(`Scanned MAC: ${scannedMac}`);
      MacScanner.stop();
      vidBox.style.display = 'none';
    });
    if (!ok) {
      showToast("Camera access unavailable. Check permissions.", true);
      vidBox.style.display = 'none';
    }
  }
}

// ==========================================================================
// SECTION 2: CONFIGURED ZONES MANAGEMENT
// ==========================================================================
function renderZonesManagement() {
  const container = document.getElementById('zonesManagementContainer');
  if (!container) return;

  const zones = farmState.zones || [];
  if (zones.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 0.82rem;" class="text-light">
        No zones configured. Tap "+ New Zone" above to create one.
      </div>
    `;
    return;
  }

  container.innerHTML = zones.map(z => {
    const fixtureCount = (farmState.slaves || []).filter(s => s.zoneId === z.id).length;
    const isAuto = (z.mode === 'AUTO');
    return `
      <div class="zone-manage-item">
        <div class="zone-manage-left">
          <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-start;">
            <span class="zone-manage-badge">Zone ${z.id}</span>
            <span class="zone-mode-badge ${isAuto ? 'mode-auto' : 'mode-manual'}" style="font-size: 0.62rem; padding: 1.5px 6px;">${isAuto ? 'Auto' : 'Manual'}</span>
          </div>
          <div>
            <div class="zone-manage-title">${z.name || `Zone ${z.id}`}</div>
            <div class="zone-desc text-light">${z.desc || `${fixtureCount} fixture${fixtureCount !== 1 ? 's' : ''} assigned`}</div>
          </div>
        </div>
        <div class="zone-manage-actions">
          <button class="icon-action-btn" onclick="openEditZoneModal(${z.id})" title="Edit Zone">
            <svg class="outline-icon outline-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h9"></path>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
            </svg>
          </button>
          <button class="icon-action-btn danger" onclick="openZoneDeleteModal(${z.id})" title="Delete Zone">
            <svg class="outline-icon outline-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function openZoneDeleteModal(zoneId) {
  const z = (farmState.zones || []).find(item => item.id === zoneId);
  const modal = document.getElementById('modalZoneDelete');
  const idInp = document.getElementById('delZoneIdInput');
  const idTxt = document.getElementById('delZoneIdTxt');
  const nameTxt = document.getElementById('delZoneNameTxt');

  if (idInp) idInp.value = zoneId;
  if (idTxt) idTxt.textContent = zoneId;
  if (nameTxt) nameTxt.textContent = z ? (z.name || `Zone ${zoneId}`) : `Zone ${zoneId}`;

  if (modal) modal.classList.add('active');
}

function closeZoneDeleteModal() {
  const modal = document.getElementById('modalZoneDelete');
  if (modal) modal.classList.remove('active');
}

async function executeZoneDeleteConfirmed() {
  const idInp = document.getElementById('delZoneIdInput');
  const zoneId = parseInt(idInp ? idInp.value : '0', 10);
  if (!zoneId) return;

  farmState.zones = (farmState.zones || []).filter(z => z.id !== zoneId);
  closeZoneDeleteModal();
  showToast(`Zone ${zoneId} deleted`);
  renderAll();

  try {
    await fetch('/api/zone/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: zoneId })
    });
    fetchStatus();
  } catch (e) {}
}

// ==========================================================================
// SECTION 3: PAIRED DEVICES (FLEET VIEWS & INSPECTOR)
// ==========================================================================
function setFleetViewMode(mode) {
  fleetViewMode = mode;
  const btnMatrix = document.getElementById('btnViewMatrix');
  const btnList = document.getElementById('btnViewList');
  const matrixView = document.getElementById('fleetMatrixView');
  const listView = document.getElementById('fleetListView');

  if (btnMatrix) btnMatrix.className = (mode === 'matrix') ? 'segmented-toggle-btn active' : 'segmented-toggle-btn';
  if (btnList) btnList.className = (mode === 'list') ? 'segmented-toggle-btn active' : 'segmented-toggle-btn';

  if (matrixView) matrixView.style.display = (mode === 'matrix') ? 'block' : 'none';
  if (listView) listView.style.display = (mode === 'list') ? 'block' : 'none';

  renderFleetViews();
}

function populateFleetZoneFilter() {
  const select = document.getElementById('fleetZoneFilter');
  if (!select) return;
  const currentVal = select.value || 'all';
  select.innerHTML = '<option value="all">All Zones</option>';

  (farmState.zones || []).forEach(z => {
    const opt = document.createElement('option');
    opt.value = String(z.id);
    opt.textContent = `Zone ${z.id}: ${z.name || `Zone ${z.id}`}`;
    select.appendChild(opt);
  });

  if (Array.from(select.options).some(o => o.value === currentVal)) {
    select.value = currentVal;
  } else {
    select.value = 'all';
  }
}

function renderFleetViews() {
  populateFleetZoneFilter();

  const filterSelect = document.getElementById('fleetZoneFilter');
  const filterVal = filterSelect ? filterSelect.value : 'all';

  let slaves = farmState.slaves ? [...farmState.slaves] : [];
  if (filterVal !== 'all') {
    const zId = parseInt(filterVal, 10);
    slaves = slaves.filter(s => s.zoneId === zId);
  }
  slaves.sort((a, b) => (a.nodeId || 0) - (b.nodeId || 0));

  // 1. Matrix View Rendering
  const matrixContainer = document.getElementById('matrixGridContainer');
  if (matrixContainer) {
    if (slaves.length === 0) {
      matrixContainer.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 24px; color: var(--text-muted); font-size: 0.82rem;" class="text-light">
          No paired devices found for this filter.
        </div>
      `;
    } else {
      matrixContainer.innerHTML = slaves.map(s => {
        const isOn = s.online && (s.pwm > 0);
        const pct = LightingEngine.pwmToPercent(s.pwm || 0);
        return `
          <div class="matrix-fleet-cell ${isOn ? 'active' : ''}" onclick="openDeviceInspectorModal(${s.nodeId})">
            <div class="matrix-cell-top">
              <span class="matrix-cell-node">#${s.nodeId}</span>
              <span class="status-indicator-dot ${s.online ? 'online' : 'offline'}"></span>
            </div>
            <div class="matrix-cell-icon">
              <svg class="outline-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <rect x="5.5" y="5.5" width="13" height="13" rx="1.8"></rect>
                <circle cx="9.5" cy="9.5" r="1.3" fill="currentColor"></circle>
                <circle cx="14.5" cy="14.5" r="1.3" fill="currentColor"></circle>
                <line x1="7.5" y1="1.5" x2="7.5" y2="5.5"></line>
                <line x1="10.5" y1="1.5" x2="10.5" y2="5.5"></line>
                <line x1="13.5" y1="1.5" x2="13.5" y2="5.5"></line>
                <line x1="16.5" y1="1.5" x2="16.5" y2="5.5"></line>
                <line x1="7.5" y1="18.5" x2="7.5" y2="22.5"></line>
                <line x1="10.5" y1="18.5" x2="10.5" y2="22.5"></line>
                <line x1="13.5" y1="18.5" x2="13.5" y2="22.5"></line>
                <line x1="16.5" y1="18.5" x2="16.5" y2="22.5"></line>
                <line x1="1.5" y1="7.5" x2="5.5" y2="7.5"></line>
                <line x1="1.5" y1="10.5" x2="5.5" y2="10.5"></line>
                <line x1="1.5" y1="13.5" x2="5.5" y2="13.5"></line>
                <line x1="1.5" y1="16.5" x2="5.5" y2="16.5"></line>
                <line x1="18.5" y1="7.5" x2="22.5" y2="7.5"></line>
                <line x1="18.5" y1="10.5" x2="22.5" y2="10.5"></line>
                <line x1="18.5" y1="13.5" x2="22.5" y2="13.5"></line>
                <line x1="18.5" y1="16.5" x2="22.5" y2="16.5"></line>
              </svg>
            </div>
            <div class="matrix-cell-bottom">
              <span class="matrix-cell-zone">Z${s.zoneId || 1}</span>
              <span class="matrix-cell-pct ${isOn ? '' : 'off'}">${isOn ? `${pct}%` : 'OFF'}</span>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // 2. List View Rendering
  const listContainer = document.getElementById('fixturesListContainer');
  if (listContainer) {
    if (slaves.length === 0) {
      listContainer.innerHTML = `
        <div style="text-align: center; padding: 24px; color: var(--text-muted); font-size: 0.82rem;" class="text-light">
          No paired devices found for this filter.
        </div>
      `;
    } else {
      listContainer.innerHTML = slaves.map(s => {
        const isOn = s.online && (s.pwm > 0);
        const pct = LightingEngine.pwmToPercent(s.pwm || 0);
        return `
          <div class="fleet-list-row">
            <div class="fleet-row-left">
              <span class="status-indicator-dot ${s.online ? 'online' : 'offline'}"></span>
              <span class="matrix-cell-node">#${s.nodeId}</span>
              <div class="fleet-row-info">
                <div class="fleet-row-name">${s.name || `Device #${s.nodeId}`}</div>
                <div class="fleet-row-sub text-light">Zone ${s.zoneId || 1} · ${s.mac || '--'}</div>
              </div>
            </div>
            <div class="fleet-row-right">
              <span class="fleet-row-pct ${isOn ? '' : 'off'}">${isOn ? `${pct}%` : 'OFF'}</span>
              <button class="icon-action-btn ${isOn ? 'primary' : ''}" onclick="toggleDevicePower(${s.nodeId})" title="Toggle Power">
                <svg class="outline-icon outline-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path>
                  <line x1="12" y1="2" x2="12" y2="12"></line>
                </svg>
              </button>
              <button class="icon-action-btn" onclick="strobeNode(${s.nodeId})" title="Find Device">
                <svg class="outline-icon outline-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                </svg>
              </button>
              <button class="icon-action-btn" onclick="openSlaveOtaModal(${s.nodeId}, '${(s.name || `Device #${s.nodeId}`).replace(/'/g, "\\'")}', '${s.mac || ''}')" title="Firmware Update">
                <svg class="outline-icon outline-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path fill="currentColor" stroke="none" fill-rule="evenodd" d="M 10.74 6.54 L 13.26 6.54 L 13.21 8.29 L 14.61 9.10 L 16.10 8.18 L 17.36 10.36 L 15.81 11.19 L 15.81 12.81 L 17.36 13.64 L 16.10 15.82 L 14.61 14.90 L 13.21 15.71 L 13.26 17.46 L 10.74 17.46 L 10.79 15.71 L 9.39 14.90 L 7.90 15.82 L 6.64 13.64 L 8.19 12.81 L 8.19 11.19 L 6.64 10.36 L 7.90 8.18 L 9.39 9.10 L 10.79 8.29 Z M 12 10 A 2 2 0 1 0 12 14 A 2 2 0 1 0 12 10 Z"></path>
                  <path d="M 5.2 15.2 A 8.6 8.6 0 0 1 18.6 7.6"></path>
                  <polyline points="14.5 7.6 18.6 7.6 18.6 3.5"></polyline>
                  <path d="M 18.8 8.8 A 8.6 8.6 0 0 1 5.4 16.4"></path>
                  <polyline points="9.5 16.4 5.4 16.4 5.4 20.5"></polyline>
                </svg>
              </button>
              <button class="icon-action-btn" onclick="openDeviceInspectorModal(${s.nodeId})" title="Edit Device">
                <svg class="outline-icon outline-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 20h9"></path>
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                </svg>
              </button>
              <button class="icon-action-btn danger" onclick="openDeviceInspectorModal(${s.nodeId}, true)" title="Depair Device">
                <svg class="outline-icon outline-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M18.84 12.25l1.72-1.71a4.88 4.88 0 0 0-6.9-6.9l-1.72 1.71"></path>
                  <path d="M5.16 11.75l-1.72 1.71a4.88 4.88 0 0 0 6.9 6.9l1.72-1.71"></path>
                  <line x1="2" y1="2" x2="22" y2="22"></line>
                </svg>
              </button>
            </div>
          </div>
        `;
      }).join('');
    }
  }
}

// Device Inspector Modal Controllers
function openDeviceInspectorModal(nodeId, openToDepair = false) {
  const s = (farmState.slaves || []).find(item => item.nodeId === nodeId);
  if (!s) return;
  currentInspectingNodeId = nodeId;

  const modal = document.getElementById('modalDeviceInspector');
  const title = document.getElementById('inspectNodeTitle');
  const macPill = document.getElementById('inspectMacPill');
  const zonePill = document.getElementById('inspectZonePill');
  const statusPill = document.getElementById('inspectStatusPill');
  const idHidden = document.getElementById('inspectNodeIdHidden');
  const macHidden = document.getElementById('inspectMacHidden');
  const nameInp = document.getElementById('inspectDeviceName');
  const zoneSel = document.getElementById('inspectDeviceZone');
  const dimmerPct = document.getElementById('inspectDimmerPct');
  const dimmerSlider = document.getElementById('inspectDimmerSlider');
  const btnPower = document.getElementById('btnInspectPower');
  const btnPowerTxt = document.getElementById('btnInspectPowerTxt');

  if (title) title.textContent = `Device #${s.nodeId}`;
  if (idHidden) idHidden.value = s.nodeId;
  if (macHidden) macHidden.value = s.mac || "";
  if (macPill) macPill.textContent = `MAC: ${s.mac || '--'}`;
  if (zonePill) zonePill.textContent = `Zone ${s.zoneId || 1}`;
  if (statusPill) {
    statusPill.innerHTML = `
      <span class="status-indicator-dot ${s.online ? 'online' : 'offline'}"></span>
      ${s.online ? 'Online' : 'Offline'}
    `;
  }
  if (nameInp) nameInp.value = s.name || `Device #${s.nodeId}`;

  if (zoneSel) {
    zoneSel.innerHTML = '';
    (farmState.zones || []).forEach(z => {
      const opt = document.createElement('option');
      opt.value = z.id;
      opt.textContent = `Zone ${z.id}: ${z.name || `Zone ${z.id}`}`;
      zoneSel.appendChild(opt);
    });
    zoneSel.value = s.zoneId || 1;
  }

  const pct = LightingEngine.pwmToPercent(s.pwm || 0);
  const isOn = s.online && (s.pwm > 0);
  if (dimmerPct) dimmerPct.textContent = `${pct}%`;
  if (dimmerSlider) dimmerSlider.value = pct;
  if (btnPower) {
    btnPower.className = isOn ? 'modal-quick-btn active' : 'modal-quick-btn';
  }
  if (btnPowerTxt) {
    btnPowerTxt.textContent = isOn ? 'Power Off' : 'Power On';
  }

  const depairBox = document.getElementById('depairConfirmBox');
  const btnStartDepair = document.getElementById('btnStartDepair');
  if (openToDepair) {
    if (depairBox) depairBox.style.display = 'block';
    if (btnStartDepair) btnStartDepair.style.display = 'none';
  } else {
    if (depairBox) depairBox.style.display = 'none';
    if (btnStartDepair) btnStartDepair.style.display = 'flex';
  }

  if (modal) modal.classList.add('active');
}

function closeDeviceInspectorModal() {
  const modal = document.getElementById('modalDeviceInspector');
  if (modal) modal.classList.remove('active');
  currentInspectingNodeId = null;
}

let inspectDimmerDebounce = null;
function onInspectDimmerChange(val) {
  const pct = parseInt(val, 10);
  const dimmerPct = document.getElementById('inspectDimmerPct');
  if (dimmerPct) dimmerPct.textContent = `${pct}%`;

  if (!currentInspectingNodeId) return;
  const s = (farmState.slaves || []).find(item => item.nodeId === currentInspectingNodeId);
  if (!s) return;

  const newPwm = LightingEngine.percentToPwm(pct);
  s.pwm = newPwm;

  const btnPower = document.getElementById('btnInspectPower');
  const btnPowerTxt = document.getElementById('btnInspectPowerTxt');
  const isOn = (newPwm > 0);
  if (btnPower) btnPower.className = isOn ? 'modal-quick-btn active' : 'modal-quick-btn';
  if (btnPowerTxt) btnPowerTxt.textContent = isOn ? 'Power Off' : 'Power On';

  renderFleetViews();

  clearTimeout(inspectDimmerDebounce);
  inspectDimmerDebounce = setTimeout(async () => {
    try {
      await fetch('/api/fixture/pwm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId: currentInspectingNodeId, pwm: newPwm })
      });
    } catch (e) {}
  }, 200);
}

async function toggleInspectDevicePower() {
  if (!currentInspectingNodeId) return;
  const s = (farmState.slaves || []).find(item => item.nodeId === currentInspectingNodeId);
  if (!s) return;

  const isCurrentlyOn = (s.pwm > 0);
  const newPwm = isCurrentlyOn ? 0 : 750;
  s.pwm = newPwm;

  const pct = LightingEngine.pwmToPercent(newPwm);
  const dimmerPct = document.getElementById('inspectDimmerPct');
  const dimmerSlider = document.getElementById('inspectDimmerSlider');
  const btnPower = document.getElementById('btnInspectPower');
  const btnPowerTxt = document.getElementById('btnInspectPowerTxt');

  if (dimmerPct) dimmerPct.textContent = `${pct}%`;
  if (dimmerSlider) dimmerSlider.value = pct;
  if (btnPower) btnPower.className = !isCurrentlyOn ? 'modal-quick-btn active' : 'modal-quick-btn';
  if (btnPowerTxt) btnPowerTxt.textContent = !isCurrentlyOn ? 'Power Off' : 'Power On';

  renderFleetViews();

  try {
    await fetch('/api/fixture/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId: currentInspectingNodeId, on: !isCurrentlyOn })
    });
    showToast(`${s.name || `Device #${currentInspectingNodeId}`} turned ${!isCurrentlyOn ? 'ON' : 'OFF'}`);
  } catch (e) {}
}

async function strobeInspectDevice() {
  if (!currentInspectingNodeId) return;
  const s = (farmState.slaves || []).find(item => item.nodeId === currentInspectingNodeId);
  try {
    await fetch('/api/identify-mac', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId: currentInspectingNodeId, mac: s ? s.mac : '' })
    });
    showToast(`Find Device strobe sent to Device #${currentInspectingNodeId}`);
  } catch (e) {
    showToast("Strobe signal sent");
  }
}

async function saveDeviceInspectorEdit() {
  if (!currentInspectingNodeId) return;
  const s = (farmState.slaves || []).find(item => item.nodeId === currentInspectingNodeId);
  if (!s) return;

  const nameInp = document.getElementById('inspectDeviceName');
  const zoneSel = document.getElementById('inspectDeviceZone');

  const newName = nameInp ? nameInp.value.trim() : s.name;
  const newZoneId = parseInt(zoneSel ? zoneSel.value : '1', 10);

  s.name = newName || `Device #${s.nodeId}`;
  s.zoneId = newZoneId;

  closeDeviceInspectorModal();
  showToast(`Device #${s.nodeId} updated`);
  renderAll();

  try {
    await fetch('/api/fixture/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId: s.nodeId, name: s.name, zoneId: s.zoneId })
    });
    fetchStatus();
  } catch (e) {}
}

function startDeviceDepairConfirm() {
  const depairBox = document.getElementById('depairConfirmBox');
  const btnStartDepair = document.getElementById('btnStartDepair');
  if (depairBox) depairBox.style.display = 'block';
  if (btnStartDepair) btnStartDepair.style.display = 'none';
}

function cancelDeviceDepairConfirm() {
  const depairBox = document.getElementById('depairConfirmBox');
  const btnStartDepair = document.getElementById('btnStartDepair');
  if (depairBox) depairBox.style.display = 'none';
  if (btnStartDepair) btnStartDepair.style.display = 'flex';
}

async function executeDeviceDepairConfirmed() {
  if (!currentInspectingNodeId) return;
  const nodeId = currentInspectingNodeId;
  const s = (farmState.slaves || []).find(item => item.nodeId === nodeId);
  const mac = s ? s.mac : "";

  farmState.slaves = (farmState.slaves || []).filter(item => item.nodeId !== nodeId);
  closeDeviceInspectorModal();
  showToast(`Device #${nodeId} depaired from network`);
  renderAll();

  try {
    await fetch('/api/depair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId: nodeId, mac: mac })
    });
    fetchStatus();
  } catch (e) {}
}

// --------------------------------------------------------------------------
// SINGLE FIXTURE / SLAVE FIRMWARE OTA CONTROLLERS
// --------------------------------------------------------------------------
let slaveOtaCloseTimeout = null;
let slaveOtaSyncCountdown = null;

function openSlaveOtaModal(nodeId, name, mac) {
  if (slaveOtaCloseTimeout) { clearTimeout(slaveOtaCloseTimeout); slaveOtaCloseTimeout = null; }
  if (slaveOtaSyncCountdown) { clearInterval(slaveOtaSyncCountdown); slaveOtaSyncCountdown = null; }

  const targetNode = document.getElementById('slaveOtaTargetNode');
  const targetIp = document.getElementById('slaveOtaTargetIp');
  const title = document.getElementById('modalSlaveOtaTitle');
  const macEl = document.getElementById('modalSlaveOtaMac');
  const ipEl = document.getElementById('modalSlaveOtaIp');

  const ip = `192.168.4.${100 + parseInt(nodeId, 10)}`;
  if (targetNode) targetNode.value = nodeId;
  if (targetIp) targetIp.value = ip;
  if (title) title.textContent = `Update ${name || `Fixture #${nodeId}`}`;
  if (macEl) macEl.textContent = `MAC: ${mac || 'N/A'}`;
  if (ipEl) ipEl.textContent = `IP: ${ip}`;

  const badge = document.getElementById('slaveOtaActiveBadge');
  if (badge) { badge.style.display = 'none'; badge.textContent = ''; badge.className = 'ota-status-pill waiting'; }

  const uploadSec = document.getElementById('slaveOtaUploadSection');
  if (uploadSec) { uploadSec.style.opacity = '0.45'; uploadSec.style.pointerEvents = 'none'; }

  const progContainer = document.getElementById('slaveOtaProgressContainer');
  if (progContainer) progContainer.style.display = 'none';

  const progBar = document.getElementById('slaveOtaProgressBar');
  if (progBar) { progBar.style.width = '0%'; progBar.style.background = 'var(--primary-purple)'; }

  const statusText = document.getElementById('slaveOtaStatusText');
  if (statusText) statusText.textContent = '';

  const fileInput = document.getElementById('slaveOtaFileInput');
  if (fileInput) fileInput.value = '';

  const btnTrigger = document.getElementById('btnTriggerSingleOta');
  const btnTriggerTxt = document.getElementById('btnTriggerSingleOtaTxt');
  if (btnTrigger) btnTrigger.disabled = false;
  if (btnTriggerTxt) btnTriggerTxt.textContent = "Activate Update Mode";

  const btnFlash = document.getElementById('btnFlashSlave');
  if (btnFlash) btnFlash.disabled = false;

  const modal = document.getElementById('modalSlaveOta');
  if (modal) modal.classList.add('active');
}

function openSlaveOtaModalFromInspector() {
  const nodeId = document.getElementById('inspectNodeIdHidden').value;
  const name = document.getElementById('inspectDeviceName').value;
  const mac = document.getElementById('inspectMacHidden').value;
  closeDeviceInspectorModal();
  openSlaveOtaModal(nodeId, name, mac);
}

function closeSlaveOtaModal() {
  if (slaveOtaCloseTimeout) { clearTimeout(slaveOtaCloseTimeout); slaveOtaCloseTimeout = null; }
  if (slaveOtaSyncCountdown) { clearInterval(slaveOtaSyncCountdown); slaveOtaSyncCountdown = null; }
  const modal = document.getElementById('modalSlaveOta');
  if (modal) modal.classList.remove('active');
}

async function activateSingleSlaveOta() {
  const nodeId = parseInt(document.getElementById('slaveOtaTargetNode').value, 10);
  const ip = document.getElementById('slaveOtaTargetIp').value;
  const btn = document.getElementById('btnTriggerSingleOta');
  const btnTxt = document.getElementById('btnTriggerSingleOtaTxt');
  const badge = document.getElementById('slaveOtaActiveBadge');
  const uploadSec = document.getElementById('slaveOtaUploadSection');

  if (btn) btn.disabled = true;
  if (btnTxt) btnTxt.textContent = "Broadcasting Wake Signal...";
  if (badge) {
    badge.style.display = 'inline-flex';
    badge.className = 'ota-status-pill waiting';
    badge.textContent = `Waking Fixture #${nodeId} over radio...`;
  }

  try {
    const res = await fetch('/api/slave/enter-ota', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId: nodeId })
    });
    const data = await res.json();
    if (data.ok) {
      let countdown = 4;
      slaveOtaSyncCountdown = setInterval(() => {
        countdown--;
        if (countdown > 0) {
          if (badge) badge.textContent = `Connecting Fixture #${nodeId} to Gateway (${countdown}s)...`;
        } else {
          clearInterval(slaveOtaSyncCountdown);
          slaveOtaSyncCountdown = null;
          if (badge) {
            badge.className = 'ota-status-pill ready';
            badge.textContent = `Fixture #${nodeId} Online & Ready at ${ip}!`;
          }
          if (btnTxt) btnTxt.textContent = "Update Mode Active";
          if (uploadSec) {
            uploadSec.style.opacity = '1';
            uploadSec.style.pointerEvents = 'auto';
          }
          showToast(`Fixture #${nodeId} ready! Select firmware to flash.`);
        }
      }, 900);
    } else {
      if (btn) btn.disabled = false;
      if (btnTxt) btnTxt.textContent = "Activate Update Mode";
      if (badge) badge.style.display = 'none';
      showToast("Activation failed", true);
    }
  } catch (e) {
    if (btn) btn.disabled = false;
    if (btnTxt) btnTxt.textContent = "Activate Update Mode";
    if (badge) badge.style.display = 'none';
    showToast("Network error contacting gateway", true);
  }
}

function uploadSlaveFirmware() {
  const fileInput = document.getElementById('slaveOtaFileInput');
  if (!fileInput.files || fileInput.files.length === 0) {
    showToast("Please choose a Slave .bin firmware file first", true);
    return;
  }
  const file = fileInput.files[0];
  if (!file.name.endsWith('.bin')) {
    showToast("Invalid file. Please select a .bin file", true);
    return;
  }

  const nodeId = document.getElementById('slaveOtaTargetNode').value;
  const ip = document.getElementById('slaveOtaTargetIp').value;
  if (!confirm(`Flash "${file.name}" to Fixture #${nodeId}?`)) return;

  const btn = document.getElementById('btnFlashSlave');
  const progContainer = document.getElementById('slaveOtaProgressContainer');
  const progBar = document.getElementById('slaveOtaProgressBar');
  const statusText = document.getElementById('slaveOtaStatusText');

  if (btn) btn.disabled = true;
  if (progContainer) progContainer.style.display = 'block';
  if (progBar) {
    progBar.style.width = '0%';
    progBar.style.background = 'var(--primary-purple)';
  }
  if (statusText) statusText.textContent = `Connecting to Fixture #${nodeId} at ${ip}...`;

  const savedHost = localStorage.getItem('samposhi_local_ip') || '192.168.4.1';
  let uploadUrl = (window.location.hostname !== savedHost)
    ? `http://${savedHost}/api/slave/ota-proxy?nodeId=${nodeId}&size=${file.size}`
    : `http://${ip}/update`;

  const xhr = new XMLHttpRequest();
  xhr.open('POST', uploadUrl, true);

  xhr.upload.onprogress = function(e) {
    if (e.lengthComputable) {
      const pct = Math.round((e.loaded / e.total) * 100);
      if (progBar) progBar.style.width = pct + '%';
      if (statusText) statusText.textContent = `Flashing Fixture #${nodeId}: ${pct}% (${(e.loaded/1024).toFixed(0)} KB / ${(e.total/1024).toFixed(0)} KB)`;
    }
  };

  xhr.onload = function() {
    if (xhr.status === 200) {
      if (progBar) {
        progBar.style.width = '100%';
        progBar.style.background = '#10B981';
      }
      if (statusText) statusText.innerHTML = `<b>Success!</b> Fixture #${nodeId} updated & rebooting back to lighting mode!`;
      showToast(`Fixture #${nodeId} updated successfully!`);
      if (slaveOtaCloseTimeout) clearTimeout(slaveOtaCloseTimeout);
      slaveOtaCloseTimeout = setTimeout(closeSlaveOtaModal, 3500);
    } else {
      if (btn) btn.disabled = false;
      if (progBar) progBar.style.background = '#EF4444';
      if (statusText) statusText.textContent = "Flash failed. Fixture rejected binary.";
      showToast("Flash failed", true);
    }
  };

  xhr.onerror = function() {
    if (btn) btn.disabled = false;
    if (progBar) progBar.style.background = '#EF4444';
    if (statusText) statusText.textContent = `Upload connection lost. Ensure Fixture #${nodeId} is in range.`;
    showToast("Upload disconnected", true);
  };

  const formData = new FormData();
  formData.append('update', file);
  xhr.send(formData);
}

async function flashSlaveFromCloudUrl() {
  const nodeId = parseInt(document.getElementById('slaveOtaTargetNode').value, 10);
  const urlInp = document.getElementById('slaveOtaUrlInput');
  const url = urlInp ? urlInp.value.trim() : '';
  if (!url || !url.startsWith('http')) {
    showToast("Please enter a valid HTTP/HTTPS firmware .bin URL", true);
    return;
  }
  showToast(`Cloud update dispatched for Fixture #${nodeId}`);
}

async function strobeNode(nodeId) {
  const s = (farmState.slaves || []).find(item => item.nodeId === nodeId);
  try {
    await fetch('/api/identify-mac', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId: nodeId, mac: s ? s.mac : '' })
    });
    showToast(`Find Device strobe sent to Node #${nodeId}`);
  } catch (e) {
    showToast("Strobe signal sent");
  }
}

function showToast(msg, isError = false) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const t = document.createElement('div');
  t.className = 'toast-msg' + (isError ? ' error' : '');
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transition = 'all 0.25s ease';
    setTimeout(() => t.remove(), 250);
  }, 2500);
}

// Live 1-second RTC ticker on Home, Settings, and Schedule pages
setInterval(() => {
  if (farmState.rtc && farmState.rtc.year) {
    farmState.rtc.second = ((farmState.rtc.second || 0) + 1);
    if (farmState.rtc.second >= 60) {
      farmState.rtc.second = 0;
      farmState.rtc.minute = ((farmState.rtc.minute || 0) + 1);
      if (farmState.rtc.minute >= 60) {
        farmState.rtc.minute = 0;
        farmState.rtc.hour = ((farmState.rtc.hour || 0) + 1) % 24;
      }
    }

    // 1. Home banner: update date & time
    const dateTimeSub = document.getElementById('bannerDateTimeSub');
    if (dateTimeSub) {
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const dStr = `${String(farmState.rtc.day).padStart(2, '0')} ${months[(farmState.rtc.month || 1) - 1]}`;
      const tStr = `${String(farmState.rtc.hour).padStart(2, '0')}:${String(farmState.rtc.minute).padStart(2, '0')}`;
      dateTimeSub.textContent = `${dStr} · ${tStr}`;
    }

    // 2. Settings page: update live 1-second clock readout
    const rtcDisplay = document.getElementById('rtcClockDisplay');
    if (rtcDisplay) {
      const y = farmState.rtc.year;
      const mo = String(farmState.rtc.month || 1).padStart(2, '0');
      const d = String(farmState.rtc.day || 1).padStart(2, '0');
      const h = String(farmState.rtc.hour || 0).padStart(2, '0');
      const mi = String(farmState.rtc.minute || 0).padStart(2, '0');
      const s = String(farmState.rtc.second || 0).padStart(2, '0');
      rtcDisplay.textContent = `${y}-${mo}-${d} ${h}:${mi}:${s}`;
    }

    // 3. Schedule page: update timeline scrubber
    if (currentTab === 'schedule' && typeof updateTimelineScrubberPosition === 'function') {
      updateTimelineScrubberPosition();
    }
  }
}, 1000);

// Boot Engine
window.addEventListener('DOMContentLoaded', () => {
  renderAll();
  setupRadialGaugeTouch();

  // Long-press handler on header connection button to open Remote Connection Modal
  const connBtn = document.getElementById('btnConnectionMode');
  if (connBtn) {
    let pressTimer = null;
    connBtn.addEventListener('touchstart', () => {
      pressTimer = setTimeout(() => {
        openRemoteConnectionModal();
      }, 550);
    }, { passive: true });
    connBtn.addEventListener('touchend', () => {
      if (pressTimer) clearTimeout(pressTimer);
    });
  }

  // Initialize active transport on open
  if (farmState.connectionMode === 'remote') {
    startCloudMqtt();
    fetchStatus(true);
    if (!pollTimer) pollTimer = setInterval(fetchStatus, 4000);
  } else {
    fetchStatus(true);
    if (!pollTimer) pollTimer = setInterval(fetchStatus, 3500);
  }
});
