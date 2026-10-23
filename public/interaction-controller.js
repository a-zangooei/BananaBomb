/**
 * Production Operator 3D Bomb Interaction Lifecycle & State Machine.
 *
 * Prevents accidental actions from short brushes, camera rotation drags,
 * pointer cancellation, lost pointer capture, focus/visibility loss,
 * multi-touch pinch interruptions, or mobile orientation changes.
 *
 * Documented Timing & Slop Constants:
 * - buttonHoldThresholdMs (default 380ms, adjustable 250ms–700ms):
 *   Presses shorter than this commit 'press' (Tap); presses held at or beyond
 *   this threshold enter explicit 'HOLD' state and commit 'release' on pointerup
 *   with the current timer last digit.
 * - wireCutHoldMs (default 400ms):
 *   Intentional press-and-hold required on a wire before cutting is committed.
 *   Releasing early, dragging the camera, or sliding off cancels safely with 0 errors.
 * - beaconTxHoldMs (default 340ms):
 *   Intentional press-and-hold required on the destructive TX button before transmitting.
 * - dragSlopPx (default 12px):
 *   Pointer travel distance before a gesture is reclassified as a camera rotation drag.
 * - keypadDedupeLockMs (default 320ms):
 *   Per-slot submission lock preventing accidental double-submission from bounce/double-tap.
 */

export const INTERACTION_DEFAULTS = Object.freeze({
  buttonHoldThresholdMs: 380,
  minHoldThresholdMs: 250,
  maxHoldThresholdMs: 700,
  wireCutHoldMs: 400,
  beaconTxHoldMs: 340,
  dragSlopPx: 12,
  keypadDedupeLockMs: 320
});

function isOperatorRole(role) {
  return role === 'blind' || role === 'operator';
}

export class BombInteractionController {
  constructor(options = {}) {
    this.getRole = options.getRole || (() => 'operator');
    this.getState = options.getState || (() => null);
    this.getTimerRemaining = options.getTimerRemaining || (() => 300);
    this.raycastAt = options.raycastAt || (() => null);
    this.resolveHitModule = options.resolveHitModule || (() => null);
    this.onSendAction = options.onSendAction || (() => {});
    this.onCameraRotate = options.onCameraRotate || (() => {});
    this.onCameraZoom = options.onCameraZoom || (() => {});
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onFeedback = options.onFeedback || (() => {});
    this.now = options.now || (() => Date.now());

    this.holdThresholdMs = this.clampHoldThreshold(
      options.holdThresholdMs ?? INTERACTION_DEFAULTS.buttonHoldThresholdMs
    );
    this.wireCutHoldMs = options.wireCutHoldMs ?? INTERACTION_DEFAULTS.wireCutHoldMs;
    this.beaconTxHoldMs = options.beaconTxHoldMs ?? INTERACTION_DEFAULTS.beaconTxHoldMs;
    this.dragSlopPx = options.dragSlopPx ?? INTERACTION_DEFAULTS.dragSlopPx;
    this.keypadDedupeLockMs = options.keypadDedupeLockMs ?? INTERACTION_DEFAULTS.keypadDedupeLockMs;

    // Active tracked pointers: pointerId -> { x, y }
    this.pointers = new Map();
    this.pinchStartDist = 0;

    // Single-pointer active gesture state
    this.activeGesture = null;

    // Per-control pending submission locks (controlKey -> expiryTimestamp)
    this.pendingControlLocks = new Map();

    // Last emitted HUD status snapshot
    this.currentStatus = {
      active: false,
      mode: 'idle',
      moduleId: null,
      controlId: null,
      label: 'آماده تعامل لمسی / کلیدی',
      detail: 'برای چرخش بمب بکشید؛ برای عمل روی ماژول‌ها لمس هدفمند انجام دهید.',
      progress: 0,
      variant: 'neutral'
    };
  }

  clampHoldThreshold(ms) {
    const num = Number(ms);
    if (!Number.isFinite(num)) return INTERACTION_DEFAULTS.buttonHoldThresholdMs;
    return Math.max(
      INTERACTION_DEFAULTS.minHoldThresholdMs,
      Math.min(INTERACTION_DEFAULTS.maxHoldThresholdMs, Math.round(num))
    );
  }

  setHoldThreshold(ms) {
    this.holdThresholdMs = this.clampHoldThreshold(ms);
    return this.holdThresholdMs;
  }

  getHoldThreshold() {
    return this.holdThresholdMs;
  }

  getTimerLastDigit() {
    const rem = Math.max(0, Number(this.getTimerRemaining()) || 0);
    return Math.floor(rem) % 10;
  }

  emitStatus(next) {
    this.currentStatus = {
      active: Boolean(next.active),
      mode: next.mode || 'idle',
      moduleId: next.moduleId || null,
      controlId: next.controlId || null,
      label: next.label || '',
      detail: next.detail || '',
      progress: Math.max(0, Math.min(1, Number(next.progress) || 0)),
      variant: next.variant || 'neutral'
    };
    this.onStatusChange(this.currentStatus);
  }

  isControlLocked(lockKey, timestamp) {
    const exp = this.pendingControlLocks.get(lockKey);
    if (!exp) return false;
    if (timestamp >= exp) {
      this.pendingControlLocks.delete(lockKey);
      return false;
    }
    return true;
  }

  lockControl(lockKey, durationMs, timestamp) {
    this.pendingControlLocks.set(lockKey, timestamp + durationMs);
  }

  /**
   * Resolves a raycast hit into a structured interactive control descriptor.
   */
  inspectHit(clientX, clientY) {
    const hit = this.raycastAt(clientX, clientY);
    if (!hit || !hit.object) return null;

    const modInfo = this.resolveHitModule(hit.object);
    if (!modInfo || !modInfo.group?.visible || !modInfo.moduleDef) return null;

    const role = this.getRole();
    const fullState = this.getState();
    const modState = fullState?.modules?.[modInfo.moduleDef.id];
    if (!modState || modState.solved) return null;

    if (typeof modInfo.moduleDef.resolveControl === 'function') {
      const descriptor = modInfo.moduleDef.resolveControl(hit, modState, role, {
        holdThresholdMs: this.holdThresholdMs,
        wireCutHoldMs: this.wireCutHoldMs,
        beaconTxHoldMs: this.beaconTxHoldMs
      });
      if (!descriptor) return null;
      return {
        hit,
        modInfo,
        modState,
        descriptor
      };
    }

    return null;
  }

  notifyModuleVisual(gesture, visualEvent) {
    if (!gesture?.modInfo?.moduleDef) return;
    const { modInfo, descriptor } = gesture;
    const fullState = this.getState();
    const modState = fullState?.modules?.[modInfo.moduleDef.id] || gesture.initialModState;
    if (typeof modInfo.moduleDef.onVisualState === 'function') {
      modInfo.moduleDef.onVisualState(modInfo.group, visualEvent, this.getRole(), modState, descriptor);
    }
  }

  /**
   * Pointer Down entry point.
   */
  onPointerDown(e) {
    const pointerId = e.pointerId ?? 1;
    const x = Number(e.clientX) || 0;
    const y = Number(e.clientY) || 0;
    const timestamp = e.timeStampNow ?? this.now();

    this.pointers.set(pointerId, { x, y });

    // Multi-touch interruption (e.g. 2-finger pinch zoom): safely cancel any pending module interaction
    if (this.pointers.size >= 2) {
      if (this.activeGesture && this.activeGesture.type === 'module') {
        this.cancelActiveGesture('multi_touch', 'زوم دو انگشتی تشخیص داده شد — تعامل ماژول بدون خطا لغو شد.');
      } else {
        this.activeGesture = null;
      }
      const pts = Array.from(this.pointers.values());
      this.pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      return;
    }

    // Single pointer start
    const role = this.getRole();
    const gameState = this.getState();
    const canOperate = isOperatorRole(role) && (!gameState || gameState.status === 'running');

    if (canOperate) {
      const target = this.inspectHit(x, y);
      if (target) {
        const { descriptor, modInfo, modState, hit } = target;
        const lockKey = `${descriptor.moduleId}:${descriptor.controlId}`;

        // Guard against hardware bounce / rapid accidental double tap on same keypad key or wire
        if (descriptor.dedupeLockMs && this.isControlLocked(lockKey, timestamp)) {
          this.activeGesture = {
            type: 'blocked_duplicate',
            pointerId,
            startX: x,
            startY: y,
            lastX: x,
            lastY: y
          };
          this.emitStatus({
            active: false,
            mode: 'deduped',
            moduleId: descriptor.moduleId,
            controlId: descriptor.controlId,
            label: `${descriptor.label}: ثبت تکراری مهار شد`,
            detail: 'از ارسال دوباره ناخواسته با یک لمس جلوگیری شد.',
            progress: 0,
            variant: 'warning'
          });
          return;
        }

        const holdDurationMs =
          descriptor.interactionMode === 'tap_or_hold'
            ? this.holdThresholdMs
            : (descriptor.holdDurationMs || this.wireCutHoldMs);

        this.activeGesture = {
          type: 'module',
          pointerId,
          startX: x,
          startY: y,
          lastX: x,
          lastY: y,
          startTime: timestamp,
          modInfo,
          initialModState: modState,
          hit,
          descriptor,
          holdDurationMs,
          holdThresholdReached: false,
          committed: false,
          cancelled: false
        };

        this.onFeedback('press_start', descriptor);
        this.notifyModuleVisual(this.activeGesture, {
          state: 'press_start',
          mode: descriptor.interactionMode === 'tap_or_hold' ? 'tap' : descriptor.interactionMode,
          progress: 0,
          lastTimerDigit: this.getTimerLastDigit()
        });

        if (descriptor.interactionMode === 'tap_or_hold') {
          this.emitStatus({
            active: true,
            mode: 'tap',
            moduleId: descriptor.moduleId,
            controlId: descriptor.controlId,
            label: `حالت فعلی: ضربه کوتاه (TAP)`,
            detail: `رهاسازی الان = ضربه کوتاه | ادامه نگه‌داشتن (${this.holdThresholdMs}ms) = حالت HOLD`,
            progress: 0.04,
            variant: 'info'
          });
        } else if (descriptor.interactionMode === 'hold_commit') {
          this.emitStatus({
            active: true,
            mode: 'holding_to_commit',
            moduleId: descriptor.moduleId,
            controlId: descriptor.controlId,
            label: `${descriptor.label}: برای تایید نگه دارید...`,
            detail: `برای جلوگیری از لمس تصادفی ${holdDurationMs}ms نگه دارید (رهاسازی زودهنگام = لغو ایمن).`,
            progress: 0.04,
            variant: 'warning'
          });
        } else {
          this.emitStatus({
            active: true,
            mode: 'pressing',
            moduleId: descriptor.moduleId,
            controlId: descriptor.controlId,
            label: `${descriptor.label}: آماده ثبت`,
            detail: 'برای ثبت رها کنید؛ برای لغو انگشت را به بیرون بکشید.',
            progress: 1,
            variant: 'info'
          });
        }
        return;
      }
    }

    // Empty bomb casing or Observer view -> start camera drag immediately
    this.activeGesture = {
      type: 'camera',
      pointerId,
      startX: x,
      startY: y,
      lastX: x,
      lastY: y
    };
  }

  /**
   * Pointer Move handler: handles camera drag transition, pinch zoom, and slide-off-target cancellation.
   */
  onPointerMove(e) {
    const pointerId = e.pointerId ?? 1;
    if (!this.pointers.has(pointerId)) return;

    const x = Number(e.clientX) || 0;
    const y = Number(e.clientY) || 0;
    const timestamp = e.timeStampNow ?? this.now();
    this.pointers.set(pointerId, { x, y });

    // 2-finger pinch zoom
    if (this.pointers.size === 2) {
      const pts = Array.from(this.pointers.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (this.pinchStartDist > 0) {
        const delta = this.pinchStartDist - dist;
        this.onCameraZoom(delta);
        this.pinchStartDist = dist;
      }
      return;
    }

    if (!this.activeGesture || this.activeGesture.pointerId !== pointerId) return;

    if (this.activeGesture.type === 'camera') {
      const dx = x - this.activeGesture.lastX;
      const dy = y - this.activeGesture.lastY;
      this.activeGesture.lastX = x;
      this.activeGesture.lastY = y;
      this.onCameraRotate(dx, dy);
      return;
    }

    if (this.activeGesture.type === 'module') {
      // Refresh hold state first so threshold crossings are accurate before evaluating movement
      this.tick(timestamp);
      if (!this.activeGesture || this.activeGesture.type !== 'module') return;

      const moveDist = Math.hypot(x - this.activeGesture.startX, y - this.activeGesture.startY);
      this.activeGesture.lastX = x;
      this.activeGesture.lastY = y;

      if (this.activeGesture.committed) {
        return;
      }

      // Before hold is locked in, exceeding dragSlopPx transitions cleanly into camera rotation!
      if (!this.activeGesture.holdThresholdReached && moveDist > this.dragSlopPx) {
        this.cancelActiveGesture('camera_drag', 'چرخش دوربین تشخیص داده شد — لمس ماژول بدون خطا لغو شد.');
        this.activeGesture = {
          type: 'camera',
          pointerId,
          startX: x,
          startY: y,
          lastX: x,
          lastY: y
        };
        return;
      }

      // Check if pointer slid outside the valid control region
      if (moveDist > 4) {
        const currentTarget = this.inspectHit(x, y);
        const sameControl =
          currentTarget &&
          currentTarget.descriptor.moduleId === this.activeGesture.descriptor.moduleId &&
          currentTarget.descriptor.controlId === this.activeGesture.descriptor.controlId;

        if (!sameControl) {
          this.cancelActiveGesture(
            'left_target',
            `${this.activeGesture.descriptor.label}: نشانگر از محدوده خارج شد — تعامل بدون ثبت خطا لغو گردید.`
          );
        }
      }
    }
  }

  /**
   * Periodic / frame update for hold progress indicators and hold-to-commit actions (wires & TX).
   */
  tick(timestamp = this.now()) {
    if (!this.activeGesture || this.activeGesture.type !== 'module') return;
    if (this.activeGesture.committed || this.activeGesture.cancelled) return;

    const g = this.activeGesture;
    const elapsed = Math.max(0, timestamp - g.startTime);
    const { descriptor } = g;

    if (descriptor.interactionMode === 'tap_or_hold') {
      const progress = Math.min(1, elapsed / this.holdThresholdMs);
      const digit = this.getTimerLastDigit();

      if (elapsed >= this.holdThresholdMs) {
        if (!g.holdThresholdReached) {
          g.holdThresholdReached = true;
          this.onFeedback('hold_start', descriptor);
        }
        this.notifyModuleVisual(g, {
          state: 'holding',
          mode: 'hold',
          progress: 1,
          lastTimerDigit: digit
        });
        this.emitStatus({
          active: true,
          mode: 'hold',
          moduleId: descriptor.moduleId,
          controlId: descriptor.controlId,
          label: `نگه‌داشتن فعال شد (HOLD) • رقم فعلی تایمر: ${digit}`,
          detail: 'روی رقم ثانیه اعلامی ناظر رها کنید (کشیدن به بیرون دکمه = لغو ایمن).',
          progress: 1,
          variant: 'hold'
        });
      } else {
        this.notifyModuleVisual(g, {
          state: 'pressing',
          mode: 'tap',
          progress,
          lastTimerDigit: digit
        });
        this.emitStatus({
          active: true,
          mode: 'tap',
          moduleId: descriptor.moduleId,
          controlId: descriptor.controlId,
          label: `حالت فعلی: ضربه کوتاه (TAP) — ${Math.round(progress * 100)}% تا HOLD`,
          detail: `رهاسازی الان = ضربه کوتاه | ادامه نگه‌داشتن (${this.holdThresholdMs}ms) = حالت HOLD`,
          progress,
          variant: 'info'
        });
      }
      return;
    }

    if (descriptor.interactionMode === 'hold_commit') {
      const progress = Math.min(1, elapsed / g.holdDurationMs);
      if (elapsed >= g.holdDurationMs) {
        this.commitGesture(g, timestamp);
      } else {
        this.notifyModuleVisual(g, {
          state: 'holding_to_commit',
          mode: 'hold_commit',
          progress
        });
        this.emitStatus({
          active: true,
          mode: 'holding_to_commit',
          moduleId: descriptor.moduleId,
          controlId: descriptor.controlId,
          label: `${descriptor.label}: در حال تایید (${Math.round(progress * 100)}%)`,
          detail: 'نگه دارید تا عمل انجام شود؛ رها کردن الان بدون خطا لغو می‌کند.',
          progress,
          variant: 'warning'
        });
      }
    }
  }

  /**
   * Commits a validated Operator module gesture exactly once.
   */
  commitGesture(gesture, timestamp) {
    if (!gesture || gesture.committed || gesture.cancelled) return false;
    gesture.committed = true;

    const { descriptor } = gesture;
    const elapsed = Math.max(0, timestamp - gesture.startTime);
    const lastTimerDigit = this.getTimerLastDigit();
    const isHold = descriptor.interactionMode === 'tap_or_hold' && (gesture.holdThresholdReached || elapsed >= this.holdThresholdMs);

    const lockKey = `${descriptor.moduleId}:${descriptor.controlId}`;
    if (descriptor.dedupeLockMs) {
      this.lockControl(lockKey, descriptor.dedupeLockMs, timestamp);
    }

    const payload = descriptor.buildAction({
      elapsed,
      isHold,
      lastTimerDigit,
      holdThresholdMs: this.holdThresholdMs
    });

    this.notifyModuleVisual(gesture, {
      state: 'committed',
      mode: isHold ? 'hold_release' : descriptor.interactionMode,
      progress: 1,
      lastTimerDigit
    });

    if (descriptor.interactionMode === 'tap_or_hold') {
      this.onFeedback(isHold ? 'hold_release' : 'tap_commit', descriptor);
      this.emitStatus({
        active: false,
        mode: 'committed',
        moduleId: descriptor.moduleId,
        controlId: descriptor.controlId,
        label: isHold
          ? `✓ رهاسازی دکمه (HOLD) روی رقم ${lastTimerDigit} پذیرفته شد`
          : '✓ ضربه کوتاه (TAP) روی دکمه ثبت شد',
        detail: isHold
          ? `مدت نگه‌داشتن: ${Math.round(elapsed)}ms • رقم ثانیه ارسالی: ${lastTimerDigit}`
          : `مدت لمس: ${Math.round(elapsed)}ms (کمتر از آستانه ${this.holdThresholdMs}ms)`,
        progress: 1,
        variant: 'success'
      });
    } else {
      this.onFeedback('commit', descriptor);
      this.emitStatus({
        active: false,
        mode: 'committed',
        moduleId: descriptor.moduleId,
        controlId: descriptor.controlId,
        label: `✓ ${descriptor.commitLabel || `${descriptor.label} انجام شد`}`,
        detail: descriptor.commitDetail || 'فرمان به سرور ارسال شد.',
        progress: 1,
        variant: 'success'
      });
    }

    if (payload) {
      this.onSendAction(payload);
    }
    return true;
  }

  /**
   * Pointer Up handler.
   */
  onPointerUp(e) {
    const pointerId = e.pointerId ?? 1;
    const x = Number(e.clientX ?? this.activeGesture?.lastX) || 0;
    const y = Number(e.clientY ?? this.activeGesture?.lastY) || 0;
    const timestamp = e.timeStampNow ?? this.now();

    this.pointers.delete(pointerId);

    if (!this.activeGesture || this.activeGesture.pointerId !== pointerId) {
      return;
    }

    const g = this.activeGesture;
    this.activeGesture = null;

    if (g.type !== 'module' || g.cancelled) {
      return;
    }

    // Already auto-committed during hold_commit (e.g., wire cut at 400ms): clean finish
    if (g.committed) {
      this.notifyModuleVisual(g, { state: 'idle', progress: 0 });
      return;
    }

    const moveDist = Math.hypot(x - g.startX, y - g.startY);
    if (!g.holdThresholdReached && moveDist > this.dragSlopPx) {
      this.notifyModuleVisual(g, { state: 'cancelled', progress: 0 });
      this.emitStatus({
        active: false,
        mode: 'cancelled',
        moduleId: g.descriptor.moduleId,
        controlId: g.descriptor.controlId,
        label: 'تعامل لغو شد (حرکت دست)',
        detail: 'هیچ خطایی ثبت نشد.',
        progress: 0,
        variant: 'neutral'
      });
      return;
    }

    // Verify pointer is still over the exact same valid control at release time
    const endTarget = this.inspectHit(x, y);
    const sameControl =
      endTarget &&
      endTarget.descriptor.moduleId === g.descriptor.moduleId &&
      endTarget.descriptor.controlId === g.descriptor.controlId;

    if (!sameControl) {
      this.notifyModuleVisual(g, { state: 'cancelled', progress: 0 });
      this.emitStatus({
        active: false,
        mode: 'cancelled',
        moduleId: g.descriptor.moduleId,
        controlId: g.descriptor.controlId,
        label: `${g.descriptor.label}: رهاسازی خارج از محدوده — لغو ایمن`,
        detail: 'عمل انجام نشد و هیچ خطایی ثبت نگردید.',
        progress: 0,
        variant: 'neutral'
      });
      return;
    }

    const elapsed = Math.max(0, timestamp - g.startTime);

    // Hold-to-commit controls (e.g., Wires 400ms, Beacon TX 340ms): early release cancels safely!
    if (g.descriptor.interactionMode === 'hold_commit' && elapsed < g.holdDurationMs) {
      this.notifyModuleVisual(g, { state: 'cancelled', progress: 0 });
      this.onFeedback('cancelled', g.descriptor);
      this.emitStatus({
        active: false,
        mode: 'cancelled',
        moduleId: g.descriptor.moduleId,
        controlId: g.descriptor.controlId,
        label: `${g.descriptor.label}: رهاسازی زودهنگام — لغو ایمن`,
        detail: `برای اجرای عمدی حداقل ${g.holdDurationMs}ms نگه دارید (بدون ثبت خطا).`,
        progress: 0,
        variant: 'neutral'
      });
      return;
    }

    this.commitGesture(g, timestamp);
  }

  /**
   * Cancels any active module interaction without ever dispatching a server action.
   */
  cancelActiveGesture(reason = 'cancelled', detailText = 'تعامل بدون ثبت خطا لغو شد.') {
    if (!this.activeGesture) return false;
    const g = this.activeGesture;
    this.activeGesture = null;

    if (g.type === 'module' && !g.committed && !g.cancelled) {
      g.cancelled = true;
      this.notifyModuleVisual(g, { state: 'cancelled', reason, progress: 0 });
      this.onFeedback('cancelled', g.descriptor);
      this.emitStatus({
        active: false,
        mode: 'cancelled',
        moduleId: g.descriptor.moduleId,
        controlId: g.descriptor.controlId,
        label: `لغو ایمن تعامل (${g.descriptor.label})`,
        detail: detailText,
        progress: 0,
        variant: 'neutral'
      });
      return true;
    }
    return false;
  }

  onPointerCancel(e) {
    const pointerId = e?.pointerId;
    if (pointerId !== undefined) {
      this.pointers.delete(pointerId);
    } else {
      this.pointers.clear();
    }
    if (!this.activeGesture) return;
    if (pointerId === undefined || this.activeGesture.pointerId === pointerId) {
      this.cancelActiveGesture('pointercancel', 'لمس توسط مرورگر/سیستم لغو شد — هیچ عملی ارسال نگردید.');
    }
  }

  /**
   * Note: Browsers fire `lostpointercapture` both on unexpected capture loss AND immediately
   * after `pointerup`. If `onPointerUp` already completed and cleared `this.activeGesture`,
   * this is a clean no-op; if a gesture was still mid-press/hold, it cancels safely!
   */
  onLostPointerCapture(e) {
    const pointerId = e?.pointerId;
    if (pointerId !== undefined) {
      this.pointers.delete(pointerId);
    }
    if (this.activeGesture && (pointerId === undefined || this.activeGesture.pointerId === pointerId)) {
      this.cancelActiveGesture('lostpointercapture', 'قفل لمس قطع شد — تعامل نیمه‌کاره به صورت ایمن لغو شد.');
    }
  }

  onBlur() {
    this.pointers.clear();
    this.pinchStartDist = 0;
    this.cancelActiveGesture('blur', 'خروج تمرکز از صفحه — تعامل فعال بدون ثبت خطا لغو شد.');
  }

  onVisibilityChange(isHidden) {
    if (isHidden) {
      this.pointers.clear();
      this.pinchStartDist = 0;
      this.cancelActiveGesture('visibilitychange', 'تغییر وضعیت نمایش صفحه — تعامل فعال بدون ثبت خطا لغو شد.');
    }
  }

  onOrientationChange() {
    this.pointers.clear();
    this.pinchStartDist = 0;
    this.cancelActiveGesture('orientationchange', 'چرخش صفحه دستگاه — تعامل نیمه‌کاره بدون ثبت خطا لغو شد.');
  }
}
