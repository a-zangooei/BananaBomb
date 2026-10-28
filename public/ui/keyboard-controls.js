/**
 * Keyboard Navigation & Operator Accessibility Controls (Camera Presets, Wires, Keypad, Beacon & Space Hold).
 */
import { isOperator } from '../../shared/roles.js';
import { INTERACTION_DEFAULTS } from '../interaction-controller.js';

export function initKeyboardControls({
  getMyRole,
  getGameState,
  getBombScene,
  getHoldThresholdMs,
  getCurrentRemainingSeconds,
  isQrModalOpen,
  closeQrModal,
  isReferenceSheetOpen,
  closeReferenceSheet,
  isTuningPopoverOpen,
  setTuningPopoverOpen,
  onCancelCountdown,
  onSelectBombViewButton,
  viewButtons = {},
  sendOperatorBombAction,
  renderOperatorHudStatus,
  sound,
  triggerHaptic
}) {
  let isSpacePressed = false;
  let spacePressStartTime = 0;
  let spaceHoldReached = false;
  let spaceProgressTimer = null;
  let isWKeyActive = false;
  const keyboardSlotLockMap = new Map();

  function cancelKeyboardSpaceHold(reasonText = 'نگه‌داشتن کلید Space بدون ثبت خطا لغو شد.') {
    if (!isSpacePressed) return;
    isSpacePressed = false;
    spaceHoldReached = false;
    if (spaceProgressTimer) {
      clearInterval(spaceProgressTimer);
      spaceProgressTimer = null;
    }
    const bombScene = getBombScene?.();
    bombScene?.setKeyboardButtonReticle?.(false, false);
    const btnView = bombScene?.moduleViews?.get('button');
    if (btnView?.moduleDef?.onVisualState) {
      btnView.moduleDef.onVisualState(
        btnView.group,
        { state: 'cancelled', progress: 0 },
        getMyRole?.(),
        getGameState?.()?.modules?.button
      );
    }
    renderOperatorHudStatus?.({
      active: false,
      mode: 'cancelled',
      label: 'لغو ایمن دکمه (Space)',
      detail: reasonText,
      progress: 0,
      variant: 'neutral'
    });
  }

  window.addEventListener('keydown', (e) => {
    const currentGameState = getGameState?.();
    const bombScene = getBombScene?.();
    const myRole = getMyRole?.();

    if (e.key === 'Escape') {
      if (isQrModalOpen?.()) {
        e.preventDefault();
        closeQrModal?.();
        return;
      }
      if (isReferenceSheetOpen?.()) {
        e.preventDefault();
        closeReferenceSheet?.();
        return;
      }
      if (currentGameState?.status === 'countdown') {
        e.preventDefault();
        onCancelCountdown?.();
        return;
      }
      if (isTuningPopoverOpen?.()) {
        e.preventDefault();
        setTuningPopoverOpen?.(false);
        return;
      }
      cancelKeyboardSpaceHold('لغو دستی با کلید Escape — هیچ خطایی ثبت نشد.');
      bombScene?.cancelActiveInteraction('escape_key');
      return;
    }

    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (isQrModalOpen?.() || isReferenceSheetOpen?.() || currentGameState?.status === 'countdown') return;

    if (currentGameState?.status === 'running') {
      if (bombScene) {
        if (e.key === 'ArrowLeft') {
          bombScene.targetRotY += 0.25;
          e.preventDefault();
        } else if (e.key === 'ArrowRight') {
          bombScene.targetRotY -= 0.25;
          e.preventDefault();
        } else if (e.key === 'ArrowUp') {
          bombScene.targetRotX = Math.min(1.4, bombScene.targetRotX + 0.18);
          e.preventDefault();
        } else if (e.key === 'ArrowDown') {
          bombScene.targetRotX = Math.max(-1.4, bombScene.targetRotX - 0.18);
          e.preventDefault();
        } else if (e.key === 'r' || e.key === 'R') {
          onSelectBombViewButton?.(viewButtons.front);
          bombScene.viewFront();
        } else if (e.key === 'b' || e.key === 'B') {
          onSelectBombViewButton?.(viewButtons.back);
          bombScene.viewBack();
        } else if (e.key === 'l' || e.key === 'L') {
          onSelectBombViewButton?.(viewButtons.bridge);
          bombScene.viewTertiary();
        }
      }

      // Operator physical interactions via keyboard (ignore key auto-repeat)
      if (isOperator(myRole)) {
        if (e.key === 'w' || e.key === 'W') {
          isWKeyActive = true;
        }

        if (['1', '2', '3', '4'].includes(e.key) && !e.repeat) {
          const index = parseInt(e.key, 10) - 1;
          const now = Date.now();
          const lockKey = isWKeyActive ? `wire:${index}` : `keypad:${index}`;
          const lockedUntil = keyboardSlotLockMap.get(lockKey) || 0;
          if (now < lockedUntil) return;
          keyboardSlotLockMap.set(lockKey, now + INTERACTION_DEFAULTS.keypadDedupeLockMs);

          if (isWKeyActive) {
            if (
              currentGameState?.modules?.wires &&
              !currentGameState.modules.wires.solved &&
              !currentGameState.modules.wires.cutWires?.includes(index)
            ) {
              triggerHaptic?.([35, 25]);
              sound?.playWireCut();
              sendOperatorBombAction?.({
                moduleId: 'wires',
                action: 'cut',
                data: { wireIndex: index }
              });
              renderOperatorHudStatus?.({
                active: false,
                mode: 'committed',
                label: `سیم ${index + 1} قطع شد (کیبورد)`,
                detail: 'فرمان قطع سیم به سرور ارسال شد.',
                progress: 1,
                variant: 'success'
              });
            }
          } else if (
            currentGameState?.modules?.keypad &&
            !currentGameState.modules.keypad.solved &&
            !currentGameState.modules.keypad.enteredSlots?.includes(index)
          ) {
            triggerHaptic?.(25);
            sound?.playClick();
            sendOperatorBombAction?.({
              moduleId: 'keypad',
              action: 'press',
              data: { slotIndex: index }
            });
            renderOperatorHudStatus?.({
              active: false,
              mode: 'committed',
              label: `کلید کیپد ${index + 1} ثبت شد`,
              detail: `فشردن کلید شماره ${index + 1} ارسال شد.`,
              progress: 1,
              variant: 'success'
            });
          }
        }

        if ((e.key === 'c' || e.key === 'C') && !e.repeat) {
          const beaconState = currentGameState?.modules?.beacon;
          if (beaconState && !beaconState.solved) {
            const currSlot = beaconState.tunedSlot || beaconState.tunedChannel || 1;
            const nextSlot = (currSlot % 3) + 1;
            const slotChannels = Array.isArray(beaconState.slotChannels) ? beaconState.slotChannels : [1, 2, 3];
            const mappedCh = slotChannels[nextSlot - 1] || nextSlot;
            triggerHaptic?.(25);
            sound?.playClick();
            sendOperatorBombAction?.({
              moduleId: 'beacon',
              action: 'tune',
              data: { slot: nextSlot }
            });
            renderOperatorHudStatus?.({
              active: false,
              mode: 'committed',
              label: `سلکتور مورس روی خانه ${nextSlot} (بریل کانال ${mappedCh}) تنظیم شد`,
              detail: 'تغییر خانه سلکتور بریل ثبت گردید.',
              progress: 1,
              variant: 'success'
            });
          }
        }

        if ((e.key === 't' || e.key === 'T') && !e.repeat) {
          const beaconState = currentGameState?.modules?.beacon;
          if (beaconState && !beaconState.solved) {
            triggerHaptic?.([30, 20]);
            sound?.playClick();
            sendOperatorBombAction?.({
              moduleId: 'beacon',
              action: 'transmit'
            });
            renderOperatorHudStatus?.({
              active: false,
              mode: 'committed',
              label: 'ارسال فرکانس (TX) ثبت شد',
              detail: 'پالس فرکانسی به سرور ارسال شد.',
              progress: 1,
              variant: 'success'
            });
          }
        }

        if (e.code === 'Space' && !isSpacePressed && !e.repeat) {
          e.preventDefault();
          if (currentGameState?.modules?.button?.solved) return;

          isSpacePressed = true;
          spaceHoldReached = false;
          spacePressStartTime = Date.now();
          triggerHaptic?.(25);
          sound?.playTactileTick();

          const updateSpaceVisuals = () => {
            if (!isSpacePressed) return;
            const activeScene = getBombScene?.();
            const btnView = activeScene?.moduleViews?.get('button');
            const holdThresholdMs = getHoldThresholdMs?.() || INTERACTION_DEFAULTS.buttonHoldThresholdMs;
            const elapsed = Date.now() - spacePressStartTime;
            const progress = Math.min(1, elapsed / holdThresholdMs);
            const digit = Math.floor(Math.max(0, getCurrentRemainingSeconds?.() || 0)) % 10;

            if (elapsed >= holdThresholdMs) {
              if (!spaceHoldReached) {
                spaceHoldReached = true;
                triggerHaptic?.([40, 30, 40]);
                sound?.playTactileTick();
              }
              activeScene?.setKeyboardButtonReticle?.(true, true);
              btnView?.moduleDef?.onVisualState?.(
                btnView.group,
                { state: 'holding', mode: 'hold', progress: 1, lastTimerDigit: digit },
                getMyRole?.(),
                getGameState?.()?.modules?.button
              );
              renderOperatorHudStatus?.({
                active: true,
                mode: 'hold',
                label: 'نگه‌داشتن فعال شد (HOLD) · منتظر فرمان رهاسازی ناظر',
                detail: 'با اعلام شفاهی ناظر کلید Space را رها کنید (Esc = لغو ایمن).',
                progress: 1,
                variant: 'hold'
              });
            } else {
              activeScene?.setKeyboardButtonReticle?.(true, false);
              btnView?.moduleDef?.onVisualState?.(
                btnView.group,
                { state: 'pressing', mode: 'tap', progress, lastTimerDigit: digit },
                getMyRole?.(),
                getGameState?.()?.modules?.button
              );
              renderOperatorHudStatus?.({
                active: true,
                mode: 'tap',
                label: `حالت ضربه کوتاه (TAP) — ${Math.round(progress * 100)}% تا HOLD`,
                detail: `رهاسازی الان = ضربه کوتاه | ادامه نگه‌داشتن (${holdThresholdMs}ms) = حالت HOLD`,
                progress,
                variant: 'info'
              });
            }
          };

          updateSpaceVisuals();
          spaceProgressTimer = setInterval(updateSpaceVisuals, 45);
        }
      }
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.key === 'w' || e.key === 'W') {
      isWKeyActive = false;
    }

    const myRole = getMyRole?.();
    if (e.code === 'Space' && isSpacePressed && isOperator(myRole)) {
      e.preventDefault();
      isSpacePressed = false;
      if (spaceProgressTimer) {
        clearInterval(spaceProgressTimer);
        spaceProgressTimer = null;
      }
      const bombScene = getBombScene?.();
      bombScene?.setKeyboardButtonReticle?.(false, false);

      const holdThresholdMs = getHoldThresholdMs?.() || INTERACTION_DEFAULTS.buttonHoldThresholdMs;
      const duration = Date.now() - spacePressStartTime;
      const isHold = spaceHoldReached || duration >= holdThresholdMs;
      spaceHoldReached = false;
      const lastDigit = Math.floor(Math.max(0, getCurrentRemainingSeconds?.() || 0)) % 10;

      const btnView = bombScene?.moduleViews?.get('button');
      btnView?.moduleDef?.onVisualState?.(
        btnView.group,
        { state: 'committed', mode: isHold ? 'hold_release' : 'tap', progress: 1, lastTimerDigit: lastDigit },
        myRole,
        getGameState?.()?.modules?.button
      );

      if (!isHold) {
        triggerHaptic?.(35);
        sound?.playClick();
        sendOperatorBombAction?.({
          moduleId: 'button',
          action: 'press'
        });
        renderOperatorHudStatus?.({
          active: false,
          mode: 'committed',
          label: 'ضربه کوتاه (TAP) روی دکمه ثبت شد',
          detail: `مدت فشردن: ${duration}ms (کمتر از آستانه ${holdThresholdMs}ms)`,
          progress: 1,
          variant: 'success'
        });
      } else {
        triggerHaptic?.([40, 30, 40]);
        sound?.playClick();
        sendOperatorBombAction?.({
          moduleId: 'button',
          action: 'release',
          data: { releaseDigit: lastDigit }
        });
        renderOperatorHudStatus?.({
          active: false,
          mode: 'committed',
          label: '✓ رهاسازی دکمه (HOLD) ثبت و به سرور ارسال شد',
          detail: `مدت نگه‌داشتن: ${duration}ms · زمان رهاسازی ثبت گردید`,
          progress: 1,
          variant: 'success'
        });
      }
    }
  });

  window.addEventListener('blur', () => {
    cancelKeyboardSpaceHold('خروج تمرکز از پنجره — نگه‌داشتن Space بدون خطا لغو شد.');
    isWKeyActive = false;
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelKeyboardSpaceHold('تغییر تب مرورگر — نگه‌داشتن Space بدون خطا لغو شد.');
      isWKeyActive = false;
    }
  });

  return { cancelKeyboardSpaceHold };
}
