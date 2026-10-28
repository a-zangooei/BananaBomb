/**
 * Role Permissions Specification, 4-Tab Reference Sheet Modal, Pre-Round Checklist & Countdown Curtain Prep.
 */
import { isOperator, toFunctionalRoleKey } from '../../shared/roles.js';

export const ROLE_PERMISSIONS_SPEC = Object.freeze({
  operator: {
    title: 'اپراتور (Operator)',
    can: [
      'مشاهده نمای سه‌بعدی مونوکروم بمب و لامپ مورس نوری بی‌صدا در دیواره چپ بیرونی کیف (با دکمه «لامپ مورس» یا چرخش نگاه).',
      'لمس مستقیم بمب و خواندن اعداد بریل دور سلکتور فانوس مورس نوری (⠁ = ۱ · ⠃ = ۲ · ⠉ = ۳) برای تنظیم کانال و نگه‌داشتن HOLD TX.',
      'پخش صدای تندشونده تایمر و هشدار خطا از بلندگوی این گوشی در اتاق (شنیده‌شده توسط اپراتور و دفترچه‌دار).',
      'دریافت دستورات کلامی از ناظر (از جمله زمان رهاسازی دکمه HOLD) و انتقال بی‌کلام الگوی چشمک‌زن لامپ مورس به ناظر.'
    ],
    cannot: [
      'خواندن ارقام تایمر یا خانه‌های ضربدر خطا روی درب باز کیف (به دلیل دید مونوکروم و کوررنگی اپراتور).',
      'صحبت کردن یا تولید هرگونه کلام در طول راند.',
      'دیدن صفحه گوشی دفترچه راهنما یا ناظر، یا برقراری ارتباط مستقیم با دارنده دفترچه راهنما.',
      'نشان دادن صفحه گوشی خود به سایر بازیکنان.'
    ]
  },
  observer: {
    title: 'ناظر (Observer) — پل ارتباطی تیم',
    can: [
      'مشاهده انحصاری تایمر دیجیتال و خانه‌های ضربدر خطا روی سطح داخلی درب باز کیف، به همراه رنگ ماژول‌ها، چراغ طیف مورس و پلاک سریال.',
      'صحبت کردن شفاهی با اپراتور (شما تنها گوینده تیم هستید و لحظه دقیق رهاسازی دکمه HOLD را اعلام می‌کنید).',
      'برقراری ارتباط دوطرفه با دارنده دفترچه راهنما از طریق اشاره‌های توافقی دست (و کمک‌ارتباطی ۳ نمادی در حالت آسان).',
      'نگاه به اطراف و زوم اپتیکال از صندلی کناری میز بدون لمس عملیاتی ماژول‌های بمب.'
    ],
    cannot: [
      'لمس، بریدن سیم یا تعامل عملیاتی با هیچ‌یک از ماژول‌های بمب.',
      'شنیدن یا استفاده از صدای تندشونده تایمر در اتاق (هدفون ایمن یا جایگزین توافقی الزامی است).',
      'نشان دادن صفحه رنگی گوشی خود به اپراتور یا دارنده دفترچه راهنما، یا نگاه کردن به صفحه گوشی آن‌ها.',
      'استفاده از موسیقی یا صدای بلند و آسیب‌زا در هدفون.'
    ]
  },
  manual: {
    title: 'دفترچه راهنما (Manual-holder)',
    can: [
      'مطالعه دفترچه قوانین ۲D راند جاری در کنار نمای سه‌بعدی نشسته پشت میز ون و شنیدن صدای تندشونده تایمر از گوشی اپراتور در اتاق.',
      'برقراری ارتباط دوطرفه فقط با ناظر از طریق اشاره‌های توافقی دست (و کمک‌ارتباطی ۳ نمادی در حالت آسان).',
      'تحلیل سرنخ‌های اعلامی ناظر (رنگ‌ها، سریال، زمان و الگوی مورس) و انتقال دستور عمل با اشاره به ناظر.'
    ],
    cannot: [
      'دیدن تایمر روی درب باز کیف یا داخل بمب (درب بازشده کیف مانع دید مستقیم شماست).',
      'صحبت کردن یا زمزمه کردن با هیچ‌یک از بازیکنان.',
      'دیدن صفحه گوشی اپراتور یا برقراری هرگونه ارتباط مستقیم با اپراتور.',
      'نشان دادن صفحه دفترچه راهنما به ناظر یا اپراتور.'
    ]
  }
});

export const COUNTDOWN_ROLE_PREP = Object.freeze({
  operator: {
    title: 'آماده‌باش نقش شما: اپراتور (Operator)',
    items: [
      'عینک آفتابی یا محدودیت دید توافقی خود را همین الان بزنید.',
      'در طول راند مطلقاً صحبت نکنید؛ کد مورس نوری دیواره چپ کیف را با ضربه میز یا اشاره به ناظر برسانید.',
      'اعداد بریل دور سلکتور: ⠁ = ۱ · ⠃ = ۲ · ⠉ = ۳ (گوشی را محرمانه نگه دارید).'
    ]
  },
  observer: {
    title: 'آماده‌باش نقش شما: ناظر (Observer)',
    items: [
      'هدفون ایمن را روی گوش بگذارید تا از صدای بازی استفاده نکنید.',
      'در ضلع کناری میز مستقر شوید؛ شما تنها گوینده تیم هستید.',
      'صفحه رنگی گوشی خود را از دید سایر بازیکنان محرمانه نگه دارید.'
    ]
  },
  manual: {
    title: 'آماده‌باش نقش شما: دفترچه راهنما (Manual-holder)',
    items: [
      'پشت درب کیف (روبه‌روی اپراتور) بنشینید و مطلقاً صحبت نکنید.',
      'صفحه قوانین را فقط در زاویه دید خود نگه دارید.',
      'فقط از طریق اشاره‌های توافقی دست با ناظر ارتباط برقرار کنید.'
    ]
  }
});

export function buildPermissionsHtml(roleKey) {
  const spec = ROLE_PERMISSIONS_SPEC[toFunctionalRoleKey(roleKey)] || ROLE_PERMISSIONS_SPEC.operator;
  const canItems = spec.can.map((item) => `<li>${item}</li>`).join('');
  const cannotItems = spec.cannot.map((item) => `<li>${item}</li>`).join('');
  return `
    <div class="perm-col perm-col-can">
      <h4>✓ مجاز هستید (${spec.title}):</h4>
      <ul class="perm-list">${canItems}</ul>
    </div>
    <div class="perm-col perm-col-cannot">
      <h4>✕ مجاز نیستید (${spec.title}):</h4>
      <ul class="perm-list">${cannotItems}</ul>
    </div>
  `;
}

function loadChecklistState() {
  try {
    const raw = sessionStorage.getItem('defusal_checklist_state');
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveChecklistState(mapObj) {
  try {
    sessionStorage.setItem('defusal_checklist_state', JSON.stringify(mapObj));
  } catch (e) {}
}

export function createReferenceSheetController({ elements, getMyRole, getGameState }) {
  const {
    btnOpenReferenceSheet,
    btnInRoundHelp,
    lobbyReferenceSheet,
    btnCloseReferenceSheet,
    headerChecklistCount,
    sheetTabCheckCount,
    refTabButtons = [],
    refTabPanes = [],
    rolePermissionsBody,
    permTabButtons = [],
    openPermButtons = [],
    checklistInputs = [],
    checklistProgressBadge,
    btnCheckAllReady,
    chkLiveRoleHint,
    chkLiveConnHint,
    countdownRoleTitle,
    countdownRoleInstructions
  } = elements;

  let selectedPermTabRole = 'operator';
  let activeRefTab = 'checklist';
  let lastRefTriggerEl = null;

  function renderLobbyPermissionsPanel(roleKey = selectedPermTabRole) {
    selectedPermTabRole = toFunctionalRoleKey(roleKey);
    permTabButtons.forEach((btn) => {
      const isActive = btn.getAttribute('data-perm-role') === selectedPermTabRole;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    if (rolePermissionsBody) {
      rolePermissionsBody.innerHTML = buildPermissionsHtml(selectedPermTabRole);
    }
  }

  function setActiveReferenceTab(tabId) {
    activeRefTab = tabId || 'checklist';
    refTabButtons.forEach((btn) => {
      const isMatch = btn.getAttribute('data-ref-tab') === activeRefTab;
      btn.classList.toggle('active', isMatch);
      btn.setAttribute('aria-selected', isMatch ? 'true' : 'false');
    });
    refTabPanes.forEach((pane) => {
      pane.classList.toggle('active', pane.getAttribute('data-ref-pane') === activeRefTab);
    });
  }

  function isReferenceSheetOpen() {
    return Boolean(lobbyReferenceSheet && lobbyReferenceSheet.style.display !== 'none');
  }

  function openReferenceSheet(tabId = activeRefTab, permRole = null, triggerEl = null) {
    if (!lobbyReferenceSheet) return;
    if (triggerEl) {
      lastRefTriggerEl = triggerEl;
    }
    if (permRole) {
      renderLobbyPermissionsPanel(permRole);
    }
    setActiveReferenceTab(tabId);
    lobbyReferenceSheet.style.display = 'flex';
    btnCloseReferenceSheet?.focus();
  }

  function closeReferenceSheet() {
    if (!lobbyReferenceSheet || lobbyReferenceSheet.style.display === 'none') return;
    lobbyReferenceSheet.style.display = 'none';
    if (lastRefTriggerEl && typeof lastRefTriggerEl.focus === 'function') {
      lastRefTriggerEl.focus();
    }
  }

  function renderCountdownCurtainRolePrep(roleKey) {
    const prep = COUNTDOWN_ROLE_PREP[toFunctionalRoleKey(roleKey)] || COUNTDOWN_ROLE_PREP.operator;
    const myRole = getMyRole?.();
    if (countdownRoleTitle) {
      countdownRoleTitle.textContent = myRole ? prep.title : 'آماده‌باش عملیات · تماشاگر';
    }
    if (countdownRoleInstructions) {
      countdownRoleInstructions.innerHTML = prep.items.map((item) => `<li>${item}</li>`).join('');
    }
  }

  function syncChecklistUI(state = getGameState?.()) {
    const myRole = getMyRole?.();
    const checkedCount = checklistInputs.filter((el) => el.checked).length;
    const totalCount = checklistInputs.length || 7;
    const isComplete = checkedCount === totalCount;

    if (checklistProgressBadge) {
      checklistProgressBadge.textContent = `${checkedCount} از ${totalCount} تایید شد`;
      checklistProgressBadge.classList.toggle('complete', isComplete);
    }
    if (headerChecklistCount) {
      headerChecklistCount.textContent = `${checkedCount}/${totalCount}`;
      headerChecklistCount.classList.toggle('complete', isComplete);
    }
    if (sheetTabCheckCount) {
      sheetTabCheckCount.textContent = `${checkedCount}/${totalCount}`;
    }
    if (btnCheckAllReady) {
      btnCheckAllReady.textContent = isComplete ? 'بازنشانی چک‌لیست' : 'تایید همه';
    }
    if (chkLiveRoleHint) {
      if (myRole) {
        const title = ROLE_PERMISSIONS_SPEC[toFunctionalRoleKey(myRole)]?.title || '';
        chkLiveRoleHint.textContent = `(نقش فعلی شما: ${title})`;
      } else {
        chkLiveRoleHint.textContent = '(هنوز نقشی انتخاب نکرده‌اید)';
      }
    }
    if (chkLiveConnHint && state?.roles) {
      const connectedCount = ['blind', 'deaf', 'mute'].filter((k) => state.roles[k]?.connected).length;
      chkLiveConnHint.textContent = `(وضعیت شبکه: ${connectedCount} از ۳ بازیکن متصل)`;
    }
  }

  // Wire event listeners
  permTabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const r = btn.getAttribute('data-perm-role') || 'operator';
      renderLobbyPermissionsPanel(r);
    });
  });

  refTabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      setActiveReferenceTab(btn.getAttribute('data-ref-tab') || 'checklist');
    });
  });

  if (btnOpenReferenceSheet) {
    btnOpenReferenceSheet.addEventListener('click', () => {
      const myRole = getMyRole?.();
      openReferenceSheet(
        activeRefTab || 'checklist',
        myRole ? toFunctionalRoleKey(myRole) : null,
        btnOpenReferenceSheet
      );
    });
  }

  if (btnInRoundHelp) {
    btnInRoundHelp.addEventListener('click', () => {
      const myRole = getMyRole?.();
      const targetTab = isOperator(myRole) ? 'permissions' : 'gestures';
      openReferenceSheet(
        targetTab,
        myRole ? toFunctionalRoleKey(myRole) : 'operator',
        btnInRoundHelp
      );
    });
  }

  if (btnCloseReferenceSheet) {
    btnCloseReferenceSheet.addEventListener('click', closeReferenceSheet);
  }

  if (lobbyReferenceSheet) {
    lobbyReferenceSheet.addEventListener('click', (e) => {
      if (e.target === lobbyReferenceSheet) {
        closeReferenceSheet();
      }
    });
  }

  openPermButtons.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const roleTarget = btn.getAttribute('data-open-perm') || 'operator';
      openReferenceSheet('permissions', roleTarget, btn);
    });
  });

  const initialChecklistMap = loadChecklistState();
  checklistInputs.forEach((input) => {
    const key = input.getAttribute('data-check-key');
    if (key && initialChecklistMap[key]) {
      input.checked = true;
    }
    input.addEventListener('change', () => {
      const nextMap = {};
      checklistInputs.forEach((chk) => {
        const k = chk.getAttribute('data-check-key');
        if (k) nextMap[k] = chk.checked;
      });
      saveChecklistState(nextMap);
      syncChecklistUI();
    });
  });

  if (btnCheckAllReady) {
    btnCheckAllReady.addEventListener('click', () => {
      const allChecked = checklistInputs.every((el) => el.checked);
      const nextVal = !allChecked;
      const nextMap = {};
      checklistInputs.forEach((chk) => {
        chk.checked = nextVal;
        const k = chk.getAttribute('data-check-key');
        if (k) nextMap[k] = nextVal;
      });
      saveChecklistState(nextMap);
      syncChecklistUI();
    });
  }

  const initialRole = getMyRole?.();
  renderLobbyPermissionsPanel(initialRole ? toFunctionalRoleKey(initialRole) : 'operator');
  syncChecklistUI();

  return {
    openReferenceSheet,
    closeReferenceSheet,
    isReferenceSheetOpen,
    renderLobbyPermissionsPanel,
    renderCountdownCurtainRolePrep,
    syncChecklistUI
  };
}
