/**
 * Offline Vector QR Code LAN Invite Modal Controller.
 *
 * Queries `/api/lan-info`, renders offline SVG QR codes via `qr-svg.js`, supports
 * multi-interface switching, manual Hotspot IP overrides, and clipboard copying.
 */
import { renderQrSvg } from '../qr-svg.js';

export function isLoopbackHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
}

export function normalizeManualLanUrl(rawInput, fallbackPort = 3000) {
  let val = String(rawInput || '').trim();
  if (!val) return '';
  if (!/^https?:\/\//i.test(val)) {
    val = `http://${val}`;
  }
  try {
    const parsed = new URL(val);
    if (!parsed.port && fallbackPort && parsed.protocol === 'http:') {
      parsed.port = String(fallbackPort);
    }
    return parsed.origin;
  } catch (e) {
    return '';
  }
}

export function createQrModalController({ elements, showToast }) {
  const {
    btnOpenQrModal,
    qrInviteModal,
    btnCloseQrModal,
    qrSvgContainer,
    qrActiveUrlText,
    btnCopyLanUrl,
    qrLocalhostNotice,
    qrInterfaceSelectorWrap,
    qrInterfaceButtons,
    inputManualLanHost,
    btnApplyManualLanHost
  } = elements;

  let detectedLanInterfaces = [];
  let detectedServerPort = Number(window.location.port) || 3000;
  let activeQrUrl = window.location.origin;
  let lastQrTriggerEl = null;

  function renderQrModalUrl(targetUrl) {
    if (!targetUrl) return;
    activeQrUrl = targetUrl;
    if (qrActiveUrlText) {
      qrActiveUrlText.textContent = activeQrUrl;
    }
    if (qrSvgContainer) {
      try {
        qrSvgContainer.innerHTML = renderQrSvg(activeQrUrl, {
          ariaLabel: `QR Code ${activeQrUrl}`
        });
      } catch (e) {
        qrSvgContainer.textContent = activeQrUrl;
      }
    }

    let isCurrentQrLoopback = false;
    try {
      isCurrentQrLoopback = isLoopbackHost(new URL(activeQrUrl).hostname);
    } catch (e) {}

    if (qrLocalhostNotice) {
      qrLocalhostNotice.style.display = isCurrentQrLoopback ? 'block' : 'none';
    }

    if (qrInterfaceButtons) {
      qrInterfaceButtons.querySelectorAll('.qr-iface-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-lan-url') === activeQrUrl);
      });
    }
  }

  function renderDetectedInterfaceButtons() {
    if (!qrInterfaceSelectorWrap || !qrInterfaceButtons) return;
    if (!Array.isArray(detectedLanInterfaces) || detectedLanInterfaces.length === 0) {
      qrInterfaceSelectorWrap.style.display = 'none';
      qrInterfaceButtons.innerHTML = '';
      return;
    }

    qrInterfaceSelectorWrap.style.display = 'flex';
    qrInterfaceButtons.innerHTML = '';
    detectedLanInterfaces.forEach((iface) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'qr-iface-btn tabular-num' + (iface.url === activeQrUrl ? ' active' : '');
      btn.setAttribute('dir', 'ltr');
      btn.setAttribute('data-lan-url', iface.url);
      btn.textContent = `${iface.address}:${detectedServerPort} (${iface.name})`;
      btn.addEventListener('click', () => {
        try {
          localStorage.removeItem('defusal_manual_lan_url');
        } catch (e) {}
        renderQrModalUrl(iface.url);
      });
      qrInterfaceButtons.appendChild(btn);
    });
  }

  async function refreshLanQrEndpoints() {
    let savedManualUrl = '';
    try {
      savedManualUrl = localStorage.getItem('defusal_manual_lan_url') || '';
    } catch (e) {}

    try {
      const resp = await fetch('/api/lan-info', { cache: 'no-store' });
      if (resp.ok) {
        const info = await resp.json();
        if (info?.port) detectedServerPort = Number(info.port) || detectedServerPort;
        if (Array.isArray(info?.interfaces)) {
          detectedLanInterfaces = info.interfaces;
        }
      }
    } catch (e) {
      // Offline fallback if server route unreachable
    }

    if (inputManualLanHost && !inputManualLanHost.value) {
      inputManualLanHost.placeholder = `192.168.43.1:${detectedServerPort}`;
    }

    let preferredUrl = window.location.origin;
    if (savedManualUrl) {
      preferredUrl = savedManualUrl;
    } else if (isLoopbackHost(window.location.hostname) && detectedLanInterfaces.length > 0) {
      preferredUrl = detectedLanInterfaces[0].url;
    }

    renderDetectedInterfaceButtons();
    renderQrModalUrl(preferredUrl);
  }

  function isQrModalOpen() {
    return Boolean(qrInviteModal && qrInviteModal.style.display !== 'none');
  }

  function openQrModal(triggerEl = null) {
    if (!qrInviteModal) return;
    if (triggerEl) lastQrTriggerEl = triggerEl;
    qrInviteModal.style.display = 'flex';
    renderQrModalUrl(activeQrUrl || window.location.origin);
    refreshLanQrEndpoints();
    btnCloseQrModal?.focus();
  }

  function closeQrModal() {
    if (!qrInviteModal || qrInviteModal.style.display === 'none') return;
    qrInviteModal.style.display = 'none';
    if (lastQrTriggerEl && typeof lastQrTriggerEl.focus === 'function') {
      lastQrTriggerEl.focus();
    }
  }

  if (btnOpenQrModal) {
    btnOpenQrModal.addEventListener('click', () => openQrModal(btnOpenQrModal));
  }
  if (btnCloseQrModal) {
    btnCloseQrModal.addEventListener('click', closeQrModal);
  }
  if (qrInviteModal) {
    qrInviteModal.addEventListener('click', (e) => {
      if (e.target === qrInviteModal) closeQrModal();
    });
  }

  if (btnApplyManualLanHost && inputManualLanHost) {
    const applyManualHost = () => {
      const raw = inputManualLanHost.value.trim();
      if (!raw) {
        try {
          localStorage.removeItem('defusal_manual_lan_url');
        } catch (e) {}
        refreshLanQrEndpoints();
        return;
      }
      const normalized = normalizeManualLanUrl(raw, detectedServerPort);
      if (!normalized) {
        showToast?.('قالب آدرس واردشده معتبر نیست (مثال: 192.168.43.1:3000).', 'error', 2800);
        return;
      }
      try {
        localStorage.setItem('defusal_manual_lan_url', normalized);
      } catch (e) {}
      renderQrModalUrl(normalized);
      showToast?.('کد QR بر اساس آدرس جدید به‌روز شد.', 'success', 2200);
    };

    btnApplyManualLanHost.addEventListener('click', applyManualHost);
    inputManualLanHost.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyManualHost();
      }
    });
  }

  if (btnCopyLanUrl) {
    btnCopyLanUrl.addEventListener('click', async () => {
      const textToCopy = activeQrUrl || window.location.origin;
      let copied = false;
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        try {
          await navigator.clipboard.writeText(textToCopy);
          copied = true;
        } catch (e) {}
      }
      if (!copied) {
        try {
          const tempArea = document.createElement('textarea');
          tempArea.value = textToCopy;
          tempArea.setAttribute('readonly', '');
          tempArea.style.position = 'fixed';
          tempArea.style.opacity = '0';
          document.body.appendChild(tempArea);
          tempArea.select();
          copied = document.execCommand('copy');
          document.body.removeChild(tempArea);
        } catch (e) {}
      }
      if (copied) {
        showToast?.('آدرس اتصال کپی شد.', 'success', 2000);
      } else {
        showToast?.('امکان کپی خودکار نبود؛ آدرس را از کادر بالا بخوانید.', 'info', 2800);
      }
    });
  }

  return {
    openQrModal,
    closeQrModal,
    isQrModalOpen,
    refreshLanQrEndpoints
  };
}
