/* ============================================================
   IRIS — редактор листа персонажа
   Полностью рабочая версия: шаблоны сохраняются без зависаний
   ============================================================ */

const root = document.documentElement;
const bgLayers = document.querySelectorAll('.page-bg');
const decalContainers = document.querySelectorAll('.decal-container');
const decalList = document.getElementById('decal-list');
let activeDecal = null;
let clipboard = null;
let decalZIndex = 10;

/* ---------- УТИЛИТЫ ---------- */
function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

let managedObjectUrls = [];
function trackUrl(url) {
  if (typeof url === 'string' && url.startsWith('blob:')) managedObjectUrls.push(url);
  return url;
}
function releaseUrl(url) {
  if (typeof url !== 'string' || !url.startsWith('blob:')) return;
  try { URL.revokeObjectURL(url); } catch (e) {}
  managedObjectUrls = managedObjectUrls.filter(u => u !== url);
}

// Загрузка картинки с таймаутом — процесс никогда не зависает
function loadImageSafe(src, timeout = 8000) {
  return new Promise((resolve) => {
    if (!src) { resolve(null); return; }
    const img = new Image();
    let done = false;
    const finish = (val) => { if (done) return; done = true; clearTimeout(timer); resolve(val); };
    const timer = setTimeout(() => finish(null), timeout);
    img.onload = () => finish(img.naturalWidth > 0 ? img : null);
    img.onerror = () => finish(null);
    try { img.src = src; } catch (e) { finish(null); }
  });
}

function dataUrlToBlob(dataUrl) {
  try {
    const parts = String(dataUrl).split(',');
    const mime = (parts[0].match(/:(.*?);/) || [, 'image/png'])[1];
    const bin = atob(parts[1]);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  } catch (e) { return null; }
}

function imageToBase64(src) {
  return new Promise(async (resolve, reject) => {
    if (!src) { reject(new Error('Пустой источник')); return; }
    if (src.startsWith('data:image/')) { resolve(src); return; }
    const img = await loadImageSafe(src, 10000);
    if (!img) { reject(new Error('Не удалось загрузить изображение')); return; }
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    } catch (err) { reject(err); }
  });
}

// Сжатие в PNG-Blob: таймаут + фолбэк
async function compressToBlob(src, maxWidth = 600) {
  const img = await loadImageSafe(src, 10000);
  if (!img) return null;
  try {
    let w = img.naturalWidth, h = img.naturalHeight;
    if (w > maxWidth) { h = Math.max(1, Math.round((maxWidth / w) * h)); w = maxWidth; }
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    const blob = await new Promise((resolve) => {
      let settled = false;
      const t = setTimeout(() => { if (!settled) { settled = true; resolve(null); } }, 8000);
      try {
        canvas.toBlob((b) => { if (!settled) { settled = true; clearTimeout(t); resolve(b); } }, 'image/png');
      } catch (e) { if (!settled) { settled = true; clearTimeout(t); resolve(null); } }
    });
    return blob || dataUrlToBlob(canvas.toDataURL('image/png'));
  } catch (e) { console.warn('compressToBlob failed:', e); return null; }
}

function getBlobUrl(blobOrString) {
  if (!blobOrString) return '';
  if (typeof blobOrString === 'string') return blobOrString;
  if (blobOrString instanceof Blob) return URL.createObjectURL(blobOrString);
  return '';
}

function drawCover(ctx, img, W, H) {
  const ir = img.naturalWidth / img.naturalHeight;
  const cr = W / H;
  let dw, dh;
  if (ir > cr) { dh = H; dw = H * ir; } else { dw = W; dh = W / ir; }
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

function flashNotification(text) {
  const n = document.createElement('div');
  n.textContent = text;
  n.style.cssText = `position:fixed;top:80px;left:50%;transform:translateX(-50%);
    background:rgba(0,0,0,.85);color:#fff;padding:8px 16px;border-radius:6px;
    font-size:13px;font-weight:600;z-index:3500;pointer-events:none;
    transition:opacity .4s;font-family:'Inter',sans-serif;max-width:90vw;text-align:center;`;
  document.body.appendChild(n);
  setTimeout(() => { n.style.opacity = '0'; }, 1400);
  setTimeout(() => { n.remove(); }, 1900);
}

/* ---------- ЦВЕТА И ФОН ---------- */
const DEFAULT_COLORS = { headerBg:'#000000', headerText:'#ffffff', border:'#333333', text:'#111111' };
const COLOR_INPUTS = { headerBg:'col-header-bg', headerText:'col-header-text', border:'col-border', text:'col-text' };
const COLOR_VARS = { headerBg:'--header-bg', headerText:'--header-text', border:'--border-color', text:'--text-color' };

Object.keys(COLOR_INPUTS).forEach(key => {
  document.getElementById(COLOR_INPUTS[key]).addEventListener('input', e => {
    root.style.setProperty(COLOR_VARS[key], e.target.value);
  });
});

function applyColors(colors) {
  const src = colors || DEFAULT_COLORS;
  Object.keys(COLOR_INPUTS).forEach(key => {
    const value = src[key] || DEFAULT_COLORS[key];
    const input = document.getElementById(COLOR_INPUTS[key]);
    if (input) input.value = value;
    root.style.setProperty(COLOR_VARS[key], value);
  });
}
function readCurrentColors() {
  const out = {};
  Object.keys(COLOR_INPUTS).forEach(key => {
    const input = document.getElementById(COLOR_INPUTS[key]);
    out[key] = input ? input.value : DEFAULT_COLORS[key];
  });
  return out;
}

function setBackgroundSource(src, label, color) {
  bgLayers.forEach(layer => {
    releaseUrl(layer.dataset.objectUrl || '');
    if (src) {
      layer.style.backgroundImage = `url("${src}")`;
      if (src.startsWith('blob:')) layer.dataset.objectUrl = src; else delete layer.dataset.objectUrl;
    } else {
      layer.style.backgroundImage = '';
      delete layer.dataset.objectUrl;
    }
  });
  const el = document.getElementById('bg-file-name');
  if (el) { el.textContent = label || 'Файл не выбран'; el.style.color = color || '#8ab4ff'; }
}

function readBackgroundDataUrl() {
  const layer = document.querySelector('.page-bg');
  if (!layer) return '';
  const bg = layer.style.backgroundImage;
  if (!bg || bg === 'none') return '';
  const m = bg.match(/url\(["']?(.*?)["']?\)$/);
  return m ? m[1] : '';
}

document.getElementById('bg-upload').addEventListener('change', e => {
  if (e.target.files[0]) {
    setBackgroundSource(trackUrl(URL.createObjectURL(e.target.files[0])), e.target.files[0].name, '#4ade80');
  }
});
document.getElementById('bg-opacity').addEventListener('input', e => root.style.setProperty('--bg-opacity', e.target.value));
function removeBg() {
  setBackgroundSource('', 'Файл не выбран', '#8ab4ff');
  document.getElementById('bg-upload').value = '';
}

/* ---------- FILE DROP ---------- */
function setupFileDrop(dropId, inputId, nameId) {
  const drop = document.getElementById(dropId);
  const input = document.getElementById(inputId);
  const nameEl = document.getElementById(nameId);
  if (!drop || !input) return;
  input.addEventListener('change', (e) => {
    if (e.target.files[0] && nameEl) { nameEl.textContent = e.target.files[0].name; nameEl.style.color = '#4ade80'; }
  });
  ['dragenter','dragover'].forEach(evt => drop.addEventListener(evt, e => { e.preventDefault(); drop.classList.add('dragover'); }));
  ['dragleave','drop'].forEach(evt => drop.addEventListener(evt, e => { e.preventDefault(); drop.classList.remove('dragover'); }));
  drop.addEventListener('drop', e => {
    e.preventDefault();
    if (e.dataTransfer.files[0]) { input.files = e.dataTransfer.files; input.dispatchEvent(new Event('change')); }
  });
}
setupFileDrop('bg-file-drop','bg-upload','bg-file-name');
setupFileDrop('decal-file-drop','decal-upload','decal-file-name');

/* ---------- ДЕКАЛИ ---------- */
document.getElementById('decal-upload').addEventListener('change', e => {
  if (e.target.files[0]) { addDecal(e.target.files[0]); e.target.value = ''; }
});
document.getElementById('decal-size').addEventListener('input', e => root.style.setProperty('--decal-default-size', e.target.value + 'px'));

// options: { fromTemplate, templateId, templateName }
function addDecal(file, restoreData = null, options = {}) {
  const pageEl = document.querySelector('.page');
  const pageW = pageEl ? pageEl.offsetWidth : 1122;
  const pageH = pageEl ? pageEl.offsetHeight : 793;
  const toPx = (value, axis, fallback) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'string' && value.trim().endsWith('%')) return (parseFloat(value)/100) * (axis === 'x' ? pageW : pageH);
    const n = parseFloat(value);
    return isNaN(n) ? fallback : n;
  };

  const id = (restoreData && restoreData.id) ? restoreData.id : 'd_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
  const defaultSize = parseInt(getComputedStyle(root).getPropertyValue('--decal-default-size')) || 120;
  const width = restoreData ? toPx(restoreData.width,'x',defaultSize) : defaultSize;
  const height = restoreData ? toPx(restoreData.height,'y',width) : width;
  const left = restoreData ? toPx(restoreData.left,'x',100) + 'px' : '100px';
  const top = restoreData ? toPx(restoreData.top,'y',100) + 'px' : '100px';
  const rotation = restoreData ? (parseFloat(restoreData.rotation) || 0) : 0;
  const flipH = restoreData ? (parseFloat(restoreData.flipH) || 1) : 1;
  const flipV = restoreData ? (parseFloat(restoreData.flipV) || 1) : 1;
  const zIndex = restoreData ? (parseInt(restoreData.zIndex) || 10) : ++decalZIndex;

  const wrap = document.createElement('div');
  wrap.className = 'decal';
  wrap.id = id;
  wrap.style.width = Math.max(10,width) + 'px';
  wrap.style.height = Math.max(10,height) + 'px';
  wrap.style.left = left;
  wrap.style.top = top;
  wrap.dataset.rotation = rotation;
  wrap.dataset.flipH = flipH;
  wrap.dataset.flipV = flipV;
  wrap.dataset.originalImageName = restoreData ? (restoreData.imageName || '') : (file ? file.name : '');
  if (options.fromTemplate) {
    wrap.classList.add('tpl-decal');
    wrap.dataset.templateId = options.templateId || '';
    wrap.dataset.templateName = options.templateName || '';
  }
  applyTransform(wrap);
  wrap.style.zIndex = zIndex;
  if (zIndex > decalZIndex) decalZIndex = zIndex;

  const img = document.createElement('img');
  let objectUrl = '';
  if (restoreData) {
    if (restoreData.imageBlob instanceof Blob) objectUrl = trackUrl(URL.createObjectURL(restoreData.imageBlob));
    img.src = objectUrl || restoreData.imageSrc || '';
  } else if (file) {
    objectUrl = trackUrl(URL.createObjectURL(file));
    img.src = objectUrl;
  }
  if (objectUrl) wrap.dataset.objectUrl = objectUrl;
  img.draggable = false;
  wrap.appendChild(img);

  const rotateLine = document.createElement('div');
  rotateLine.className = 'rotate-line';
  rotateLine.style.height = '28px';
  wrap.appendChild(rotateLine);

  const handlePositions = ['nw','ne','se','sw','n','s','e','w'];
  handlePositions.forEach(pos => {
    const h = document.createElement('div');
    h.className = 'handle' + (['nw','ne','se','sw'].includes(pos) ? ' corner' : '');
    h.classList.add(pos);
    h.dataset.handle = pos;
    wrap.appendChild(h);
  });

  const rotateHandle = document.createElement('div');
  rotateHandle.className = 'rotate-handle';
  rotateHandle.dataset.handle = 'rotate';
  wrap.appendChild(rotateHandle);

  // --- мышь: перетаскивание ---
  let isDragging = false, startX, startY, origLeft, origTop;
  wrap.addEventListener('mousedown', e => {
    if (e.target.dataset.handle) return;
    if (e.button !== 0) return;
    isDragging = true;
    startX = e.clientX; startY = e.clientY;
    origLeft = parseFloat(wrap.style.left) || 0;
    origTop = parseFloat(wrap.style.top) || 0;
    setActiveDecal(wrap);
    e.preventDefault();
  });

  // --- тач: перетаскивание ---
  let isTouchDragging = false, touchStartX, touchStartY, touchOrigLeft, touchOrigTop;
  wrap.addEventListener('touchstart', (e) => {
    if (e.target.dataset.handle) return;
    if (e.touches.length !== 1) return;
    e.preventDefault(); e.stopPropagation();
    const t = e.touches[0];
    isTouchDragging = true;
    touchStartX = t.clientX; touchStartY = t.clientY;
    touchOrigLeft = parseFloat(wrap.style.left) || 0;
    touchOrigTop = parseFloat(wrap.style.top) || 0;
    setActiveDecal(wrap);
  }, { passive: false });

  wrap.addEventListener('touchmove', (e) => {
    if (!isTouchDragging || e.touches.length !== 1) return;
    e.preventDefault(); e.stopPropagation();
    const t = e.touches[0];
    wrap.style.left = (touchOrigLeft + t.clientX - touchStartX) + 'px';
    wrap.style.top = (touchOrigTop + t.clientY - touchStartY) + 'px';
  }, { passive: false });
  wrap.addEventListener('touchend', () => { isTouchDragging = false; });

  wrap.addEventListener('contextmenu', e => {
    e.preventDefault(); e.stopPropagation();
    setActiveDecal(wrap);
    showContextMenu(e.clientX, e.clientY);
  });

  let longPressTimer;
  wrap.addEventListener('touchstart', (e) => {
    if (e.target.dataset.handle) return;
    const t = e.touches[0];
    longPressTimer = setTimeout(() => {
      isTouchDragging = false;
      setActiveDecal(wrap);
      showContextMenu(t.clientX, t.clientY);
    }, 550);
  });
  wrap.addEventListener('touchend', () => clearTimeout(longPressTimer));
  wrap.addEventListener('touchmove', () => clearTimeout(longPressTimer));

  // --- ресайз ---
  handlePositions.forEach(pos => {
    const handle = wrap.querySelector('.handle.' + pos);
    let isResizing = false, smX, smY, sW, sH, sL, sT;
    let tResizing = false, tX, tY, tW, tH, tL, tT;

    const applyResize = (dx, dy, baseW, baseH, baseL, baseT) => {
      let newW = baseW, newH = baseH, newL = baseL, newT = baseT;
      if (pos.includes('e')) newW = Math.max(30, baseW + dx);
      else if (pos.includes('w')) { newW = Math.max(30, baseW - dx); newL = baseL + (baseW - newW); }
      if (pos.includes('s')) newH = Math.max(30, baseH + dy);
      else if (pos.includes('n')) { newH = Math.max(30, baseH - dy); newT = baseT + (baseH - newH); }
      wrap.style.width = newW + 'px'; wrap.style.height = newH + 'px';
      wrap.style.left = newL + 'px'; wrap.style.top = newT + 'px';
    };

    handle.addEventListener('mousedown', (e) => {
      e.stopPropagation(); e.preventDefault();
      isResizing = true;
      smX = e.clientX; smY = e.clientY;
      sW = wrap.offsetWidth; sH = wrap.offsetHeight;
      sL = parseFloat(wrap.style.left) || 0; sT = parseFloat(wrap.style.top) || 0;
      setActiveDecal(wrap);
    });
    handle.addEventListener('touchstart', (e) => {
      e.stopPropagation(); e.preventDefault();
      const t = e.touches[0];
      tResizing = true;
      tX = t.clientX; tY = t.clientY;
      tW = wrap.offsetWidth; tH = wrap.offsetHeight;
      tL = parseFloat(wrap.style.left) || 0; tT = parseFloat(wrap.style.top) || 0;
      setActiveDecal(wrap);
    }, { passive: false });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      applyResize(e.clientX - smX, e.clientY - smY, sW, sH, sL, sT);
    });
    document.addEventListener('touchmove', (e) => {
      if (!tResizing || e.touches.length !== 1) return;
      e.preventDefault();
      const t = e.touches[0];
      applyResize(t.clientX - tX, t.clientY - tY, tW, tH, tL, tT);
    }, { passive: false });
    document.addEventListener('mouseup', () => { isResizing = false; });
    document.addEventListener('touchend', () => { tResizing = false; });
  });

  // --- поворот ---
  let isRotating = false, startAngle = 0, startRotation = 0;
  let tRotating = false, tStartAngle = 0, tStartRotation = 0;
  const angleFrom = (cx, cy) => {
    const r = wrap.getBoundingClientRect();
    return Math.atan2(cy - (r.top + r.height/2), cx - (r.left + r.width/2));
  };
  rotateHandle.addEventListener('mousedown', (e) => {
    e.stopPropagation(); e.preventDefault();
    isRotating = true; setActiveDecal(wrap);
    startAngle = angleFrom(e.clientX, e.clientY);
    startRotation = parseFloat(wrap.dataset.rotation) || 0;
  });
  rotateHandle.addEventListener('touchstart', (e) => {
    e.stopPropagation(); e.preventDefault();
    const t = e.touches[0];
    tRotating = true; setActiveDecal(wrap);
    tStartAngle = angleFrom(t.clientX, t.clientY);
    tStartRotation = parseFloat(wrap.dataset.rotation) || 0;
  }, { passive: false });

  document.addEventListener('mousemove', (e) => {
    if (isDragging) {
      wrap.style.left = (origLeft + e.clientX - startX) + 'px';
      wrap.style.top = (origTop + e.clientY - startY) + 'px';
    }
    if (isRotating) {
      wrap.dataset.rotation = startRotation + (angleFrom(e.clientX, e.clientY) - startAngle) * (180/Math.PI);
      applyTransform(wrap);
    }
  });
  document.addEventListener('touchmove', (e) => {
    if (!tRotating || e.touches.length !== 1) return;
    e.preventDefault();
    const t = e.touches[0];
    wrap.dataset.rotation = tStartRotation + (angleFrom(t.clientX, t.clientY) - tStartAngle) * (180/Math.PI);
    applyTransform(wrap);
  }, { passive: false });
  document.addEventListener('mouseup', () => { isDragging = false; isRotating = false; });
  document.addEventListener('touchend', () => { isTouchDragging = false; tRotating = false; });

  decalContainers[0].appendChild(wrap);
  renderDecalListItem(wrap);
  return wrap;
}

function renderDecalListItem(wrap) {
  if (!wrap || !decalList) return;
  const old = document.getElementById('list_' + wrap.id);
  if (old) old.remove();
  const img = wrap.querySelector('img');
  const isTpl = wrap.classList.contains('tpl-decal');
  const name = wrap.dataset.originalImageName || 'decal';
  const item = document.createElement('div');
  item.className = 'decal-list-item' + (isTpl ? ' tpl-decal-row' : '');
  item.id = 'list_' + wrap.id;
  item.innerHTML = `
    <div class="decal-item-info">
      <img src="${escapeHtml(img ? img.src : '')}" class="decal-thumb" alt="">
      <span class="decal-item-name">${escapeHtml(name)}</span>
      ${isTpl ? `<span class="tpl-tag" title="Из шаблона: ${escapeHtml(wrap.dataset.templateName || '')}">шаблон</span>` : ''}
    </div>
    <button onclick="removeDecal('${wrap.id}')">Удалить</button>`;
  item.addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    setActiveDecal(wrap);
  });
  decalList.appendChild(item);
}

function applyTransform(el) {
  const rot = parseFloat(el.dataset.rotation) || 0;
  const fh = parseFloat(el.dataset.flipH) || 1;
  const fv = parseFloat(el.dataset.flipV) || 1;
  el.style.transform = `rotate(${rot}deg) scale(${fh}, ${fv})`;
}
function setActiveDecal(wrap) {
  document.querySelectorAll('.decal').forEach(d => d.classList.remove('active'));
  wrap.classList.add('active');
  activeDecal = wrap;
}
function removeDecal(id) {
  const el = document.getElementById(id);
  if (el) { releaseUrl(el.dataset.objectUrl || ''); el.remove(); }
  const listEl = document.getElementById('list_' + id);
  if (listEl) listEl.remove();
  if (activeDecal === el) activeDecal = null;
}
function copyDecal() {
  if (!activeDecal) return;
  const img = activeDecal.querySelector('img');
  clipboard = {
    imageSrc: img ? img.src : '',
    width: activeDecal.offsetWidth, height: activeDecal.offsetHeight,
    rotation: parseFloat(activeDecal.dataset.rotation) || 0,
    flipH: parseFloat(activeDecal.dataset.flipH) || 1,
    flipV: parseFloat(activeDecal.dataset.flipV) || 1,
    imageName: activeDecal.dataset.originalImageName || ''
  };
  flashNotification('Скопировано');
}
function pasteDecal() {
  if (!clipboard) { flashNotification('Буфер пуст'); return; }
  const data = { ...clipboard };
  data.id = 'd_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
  const oL = parseFloat(activeDecal?.style.left) || 100;
  const oT = parseFloat(activeDecal?.style.top) || 100;
  data.left = (oL + 20) + 'px'; data.top = (oT + 20) + 'px';
  data.zIndex = ++decalZIndex;
  const copy = addDecal(null, data);
  if (copy) {
    copy.dataset.originalImageName = (data.imageName || 'decal') + ' (копия)';
    renderDecalListItem(copy);
    setActiveDecal(copy);
  }
}
function duplicateDecal() { if (!activeDecal) return; copyDecal(); pasteDecal(); }
function flipDecal(axis) {
  if (!activeDecal) return;
  if (axis === 'h') activeDecal.dataset.flipH = -(parseFloat(activeDecal.dataset.flipH) || 1);
  else activeDecal.dataset.flipV = -(parseFloat(activeDecal.dataset.flipV) || 1);
  applyTransform(activeDecal);
}
function rotateDecal(delta) {
  if (!activeDecal) return;
  activeDecal.dataset.rotation = (parseFloat(activeDecal.dataset.rotation) || 0) + delta;
  applyTransform(activeDecal);
}
function resetRotation() { if (!activeDecal) return; activeDecal.dataset.rotation = 0; applyTransform(activeDecal); }
function bringToFront() { if (!activeDecal) return; activeDecal.style.zIndex = ++decalZIndex; }
function sendToBack() { if (!activeDecal) return; activeDecal.style.zIndex = 1; }
function moveDecal(dx, dy) {
  if (!activeDecal) return;
  activeDecal.style.left = (parseFloat(activeDecal.style.left) || 0) + dx + 'px';
  activeDecal.style.top = (parseFloat(activeDecal.style.top) || 0) + dy + 'px';
}
function resizeDecal(delta) {
  if (!activeDecal) return;
  const w = activeDecal.offsetWidth, h = activeDecal.offsetHeight;
  const ratio = h / w, nw = Math.max(30, w + delta);
  activeDecal.style.width = nw + 'px';
  activeDecal.style.height = (nw * ratio) + 'px';
}
function clearAllDecals() {
  document.querySelectorAll('.decal').forEach(d => { releaseUrl(d.dataset.objectUrl || ''); d.remove(); });
  if (decalList) decalList.innerHTML = '';
  activeDecal = null; decalZIndex = 10;
}
function clearTemplateDecals() {
  let removed = 0;
  document.querySelectorAll('.decal.tpl-decal').forEach(d => {
    const l = document.getElementById('list_' + d.id);
    if (l) l.remove();
    releaseUrl(d.dataset.objectUrl || '');
    if (activeDecal === d) activeDecal = null;
    d.remove(); removed++;
  });
  return removed;
}

/* ---------- КОНТЕКСТНОЕ МЕНЮ ---------- */
function showContextMenu(x, y) {
  const menu = document.getElementById('context-menu');
  menu.style.display = 'block';
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, window.innerWidth - r.width - 8) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - r.height - 8) + 'px';
}
function hideContextMenu() { document.getElementById('context-menu').style.display = 'none'; }

document.querySelectorAll('#context-menu .cm-item').forEach(item => {
  item.addEventListener('click', () => {
    const a = item.dataset.action;
    if (a === 'copy') copyDecal();
    else if (a === 'duplicate') duplicateDecal();
    else if (a === 'flip-h') flipDecal('h');
    else if (a === 'flip-v') flipDecal('v');
    else if (a === 'rotate-plus') rotateDecal(90);
    else if (a === 'rotate-minus') rotateDecal(-90);
    else if (a === 'reset-rotation') resetRotation();
    else if (a === 'front') bringToFront();
    else if (a === 'back') sendToBack();
    else if (a === 'delete') { if (activeDecal) removeDecal(activeDecal.id); }
    hideContextMenu();
  });
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('#context-menu') && !e.target.closest('.decal')) {
    hideContextMenu();
    if (!e.target.closest('#settings-panel') && !e.target.closest('.fab') &&
        !e.target.closest('.modal-overlay') && !e.target.closest('.shortcut-hint')) {
      document.querySelectorAll('.decal').forEach(d => d.classList.remove('active'));
      activeDecal = null;
    }
  }
});

/* ---------- КНОПКА «ПОДСКАЗКИ» ---------- */
(function setupHelpButton() {
  const btnOpen = document.getElementById('btn-help');
  const btnClose = document.getElementById('btn-help-close');
  const hint = document.getElementById('shortcut-hint');
  if (!btnOpen || !hint) return;
  const toggleHint = () => hint.classList.toggle('visible');
  const hideHint = () => hint.classList.remove('visible');
  btnOpen.addEventListener('click', toggleHint);
  if (btnClose) btnClose.addEventListener('click', hideHint);
  // Esc закрывает панель подсказок (если она открыта)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && hint.classList.contains('visible')) {
      e.stopPropagation();
      hideHint();
    }
  }, true);
})();

/* ---------- ГОРЯЧИЕ КЛАВИШИ (EN + RU) ---------- */
document.addEventListener('keydown', (e) => {
  const ae = document.activeElement;
  const inInput = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA');
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key, kl = k.toLowerCase();

  if (ctrl && (kl === 's' || kl === 'ы')) { e.preventDefault(); exportData(); return; }
  if (inInput) return;
  if (ctrl && (kl === 'c' || kl === 'с') && activeDecal) { e.preventDefault(); copyDecal(); return; }
  if (ctrl && (kl === 'v' || kl === 'м') && clipboard) { e.preventDefault(); pasteDecal(); return; }
  if (ctrl && (kl === 'd' || kl === 'в') && activeDecal) { e.preventDefault(); duplicateDecal(); return; }
  if (!activeDecal) return;

  const step = e.shiftKey ? 10 : 1;
  if (k === 'ArrowLeft')  { e.preventDefault(); moveDecal(-step,0); return; }
  if (k === 'ArrowRight') { e.preventDefault(); moveDecal(step,0); return; }
  if (k === 'ArrowUp')    { e.preventDefault(); moveDecal(0,-step); return; }
  if (k === 'ArrowDown')  { e.preventDefault(); moveDecal(0,step); return; }
  if (kl === 'r' || kl === 'к') { e.preventDefault(); rotateDecal(e.shiftKey ? -90 : 90); return; }
  if (kl === 'f' || kl === 'а') { e.preventDefault(); flipDecal(e.shiftKey ? 'v' : 'h'); return; }
  if (k === '[' || kl === 'х') { e.preventDefault(); resizeDecal(-10); return; }
  if (k === ']' || kl === 'ъ') { e.preventDefault(); resizeDecal(10); return; }
  if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); removeDecal(activeDecal.id); return; }
  if (k === 'Escape') { e.preventDefault(); activeDecal.classList.remove('active'); activeDecal = null; }
});

/* ---------- ЭКСПОРТ / ИМПОРТ ФОРМЫ ---------- */
async function exportData() {
  try {
    const page = document.querySelector('.page');
    const pW = page.offsetWidth || 1122, pH = page.offsetHeight || 793;
    const data = {
      version: '2.1',
      timestamp: new Date().toISOString(),
      colors: readCurrentColors(),
      bgOpacity: document.getElementById('bg-opacity').value,
      activeTemplate: activeTemplateMeta ? { ...activeTemplateMeta } : null,
      fields: {}, decals: []
    };
    document.querySelectorAll('[data-field]').forEach(el => {
      const f = el.dataset.field;
      if (el.tagName === 'INPUT' && el.type === 'text') data.fields[f] = el.value;
      else if (el.tagName === 'TEXTAREA') data.fields[f] = el.value;
      else if (el.classList.contains('cb')) data.fields[f] = el.classList.contains('checked');
    });
    const bgSrc = readBackgroundDataUrl();
    if (bgSrc) { try { data.background = await imageToBase64(bgSrc); } catch (e) {} }

    for (const decal of document.querySelectorAll('.decal')) {
      const img = decal.querySelector('img');
      if (!img || !img.src) continue;
      try {
        data.decals.push({
          id: decal.id,
          imageSrc: await imageToBase64(img.src),
          imageName: decal.dataset.originalImageName || '',
          left: ((parseFloat(decal.style.left)||0)/pW*100)+'%',
          top: ((parseFloat(decal.style.top)||0)/pH*100)+'%',
          width: (decal.offsetWidth/pW*100)+'%',
          height: (decal.offsetHeight/pH*100)+'%',
          rotation: parseFloat(decal.dataset.rotation)||0,
          flipH: parseFloat(decal.dataset.flipH)||1,
          flipV: parseFloat(decal.dataset.flipV)||1,
          zIndex: parseInt(decal.style.zIndex)||10,
          fromTemplate: decal.classList.contains('tpl-decal'),
          templateId: decal.dataset.templateId || '',
          templateName: decal.dataset.templateName || ''
        });
      } catch (e) { console.warn('Export decal skipped:', decal.id); }
    }

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `character-sheet-${Date.now()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    flashNotification('Форма экспортирована');
  } catch (e) { alert('Ошибка экспорта: ' + e.message); }
}

async function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data.version) { alert('Неверный формат файла'); return; }
    if (data.colors) applyColors(data.colors);
    if (data.bgOpacity !== undefined) {
      document.getElementById('bg-opacity').value = data.bgOpacity;
      root.style.setProperty('--bg-opacity', data.bgOpacity);
    }
    setBackgroundSource(data.background || '', data.background ? 'Файл загружен' : 'Файл не выбран', data.background ? '#4ade80' : '#8ab4ff');
    if (data.fields) {
      document.querySelectorAll('[data-field]').forEach(el => {
        const f = el.dataset.field;
        if (data.fields[f] === undefined) return;
        if (el.tagName === 'INPUT' && el.type === 'text') el.value = data.fields[f];
        else if (el.tagName === 'TEXTAREA') el.value = data.fields[f];
        else if (el.classList.contains('cb')) el.classList.toggle('checked', !!data.fields[f]);
      });
    }
    clearAllDecals();
    for (const d of (data.decals || [])) {
      addDecal(null, d, { fromTemplate: !!d.fromTemplate, templateId: d.templateId || '', templateName: d.templateName || '' });
    }
    if (data.activeTemplate && data.activeTemplate.id) {
      const known = await getTemplateById(data.activeTemplate.id);
      setActiveTemplateMeta(known ? { id: known.id, name: known.name } : data.activeTemplate);
    } else setActiveTemplateMeta(null);
    await renderTemplateList();
    flashNotification('Форма импортирована');
  } catch (e) { alert('Ошибка импорта: ' + e.message); }
  event.target.value = '';
}

/* ============================================================
   ШАБЛОНЫ · IndexedDB
   ============================================================ */
const DB_NAME = 'iris_templates_db';
const DB_VERSION = 1;
const STORE_NAME = 'templates';
const ACTIVE_TEMPLATE_KEY = 'iris_active_template_v1';
let dbInstance = null;
let dbOpening = null;
let activeTemplateMeta = null;
let templateUndoState = null;
let undoTimer = null;
let templateSaveInProgress = false;
let templateApplyInProgress = false;
let previewBusy = false;

function openDB() {
  if (dbInstance) return Promise.resolve(dbInstance);
  if (dbOpening) return dbOpening;
  dbOpening = new Promise((resolve, reject) => {
    let request;
    try { request = indexedDB.open(DB_NAME, DB_VERSION); }
    catch (e) { dbOpening = null; reject(e); return; }
    const timer = setTimeout(() => {
      dbOpening = null;
      reject(new Error('База шаблонов не отвечает. Закройте другие вкладки редактора и повторите.'));
    }, 10000);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => {
      clearTimeout(timer);
      dbInstance = request.result;
      dbInstance.onversionchange = () => { try { dbInstance.close(); } catch (e) {} dbInstance = null; };
      dbInstance.onclose = () => { dbInstance = null; };
      dbOpening = null;
      resolve(dbInstance);
    };
    request.onerror = () => { clearTimeout(timer); dbOpening = null; reject(request.error || new Error('Не удалось открыть базу шаблонов')); };
    request.onblocked = () => flashNotification('База занята другой вкладкой — закройте её');
  });
  return dbOpening;
}

async function addTemplate(template) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    let tx;
    try { tx = db.transaction(STORE_NAME, 'readwrite'); } catch (e) { reject(e); return; }
    const req = tx.objectStore(STORE_NAME).put(template);
    req.onerror = () => reject(req.error || new Error('Не удалось записать шаблон'));
    tx.oncomplete = () => resolve(template);
    tx.onerror = () => reject(tx.error || new Error('Транзакция записи прервана'));
    tx.onabort = () => reject(tx.error || new Error('Запись отменена — возможно, не хватает места'));
  });
}

async function getTemplates() {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE_NAME,'readonly').objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch (e) { console.warn('getTemplates:', e); return []; }
}

async function getTemplateById(id) {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE_NAME,'readonly').objectStore(STORE_NAME).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) { console.warn('getTemplateById:', e); return null; }
}

async function deleteTemplateFromDB(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME,'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Удаление отменено'));
  });
}

/* ---------- активный шаблон ---------- */
function readActiveTemplateMeta() {
  try {
    const raw = localStorage.getItem(ACTIVE_TEMPLATE_KEY);
    const p = raw ? JSON.parse(raw) : null;
    return (p && p.id) ? p : null;
  } catch (e) { return null; }
}
function setActiveTemplateMeta(meta) {
  activeTemplateMeta = (meta && meta.id) ? { id: meta.id, name: meta.name || 'Шаблон' } : null;
  try {
    if (activeTemplateMeta) localStorage.setItem(ACTIVE_TEMPLATE_KEY, JSON.stringify(activeTemplateMeta));
    else localStorage.removeItem(ACTIVE_TEMPLATE_KEY);
  } catch (e) {}
  updateActiveTemplateUI();
}
function updateActiveTemplateUI() {
  const box = document.getElementById('tpl-active');
  const nameEl = document.getElementById('tpl-active-name');
  const btn = document.getElementById('tpl-clear-btn');
  if (!box || !nameEl) return;
  if (activeTemplateMeta) {
    box.classList.remove('is-empty');
    nameEl.textContent = activeTemplateMeta.name;
    nameEl.title = activeTemplateMeta.name;
    if (btn) btn.style.display = '';
  } else {
    box.classList.add('is-empty');
    nameEl.textContent = 'Не применён';
    nameEl.title = '';
    if (btn) btn.style.display = 'none';
  }
  document.querySelectorAll('.template-card').forEach(c => {
    c.classList.toggle('is-active', !!activeTemplateMeta && c.dataset.id === activeTemplateMeta.id);
  });
}

/* ---------- отрисовка структуры для превью ---------- */
function drawBarWithOutline(ctx,x,y,w,h,color,label,fontSize,textColor) {
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fillRect(x-1,y-1,w+2,h+2);
  ctx.fillStyle = color;
  ctx.fillRect(x,y,w,h);
  if (label && fontSize) {
    ctx.font = `bold ${fontSize}px Inter, Arial, sans-serif`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = textColor || '#fff';
    ctx.fillText(label, x+3, y+h/2);
  }
}
function drawField(ctx,x,y,w,h,borderColor) {
  ctx.strokeStyle = borderColor; ctx.lineWidth = 0.8; ctx.strokeRect(x,y,w,h);
}
function drawCheckbox(ctx,x,y,size,borderColor) {
  ctx.strokeStyle = borderColor; ctx.lineWidth = 0.8; ctx.strokeRect(x,y,size,size);
}
function drawFormStructure(ctx,W,H,colors) {
  const c = colors || DEFAULT_COLORS;
  const scale = W/297, mm = v => v*scale;
  const labelSize = mm(3.5), smallLabel = mm(2.8);
  const ht = mm(12);
  drawField(ctx, mm(10), ht, mm(30), mm(22), c.border);
  drawBarWithOutline(ctx, mm(45), ht, mm(165), mm(5), c.headerBg, 'ПЕРСОНАЖ', labelSize, c.headerText);
  drawField(ctx, mm(45), ht+mm(6), mm(165), mm(6), c.border);
  drawField(ctx, mm(45), ht+mm(13), mm(165), mm(8), c.border);
  drawBarWithOutline(ctx, mm(215), ht, mm(30), mm(5), c.headerBg, 'ЦВЕТКИ', smallLabel, c.headerText);
  drawField(ctx, mm(215), ht+mm(6), mm(30), mm(15), c.border);
  ctx.strokeStyle = 'rgba(200,200,200,0.6)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(mm(10), ht+mm(26)); ctx.lineTo(mm(287), ht+mm(26)); ctx.stroke();

  const bt = ht + mm(32);
  drawBarWithOutline(ctx, mm(10), bt, mm(130), mm(5), c.headerBg, 'АСПЕКТЫ', labelSize, c.headerText);
  for (let i=0;i<5;i++) drawField(ctx, mm(10), bt+mm(7)+i*mm(7), mm(130), mm(6), c.border);
  drawBarWithOutline(ctx, mm(145), bt, mm(142), mm(5), c.headerBg, 'НАВЫКИ', labelSize, c.headerText);
  for (let i=0;i<5;i++) {
    const ry = bt+mm(7)+i*mm(7);
    drawField(ctx, mm(145), ry, mm(40), mm(6), c.border);
    for (let j=0;j<5;j++) drawField(ctx, mm(190)+j*mm(19), ry, mm(18), mm(6), c.border);
  }
  const bo = bt + mm(45);
  drawBarWithOutline(ctx, mm(10), bo, mm(136), mm(5), c.headerBg, 'ДОПОЛНЕНИЯ', labelSize, c.headerText);
  drawBarWithOutline(ctx, mm(151), bo, mm(136), mm(5), c.headerBg, 'ТРЮКИ', labelSize, c.headerText);
  drawField(ctx, mm(10), bo+mm(7), mm(136), mm(30), c.border);
  drawField(ctx, mm(151), bo+mm(7), mm(136), mm(30), c.border);

  const ft = bo + mm(42);
  drawBarWithOutline(ctx, mm(10), ft, mm(70), mm(5), c.headerBg, 'ФИЗ. СТРЕСС', smallLabel, c.headerText);
  for (let i=0;i<4;i++) drawCheckbox(ctx, mm(12)+i*mm(17), ft+mm(7), mm(5), c.border);
  drawBarWithOutline(ctx, mm(10), ft+mm(12), mm(70), mm(5), c.headerBg, 'МЕНТАЛ. СТРЕСС', smallLabel, c.headerText);
  for (let i=0;i<4;i++) drawCheckbox(ctx, mm(12)+i*mm(17), ft+mm(19), mm(5), c.border);
  drawBarWithOutline(ctx, mm(151), ft, mm(136), mm(5), c.headerBg, 'ПОСЛЕДСТВИЯ', labelSize, c.headerText);
  for (let i=0;i<3;i++) drawField(ctx, mm(151), ft+mm(7)+i*mm(7), mm(136), mm(6), c.border);
}

function drawDecalsOnCanvas(ctx,W,H) {
  const page = document.querySelector('.page');
  const pW = (page && page.offsetWidth) || 1122;
  const pH = (page && page.offsetHeight) || 793;
  const sx = W/pW, sy = H/pH;
  document.querySelectorAll('.decal').forEach(decal => {
    const img = decal.querySelector('img');
    if (!img || !img.src || !img.complete || img.naturalWidth === 0) return;
    const l = (parseFloat(decal.style.left)||0)*sx;
    const t = (parseFloat(decal.style.top)||0)*sy;
    const w = decal.offsetWidth*sx, h = decal.offsetHeight*sy;
    if (w<=0||h<=0) return;
    ctx.save();
    ctx.translate(l+w/2, t+h/2);
    ctx.rotate((parseFloat(decal.dataset.rotation)||0)*Math.PI/180);
    ctx.scale(parseFloat(decal.dataset.flipH)||1, parseFloat(decal.dataset.flipV)||1);
    try { ctx.drawImage(img, -w/2, -h/2, w, h); } catch (e) {}
    ctx.restore();
  });
}

// Превью текущего листа. ВСЕГДА завершается.
async function generateTemplateThumbnail() {
  const canvas = document.getElementById('template-canvas');
  if (!canvas) return '';
  canvas.width = 400; canvas.height = 283;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = '#fff'; ctx.fillRect(0,0,W,H);

  const bgSrc = readBackgroundDataUrl();
  if (bgSrc) {
    const img = await loadImageSafe(bgSrc, 8000);
    if (img) {
      ctx.save();
      const a = parseFloat(document.getElementById('bg-opacity').value);
      ctx.globalAlpha = isNaN(a) ? 1 : a;
      drawCover(ctx, img, W, H);
      ctx.restore();
    }
  }
  drawFormStructure(ctx, W, H, readCurrentColors());
  drawDecalsOnCanvas(ctx, W, H);
  try { return canvas.toDataURL('image/png'); } catch (e) { return ''; }
}

/* ---------- создание шаблона ---------- */
async function showCreateTemplateModal() {
  const modal = document.getElementById('template-modal');
  modal.classList.add('active');
  const input = document.getElementById('template-name-input');
  input.value = '';
  setTemplateSaveProgress('Готовим предпросмотр…');
  await generateTemplateThumbnail();
  setTemplateSaveProgress('');
  input.focus();
}
function closeTemplateModal() {
  if (templateSaveInProgress) return;
  document.getElementById('template-modal').classList.remove('active');
}
function setTemplateSaveProgress(text) {
  const el = document.getElementById('template-save-status');
  if (el) el.textContent = text || '';
}

async function confirmCreateTemplate() {
  if (templateSaveInProgress) return;
  const nameInput = document.getElementById('template-name-input');
  const name = nameInput.value.trim();
  if (!name) { alert('Введите название шаблона'); nameInput.focus(); return; }

  templateSaveInProgress = true;
  const saveBtn = document.querySelector('#template-modal .btn-save');
  const cancelBtn = document.querySelector('#template-modal .btn-cancel');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Сохранение…'; }
  if (cancelBtn) cancelBtn.disabled = true;
  setTemplateSaveProgress('Готовим предпросмотр…');

  try {
    await generateTemplateThumbnail();
    const canvas = document.getElementById('template-canvas');
    let thumbBlob = null;
    try { thumbBlob = dataUrlToBlob(canvas.toDataURL('image/png')); } catch (e) {}

    const template = {
      id: 'tpl_' + Date.now(),
      name, type: 'template', version: '2.1',
      createdAt: new Date().toISOString(),
      thumbnail: thumbBlob || '',
      colors: readCurrentColors(),
      bgOpacity: document.getElementById('bg-opacity').value,
      background: null,
      decals: []
    };

    setTemplateSaveProgress('Сжимаем фон…');
    const bgSrc = readBackgroundDataUrl();
    if (bgSrc) template.background = await compressToBlob(bgSrc, 1600);

    const page = document.querySelector('.page');
    const pW = page.offsetWidth || 1122, pH = page.offsetHeight || 793;
    const els = Array.from(document.querySelectorAll('.decal'));
    let skipped = 0;

    for (let i=0;i<els.length;i++) {
      const decal = els[i];
      const img = decal.querySelector('img');
      if (!img || !img.src) continue;
      setTemplateSaveProgress(`Декали: ${i+1} / ${els.length}`);
      const blob = await compressToBlob(img.src, 900);
      if (!blob) { skipped++; continue; }
      template.decals.push({
        imageBlob: blob,
        imageName: decal.dataset.originalImageName || '',
        left: ((parseFloat(decal.style.left)||0)/pW*100)+'%',
        top: ((parseFloat(decal.style.top)||0)/pH*100)+'%',
        width: (decal.offsetWidth/pW*100)+'%',
        height: (decal.offsetHeight/pH*100)+'%',
        rotation: parseFloat(decal.dataset.rotation)||0,
        flipH: parseFloat(decal.dataset.flipH)||1,
        flipV: parseFloat(decal.dataset.flipV)||1,
        zIndex: parseInt(decal.style.zIndex)||10
      });
    }

    setTemplateSaveProgress('Записываем в библиотеку…');
    await addTemplate(template);
    templateSaveInProgress = false;
    closeTemplateModal();
    await renderTemplateList();
    flashNotification(`Шаблон «${name}» сохранён · декалей: ${template.decals.length}` + (skipped ? ` (пропущено: ${skipped})` : ''));
  } catch (e) {
    console.error(e);
    alert(e && e.name === 'QuotaExceededError'
      ? 'Не хватает места в хранилище браузера. Удалите старые шаблоны и повторите.'
      : 'Ошибка сохранения: ' + (e && e.message ? e.message : e));
  } finally {
    templateSaveInProgress = false;
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Создать'; }
    if (cancelBtn) cancelBtn.disabled = false;
    setTemplateSaveProgress('');
  }
}

/* ---------- библиотека шаблонов ---------- */
async function renderTemplateList() {
  const list = document.getElementById('templates-list');
  if (!list) return;
  const templates = await getTemplates();
  templates.sort((a,b) => String(b.createdAt||'').localeCompare(String(a.createdAt||'')));

  (list._thumbUrls || []).forEach(u => releaseUrl(u));
  list._thumbUrls = [];

  if (!templates.length) {
    list.innerHTML = '<div class="templates-empty">Нет сохранённых шаблонов</div>';
    updateActiveTemplateUI();
    return;
  }
  list.innerHTML = '';
  templates.forEach(t => {
    const card = document.createElement('div');
    card.className = 'template-card';
    card.dataset.id = t.id;
    card.tabIndex = 0;
    card.title = `${t.name} — нажмите для предпросмотра`;
    let thumb = '';
    if (t.thumbnail instanceof Blob) { thumb = trackUrl(URL.createObjectURL(t.thumbnail)); list._thumbUrls.push(thumb); }
    else if (typeof t.thumbnail === 'string') thumb = t.thumbnail;
    card.innerHTML = `
      <span class="tpl-badge">✓ активен</span>
      <img src="${escapeHtml(thumb)}" class="thumb" alt="${escapeHtml(t.name)}">
      <div class="name">${escapeHtml(t.name)}</div>
      <div class="actions">
        <button class="btn-apply-template" title="Применить (заменит текущий)">✓</button>
        <button class="btn-delete-template" title="Удалить">×</button>
      </div>`;
    card.addEventListener('click', () => showTemplatePreview(t.id));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showTemplatePreview(t.id); }
    });
    card.querySelector('.btn-apply-template').addEventListener('click', (e) => { e.stopPropagation(); applyTemplate(t.id); });
    card.querySelector('.btn-delete-template').addEventListener('click', (e) => { e.stopPropagation(); deleteTemplate(t.id); });
    list.appendChild(card);
  });
  updateActiveTemplateUI();
}

async function deleteTemplate(id) {
  const t = await getTemplateById(id);
  if (!confirm(`Удалить шаблон «${t ? t.name : id}» из библиотеки?\nПрименённое оформление на листе останется.`)) return;
  try {
    await deleteTemplateFromDB(id);
    await renderTemplateList();
    flashNotification('Шаблон удалён');
  } catch (e) { alert('Ошибка удаления: ' + e.message); }
}

/* ---------- снимок для отмены ---------- */
async function captureStyleSnapshot() {
  const snap = {
    meta: activeTemplateMeta ? { ...activeTemplateMeta } : null,
    colors: readCurrentColors(),
    bgOpacity: document.getElementById('bg-opacity').value,
    background: null, decals: []
  };
  const bg = readBackgroundDataUrl();
  if (bg) { try { snap.background = await imageToBase64(bg); } catch (e) {} }
  const page = document.querySelector('.page');
  const pW = page.offsetWidth||1122, pH = page.offsetHeight||793;
  for (const d of document.querySelectorAll('.decal')) {
    const img = d.querySelector('img');
    if (!img || !img.src) continue;
    try {
      snap.decals.push({
        imageSrc: await imageToBase64(img.src),
        imageName: d.dataset.originalImageName || '',
        left: d.style.left, top: d.style.top,
        width: (d.offsetWidth/pW*100)+'%', height: (d.offsetHeight/pH*100)+'%',
        rotation: parseFloat(d.dataset.rotation)||0,
        flipH: parseFloat(d.dataset.flipH)||1, flipV: parseFloat(d.dataset.flipV)||1,
        zIndex: parseInt(d.style.zIndex)||10,
        fromTemplate: d.classList.contains('tpl-decal'),
        templateId: d.dataset.templateId||'', templateName: d.dataset.templateName||''
      });
    } catch (e) {}
  }
  return snap;
}
function showUndoToast(text) {
  const toast = document.getElementById('undo-toast');
  const label = document.getElementById('undo-text');
  if (!toast || !label) return;
  label.textContent = text;
  toast.classList.add('visible');
  clearTimeout(undoTimer);
  undoTimer = setTimeout(hideUndoToast, 8000);
}
function hideUndoToast() {
  const t = document.getElementById('undo-toast');
  if (t) t.classList.remove('visible');
  clearTimeout(undoTimer);
  templateUndoState = null;
}
async function undoTemplateChange() {
  if (!templateUndoState) { hideUndoToast(); return; }
  const snap = templateUndoState;
  hideUndoToast();
  applyColors(snap.colors);
  document.getElementById('bg-opacity').value = snap.bgOpacity;
  root.style.setProperty('--bg-opacity', snap.bgOpacity);
  setBackgroundSource(snap.background||'', snap.background?'Файл загружен':'Файл не выбран', snap.background?'#4ade80':'#8ab4ff');
  clearAllDecals();
  for (const d of snap.decals) addDecal(null, d, { fromTemplate: d.fromTemplate, templateId: d.templateId, templateName: d.templateName });
  setActiveTemplateMeta(snap.meta);
  await renderTemplateList();
  flashNotification('Изменение отменено');
}

/* ---------- применение = ЗАМЕНА ---------- */
async function applyTemplate(id) {
  if (templateApplyInProgress) return;
  templateApplyInProgress = true;
  try {
    const template = await getTemplateById(id);
    if (!template) { flashNotification('Шаблон не найден'); return; }
    templateUndoState = await captureStyleSnapshot();

    clearTemplateDecals();
    applyColors(template.colors);
    const op = (template.bgOpacity !== undefined && template.bgOpacity !== null) ? template.bgOpacity : 1;
    document.getElementById('bg-opacity').value = op;
    root.style.setProperty('--bg-opacity', op);

    if (template.background) {
      const url = template.background instanceof Blob ? trackUrl(URL.createObjectURL(template.background)) : template.background;
      setBackgroundSource(url, `Фон: ${template.name}`, '#a78bfa');
    } else setBackgroundSource('', 'Файл не выбран', '#8ab4ff');
    document.getElementById('bg-upload').value = '';

    const page = document.querySelector('.page');
    const pW = page.offsetWidth||1122, pH = page.offsetHeight||793;
    let placed = 0;
    for (const d of (template.decals || [])) {
      if (!d.imageBlob && !d.imageSrc) continue;
      addDecal(null, {
        ...d,
        id: 'd_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
        left: ((parseFloat(d.left)||0)/100*pW)+'px',
        top: ((parseFloat(d.top)||0)/100*pH)+'px',
        width: ((parseFloat(d.width)||10)/100*pW)+'px',
        height: ((parseFloat(d.height)||10)/100*pH)+'px',
        zIndex: ++decalZIndex
      }, { fromTemplate: true, templateId: template.id, templateName: template.name });
      placed++;
    }
    setActiveTemplateMeta({ id: template.id, name: template.name });
    await renderTemplateList();
    showUndoToast(`Шаблон «${template.name}» применён · декалей: ${placed}`);
    flashNotification('Шаблон применён (предыдущий заменён)');
  } catch (e) {
    console.error(e);
    alert('Не удалось применить шаблон: ' + (e && e.message ? e.message : e));
  } finally { templateApplyInProgress = false; }
}

async function clearTemplate() {
  if (!activeTemplateMeta && !document.querySelectorAll('.decal.tpl-decal').length) {
    flashNotification('Шаблон не применён'); return;
  }
  templateUndoState = await captureStyleSnapshot();
  const removed = clearTemplateDecals();
  applyColors(DEFAULT_COLORS);
  document.getElementById('bg-opacity').value = 1;
  root.style.setProperty('--bg-opacity', 1);
  setBackgroundSource('', 'Файл не выбран', '#8ab4ff');
  document.getElementById('bg-upload').value = '';
  setActiveTemplateMeta(null);
  await renderTemplateList();
  showUndoToast(`Шаблон снят · удалено декалей: ${removed}`);
  flashNotification('Оформление шаблона снято');
}

/* ---------- предпросмотр ---------- */
async function drawPreviewDecals(decals, W, H, data) {
  const canvas = document.getElementById('preview-canvas');
  if (!canvas) return;
  canvas.width = 800; canvas.height = 566;
  const ctx = canvas.getContext('2d');
  const CW = canvas.width, CH = canvas.height;
  ctx.fillStyle = '#fff'; ctx.fillRect(0,0,CW,CH);
  const d = data || {};
  const owned = [];
  const srcOf = (v) => {
    if (!v) return '';
    if (typeof v === 'string') return v;
    if (v instanceof Blob) { const u = URL.createObjectURL(v); owned.push(u); return u; }
    return '';
  };
  try {
    const bg = srcOf(d.background);
    if (bg) {
      const img = await loadImageSafe(bg, 8000);
      if (img) {
        ctx.save();
        const a = parseFloat(d.bgOpacity);
        ctx.globalAlpha = isNaN(a) ? 1 : a;
        drawCover(ctx, img, CW, CH);
        ctx.restore();
      }
    }
    drawFormStructure(ctx, CW, CH, d.colors || DEFAULT_COLORS);
    for (const dec of (decals || [])) {
      const src = srcOf(dec.imageBlob) || dec.imageSrc || '';
      if (!src) continue;
      const img = await loadImageSafe(src, 8000);
      if (!img) continue;
      const l = (parseFloat(dec.left)||0)/100*CW;
      const t = (parseFloat(dec.top)||0)/100*CH;
      const w = (parseFloat(dec.width)||0)/100*CW;
      const h = (parseFloat(dec.height)||0)/100*CH;
      if (w<=0||h<=0) continue;
      ctx.save();
      ctx.translate(l+w/2, t+h/2);
      ctx.rotate((parseFloat(dec.rotation)||0)*Math.PI/180);
      ctx.scale(parseFloat(dec.flipH)||1, parseFloat(dec.flipV)||1);
      ctx.drawImage(img, -w/2, -h/2, w, h);
      ctx.restore();
    }
  } finally {
    owned.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) {} });
  }
}

async function showTemplatePreview(id) {
  if (previewBusy) return;
  previewBusy = true;
  const card = document.querySelector(`.template-card[data-id="${id}"]`);
  if (card) card.classList.add('is-busy');
  try {
    const template = await getTemplateById(id);
    if (!template) { flashNotification('Шаблон не найден'); return; }
    const modal = document.getElementById('preview-modal');
    document.getElementById('preview-title').textContent = template.name;
    document.getElementById('preview-info').innerHTML = '<span style="color:#8f97a8">Отрисовка предпросмотра…</span>';
    modal.classList.add('active');
    await drawPreviewDecals(template.decals, 800, 566, {
      colors: template.colors, background: template.background, bgOpacity: template.bgOpacity
    });
    const isActive = !!activeTemplateMeta && activeTemplateMeta.id === template.id;
    const created = template.createdAt ? new Date(template.createdAt).toLocaleString('ru-RU') : '—';
    document.getElementById('preview-info').innerHTML = `
      <strong>Шаблон:</strong> ${escapeHtml(template.name)}${isActive ? ' · <span style="color:#a78bfa">активен</span>' : ''}<br>
      <strong>Создан:</strong> ${created}<br>
      <strong>Декалей:</strong> ${(template.decals||[]).length}<br>
      <span style="color:#8f97a8">Применение заменит текущее оформление шаблона. Текст персонажа и ваши декали сохранятся.</span>`;
    const btn = document.getElementById('preview-apply-btn');
    btn.textContent = isActive ? 'Применить заново' : 'Применить шаблон';
    btn.onclick = () => { closePreviewModal(); applyTemplate(id); };
  } catch (e) {
    console.error(e);
    flashNotification('Не удалось показать предпросмотр');
  } finally {
    previewBusy = false;
    if (card) card.classList.remove('is-busy');
  }
}
function closePreviewModal() { document.getElementById('preview-modal').classList.remove('active'); }

document.querySelectorAll('.modal-overlay').forEach(m => {
  m.addEventListener('click', (e) => {
    if (e.target !== m) return;
    if (m.id === 'template-modal' && templateSaveInProgress) return;
    m.classList.remove('active');
  });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (templateSaveInProgress) return;
    document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
  }
  if (e.key === 'Enter' && document.getElementById('template-modal').classList.contains('active')) {
    if (document.activeElement === document.getElementById('template-name-input')) {
      e.preventDefault(); confirmCreateTemplate();
    }
  }
});

/* ============================================================
   МАСШТАБИРОВАНИЕ + ПЕРЕМЕЩЕНИЕ ЛИСТА (мобильные)
   ============================================================ */
let currentZoom = 1, baseScale = 1, pageOffsetX = 0, pageOffsetY = 0;
let isPinching = false, pinchStartDistance = 0, pinchStartZoom = 1;
let isDraggingPage = false, dragStartX = 0, dragStartY = 0, dragStartOffsetX = 0, dragStartOffsetY = 0;
let lastTapTime = 0, lastTapX = 0, lastTapY = 0, zoomHideTimer = null;

const isTouch = () => window.matchMedia('(hover: none) and (pointer: coarse)').matches;

function showZoomIndicator() {
  const el = document.getElementById('zoom-indicator');
  if (!el) return;
  el.textContent = Math.round(currentZoom*100) + '%';
  el.classList.add('visible');
  clearTimeout(zoomHideTimer);
  zoomHideTimer = setTimeout(() => el.classList.remove('visible'), 1500);
}
function getPinchDistance(t) {
  const dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY;
  return Math.sqrt(dx*dx + dy*dy);
}
function isTouchOnDecal(e) { return !!e.target.closest('.decal'); }
function isTouchOnFixedUI(e) {
  const t = e.target;
  return !!(t.closest('#settings-panel') || t.closest('.fab-container') ||
            t.closest('.modal-overlay') || t.closest('.shortcut-hint') ||
            t.closest('#context-menu') || t.closest('#undo-toast'));
}
function isTouchOnInteractive(e) {
  return !!e.target.closest('input, textarea, select, button, a, [contenteditable], .cb');
}
function applyPageTransform() {
  const page = document.querySelector('.page');
  if (!page) return;
  page.style.transformOrigin = '0 0';
  page.style.transform = `translate(${pageOffsetX}px, ${pageOffsetY}px) scale(${baseScale*currentZoom})`;
  showZoomIndicator();
}
function updateBaseScale() {
  const page = document.querySelector('.page');
  if (!page) return;
  if (!isTouch()) {
    baseScale = 1; currentZoom = 1; pageOffsetX = 0; pageOffsetY = 0;
    page.style.transform = 'none';
    page.style.transformOrigin = 'top center';
    page.style.position = 'relative';
    page.style.top = 'auto'; page.style.left = 'auto';
    page.style.margin = '0 auto 20px auto';
    page.style.width = '297mm';
    return;
  }
  const mmToPx = 3.7795275591;
  const pW = 297*mmToPx, pH = 210*mmToPx;
  const vw = window.innerWidth, vh = window.innerHeight;
  baseScale = Math.min(vw/pW, vh/pH, 1);
  pageOffsetX = (vw - pW*baseScale)/2;
  pageOffsetY = (vh - pH*baseScale)/2;
  currentZoom = 1;
  applyPageTransform();
}

document.addEventListener('touchstart', (e) => {
  if (isTouchOnFixedUI(e)) return;
  if (e.touches.length === 2 && !isTouchOnDecal(e)) {
    isPinching = true;
    pinchStartDistance = getPinchDistance(e.touches);
    pinchStartZoom = currentZoom;
    isDraggingPage = false;
    e.preventDefault();
    return;
  }
  if (e.touches.length === 1 && !isTouchOnDecal(e) && !isTouchOnInteractive(e)) {
    isDraggingPage = true;
    dragStartX = e.touches[0].clientX; dragStartY = e.touches[0].clientY;
    dragStartOffsetX = pageOffsetX; dragStartOffsetY = pageOffsetY;
    e.preventDefault();
  }
}, { passive: false });

document.addEventListener('touchmove', (e) => {
  if (isTouchOnFixedUI(e)) return;
  if (isPinching && e.touches.length === 2) {
    e.preventDefault();
    const ratio = getPinchDistance(e.touches)/pinchStartDistance;
    currentZoom = Math.max(0.3, Math.min(4, pinchStartZoom*ratio));
    applyPageTransform();
    return;
  }
  if (isDraggingPage && e.touches.length === 1) {
    e.preventDefault();
    pageOffsetX = dragStartOffsetX + (e.touches[0].clientX - dragStartX);
    pageOffsetY = dragStartOffsetY + (e.touches[0].clientY - dragStartY);
    applyPageTransform();
  }
}, { passive: false });

document.addEventListener('touchend', (e) => {
  if (e.touches.length < 2) isPinching = false;
  if (e.touches.length === 0) {
    const wasDragging = isDraggingPage;
    isDraggingPage = false;
    const t = e.changedTouches[0];
    if (!t) return;
    const now = Date.now();
    const dx = t.clientX - lastTapX, dy = t.clientY - lastTapY;
    if (!wasDragging && now - lastTapTime < 300 && Math.abs(dx) < 30 && Math.abs(dy) < 30) {
      if (!isTouchOnDecal(e) && !isTouchOnFixedUI(e) && !isTouchOnInteractive(e)) {
        currentZoom = currentZoom > 1.1 ? 1 : 2;
        applyPageTransform();
      }
    }
    lastTapTime = now; lastTapX = t.clientX; lastTapY = t.clientY;
  }
});

window.addEventListener('resize', updateBaseScale);
window.addEventListener('orientationchange', () => setTimeout(updateBaseScale, 200));

/* ---------- СТАРТ ---------- */
(async function init() {
  updateBaseScale();
  activeTemplateMeta = readActiveTemplateMeta();
  updateActiveTemplateUI();
  await renderTemplateList();
  if (activeTemplateMeta) {
    const exists = await getTemplateById(activeTemplateMeta.id);
    if (!exists) { setActiveTemplateMeta(null); await renderTemplateList(); }
  }
})();
window.addEventListener('load', updateBaseScale);
