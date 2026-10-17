/**
 * Transport Layer Abstraction
 * Hides WebSocket connection details behind send(event, payload) and onEvent(callback).
 * Can be swapped in the future for PeerJS, WebRTC, or mock transport without touching game UI.
 */
export class GameTransport {
  constructor() {
    this.callbacks = new Set();
    this.ws = null;
    this.serverOffset = 0; // ms offset: serverTime = Date.now() + serverOffset
    this.latency = 0;
    this.isConnected = false;
    this.reconnectTimer = null;
    this.pingInterval = null;

    this.connect();
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.emit('_connection_change', { connected: true });
        this.startSync();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // Handle internal time sync pong
          if (data.type === 'pong') {
            const now = Date.now();
            const roundTrip = now - (data.clientTime || now);
            this.latency = Math.round(roundTrip / 2);
            // serverOffset: how much to add to client Date.now() to get current server time
            this.serverOffset = data.serverTime - (data.clientTime + roundTrip / 2);
            this.emit('_time_synced', {
              serverOffset: this.serverOffset,
              latency: this.latency,
              serverTime: data.serverTime
            });
            return;
          }

          // Dispatch event to listeners
          this.emit(data.type, data);
        } catch (err) {
          console.error('Failed to parse incoming WS message:', err);
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.emit('_connection_change', { connected: false });
        this.stopSync();
        this.scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        console.warn('Transport WebSocket error:', err);
      };
    } catch (err) {
      console.error('Error instantiating WebSocket:', err);
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 2000);
  }

  startSync() {
    this.stopSync();
    // Immediate ping
    this.ping();
    // Regular ping every 4 seconds to maintain sync & keepalive
    this.pingInterval = setInterval(() => {
      this.ping();
    }, 4000);
  }

  stopSync() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  ping() {
    if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'ping',
          clientTime: Date.now()
        })
      );
    }
  }

  /**
   * Send an event over the transport
   * @param {string} event - Event name/type (e.g. 'join', 'start', 'action', 'reset')
   * @param {any} [payload] - Optional data payload
   */
  send(event, payload = {}) {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn(`[Transport] Cannot send "${event}", socket not connected.`);
      return false;
    }

    const message = {
      type: event,
      payload,
      timestamp: Date.now()
    };
    this.ws.send(JSON.stringify(message));
    return true;
  }

  /**
   * Subscribe to incoming events
   * @param {Function} callback - Function receiving (eventType, data)
   * @returns {Function} Unsubscribe function
   */
  onEvent(callback) {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  emit(eventType, data) {
    for (const cb of this.callbacks) {
      try {
        cb(eventType, data);
      } catch (err) {
        console.error('Error in onEvent callback:', err);
      }
    }
  }

  /**
   * Returns current synchronized server timestamp in milliseconds
   */
  getServerTime() {
    return Date.now() + this.serverOffset;
  }
}
