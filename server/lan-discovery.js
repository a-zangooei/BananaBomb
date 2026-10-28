/**
 * Offline LAN IPv4 Discovery & Startup Banner Printer (Android Termux Safe).
 */
import os from 'os';
import { sanitizeTerminalText } from './logger.js';

export function scoreLanAddress(ip) {
  if (typeof ip !== 'string') return 99;
  if (ip.startsWith('192.168.43.') || ip.startsWith('192.168.49.')) return 1; // Common Android Hotspot
  if (ip.startsWith('192.168.')) return 2;
  if (ip.startsWith('10.')) return 3;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return 4;
  return 10;
}

export function detectLanInterfaces(activePort, fallbackPort = process.env.PORT || 3000) {
  const safePort = Number(activePort) || Number(fallbackPort) || 3000;
  const detected = [];
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces || {})) {
      const netList = interfaces[name];
      if (!Array.isArray(netList)) continue;
      for (const net of netList) {
        const isIpv4 = net && (net.family === 'IPv4' || net.family === 4);
        if (isIpv4 && !net.internal && net.address) {
          const cleanName = sanitizeTerminalText(name);
          const cleanAddr = sanitizeTerminalText(net.address);
          detected.push({
            name: cleanName,
            address: cleanAddr,
            url: `http://${cleanAddr}:${safePort}`,
            priority: scoreLanAddress(cleanAddr)
          });
        }
      }
    }
  } catch (err) {
    // Expected on restricted Android Termux environments; client falls back to browser origin or manual Hotspot IP
  }

  detected.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  return detected.map(({ name, address, url }) => ({ name, address, url }));
}

export function printNetworkInterfaces(port) {
  const safePort = sanitizeTerminalText(port);
  console.log('='.repeat(60));
  console.log('[SERVER] BananaBomb - 3D Local Co-op Bomb Defusal Server');
  console.log('='.repeat(60));
  console.log(`[SERVER] Listening on port: ${safePort}`);
  console.log(`[LOCAL]  Browser on this device: http://localhost:${safePort}`);
  console.log('\n[LAN]    Connect other phones over Wi-Fi or Mobile Hotspot:');

  try {
    const interfaces = os.networkInterfaces();
    let count = 0;
    for (const name of Object.keys(interfaces || {})) {
      const netList = interfaces[name];
      if (!netList) continue;
      for (const net of netList) {
        if (net.family === 'IPv4' && !net.internal) {
          console.log(`  -> [${sanitizeTerminalText(name)}] http://${sanitizeTerminalText(net.address)}:${safePort}`);
          count++;
        }
      }
    }
    if (count === 0) {
      console.log('  [INFO] No active external IPv4 interface detected. Connect to Wi-Fi or enable Hotspot.');
    }
  } catch (err) {
    console.warn('\n[WARN] Unable to read os.networkInterfaces() automatically (common on Android Termux).');
    console.warn('[INFO] Check Hotspot settings or run "ifconfig" or "ip addr" in Termux to find your device IP:');
    console.warn(`  -> http://<DEVICE_IP>:${safePort}\n`);
  }
  console.log('='.repeat(60));
}
