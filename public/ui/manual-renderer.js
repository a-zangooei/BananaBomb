/**
 * Dynamic Tactical Field Manual Renderer for Manual-holder Role.
 */

export function createManualRenderer({ containerEl }) {
  let currentManualFilter = 'all';
  let currentBeaconSpectrumFilter = 'all';

  function renderDynamicManual(manual, state) {
    if (!containerEl) return;
    if (!manual) {
      containerEl.innerHTML = `
        <div class="manual-section manual-loading-placeholder">
          در انتظار دریافت پروتکل‌های اختصاصی این راند...
        </div>
      `;
      return;
    }

    const { seed, button, wires, keypad, beacon } = manual;

    // 1. Live Operational Threat Matrix (Unboxed Metadata — Zero Pills)
    const modulesDefused =
      state?.modulesDefusedCount ??
      Object.values(state?.modules || {}).filter((m) => m?.solved).length;
    const totalModules = state?.totalModulesCount || 4;
    const remainingModules = Math.max(0, totalModules - modulesDefused);

    let threatPhaseText = `وضعیت عملیات: ${remainingModules} از ${totalModules} ماژول مسلح است`;
    if (remainingModules === 0) {
      threatPhaseText = 'تمام ماژول‌های این راند خنثی شدند';
    } else if (remainingModules === 1) {
      threatPhaseText = 'مرحله پایانی: تنها ۱ ماژول مسلح باقی مانده است';
    }

    const activeModuleIds = state?.moduleIds || ['wires', 'button', 'keypad', 'beacon'];
    const moduleMetaList = [
      { id: 'button', label: 'دکمه کاتالیزور', solved: Boolean(state?.modules?.button?.solved) },
      { id: 'wires', label: 'فیوزهای سیم‌کشی', solved: Boolean(state?.modules?.wires?.solved) },
      { id: 'keypad', label: 'صفحه‌کلید رمزی', solved: Boolean(state?.modules?.keypad?.solved) },
      { id: 'beacon', label: 'فانوس مورس نوری', solved: Boolean(state?.modules?.beacon?.solved) }
    ].filter((m) => activeModuleIds.includes(m.id));

    const stepsHtml = Array.from(
      { length: totalModules },
      (_, i) => `<div class="threat-step ${i < modulesDefused ? 'defused' : ''}"></div>`
    ).join('');

    const statusLineHtml = moduleMetaList
      .map(
        (m) => `
        <span class="manual-mod-stat ${m.solved ? 'is-solved' : 'is-armed'}">
          ${m.solved ? '✓' : '●'} ${m.label}: <strong>${m.solved ? 'خنثی' : 'مسلح'}</strong>
        </span>
      `
      )
      .join('<span class="meta-sep" aria-hidden="true">·</span>');

    const matrixHtml = `
      <div class="threat-matrix-card" id="manual-matrix">
        <div class="threat-matrix-header">
          <span class="threat-phase-title">${threatPhaseText}</span>
          <span class="manual-seed-tag" dir="ltr">CODE: ${seed || '------'}</span>
        </div>
        <div class="threat-progress-bar">
          ${stepsHtml}
        </div>
        <div class="manual-modules-strip">
          ${statusLineHtml}
        </div>
      </div>
    `;

    // 2. Segmented Module Filter Bar
    const tabDefs = [
      { id: 'all', label: 'همه پروتکل‌ها', show: true },
      { id: 'button', label: 'دکمه', show: activeModuleIds.includes('button'), solved: Boolean(state?.modules?.button?.solved) },
      { id: 'wires', label: 'سیم‌ها', show: activeModuleIds.includes('wires'), solved: Boolean(state?.modules?.wires?.solved) },
      { id: 'keypad', label: 'کیپد', show: activeModuleIds.includes('keypad'), solved: Boolean(state?.modules?.keypad?.solved) },
      { id: 'beacon', label: 'فانوس مورس نوری', show: activeModuleIds.includes('beacon'), solved: Boolean(state?.modules?.beacon?.solved) }
    ].filter((t) => t.show);

    if (!tabDefs.some((t) => t.id === currentManualFilter)) {
      currentManualFilter = 'all';
    }

    const navTabsHtml = `
      <div class="manual-nav-tabs" role="tablist" aria-label="فیلتر بخش‌های دفترچه">
        ${tabDefs
          .map(
            (t) => `
          <button type="button" class="manual-tab-btn ${currentManualFilter === t.id ? 'active' : ''}" data-filter="${t.id}">
            ${t.solved ? '✓ ' : ''}${t.label}
          </button>
        `
          )
          .join('')}
      </div>
    `;

    // 3. Button Module Section
    let buttonHtml = '';
    if (button && activeModuleIds.includes('button') && (currentManualFilter === 'all' || currentManualFilter === 'button')) {
      const tapRows = (button.tapRows || [])
        .map(
          (r) => `
        <tr>
          <td>${r.condition}</td>
          <td><strong>${r.action}</strong></td>
        </tr>
      `
        )
        .join('');

      const stripRows = (button.stripRows || [])
        .map(
          (r) => `
        <li>نوار کناری <strong>${r.colorName}</strong>: رهاسازی وقتی رقم یکان ثانیه برابر <strong class="tabular-num" dir="ltr">${r.digit}</strong> است (با اشاره به ناظر اعلام کنید).</li>
      `
        )
        .join('');

      buttonHtml = `
        <div class="manual-section" id="manual-button">
          <div class="manual-section-head">
            <h4>۰۱. ماژول دکمه کاتالیزور</h4>
            <span class="manual-protocol-code">${button.protocolName || ''}</span>
          </div>
          <table class="rule-table">
            <thead>
              <tr>
                <th>شرط رنگ و شکل دکمه / سریال (گزارش ناظر)</th>
                <th>اقدام لازم (اعلام با اشاره به ناظر)</th>
              </tr>
            </thead>
            <tbody>
              ${tapRows}
              <tr>
                <td>${button.otherRow?.condition || 'سایر حالات دکمه'}</td>
                <td><strong>${button.otherRow?.action || 'دکمه را نگه‌دار تا ناظر رنگ نوار کناری را ببیند'}</strong></td>
              </tr>
            </tbody>
          </table>

          <div class="manual-sub-box">
            <strong>جدول رقم ثانیه رهاسازی در حالت نگه‌داشتن (HOLD):</strong>
            <ul class="manual-checklist" style="margin-top: 6px;">
              ${stripRows}
            </ul>
          </div>
          <p class="manual-note">${button.note || ''}</p>
        </div>
      `;
    }

    // 4. Wires Module Section
    let wiresHtml = '';
    if (wires && activeModuleIds.includes('wires') && (currentManualFilter === 'all' || currentManualFilter === 'wires')) {
      const steps = (wires.checklist || [])
        .map(
          (item) => `
        <li>${item.condition} <strong>${item.action}</strong> بریده شود (شماره سیم را با اشاره به ناظر نشان دهید).</li>
      `
        )
        .join('');

      wiresHtml = `
        <div class="manual-section" id="manual-wires">
          <div class="manual-section-head">
            <h4>۰۲. ماژول فیوزهای سیم‌کشی</h4>
            <span class="manual-protocol-code">${wires.protocolName || ''}</span>
          </div>
          <ol class="manual-checklist">
            ${steps}
          </ol>
          <p class="manual-note">${wires.note || ''}</p>
        </div>
      `;
    }

    // 5. Keypad Module Section
    let keypadHtml = '';
    if (keypad && activeModuleIds.includes('keypad') && (currentManualFilter === 'all' || currentManualFilter === 'keypad')) {
      keypadHtml = `
        <div class="manual-section" id="manual-keypad">
          <div class="manual-section-head">
            <h4>۰۳. ماژول نمادهای صفحه‌کلید</h4>
            <span class="manual-protocol-code">${keypad.protocolName || ''}</span>
          </div>
          <p style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 10px;">
            ${keypad.note || ''}
          </p>
          <div class="symbol-priority-ribbon">
            ${keypad.priorityRibbon}
          </div>
        </div>
      `;
    }

    // 6. Optical Morse & Tactile Braille Module Section
    let beaconHtml = '';
    if (beacon && activeModuleIds.includes('beacon') && (currentManualFilter === 'all' || currentManualFilter === 'beacon')) {
      const buildBeaconTable = (rows, headingLabel) => {
        const trs = (rows || [])
          .map(
            (r) => `
          <tr>
            <td><strong>${r.name}</strong></td>
            <td style="text-align: center;"><span class="rhythm-badge">${r.pattern}</span></td>
            <td class="tabular-num" style="text-align: center; font-weight: 700; color: var(--accent-amber);">${r.channel} (${r.braille || ''})</td>
          </tr>
        `
          )
          .join('');
        return `
          <div style="margin-top: 8px;">
            <div style="font-size: 0.78rem; font-weight: 700; color: var(--text-secondary); margin-bottom: 4px;">${headingLabel}</div>
            <table class="rule-table">
              <thead>
                <tr>
                  <th>کد پالس نوری</th>
                  <th style="text-align: center;">الگوی چشمک / ضربه میز</th>
                  <th style="text-align: center;">کانال هدف (بریل)</th>
                </tr>
              </thead>
              <tbody>${trs}</tbody>
            </table>
          </div>
        `;
      };

      const colorTables = beacon.colorTables || {};
      let tablesMarkup = '';
      if (currentBeaconSpectrumFilter === 'red') {
        tablesMarkup = buildBeaconTable(colorTables.red, 'جدول چراغ طیف قرمز (Red):');
      } else if (currentBeaconSpectrumFilter === 'blue') {
        tablesMarkup = buildBeaconTable(colorTables.blue, 'جدول چراغ طیف آبی (Blue):');
      } else if (currentBeaconSpectrumFilter === 'yellow') {
        tablesMarkup = buildBeaconTable(colorTables.yellow, 'جدول چراغ طیف زرد (Yellow):');
      } else {
        tablesMarkup =
          buildBeaconTable(colorTables.red, 'الف) چراغ طیف قرمز (Red):') +
          buildBeaconTable(colorTables.blue, 'ب) چراغ طیف آبی (Blue):') +
          buildBeaconTable(colorTables.yellow, 'ج) چراغ طیف زرد (Yellow):');
      }

      const brailleLegendHtml = (beacon.brailleLegend || [
        { channel: 1, braille: '⠁', desc: 'نقطه بالا-چپ' },
        { channel: 2, braille: '⠃', desc: 'دو نقطه عمودی چپ' },
        { channel: 3, braille: '⠉', desc: 'دو نقطه افقی بالا' }
      ])
        .map(
          (b) =>
            `<span>کانال <strong class="tabular-num" dir="ltr">${b.channel}</strong>: <span class="braille-glyph" dir="ltr">${b.braille}</span> (${b.desc})</span>`
        )
        .join('<span class="meta-sep" aria-hidden="true">·</span>');

      beaconHtml = `
        <div class="manual-section" id="manual-beacon">
          <div class="manual-section-head">
            <h4>۰۴. ماژول فانوس مورس نوری (Optical Morse)</h4>
            <span class="manual-protocol-code">${beacon.protocolName || ''}</span>
          </div>

          <p style="font-size: 0.79rem; color: var(--text-secondary); line-height: 1.65;">
            لامپ مورس نوری در دیواره چپ بیرونی کیف <strong>کاملاً بی‌صداست</strong> و تنها در زاویه دید <strong>اپراتور</strong> قرار دارد. اپراتور ریتم نور (کوتاه و بلند) را با <strong>ضربه روی میز یا اشاره دست</strong> به <strong>ناظر</strong> نشان می‌دهد و ناظر رنگ چراغ طیف داخل ماژول (قرمز / آبی / زرد) و الگو را با اشاره به شما منتقل می‌کند:
          </p>

          <div class="parity-toggle-group" role="group" aria-label="فیلتر رنگ چراغ طیف فانوس مورس">
            <button type="button" class="parity-toggle-btn ${currentBeaconSpectrumFilter === 'all' ? 'active' : ''}" data-spectrum="all">
              همه رنگ‌ها
            </button>
            <button type="button" class="parity-toggle-btn ${currentBeaconSpectrumFilter === 'red' ? 'active' : ''}" data-spectrum="red">
              چراغ قرمز
            </button>
            <button type="button" class="parity-toggle-btn ${currentBeaconSpectrumFilter === 'blue' ? 'active' : ''}" data-spectrum="blue">
              چراغ آبی
            </button>
            <button type="button" class="parity-toggle-btn ${currentBeaconSpectrumFilter === 'yellow' ? 'active' : ''}" data-spectrum="yellow">
              چراغ زرد
            </button>
          </div>

          ${tablesMarkup}

          <div class="manual-sub-box">
            <strong>راهنمای تطبیق ریتم مورس نوری و اعداد بریل سلکتور اپراتور:</strong>
            <div class="braille-legend-strip">${brailleLegendHtml}</div>
            <ul class="manual-checklist" style="margin-top: 6px;">
              <li><span class="tabular-num" dir="ltr">·· — ·</span> <strong>(وکتور):</strong> دو چشمک کوتاه، یک بلند، یک کوتاه</li>
              <li><span class="tabular-num" dir="ltr">— · — ·</span> <strong>(سیگما):</strong> یک بلند، یک کوتاه، یک بلند، یک کوتاه</li>
              <li><span class="tabular-num" dir="ltr">· — — ·</span> <strong>(دلتا):</strong> یک کوتاه، دو بلند، یک کوتاه</li>
              <li><span class="tabular-num" dir="ltr">— — · ·</span> <strong>(امگا):</strong> دو چشمک بلند، دو چشمک کوتاه</li>
            </ul>
          </div>

          <p class="manual-note">${beacon.note || ''}</p>
        </div>
      `;
    }

    containerEl.innerHTML =
      matrixHtml + navTabsHtml + buttonHtml + wiresHtml + keypadHtml + beaconHtml;

    containerEl.querySelectorAll('.manual-tab-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        currentManualFilter = e.currentTarget.getAttribute('data-filter') || 'all';
        renderDynamicManual(manual, state);
      });
    });

    containerEl.querySelectorAll('[data-spectrum]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        currentBeaconSpectrumFilter = e.currentTarget.getAttribute('data-spectrum') || 'all';
        renderDynamicManual(manual, state);
      });
    });
  }

  return { renderDynamicManual };
}
