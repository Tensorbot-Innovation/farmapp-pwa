// ==========================================================================
// SAMPOSHI FARM AUTOMATION — CAMERA QR SCANNER & MAC PROVISIONING
// v2.0 Fast Provisioning Engine with Haptic & Audio Feedback
// ==========================================================================

const MacScanner = {
  stream: null,
  animId: null,
  detector: null,

  async init() {
    if ('BarcodeDetector' in window) {
      try {
        const formats = await BarcodeDetector.getSupportedFormats();
        if (formats.includes('qr_code')) {
          this.detector = new BarcodeDetector({ formats: ['qr_code'] });
        }
      } catch (e) {}
    }
  },

  async start(videoElement, onDetectedCallback) {
    await this.init();
    const video = videoElement || document.getElementById('qrVideoPreview');
    if (!video) return false;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });

      video.srcObject = this.stream;
      await video.play();

      this.scanLoop(video, onDetectedCallback);
      return true;
    } catch (err) {
      console.warn("Camera access denied or unavailable:", err);
      return false;
    }
  },

  scanLoop(video, callback) {
    if (!this.stream) return;

    if (this.detector && video.readyState >= video.HAVE_CURRENT_DATA) {
      this.detector.detect(video).then(barcodes => {
        if (barcodes && barcodes.length > 0) {
          const raw = barcodes[0].rawValue;
          const cleanMac = this.cleanAndFormatMac(raw);
          if (cleanMac) {
            this.triggerSuccessFeedback();
            callback(cleanMac);
            return;
          }
        }
        this.animId = requestAnimationFrame(() => this.scanLoop(video, callback));
      }).catch(() => {
        this.animId = requestAnimationFrame(() => this.scanLoop(video, callback));
      });
    } else {
      this.animId = requestAnimationFrame(() => this.scanLoop(video, callback));
    }
  },

  stop() {
    if (this.animId) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
  },

  cleanAndFormatMac(str) {
    if (!str) return null;
    // Extract 12 hex characters
    const hex = str.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
    if (hex.length >= 12) {
      const mac = hex.substring(0, 12);
      return mac.match(/.{1,2}/g).join(':');
    }
    return null;
  },

  triggerSuccessFeedback() {
    if ('vibrate' in navigator) {
      try { navigator.vibrate([40, 60, 40]); } catch (e) {}
    }
  }
};

window.MacScanner = MacScanner;
