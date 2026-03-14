/**
 * Visual MCP — Client Application
 *
 * Handles canvas rendering, element interaction (select, drag, edit),
 * timeline visualization, and WebSocket connection to the server.
 */

// --- State ---
let scene = { elements: [], width: 1920, height: 1080, duration: 5000, currentTime: 0, playing: false, background: '#0a0a0f' };
let selectedId = null;
let editMode = false;
let isDragging = false;
let dragStartX = 0, dragStartY = 0;
let elStartX = 0, elStartY = 0;
let canvasScale = 1;
let ws = null;
let animFrame = null;
let animStartTime = 0;

// --- DOM ---
const canvas = document.getElementById('canvas');
const canvasWrapper = document.getElementById('canvas-wrapper');
const elementList = document.getElementById('element-list');
const selectionInfo = document.getElementById('selection-info');
const propsSection = document.getElementById('props-section');
const propsGrid = document.getElementById('props-grid');
const adapterBadge = document.getElementById('adapter-badge');
const connectionDot = document.getElementById('connection-dot');
const timeDisplay = document.getElementById('time-display');
const btnPlay = document.getElementById('btn-play');
const btnReset = document.getElementById('btn-reset');
const btnEditMode = document.getElementById('btn-edit-mode');
const btnZoomFit = document.getElementById('btn-zoom-fit');
const userInput = document.getElementById('user-input');
const btnSend = document.getElementById('btn-send');
const timelineRuler = document.getElementById('timeline-ruler');
const timelineTracks = document.getElementById('timeline-tracks');
const timelinePlayhead = document.getElementById('timeline-playhead');

// --- WebSocket ---
function connectWs() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}/ws`);

  ws.onopen = () => {
    connectionDot.classList.add('connected');
  };

  ws.onclose = () => {
    connectionDot.classList.remove('connected');
    setTimeout(connectWs, 2000);
  };

  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      handleMessage(msg);
    } catch {}
  };
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'init':
      adapterBadge.textContent = msg.data.adapter || '—';
      if (msg.data.scene) {
        scene = { ...scene, ...msg.data.scene };
        renderAll();
      }
      break;
    case 'scene:update':
      scene = { ...scene, ...msg.data };
      renderAll();
      break;
    case 'command':
      handleCommand(msg.data);
      break;
  }
}

function handleCommand(cmd) {
  switch (cmd.command) {
    case 'timeline':
      if (cmd.args.action === 'play') startAnimation();
      else if (cmd.args.action === 'pause') stopAnimation();
      else if (cmd.args.action === 'seek') seekTo(cmd.args.time || 0);
      else if (cmd.args.action === 'reset') { seekTo(0); stopAnimation(); }
      break;
  }
}

// --- Canvas Rendering ---
function renderAll() {
  renderCanvas();
  renderElementList();
  renderTimeline();
  updateTimeDisplay();
  fitCanvas();
}

function renderCanvas() {
  canvas.style.width = scene.width + 'px';
  canvas.style.height = scene.height + 'px';
  canvas.style.background = scene.background || '#0a0a0f';

  // Clear
  canvas.innerHTML = '';

  // Render elements
  for (const el of (scene.elements || [])) {
    const dom = createElementDom(el);
    canvas.appendChild(dom);
  }
}

function createElementDom(el) {
  const div = document.createElement('div');
  div.className = 'canvas-element';
  div.dataset.id = el.id;
  div.dataset.type = el.type;

  const p = el.props || {};

  // Position
  div.style.left = (p.x || 0) + 'px';
  div.style.top = (p.y || 0) + 'px';
  if (p.width) div.style.width = p.width + 'px';
  if (p.height) div.style.height = p.height + 'px';
  if (p.zIndex) div.style.zIndex = p.zIndex;
  if (p.opacity !== undefined) div.style.opacity = p.opacity;
  if (p.rotation) div.style.transform = `rotate(${p.rotation}deg)`;

  // Type-specific rendering
  switch (el.type) {
    case 'text':
      div.textContent = p.text || '';
      div.style.fontSize = (p.fontSize || 48) + 'px';
      div.style.fontFamily = p.fontFamily || 'Inter, system-ui, sans-serif';
      div.style.color = p.color || '#ffffff';
      if (p.backgroundColor) div.style.backgroundColor = p.backgroundColor;
      div.style.lineHeight = '1.2';
      div.style.whiteSpace = 'pre-wrap';
      break;

    case 'shape':
      div.style.backgroundColor = p.color || p.gradient || '#f97316';
      if (p.gradient) div.style.background = p.gradient;
      if (p.shape === 'circle' || p.shape === 'ellipse') {
        div.style.borderRadius = '50%';
      } else {
        div.style.borderRadius = (p.borderRadius || 0) + 'px';
      }
      if (!p.width) div.style.width = '100px';
      if (!p.height) div.style.height = '100px';
      break;

    case 'image':
      if (p.src) {
        const img = document.createElement('img');
        img.src = p.src;
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        img.draggable = false;
        div.appendChild(img);
      }
      break;

    case 'svg':
      if (p.svgContent) {
        div.innerHTML = p.svgContent;
      }
      break;
  }

  // Common styles
  if (p.blur) div.style.filter = `blur(${p.blur}px)`;
  if (p.shadow) div.style.boxShadow = p.shadow;

  // Selection state
  if (el.id === selectedId) {
    div.classList.add('selected');
  }

  // Apply keyframe interpolation at current time
  applyKeyframes(div, el);

  // Interaction handlers
  div.addEventListener('mousedown', (e) => onElementMouseDown(e, el));
  div.addEventListener('click', (e) => onElementClick(e, el));
  div.addEventListener('dblclick', (e) => onElementDblClick(e, el));

  // Touch
  div.addEventListener('touchstart', (e) => onElementTouchStart(e, el), { passive: false });

  return div;
}

function applyKeyframes(dom, el) {
  if (!el.keyframes || el.keyframes.length === 0) return;

  const t = scene.currentTime || 0;
  const kfs = el.keyframes;

  // Find the two keyframes we're between
  let before = null, after = null;
  for (let i = 0; i < kfs.length; i++) {
    if (kfs[i].time <= t) before = kfs[i];
    if (kfs[i].time > t && !after) after = kfs[i];
  }

  if (!before && !after) return;
  if (!before) {
    // Before first keyframe — use element defaults
    return;
  }
  if (!after) {
    // After last keyframe — apply last keyframe props
    applyProps(dom, before.props);
    return;
  }

  // Interpolate between before and after
  const progress = (t - before.time) / (after.time - before.time);
  const eased = easeProgress(progress, after.easing || 'ease');

  const interpolated = {};
  for (const key of Object.keys(after.props)) {
    const fromVal = before.props[key] ?? el.props[key];
    const toVal = after.props[key];

    if (typeof fromVal === 'number' && typeof toVal === 'number') {
      interpolated[key] = fromVal + (toVal - fromVal) * eased;
    } else {
      // Non-numeric: snap at midpoint
      interpolated[key] = progress < 0.5 ? fromVal : toVal;
    }
  }

  applyProps(dom, interpolated);
}

function applyProps(dom, props) {
  if (props.x !== undefined) dom.style.left = props.x + 'px';
  if (props.y !== undefined) dom.style.top = props.y + 'px';
  if (props.opacity !== undefined) dom.style.opacity = props.opacity;
  if (props.rotation !== undefined) dom.style.transform = `rotate(${props.rotation}deg)`;
  if (props.color !== undefined) {
    if (dom.dataset.type === 'text') dom.style.color = props.color;
    else dom.style.backgroundColor = props.color;
  }
  if (props.fontSize !== undefined) dom.style.fontSize = props.fontSize + 'px';
  if (props.width !== undefined) dom.style.width = props.width + 'px';
  if (props.height !== undefined) dom.style.height = props.height + 'px';
  if (props.blur !== undefined) dom.style.filter = `blur(${props.blur}px)`;
  if (props.scale !== undefined) {
    const rot = props.rotation || 0;
    dom.style.transform = `rotate(${rot}deg) scale(${props.scale})`;
  }
}

function easeProgress(t, easing) {
  switch (easing) {
    case 'linear': return t;
    case 'ease-in': return t * t;
    case 'ease-out': return t * (2 - t);
    case 'ease-in-out': return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    case 'ease':
    default: return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }
}

// --- Element Interaction ---
function onElementClick(e, el) {
  e.stopPropagation();
  selectElement(el.id);
}

function onElementMouseDown(e, el) {
  if (el.id !== selectedId) return;
  e.preventDefault();
  e.stopPropagation();

  isDragging = true;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  elStartX = el.props.x || 0;
  elStartY = el.props.y || 0;

  const dom = canvas.querySelector(`[data-id="${el.id}"]`);
  if (dom) dom.classList.add('dragging');

  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd);
}

function onDragMove(e) {
  if (!isDragging || !selectedId) return;

  const dx = (e.clientX - dragStartX) / canvasScale;
  const dy = (e.clientY - dragStartY) / canvasScale;

  const dom = canvas.querySelector(`[data-id="${selectedId}"]`);
  if (dom) {
    dom.style.left = (elStartX + dx) + 'px';
    dom.style.top = (elStartY + dy) + 'px';
  }
}

function onDragEnd(e) {
  if (!isDragging || !selectedId) return;

  const dx = (e.clientX - dragStartX) / canvasScale;
  const dy = (e.clientY - dragStartY) / canvasScale;

  const dom = canvas.querySelector(`[data-id="${selectedId}"]`);
  if (dom) dom.classList.remove('dragging');

  isDragging = false;
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragEnd);

  // Only report if moved significantly
  if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;

  const newX = Math.round(elStartX + dx);
  const newY = Math.round(elStartY + dy);

  // Update local state
  const el = scene.elements.find(e => e.id === selectedId);
  if (el) {
    el.props.x = newX;
    el.props.y = newY;
  }

  // Report to server
  sendWs({ type: 'move', data: { id: selectedId, x: newX, y: newY } });
  updateSelectionInfo();
}

// Touch support
function onElementTouchStart(e, el) {
  if (el.id !== selectedId) {
    selectElement(el.id);
    return;
  }

  e.preventDefault();
  const touch = e.touches[0];
  isDragging = true;
  dragStartX = touch.clientX;
  dragStartY = touch.clientY;
  elStartX = el.props.x || 0;
  elStartY = el.props.y || 0;

  const dom = canvas.querySelector(`[data-id="${el.id}"]`);
  if (dom) dom.classList.add('dragging');

  const onTouchMove = (te) => {
    if (!isDragging) return;
    te.preventDefault();
    const t = te.touches[0];
    const dx = (t.clientX - dragStartX) / canvasScale;
    const dy = (t.clientY - dragStartY) / canvasScale;
    if (dom) {
      dom.style.left = (elStartX + dx) + 'px';
      dom.style.top = (elStartY + dy) + 'px';
    }
  };

  const onTouchEnd = (te) => {
    if (!isDragging) return;
    const t = te.changedTouches[0];
    const dx = (t.clientX - dragStartX) / canvasScale;
    const dy = (t.clientY - dragStartY) / canvasScale;
    if (dom) dom.classList.remove('dragging');
    isDragging = false;

    document.removeEventListener('touchmove', onTouchMove);
    document.removeEventListener('touchend', onTouchEnd);

    if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;

    const newX = Math.round(elStartX + dx);
    const newY = Math.round(elStartY + dy);
    const elData = scene.elements.find(e => e.id === selectedId);
    if (elData) { elData.props.x = newX; elData.props.y = newY; }
    sendWs({ type: 'move', data: { id: selectedId, x: newX, y: newY } });
    updateSelectionInfo();
  };

  document.addEventListener('touchmove', onTouchMove, { passive: false });
  document.addEventListener('touchend', onTouchEnd);
}

function onElementDblClick(e, el) {
  if (el.type !== 'text') return;
  e.preventDefault();
  e.stopPropagation();

  const dom = canvas.querySelector(`[data-id="${el.id}"]`);
  if (!dom) return;

  dom.classList.add('text-editing');
  dom.contentEditable = 'true';
  dom.focus();

  // Select all text
  const range = document.createRange();
  range.selectNodeContents(dom);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  const originalText = el.props.text || '';

  const finish = () => {
    dom.contentEditable = 'false';
    dom.classList.remove('text-editing');

    const newText = dom.textContent.trim();
    if (newText && newText !== originalText) {
      el.props.text = newText;
      sendWs({ type: 'edit-text', data: { id: el.id, oldText: originalText, newText } });
    }
  };

  dom.addEventListener('blur', finish, { once: true });
  dom.addEventListener('keydown', (ke) => {
    if (ke.key === 'Enter' && !ke.shiftKey) {
      ke.preventDefault();
      dom.blur();
    }
    if (ke.key === 'Escape') {
      dom.textContent = originalText;
      dom.blur();
    }
  });
}

function selectElement(id) {
  selectedId = id;

  // Update DOM
  canvas.querySelectorAll('.canvas-element').forEach(el => {
    el.classList.toggle('selected', el.dataset.id === id);
  });

  // Update element list
  elementList.querySelectorAll('.element-item').forEach(item => {
    item.classList.toggle('selected', item.dataset.id === id);
  });

  // Update selection info
  updateSelectionInfo();

  // Report to server
  const el = scene.elements.find(e => e.id === id);
  if (el) {
    sendWs({ type: 'select', data: { id, type: el.type, props: el.props } });
  }
}

function updateSelectionInfo() {
  const el = scene.elements.find(e => e.id === selectedId);
  if (!el) {
    selectionInfo.textContent = 'Click an element to select it';
    propsSection.style.display = 'none';
    return;
  }

  selectionInfo.textContent = `${el.id} (${el.type})\nPos: ${el.props.x || 0}, ${el.props.y || 0}\nKeyframes: ${el.keyframes?.length || 0}`;

  // Show properties
  propsSection.style.display = '';
  propsGrid.innerHTML = '';

  const editableProps = ['x', 'y', 'width', 'height', 'opacity', 'rotation', 'fontSize', 'color', 'text'];
  for (const key of editableProps) {
    if (el.props[key] === undefined) continue;

    const label = document.createElement('span');
    label.className = 'prop-label';
    label.textContent = key;

    const input = document.createElement('input');
    input.className = 'prop-value';
    input.value = el.props[key];
    input.dataset.prop = key;

    input.addEventListener('change', () => {
      const val = isNaN(Number(input.value)) ? input.value : Number(input.value);
      el.props[key] = val;
      sendWs({ type: 'move', data: { id: el.id, [key]: val } });
      renderCanvas();
    });

    propsGrid.appendChild(label);
    propsGrid.appendChild(input);
  }
}

// Deselect on canvas background click
canvas.addEventListener('click', (e) => {
  if (e.target === canvas) {
    selectedId = null;
    canvas.querySelectorAll('.canvas-element').forEach(el => el.classList.remove('selected'));
    elementList.querySelectorAll('.element-item').forEach(item => item.classList.remove('selected'));
    selectionInfo.textContent = 'Click an element to select it';
    propsSection.style.display = 'none';
  }
});

// --- Element List ---
function renderElementList() {
  const elements = scene.elements || [];
  if (elements.length === 0) {
    elementList.innerHTML = '<div class="empty-state">No elements yet</div>';
    return;
  }

  elementList.innerHTML = '';
  for (const el of elements) {
    const item = document.createElement('div');
    item.className = 'element-item' + (el.id === selectedId ? ' selected' : '');
    item.dataset.id = el.id;

    const typeSpan = document.createElement('span');
    typeSpan.className = 'el-type';
    typeSpan.textContent = el.type;

    const nameSpan = document.createElement('span');
    nameSpan.textContent = el.id + (el.props.text ? ` "${el.props.text.slice(0, 20)}"` : '');

    item.appendChild(typeSpan);
    item.appendChild(nameSpan);
    item.addEventListener('click', () => selectElement(el.id));

    elementList.appendChild(item);
  }
}

// --- Timeline ---
function renderTimeline() {
  // Ruler
  const duration = scene.duration || 5000;
  timelineRuler.innerHTML = '';

  const steps = Math.ceil(duration / 1000);
  for (let i = 0; i <= steps; i++) {
    const pct = (i * 1000 / duration) * 100;
    const tick = document.createElement('div');
    tick.className = 'tick';
    tick.style.left = `calc(80px + ${pct}% * (100% - 80px) / 100%)`;

    // Compensate for label area
    const leftPx = 80 + (pct / 100) * (timelineRuler.offsetWidth - 80);
    tick.style.left = leftPx + 'px';

    const label = document.createElement('span');
    label.className = 'tick-label';
    label.textContent = i + 's';
    label.style.left = leftPx + 'px';

    timelineRuler.appendChild(tick);
    timelineRuler.appendChild(label);
  }

  // Tracks
  const elements = scene.elements || [];
  if (elements.length === 0) {
    timelineTracks.innerHTML = '<div class="empty-state">Add elements to see their timeline tracks</div>';
    return;
  }

  timelineTracks.innerHTML = '';
  const trackWidth = timelineTracks.offsetWidth - 80;

  for (const el of elements) {
    const track = document.createElement('div');
    track.className = 'timeline-track';

    const label = document.createElement('div');
    label.className = 'timeline-track-label';
    label.textContent = el.id;

    const bar = document.createElement('div');
    bar.className = 'timeline-track-bar';

    for (const kf of (el.keyframes || [])) {
      const dot = document.createElement('div');
      dot.className = 'keyframe-dot';
      const pct = (kf.time / duration) * 100;
      dot.style.left = pct + '%';
      dot.title = `${kf.time}ms`;
      bar.appendChild(dot);
    }

    track.appendChild(label);
    track.appendChild(bar);
    timelineTracks.appendChild(track);
  }

  updatePlayhead();
}

function updatePlayhead() {
  const duration = scene.duration || 5000;
  const t = scene.currentTime || 0;
  const trackWidth = timelineTracks.offsetWidth - 80;
  const left = 80 + (t / duration) * trackWidth;
  timelinePlayhead.style.left = left + 'px';
}

function updateTimeDisplay() {
  const current = (scene.currentTime || 0) / 1000;
  const total = (scene.duration || 5000) / 1000;
  timeDisplay.textContent = `${formatTime(current)} / ${formatTime(total)}`;
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(1);
  return `${m}:${s.padStart(4, '0')}`;
}

// --- Animation ---
function startAnimation() {
  scene.playing = true;
  btnPlay.textContent = '⏸';
  animStartTime = performance.now() - (scene.currentTime || 0);
  animFrame = requestAnimationFrame(animationLoop);
}

function stopAnimation() {
  scene.playing = false;
  btnPlay.textContent = '▶';
  if (animFrame) cancelAnimationFrame(animFrame);
  animFrame = null;
}

function seekTo(time) {
  scene.currentTime = time;
  renderCanvas();
  updatePlayhead();
  updateTimeDisplay();
}

function animationLoop(timestamp) {
  if (!scene.playing) return;

  scene.currentTime = timestamp - animStartTime;
  if (scene.currentTime >= (scene.duration || 5000)) {
    scene.currentTime = 0;
    animStartTime = timestamp;
  }

  renderCanvas();
  updatePlayhead();
  updateTimeDisplay();

  animFrame = requestAnimationFrame(animationLoop);
}

// --- Controls ---
btnPlay.addEventListener('click', () => {
  if (scene.playing) stopAnimation();
  else startAnimation();
});

btnReset.addEventListener('click', () => {
  seekTo(0);
  stopAnimation();
});

btnEditMode.addEventListener('click', () => {
  editMode = !editMode;
  btnEditMode.classList.toggle('active', editMode);
});

btnZoomFit.addEventListener('click', fitCanvas);

// --- Canvas Zoom/Pan ---
let canvasPanX = 0, canvasPanY = 0;
let isPanning = false;
let panStartX = 0, panStartY = 0;
let panStartPanX = 0, panStartPanY = 0;

function fitCanvas() {
  const wrapperRect = canvasWrapper.getBoundingClientRect();
  const scaleX = (wrapperRect.width - 40) / scene.width;
  const scaleY = (wrapperRect.height - 40) / scene.height;
  canvasScale = Math.min(scaleX, scaleY, 1);
  canvasPanX = 0;
  canvasPanY = 0;
  updateCanvasTransform();
}

function updateCanvasTransform() {
  canvas.style.transform = `translate(${canvasPanX}px, ${canvasPanY}px) scale(${canvasScale})`;
}

// Zoom with scroll wheel
canvasWrapper.addEventListener('wheel', (e) => {
  e.preventDefault();
  const delta = e.deltaY > 0 ? 0.9 : 1.1;
  const newScale = Math.max(0.1, Math.min(3, canvasScale * delta));

  // Zoom towards mouse position
  const rect = canvasWrapper.getBoundingClientRect();
  const mx = e.clientX - rect.left - rect.width / 2;
  const my = e.clientY - rect.top - rect.height / 2;

  canvasPanX = mx - (mx - canvasPanX) * (newScale / canvasScale);
  canvasPanY = my - (my - canvasPanY) * (newScale / canvasScale);
  canvasScale = newScale;

  updateCanvasTransform();
}, { passive: false });

// Pan with middle mouse or Alt+drag
canvasWrapper.addEventListener('mousedown', (e) => {
  if (e.button === 1 || (e.altKey && e.button === 0)) {
    e.preventDefault();
    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panStartPanX = canvasPanX;
    panStartPanY = canvasPanY;
    canvasWrapper.style.cursor = 'grabbing';
  }
});

document.addEventListener('mousemove', (e) => {
  if (!isPanning) return;
  canvasPanX = panStartPanX + (e.clientX - panStartX);
  canvasPanY = panStartPanY + (e.clientY - panStartY);
  updateCanvasTransform();
});

document.addEventListener('mouseup', () => {
  if (isPanning) {
    isPanning = false;
    canvasWrapper.style.cursor = '';
  }
});

// --- Keyboard Shortcuts ---
document.addEventListener('keydown', (e) => {
  // Skip if typing in input field
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.contentEditable === 'true') return;

  switch (e.key) {
    case 'Delete':
    case 'Backspace':
      if (selectedId) {
        const idx = scene.elements.findIndex(el => el.id === selectedId);
        if (idx !== -1) {
          scene.elements.splice(idx, 1);
          sendWs({ type: 'input', data: { message: `[delete] ${selectedId}` } });
          selectedId = null;
          renderAll();
        }
      }
      break;

    case 'Escape':
      selectedId = null;
      canvas.querySelectorAll('.canvas-element').forEach(el => el.classList.remove('selected'));
      propsSection.style.display = 'none';
      selectionInfo.textContent = 'Click an element to select it';
      break;

    case ' ':
      e.preventDefault();
      if (scene.playing) stopAnimation();
      else startAnimation();
      break;

    case 'ArrowUp':
    case 'ArrowDown':
    case 'ArrowLeft':
    case 'ArrowRight':
      if (selectedId) {
        e.preventDefault();
        const el = scene.elements.find(el => el.id === selectedId);
        if (el) {
          const step = e.shiftKey ? 10 : 1;
          if (e.key === 'ArrowUp') el.props.y -= step;
          if (e.key === 'ArrowDown') el.props.y += step;
          if (e.key === 'ArrowLeft') el.props.x -= step;
          if (e.key === 'ArrowRight') el.props.x += step;
          sendWs({ type: 'move', data: { id: el.id, x: el.props.x, y: el.props.y } });
          renderCanvas();
          updateSelectionInfo();
        }
      }
      break;

    case 'f':
      if (!e.ctrlKey && !e.metaKey) fitCanvas();
      break;
  }
});

// --- Timeline Click to Seek ---
timelineRuler.addEventListener('click', (e) => {
  const rect = timelineRuler.getBoundingClientRect();
  const x = e.clientX - rect.left - 80; // 80px label offset
  const width = rect.width - 80;
  if (x < 0 || width <= 0) return;

  const ratio = Math.max(0, Math.min(1, x / width));
  const time = ratio * (scene.duration || 5000);
  seekTo(time);
});

// --- User Input ---
function sendUserInput() {
  const msg = userInput.value.trim();
  if (!msg) return;

  sendWs({ type: 'input', data: { message: msg } });
  userInput.value = '';
}

btnSend.addEventListener('click', sendUserInput);
userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendUserInput();
});

// --- WebSocket send ---
function sendWs(msg) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(msg));
  }
}

// --- Init ---
window.addEventListener('resize', fitCanvas);

// Initial state fetch (in case WS hasn't connected yet)
fetch('/api/state')
  .then(r => r.json())
  .then(data => {
    adapterBadge.textContent = data.adapter || '—';
    if (data.scene) {
      scene = { ...scene, ...data.scene };
      renderAll();
    }
  })
  .catch(() => {});

connectWs();

// Fit canvas after initial render
requestAnimationFrame(fitCanvas);
