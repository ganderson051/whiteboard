/* ═══════════════════════════════════════════════════
   TIRREXBOARD — Complete Whiteboard Engine
   Bezier pen, dual eraser, shapes, text overhaul,
   text selection, image paste/import, dark-first
═══════════════════════════════════════════════════ */

'use strict';

// ─── CONSTANTS ───────────────────────────────────────
const COLORS = ['#e8e6e3','#c50f1f','#ca5010','#c19c00','#0e7a0d','#0078d4','#7160e8','#e3008c'];
const CP_COLORS = ['#ffffff','#000000','#c50f1f','#ca5010','#c19c00','#0e7a0d','#0078d4','#7160e8','#e3008c','#69797e','#ff4444','#ff9900'];
const PAGE_W = 4000, PAGE_H = 2800;

const SMOOTH_MODES = {
  raw:  { strength: 0, label: 'RAW — No smoothing', snap: false },
  std:  { strength: 5, label: 'STD — Standard',     snap: false },
  arch: { strength: 8, label: 'ARC — Architect snap', snap: true  },
};

// ─── STATE ───────────────────────────────────────────
const S = {
  tool:           'pen',
  subTool:        'pen',
  shapeTool:      'rect',
  eraserMode:     'stroke',
  color:          '#e8e6e3',
  penSize:        6,
  eraserSize:     24,
  smoothMode:     'std',
  smartSnap:      false,
  zoom:           1,
  pan:            { x: 0, y: 0 },
  grid:           false,
  dark:           true,
  pages:          [],
  currentPage:    0,
  drawing:        false,
  currentStroke:  null,
  shiftHeld:      false,
  panning:        false,
  panStart:       { x: 0, y: 0 },
  laserTrails:    [],
  selection:      null,
  selectedStrokes:[],
  selectedTextBox: null,
  selectedImage:   null,
  dragState:       null,
  historyOpen:    false,
  minimapOpen:    false,
  textOpts: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 24,
    bold: false,
    italic: false,
    align: 'left',
  },
};

// ─── CANVAS SETUP ─────────────────────────────────────
const strokeCanvas  = document.getElementById('stroke-canvas');
const gridCanvas    = document.getElementById('grid-canvas');
const overlayCanvas = document.getElementById('overlay-canvas');
const ctx   = strokeCanvas.getContext('2d');
const gctx  = gridCanvas.getContext('2d');
const octx  = overlayCanvas.getContext('2d');

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  [strokeCanvas, gridCanvas, overlayCanvas].forEach(c => { c.width = w; c.height = h; });
  renderGrid();
  renderAll();
  updateMinimap();
}
window.addEventListener('resize', resize);

// ─── PAGE & LAYER SYSTEM ─────────────────────────────
function createLayer(name, id) {
  const c = document.createElement('canvas');
  c.width = PAGE_W; c.height = PAGE_H;
  const vc = document.createElement('canvas');
  vc.width = PAGE_W; vc.height = PAGE_H;
  return {
    id: id || Date.now(), name,
    canvas: c, ctx: c.getContext('2d'),
    vectorCanvas: vc, vectorCtx: vc.getContext('2d'),
    strokes: [], textBoxes: [], images: [],
    visible: true, locked: false, opacity: 1,
  };
}

function createPage() {
  return {
    layers: [
      createLayer('Background', 'bg'),
      createLayer('Main', 'main'),
      createLayer('Annotations', 'ann'),
    ],
    activeLayer:  1,
    undoHistory:  [],
    redoHistory:  [],
  };
}

function getPage()        { return S.pages[S.currentPage]; }
function getActiveLayer() { const p = getPage(); return p ? p.layers[p.activeLayer] : null; }

function initPages() {
  S.pages = [createPage()];
  S.currentPage = 0;
  renderLayersPanel();
  renderPagesPanel();
}

// ─── RESPONSIVE HELPERS ──────────────────────────────
function getToolbarWidth() {
  const w = window.innerWidth;
  if (w <= 600) return 0;
  if (w <= 900) return 48;
  if (w >= 1400) return 58;
  return 54;
}
function getTopbarHeight() {
  const w = window.innerWidth;
  if (w <= 400) return 38;
  if (w <= 600) return 44;
  if (w <= 900) return 44;
  if (w >= 1400) return 48;
  return 46;
}
function getDefaultPanX() { return getToolbarWidth() + 20; }
function getDefaultPanY() { return getTopbarHeight() + 20; }

// ─── COORDINATE TRANSFORMS ───────────────────────────
function toPage(cx, cy)   { return { x: (cx - S.pan.x) / S.zoom, y: (cy - S.pan.y) / S.zoom }; }
function toScreen(px, py) { return { x: px * S.zoom + S.pan.x, y: py * S.zoom + S.pan.y }; }

// ─── RENDERING ENGINE ────────────────────────────────
function renderAll() {
  const w = strokeCanvas.width, h = strokeCanvas.height;
  ctx.clearRect(0, 0, w, h);
  const page = getPage();
  if (!page) return;

  ctx.save();
  ctx.translate(S.pan.x, S.pan.y);
  ctx.scale(S.zoom, S.zoom);

  page.layers.forEach(layer => {
    if (!layer.visible) return;
    ctx.save();
    ctx.globalAlpha = layer.opacity;
    ctx.drawImage(layer.canvas, 0, 0);
    ctx.restore();
  });

  if (S.currentStroke && S.currentStroke.points.length > 0) {
    drawStrokeToCtx(ctx, S.currentStroke, true);
  }

  ctx.restore();
  renderOverlay();
}

function renderOverlay() {
  const w = overlayCanvas.width, h = overlayCanvas.height;
  octx.clearRect(0, 0, w, h);

  S.laserTrails.forEach(trail => {
    trail.points.forEach((p, i) => {
      if (i === 0) return;
      const age = (Date.now() - p.t) / 2000;
      if (age >= 1) return;
      octx.save();
      octx.globalAlpha = (1 - age) * 0.85;
      octx.strokeStyle = '#ff3c3c';
      octx.lineWidth = 4 * (1 - age * 0.5);
      octx.lineCap = 'round';
      octx.shadowColor = '#ff3c3c';
      octx.shadowBlur = 10 * (1 - age);
      octx.beginPath();
      octx.moveTo(trail.points[i-1].cx, trail.points[i-1].cy);
      octx.lineTo(p.cx, p.cy);
      octx.stroke();
      octx.restore();
    });
  });

  if (S.selection?.dragging) {
    const { x1, y1, x2, y2 } = S.selection;
    const rx = Math.min(x1, x2), ry = Math.min(y1, y2);
    const rw = Math.abs(x2 - x1), rh = Math.abs(y2 - y1);
    const sr = document.getElementById('sel-rect');
    sr.setAttribute('x', rx); sr.setAttribute('y', ry);
    sr.setAttribute('width', rw); sr.setAttribute('height', rh);
    sr.setAttribute('display', 'block');
  } else {
    document.getElementById('sel-rect').setAttribute('display', 'none');
  }

  renderSelectionHandles();
}

function renderSelectionHandles() {
  const g = document.getElementById('sel-handles');
  g.innerHTML = '';
  if (!S.selectedStrokes.length) return;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  S.selectedStrokes.forEach(s => {
    s.points.forEach(p => {
      const sc = toScreen(p.x, p.y);
      minX = Math.min(minX, sc.x); minY = Math.min(minY, sc.y);
      maxX = Math.max(maxX, sc.x); maxY = Math.max(maxY, sc.y);
    });
  });

  const pad = 10;
  const rx = minX - pad, ry = minY - pad;
  const rw = maxX - minX + pad * 2, rh = maxY - minY + pad * 2;

  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', rx); rect.setAttribute('y', ry);
  rect.setAttribute('width', rw); rect.setAttribute('height', rh);
  rect.setAttribute('fill', 'rgba(108,140,255,0.06)');
  rect.setAttribute('stroke', 'rgba(108,140,255,0.75)');
  rect.setAttribute('stroke-width', '1.5');
  rect.setAttribute('stroke-dasharray', '6 4');
  rect.setAttribute('rx', '4');
  g.appendChild(rect);

  [[rx,ry],[rx+rw/2,ry],[rx+rw,ry],[rx+rw,ry+rh/2],[rx+rw,ry+rh],[rx+rw/2,ry+rh],[rx,ry+rh],[rx,ry+rh/2]].forEach(([hx,hy]) => {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', hx); c.setAttribute('cy', hy); c.setAttribute('r', 5);
    c.setAttribute('fill', 'var(--accent)');
    c.setAttribute('stroke', 'white'); c.setAttribute('stroke-width', '1.5');
    g.appendChild(c);
  });

  openPanel('inspector');
}

// ─── BEZIER STROKE RENDERER ──────────────────────────
function drawStrokeToCtx(c, stroke, live = false) {
  if (!stroke.points || stroke.points.length < 1) return;
  c.save();
  c.lineCap = 'round'; c.lineJoin = 'round';

  const tool = stroke.tool;

  if (tool === 'pixel-eraser') {
    c.globalCompositeOperation = 'destination-out';
    c.globalAlpha = 1;
    c.strokeStyle = 'rgba(0,0,0,1)';
    c.fillStyle = 'rgba(0,0,0,1)';
  } else if (tool === 'highlighter') {
    c.globalCompositeOperation = S.dark ? 'screen' : 'multiply';
    c.globalAlpha = 0.4;
    c.strokeStyle = stroke.color;
    c.fillStyle = stroke.color;
  } else if (tool === 'chalk') {
    c.globalAlpha = 0.72;
    c.strokeStyle = stroke.color;
    c.fillStyle = stroke.color;
    c.setLineDash([3, 2]);
    c.lineDashOffset = Math.random() * 4;
  } else if (tool === 'graphite') {
    c.globalAlpha = 0.55;
    c.strokeStyle = stroke.color;
    c.fillStyle = stroke.color;
  } else {
    c.globalAlpha = stroke.opacity ?? 1;
    c.strokeStyle = stroke.color;
    c.fillStyle = stroke.color;
  }

  const pts = stroke.points;

  if (stroke.isShape && pts.length >= 2) {
    c.lineWidth = Math.max(1, stroke.size);
    c.beginPath();
    c.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      c.lineTo(pts[i].x, pts[i].y);
    }
    c.stroke();
    c.setLineDash([]);
    c.restore();
    return;
  }

  if (pts.length === 1) {
    c.beginPath();
    c.arc(pts[0].x, pts[0].y, Math.max(1, (pts[0].size || stroke.size) / 2), 0, Math.PI * 2);
    c.fill();
  } else if (pts.length === 2) {
    c.lineWidth = Math.max(1, (pts[0].size + pts[1].size) / 2 || stroke.size);
    c.beginPath();
    c.moveTo(pts[0].x, pts[0].y);
    c.lineTo(pts[1].x, pts[1].y);
    c.stroke();
  } else {
    const hasPressure = pts.some((p, i) => i > 0 && Math.abs((p.size || stroke.size) - (pts[i-1].size || stroke.size)) > 0.5);

    if (!hasPressure || tool === 'pixel-eraser') {
      let totalSize = 0;
      pts.forEach(p => totalSize += (p.size || stroke.size));
      c.lineWidth = Math.max(1, totalSize / pts.length);
      c.beginPath();
      c.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i+1].x) / 2;
        const my = (pts[i].y + pts[i+1].y) / 2;
        c.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
      }
      c.lineTo(pts[pts.length-1].x, pts[pts.length-1].y);
      c.stroke();
    } else {
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i], p1 = pts[i + 1];
        const w = Math.max(1, (p0.size + p1.size) / 2 || stroke.size);
        c.lineWidth = w;
        c.beginPath();
        if (i === 0) {
          c.moveTo(p0.x, p0.y);
        } else {
          c.moveTo((pts[i-1].x + p0.x) / 2, (pts[i-1].y + p0.y) / 2);
        }
        if (i < pts.length - 2) {
          c.quadraticCurveTo(p0.x, p0.y, (p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
        } else {
          c.quadraticCurveTo(p0.x, p0.y, p1.x, p1.y);
        }
        c.stroke();
      }
      for (let i = 1; i < pts.length; i++) {
        const r = Math.max(0.5, (pts[i].size || stroke.size) / 2.2);
        c.beginPath();
        c.arc(pts[i].x, pts[i].y, r, 0, Math.PI * 2);
        c.fill();
      }
    }
  }

  c.setLineDash([]);
  c.restore();
}

function renderTextBox(c, tb) {
  c.save();
  let fontStr = '';
  if (tb.italic) fontStr += 'italic ';
  if (tb.bold) fontStr += 'bold ';
  fontStr += (tb.fontSize || tb.size || 24) + 'px ' + (tb.fontFamily || 'Inter, sans-serif');
  c.font = fontStr;
  c.fillStyle = tb.color;
  c.textBaseline = 'top';

  const lines = (tb.text || '').split('\n');
  const lineHeight = (tb.fontSize || tb.size || 24) * 1.4;
  const align = tb.align || 'left';

  let maxW = 0;
  lines.forEach(line => { maxW = Math.max(maxW, c.measureText(line).width); });

  lines.forEach((line, i) => {
    let xOff = 0;
    if (align === 'center') xOff = (maxW - c.measureText(line).width) / 2;
    else if (align === 'right') xOff = maxW - c.measureText(line).width;
    c.fillText(line, tb.x + xOff, tb.y + i * lineHeight);
  });

  if (!tb._width) {
    tb._width = maxW;
    tb._height = lines.length * lineHeight;
  }

  c.restore();
}

function renderImageObj(c, img) {
  if (!img._el) return;
  c.save();
  c.drawImage(img._el, img.x, img.y, img.width, img.height);
  c.restore();
}

function redrawLayerCanvas(layer) {
  layer.ctx.clearRect(0, 0, PAGE_W, PAGE_H);
  layer.vectorCtx.clearRect(0, 0, PAGE_W, PAGE_H);
  (layer.images || []).forEach(img => renderImageObj(layer.ctx, img));
  layer.strokes.forEach(s => drawStrokeToCtx(layer.vectorCtx, s));
  (layer.textBoxes || []).forEach(tb => renderTextBox(layer.vectorCtx, tb));
  layer.ctx.drawImage(layer.vectorCanvas, 0, 0);
}

// ─── SMOOTHING ───────────────────────────────────────
let smoothBuf = [];
function applySmooth(x, y) {
  const n = SMOOTH_MODES[S.smoothMode].strength;
  if (n === 0) return { x, y };
  smoothBuf.push({ x, y });
  if (smoothBuf.length > n + 1) smoothBuf.shift();
  let sx = 0, sy = 0;
  smoothBuf.forEach(p => { sx += p.x; sy += p.y; });
  return { x: sx / smoothBuf.length, y: sy / smoothBuf.length };
}

function architectSnap(x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const a = Math.atan2(dy, dx);
  const snapped = Math.round(a / (Math.PI / 4)) * (Math.PI / 4);
  const dist = Math.hypot(dx, dy);
  return { x: x1 + Math.cos(snapped) * dist, y: y1 + Math.sin(snapped) * dist };
}

// ─── SMART SHAPE DETECTION ───────────────────────────
function detectShape(pts) {
  if (pts.length < 4) return null;
  const first = pts[0], last = pts[pts.length - 1];
  let pathLen = 0;
  for (let i = 1; i < pts.length; i++) pathLen += Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y);
  const directDist = Math.hypot(last.x - first.x, last.y - first.y);
  const straightness = directDist / pathLen;

  if (straightness > 0.88) return { type: 'line', x1: first.x, y1: first.y, x2: last.x, y2: last.y };

  if (directDist / pathLen < 0.18) {
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    pts.forEach(p => { minX=Math.min(minX,p.x); maxX=Math.max(maxX,p.x); minY=Math.min(minY,p.y); maxY=Math.max(maxY,p.y); });
    const w=maxX-minX, h=maxY-minY, aspect=Math.min(w,h)/Math.max(w,h);
    if (aspect > 0.75) {
      const cx=(minX+maxX)/2, cy=(minY+maxY)/2, r=Math.max(w,h)/2;
      if (pathLen/(2*Math.PI*r) > 0.5 && pathLen/(2*Math.PI*r) < 1.8)
        return { type:'circle', cx, cy, r };
    }
    return { type:'rect', x:minX, y:minY, w, h };
  }
  if (straightness > 0.65 && directDist > 20)
    return { type:'arrow', x1:first.x, y1:first.y, x2:last.x, y2:last.y };
  return null;
}

function buildShapePoints(shape, sz) {
  const pts = [];
  const ah = Math.max(10, sz * 3);
  if (shape.type === 'line' || shape.type === 'arrow') {
    pts.push({x:shape.x1,y:shape.y1,size:sz}); pts.push({x:shape.x2,y:shape.y2,size:sz});
    if (shape.type === 'arrow') {
      const a=Math.atan2(shape.y2-shape.y1,shape.x2-shape.x1);
      pts.push({x:shape.x2-ah*Math.cos(a-0.45),y:shape.y2-ah*Math.sin(a-0.45),size:sz});
      pts.push({x:shape.x2,y:shape.y2,size:sz});
      pts.push({x:shape.x2-ah*Math.cos(a+0.45),y:shape.y2-ah*Math.sin(a+0.45),size:sz});
    }
  } else if (shape.type === 'circle') {
    for (let a=0; a<=Math.PI*2+0.05; a+=0.08)
      pts.push({x:shape.cx+Math.cos(a)*shape.r,y:shape.cy+Math.sin(a)*shape.r,size:sz});
  } else if (shape.type === 'rect') {
    const {x,y,w,h}=shape;
    pts.push({x,y,size:sz}); pts.push({x:x+w,y,size:sz}); pts.push({x:x+w,y:y+h,size:sz}); pts.push({x,y:y+h,size:sz}); pts.push({x,y,size:sz});
  }
  return pts;
}

// ─── RDP SIMPLIFICATION ──────────────────────────────
function simplifyPoints(pts, epsilon = 1.5) {
  if (pts.length <= 2) return pts;
  function perp(p, a, b) {
    const dx=b.x-a.x, dy=b.y-a.y;
    if (dx===0&&dy===0) return Math.hypot(p.x-a.x,p.y-a.y);
    return Math.abs(dy*p.x-dx*p.y+b.x*a.y-b.y*a.x)/Math.hypot(dx,dy);
  }
  function rdp(pts, first, last, eps, result) {
    let maxDist=0, index=0;
    for (let i=first+1; i<last; i++) { const d=perp(pts[i],pts[first],pts[last]); if(d>maxDist){maxDist=d;index=i;} }
    if (maxDist>eps) { rdp(pts,first,index,eps,result); result.push(pts[index]); rdp(pts,index,last,eps,result); }
  }
  const result=[pts[0]]; rdp(pts,0,pts.length-1,epsilon,result); result.push(pts[pts.length-1]);
  return result;
}

// ─── SCHEDULE RENDER ─────────────────────────────────
let raf = null;
function scheduleRender() {
  if (raf) cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => { renderAll(); updateMinimap(); raf = null; });
}

// ─── POINTER EVENTS ──────────────────────────────────
strokeCanvas.addEventListener('pointerdown', onDown);
strokeCanvas.addEventListener('pointermove', onMove);
strokeCanvas.addEventListener('pointerup',   onUp);
strokeCanvas.addEventListener('pointercancel', onUp);

function onDown(e) {
  e.preventDefault();
  strokeCanvas.setPointerCapture(e.pointerId);
  const cx = e.clientX, cy = e.clientY;

  closeAllFlyouts();

  if (S.tool === 'pan' || e.buttons === 4) {
    S.panning = true;
    S.panStart = { x: cx - S.pan.x, y: cy - S.pan.y };
    strokeCanvas.classList.add('panning');
    return;
  }

  if (S.tool === 'laser') {
    S.laserTrails.push({ points: [{ cx, cy, t: Date.now() }] });
    moveLaserCursor(cx, cy);
    return;
  }

  if (S.tool === 'text') { openTextBox(cx, cy); return; }

  if (S.tool === 'select') {
    const pp = toPage(cx, cy);
    const hitTb = hitTestTextBox(pp.x, pp.y);
    if (hitTb) {
      S.selectedTextBox = hitTb;
      S.selectedImage = null;
      S.selectedStrokes = [];
      showElementOverlay(hitTb, 'text');
      return;
    }
    const hitImg = hitTestImage(pp.x, pp.y);
    if (hitImg) {
      S.selectedImage = hitImg;
      S.selectedTextBox = null;
      S.selectedStrokes = [];
      showElementOverlay(hitImg, 'image');
      return;
    }

    hideElementOverlay();
    S.selectedTextBox = null;
    S.selectedImage = null;
    S.selection = { x1:cx, y1:cy, x2:cx, y2:cy, dragging:true };
    S.selectedStrokes = [];
    closePanel('inspector');
    document.getElementById('sel-handles').innerHTML = '';
    scheduleRender();
    return;
  }

  if (S.tool === 'shapes') { startShapeDraw(cx, cy); return; }

  if (S.tool === 'eraser') {
    if (S.eraserMode === 'stroke') {
      S.drawing = true;
      strokeEraseAt(cx, cy);
      return;
    }
    smoothBuf = [];
    S.drawing = true;
    const pp = toPage(cx, cy);
    S.currentStroke = {
      tool: 'pixel-eraser', color: '#000', size: S.eraserSize, opacity: 1,
      points: [{ x: pp.x, y: pp.y, size: S.eraserSize }],
    };
    scheduleRender();
    return;
  }

  smoothBuf = [];
  const pressure = Math.max(0.25, e.pressure || 0.5);
  const sizeD = S.penSize * (0.6 + pressure * 0.6);
  const pp = toPage(cx, cy);
  const sp = applySmooth(pp.x, pp.y);

  S.drawing = true;
  S.currentStroke = {
    tool:    S.subTool,
    color:   S.color,
    size:    S.penSize,
    opacity: S.subTool === 'highlighter' ? 0.5 : 1,
    points:  [{ x: sp.x, y: sp.y, size: sizeD }],
  };
  scheduleRender();
}

function onMove(e) {
  e.preventDefault();
  const cx = e.clientX, cy = e.clientY;

  if (S.tool === 'eraser') {
    const ec = document.getElementById('eraser-cursor');
    const d = S.eraserSize * S.zoom;
    ec.style.width = d + 'px'; ec.style.height = d + 'px';
    ec.style.left = cx + 'px'; ec.style.top = cy + 'px';
  }

  if (S.panning) {
    S.pan.x = cx - S.panStart.x; S.pan.y = cy - S.panStart.y;
    renderGrid(); scheduleRender(); return;
  }

  if (S.tool === 'laser' && S.laserTrails.length) {
    S.laserTrails[S.laserTrails.length-1].points.push({ cx, cy, t: Date.now() });
    moveLaserCursor(cx, cy);
    scheduleRender(); pruneLaser(); return;
  }

  if (S.tool === 'select' && S.selection?.dragging) {
    S.selection.x2 = cx; S.selection.y2 = cy;
    scheduleRender(); return;
  }

  if (S.tool === 'shapes' && S.drawing) {
    const pp = toPage(cx, cy);
    updateShapeDraw(pp.x, pp.y, S.shiftHeld);
    scheduleRender(); return;
  }

  if (S.tool === 'eraser' && S.drawing && S.eraserMode === 'stroke') {
    strokeEraseAt(cx, cy);
    return;
  }

  if (!S.drawing || !S.currentStroke) return;

  const pressure = Math.max(0.25, e.pressure || 0.5);
  const sz = S.currentStroke.tool === 'pixel-eraser' ? S.eraserSize : S.penSize;
  const sizeD = sz * (S.currentStroke.tool === 'pixel-eraser' ? 1 : (0.6 + pressure * 0.6));
  const pp = toPage(cx, cy);
  let sp = applySmooth(pp.x, pp.y);

  if (SMOOTH_MODES[S.smoothMode].snap && S.currentStroke.points.length > 0) {
    const last = S.currentStroke.points[0];
    sp = architectSnap(last.x, last.y, sp.x, sp.y);
  }

  S.currentStroke.points.push({ x: sp.x, y: sp.y, size: sizeD });
  scheduleRender();
}

function onUp(e) {
  if (S.panning) { S.panning = false; strokeCanvas.classList.remove('panning'); return; }
  if (S.tool === 'laser') return;

  if (S.tool === 'select' && S.selection?.dragging) {
    S.selection.dragging = false;
    const page = getPage();
    if (page) {
      const x1=Math.min(S.selection.x1,S.selection.x2), x2=Math.max(S.selection.x1,S.selection.x2);
      const y1=Math.min(S.selection.y1,S.selection.y2), y2=Math.max(S.selection.y1,S.selection.y2);
      S.selectedStrokes = [];
      page.layers.forEach(layer => layer.strokes.forEach(s => {
        for (const p of s.points) {
          const sc = toScreen(p.x, p.y);
          if (sc.x>=x1&&sc.x<=x2&&sc.y>=y1&&sc.y<=y2) { S.selectedStrokes.push(s); break; }
        }
      }));
    }
    scheduleRender(); return;
  }

  if (S.tool === 'eraser' && S.eraserMode === 'stroke') {
    S.drawing = false; return;
  }

  if (!S.drawing || !S.currentStroke) return;
  S.drawing = false;

  let finalStroke = S.currentStroke;

  if (finalStroke.tool !== 'pixel-eraser' && S.tool !== 'shapes') {
    finalStroke.points = simplifyPoints(finalStroke.points, 1.5);
  }

  if (S.smartSnap && finalStroke.points.length >= 4 && finalStroke.tool !== 'pixel-eraser') {
    const shape = detectShape(finalStroke.points);
    if (shape) {
      finalStroke = { ...finalStroke, points: buildShapePoints(shape, finalStroke.size) };
      showNotif(`Shape: ${shape.type}`);
    }
  }

  const layer = getActiveLayer();
  const page = getPage();
  if (layer && !layer.locked && page) {
    layer.strokes.push(finalStroke);
    redrawLayerCanvas(layer);
    page.undoHistory.push({ type:'stroke', layerIdx: page.activeLayer, stroke: finalStroke });
    page.redoHistory = [];
    updateHistorySlider();
  }
  S.currentStroke = null;
  shapeOrigin = null;
  renderAll(); renderPagesPanel(); updateMinimap();
  autoSave();
}

// ─── STROKE ERASER ───────────────────────────────────
function strokeEraseAt(cx, cy) {
  const pp = toPage(cx, cy);
  const eraserRadius = S.eraserSize / S.zoom;
  const page = getPage();
  if (!page) return;

  for (let li = page.layers.length - 1; li >= 0; li--) {
    const layer = page.layers[li];
    if (!layer.visible || layer.locked) continue;

    for (let ti = layer.textBoxes.length - 1; ti >= 0; ti--) {
      const tb = layer.textBoxes[ti];
      const w = tb._width || 150;
      const h = tb._height || (tb.fontSize || 24) * 1.4 * (tb.text || '').split('\n').length;
      const tx = tb.x, ty = tb.y;
      const ex = pp.x, ey = pp.y;
      const inBox = ex >= tx - eraserRadius && ex <= tx + w + eraserRadius &&
        ey >= ty - eraserRadius && ey <= ty + h + eraserRadius;
      if (inBox) {
        const removed = layer.textBoxes.splice(ti, 1)[0];
        redrawLayerCanvas(layer);
        page.undoHistory.push({ type:'erase-text', layerIdx: li, textBox: removed, index: ti });
        page.redoHistory = [];
        updateHistorySlider();
        scheduleRender();
        autoSave();
        return;
      }
    }

    for (let si = layer.strokes.length - 1; si >= 0; si--) {
      const stroke = layer.strokes[si];
      for (const p of stroke.points) {
        if (Math.hypot(p.x - pp.x, p.y - pp.y) < eraserRadius + (p.size || stroke.size) / 2) {
          layer.strokes.splice(si, 1);
          redrawLayerCanvas(layer);
          page.undoHistory.push({ type:'erase-stroke', layerIdx: li, stroke, index: si });
          page.redoHistory = [];
          updateHistorySlider();
          scheduleRender();
          autoSave();
          return;
        }
      }
    }
  }
}

// ─── SHAPE TOOL ──────────────────────────────────────
let shapeOrigin = null;
function startShapeDraw(cx, cy) {
  shapeOrigin = toPage(cx, cy);
  S.drawing = true;
  S.currentStroke = { tool: 'pen', color: S.color, size: S.penSize, opacity: 1, points: [], isShape: true };
}

function updateShapeDraw(px, py, shift) {
  if (!shapeOrigin) return;
  const o = shapeOrigin, pts = [];
  const sz = S.penSize;
  const ah = Math.max(10, sz * 3);

  if (S.shapeTool === 'line' || S.shapeTool === 'arrow') {
    let ex = px, ey = py;
    if (shift) {
      const snapped = architectSnap(o.x, o.y, px, py);
      ex = snapped.x; ey = snapped.y;
    }
    pts.push({x:o.x, y:o.y, size:sz});
    pts.push({x:ex, y:ey, size:sz});
    if (S.shapeTool === 'arrow') {
      const a = Math.atan2(ey - o.y, ex - o.x);
      pts.push({x:ex - ah*Math.cos(a-0.45), y:ey - ah*Math.sin(a-0.45), size:sz});
      pts.push({x:ex, y:ey, size:sz});
      pts.push({x:ex - ah*Math.cos(a+0.45), y:ey - ah*Math.sin(a+0.45), size:sz});
    }
    S.currentStroke.points = pts;
    return;
  }

  let dx = px - o.x, dy = py - o.y;
  let w = Math.abs(dx), h = Math.abs(dy);
  const sx = dx >= 0 ? 1 : -1, sy = dy >= 0 ? 1 : -1;

  if (shift) {
    const side = Math.max(w, h);
    w = side; h = side;
  }

  const x1 = sx > 0 ? o.x : o.x - w;
  const y1 = sy > 0 ? o.y : o.y - h;
  const x2 = x1 + w;
  const y2 = y1 + h;

  switch (S.shapeTool) {
    case 'rect':
      pts.push({x:x1,y:y1,size:sz}); pts.push({x:x2,y:y1,size:sz});
      pts.push({x:x2,y:y2,size:sz}); pts.push({x:x1,y:y2,size:sz}); pts.push({x:x1,y:y1,size:sz});
      break;
    case 'circle': {
      const ccx = (x1 + x2) / 2, ccy = (y1 + y2) / 2;
      const rx = w / 2, ry = h / 2;
      const steps = Math.max(48, Math.round(Math.max(rx, ry) * 0.8));
      const step = (Math.PI * 2) / steps;
      for (let i = 0; i <= steps; i++) {
        const a = i * step;
        pts.push({x: ccx + Math.cos(a) * rx, y: ccy + Math.sin(a) * ry, size: sz});
      }
      break;
    }
    case 'triangle': {
      const midX = (x1 + x2) / 2;
      pts.push({x:midX, y:y1, size:sz}); pts.push({x:x2, y:y2, size:sz});
      pts.push({x:x1, y:y2, size:sz}); pts.push({x:midX, y:y1, size:sz});
      break;
    }
    case 'diamond': {
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      pts.push({x:mx, y:y1, size:sz}); pts.push({x:x2, y:my, size:sz});
      pts.push({x:mx, y:y2, size:sz}); pts.push({x:x1, y:my, size:sz}); pts.push({x:mx, y:y1, size:sz});
      break;
    }
  }
  S.currentStroke.points = pts;
}

// ─── TEXT TOOL ───────────────────────────────────────
function openTextBox(cx, cy) {
  const ta = document.createElement('textarea');
  ta.className = 'text-overlay';
  ta.style.left = cx + 'px'; ta.style.top = cy + 'px';
  const opts = S.textOpts;
  let fontStr = '';
  if (opts.italic) fontStr += 'italic ';
  if (opts.bold) fontStr += 'bold ';
  fontStr += opts.fontSize + 'px ' + opts.fontFamily;
  ta.style.font = fontStr;
  ta.style.color = S.color;
  ta.style.textAlign = opts.align;
  document.body.appendChild(ta);
  setTimeout(() => ta.focus(), 0);

  function commit() {
    const text = ta.value.trim();
    if (text) {
      const layer = getActiveLayer();
      const page = getPage();
      if (layer && page) {
        const tb = {
          id: Date.now(),
          text,
          x: (cx - S.pan.x) / S.zoom,
          y: (cy - S.pan.y) / S.zoom,
          color: S.color,
          fontFamily: opts.fontFamily,
          fontSize: opts.fontSize,
          bold: opts.bold,
          italic: opts.italic,
          align: opts.align,
        };
        layer.textBoxes.push(tb);
        renderTextBox(layer.ctx, tb);
        page.undoHistory.push({ type:'text', layerIdx: page.activeLayer, textBox: tb });
        page.redoHistory = [];
        updateHistorySlider();
        renderAll();
        autoSave();
      }
    }
    ta.remove();
  }

  ta.addEventListener('keydown', e => {
    if (e.key === 'Escape') { ta.value = ''; commit(); }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); }
  });

  ta.addEventListener('blur', () => {
    setTimeout(() => {
      if (!document.body.contains(ta)) return;
      const focused = document.activeElement;
      if (focused && focused.closest('#text-toolbar')) {
        ta.focus();
        return;
      }
      commit();
    }, 150);
  });
}

// ─── TEXT TOOLBAR ────────────────────────────────────
document.getElementById('text-font').addEventListener('change', function() {
  S.textOpts.fontFamily = this.value;
});
document.getElementById('text-size').addEventListener('input', function() {
  const v = Math.max(8, Math.min(200, +this.value || 24));
  S.textOpts.fontSize = v;
});
document.getElementById('text-bold').addEventListener('click', function() {
  S.textOpts.bold = !S.textOpts.bold;
  this.classList.toggle('active', S.textOpts.bold);
});
document.getElementById('text-italic').addEventListener('click', function() {
  S.textOpts.italic = !S.textOpts.italic;
  this.classList.toggle('active', S.textOpts.italic);
});
['left','center','right'].forEach(al => {
  document.getElementById('text-align-' + al).addEventListener('click', function() {
    S.textOpts.align = al;
    document.querySelectorAll('#text-toolbar .tt-btn[id^="text-align"]').forEach(b => b.classList.remove('active'));
    this.classList.add('active');
  });
});

// ─── HIT-TESTING (text & image) ──────────────────────
function hitTestTextBox(px, py) {
  const page = getPage();
  if (!page) return null;
  for (let li = page.layers.length - 1; li >= 0; li--) {
    const layer = page.layers[li];
    if (!layer.visible) continue;
    for (let ti = layer.textBoxes.length - 1; ti >= 0; ti--) {
      const tb = layer.textBoxes[ti];
      const w = tb._width || 150, h = tb._height || (tb.fontSize || 24) * 1.4;
      if (px >= tb.x && px <= tb.x + w && py >= tb.y && py <= tb.y + h) return tb;
    }
  }
  return null;
}

function hitTestImage(px, py) {
  const page = getPage();
  if (!page) return null;
  for (let li = page.layers.length - 1; li >= 0; li--) {
    const layer = page.layers[li];
    if (!layer.visible) continue;
    for (let ii = (layer.images || []).length - 1; ii >= 0; ii--) {
      const img = layer.images[ii];
      if (px >= img.x && px <= img.x + img.width && py >= img.y && py <= img.y + img.height) return img;
    }
  }
  return null;
}

// ─── ELEMENT SELECTION OVERLAY ───────────────────────
const elOverlay = document.getElementById('element-overlay');
const overlayDrag = document.getElementById('overlay-drag-handle');
const overlayEdit = document.getElementById('overlay-edit-btn');
const overlayDel = document.getElementById('overlay-delete-btn');
const overlayResizeHandles = document.getElementById('overlay-resize-handles');

function showElementOverlay(obj, type) {
  const sc = toScreen(obj.x, obj.y);
  let w, h;
  if (type === 'text') {
    w = (obj._width || 150) * S.zoom;
    h = (obj._height || (obj.fontSize || 24) * 1.4) * S.zoom;
    overlayResizeHandles.classList.remove('visible');
    overlayEdit.style.display = '';
  } else {
    w = obj.width * S.zoom;
    h = obj.height * S.zoom;
    overlayResizeHandles.classList.add('visible');
    overlayEdit.style.display = 'none';
  }

  elOverlay.style.left = sc.x + 'px';
  elOverlay.style.top = sc.y + 'px';
  elOverlay.style.width = w + 'px';
  elOverlay.style.height = h + 'px';
  elOverlay.style.display = 'block';
  elOverlay.dataset.type = type;
}

function hideElementOverlay() {
  elOverlay.style.display = 'none';
  S.selectedTextBox = null;
  S.selectedImage = null;
}

function updateOverlayPosition() {
  const obj = S.selectedTextBox || S.selectedImage;
  if (!obj) { hideElementOverlay(); return; }
  const type = S.selectedTextBox ? 'text' : 'image';
  showElementOverlay(obj, type);
}

overlayDrag.addEventListener('pointerdown', e => {
  e.preventDefault(); e.stopPropagation();
  const obj = S.selectedTextBox || S.selectedImage;
  if (!obj) return;
  const startX = e.clientX, startY = e.clientY;
  const origX = obj.x, origY = obj.y;

  function move(ev) {
    const dx = (ev.clientX - startX) / S.zoom;
    const dy = (ev.clientY - startY) / S.zoom;
    obj.x = origX + dx; obj.y = origY + dy;
    updateOverlayPosition();
    reRenderLayers();
  }
  function up() {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    autoSave();
  }
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
});

overlayDel.addEventListener('click', e => {
  e.stopPropagation();
  const page = getPage();
  if (!page) return;

  if (S.selectedTextBox) {
    for (const layer of page.layers) {
      const idx = layer.textBoxes.indexOf(S.selectedTextBox);
      if (idx >= 0) {
        const removed = layer.textBoxes.splice(idx, 1)[0];
        page.undoHistory.push({ type:'delete-text', layerIdx: page.layers.indexOf(layer), textBox: removed, index: idx });
        page.redoHistory = [];
        break;
      }
    }
  } else if (S.selectedImage) {
    for (const layer of page.layers) {
      const idx = (layer.images || []).indexOf(S.selectedImage);
      if (idx >= 0) {
        const removed = layer.images.splice(idx, 1)[0];
        page.undoHistory.push({ type:'delete-image', layerIdx: page.layers.indexOf(layer), image: removed, index: idx });
        page.redoHistory = [];
        break;
      }
    }
  }

  hideElementOverlay();
  reRenderLayers();
  updateHistorySlider();
  autoSave();
  showNotif('Deleted');
});

overlayEdit.addEventListener('click', e => {
  e.stopPropagation();
  if (!S.selectedTextBox) return;
  const tb = S.selectedTextBox;
  const sc = toScreen(tb.x, tb.y);

  hideElementOverlay();

  const ta = document.createElement('textarea');
  ta.className = 'text-overlay';
  ta.style.left = sc.x + 'px'; ta.style.top = sc.y + 'px';
  let fontStr = '';
  if (tb.italic) fontStr += 'italic ';
  if (tb.bold) fontStr += 'bold ';
  fontStr += (tb.fontSize || 24) + 'px ' + (tb.fontFamily || 'Inter, sans-serif');
  ta.style.font = fontStr;
  ta.style.color = tb.color;
  ta.style.textAlign = tb.align || 'left';
  ta.value = tb.text;
  document.body.appendChild(ta);
  setTimeout(() => { ta.focus(); ta.select(); }, 0);

  function commit() {
    const text = ta.value.trim();
    if (text) {
      tb.text = text;
      tb._width = null; tb._height = null;
    } else {
      const page = getPage();
      if (page) {
        for (const layer of page.layers) {
          const idx = layer.textBoxes.indexOf(tb);
          if (idx >= 0) { layer.textBoxes.splice(idx, 1); break; }
        }
      }
    }
    ta.remove();
    reRenderLayers();
    autoSave();
  }

  ta.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { ta.remove(); return; }
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); commit(); }
  });
  ta.addEventListener('blur', () => {
    setTimeout(() => {
      if (!document.body.contains(ta)) return;
      const focused = document.activeElement;
      if (focused && focused.closest('#text-toolbar')) {
        ta.focus();
        return;
      }
      commit();
    }, 150);
  });
});

overlayResizeHandles.querySelectorAll('.resize-dot').forEach(dot => {
  dot.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation();
    const img = S.selectedImage;
    if (!img) return;
    const handle = dot.dataset.handle;
    const startX = e.clientX, startY = e.clientY;
    let origX = img.x, origY = img.y, origW = img.width, origH = img.height;

    function move(ev) {
      const dx = (ev.clientX - startX) / S.zoom;
      const dy = (ev.clientY - startY) / S.zoom;
      let x = origX, y = origY, w = origW, h = origH;
      if (handle === 'se') { w = Math.max(20, origW + dx); h = Math.max(20, origH + dy); }
      else if (handle === 'sw') { x = origX + dx; w = Math.max(20, origW - dx); h = Math.max(20, origH + dy); }
      else if (handle === 'ne') { y = origY + dy; w = Math.max(20, origW + dx); h = Math.max(20, origH - dy); }
      else if (handle === 'nw') { x = origX + dx; y = origY + dy; w = Math.max(20, origW - dx); h = Math.max(20, origH - dy); }
      else if (handle === 'e') { w = Math.max(20, origW + dx); }
      else if (handle === 'w') { x = origX + dx; w = Math.max(20, origW - dx); }
      else if (handle === 's') { h = Math.max(20, origH + dy); }
      else if (handle === 'n') { y = origY + dy; h = Math.max(20, origH - dy); }
      img.x = x; img.y = y; img.width = w; img.height = h;
      updateOverlayPosition();
      reRenderLayers();
    }
    function up() {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      autoSave();
    }
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  });
});

function reRenderLayers() {
  const page = getPage();
  if (!page) return;
  page.layers.forEach(l => redrawLayerCanvas(l));
  renderAll(); renderPagesPanel(); updateMinimap();
}

// ─── IMAGE SYSTEM ────────────────────────────────────
function addImage(dataURL) {
  const img = new Image();
  img.onload = () => {
    const layer = getActiveLayer();
    const page = getPage();
    if (!layer || !page) return;

    const viewCX = (strokeCanvas.width / 2 - S.pan.x) / S.zoom;
    const viewCY = (strokeCanvas.height / 2 - S.pan.y) / S.zoom;

    let w = img.naturalWidth, h = img.naturalHeight;
    const maxDim = 600;
    if (w > maxDim || h > maxDim) {
      const scale = maxDim / Math.max(w, h);
      w *= scale; h *= scale;
    }

    const imageObj = {
      id: Date.now(), dataURL,
      x: viewCX - w / 2, y: viewCY - h / 2,
      width: w, height: h,
      _el: img,
    };

    layer.images.push(imageObj);
    renderImageObj(layer.ctx, imageObj);
    page.undoHistory.push({ type:'image', layerIdx: page.activeLayer, image: imageObj });
    page.redoHistory = [];
    updateHistorySlider();
    renderAll();

    setTool('select');
    S.selectedImage = imageObj;
    S.selectedTextBox = null;
    showElementOverlay(imageObj, 'image');

    showNotif('Image added');
    autoSave();
  };
  img.src = dataURL;
}

function loadImageElement(imgObj) {
  return new Promise(resolve => {
    if (imgObj._el) { resolve(); return; }
    const img = new Image();
    img.onload = () => { imgObj._el = img; resolve(); };
    img.onerror = () => resolve();
    img.src = imgObj.dataURL;
  });
}

document.getElementById('image-btn').addEventListener('click', () => {
  document.getElementById('image-input').click();
});

document.getElementById('image-input').addEventListener('change', function() {
  if (!this.files.length) return;
  const file = this.files[0];
  if (!file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = () => addImage(reader.result);
  reader.readAsDataURL(file);
  this.value = '';
});

document.addEventListener('paste', e => {
  const items = (e.clipboardData || e.originalEvent?.clipboardData)?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      const reader = new FileReader();
      reader.onload = () => addImage(reader.result);
      reader.readAsDataURL(file);
      return;
    }
  }
});

document.addEventListener('dragover', e => {
  e.preventDefault();
  document.body.classList.add('dragover');
});
document.addEventListener('dragleave', e => {
  if (e.relatedTarget === null) document.body.classList.remove('dragover');
});
document.addEventListener('drop', e => {
  e.preventDefault();
  document.body.classList.remove('dragover');
  for (const file of e.dataTransfer.files) {
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => addImage(reader.result);
      reader.readAsDataURL(file);
      return;
    }
  }
});

// ─── LASER ───────────────────────────────────────────
const laserCursor = document.getElementById('laser-cursor');
function moveLaserCursor(cx, cy) {
  laserCursor.style.left = cx+'px'; laserCursor.style.top = cy+'px';
  laserCursor.style.display = 'block';
}
function pruneLaser() {
  const now = Date.now();
  S.laserTrails = S.laserTrails.filter(t => {
    t.points = t.points.filter(p => (now - p.t) < 2200);
    return t.points.length > 0;
  });
  if (S.laserTrails.length) setTimeout(() => { scheduleRender(); pruneLaser(); }, 40);
}
strokeCanvas.addEventListener('pointerleave', () => {
  laserCursor.style.display = 'none';
  document.getElementById('eraser-cursor').style.display = 'none';
});

// ─── ZOOM & PAN ──────────────────────────────────────
strokeCanvas.addEventListener('wheel', e => {
  e.preventDefault();
  const factor = Math.exp(-e.deltaY * 0.001 * (e.ctrlKey ? 5 : 1));
  const cx = e.clientX, cy = e.clientY;
  const wx = (cx - S.pan.x) / S.zoom, wy = (cy - S.pan.y) / S.zoom;
  S.zoom = Math.min(12, Math.max(0.05, S.zoom * factor));
  S.pan.x = cx - wx * S.zoom; S.pan.y = cy - wy * S.zoom;
  renderGrid(); scheduleRender(); updateZoomLabel();
  hideElementOverlay();
}, { passive: false });

function zoomAt(factor) {
  const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
  const wx = (cx-S.pan.x)/S.zoom, wy = (cy-S.pan.y)/S.zoom;
  S.zoom = Math.min(12, Math.max(0.05, S.zoom * factor));
  S.pan.x = cx - wx*S.zoom; S.pan.y = cy - wy*S.zoom;
  renderGrid(); scheduleRender(); updateZoomLabel();
}

function updateZoomLabel() {
  const label = Math.round(S.zoom * 100) + '%';
  document.getElementById('zoom-indicator').textContent = label;
  document.getElementById('zoom-label').textContent = label;
}

document.getElementById('zoom-in-btn').addEventListener('click',  () => zoomAt(1.25));
document.getElementById('zoom-out-btn').addEventListener('click', () => zoomAt(0.8));

// ─── GRID ────────────────────────────────────────────
function renderGrid() {
  const w = gridCanvas.width, h = gridCanvas.height;
  gctx.clearRect(0, 0, w, h);
  if (!S.grid) return;
  const size = 40 * S.zoom;
  const ox = S.pan.x % size, oy = S.pan.y % size;
  const minor = S.dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)';
  const major = S.dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.09)';

  gctx.strokeStyle = minor; gctx.lineWidth = 1; gctx.beginPath();
  for (let x=ox; x<w; x+=size) { gctx.moveTo(x,0); gctx.lineTo(x,h); }
  for (let y=oy; y<h; y+=size) { gctx.moveTo(0,y); gctx.lineTo(w,y); }
  gctx.stroke();

  const ms = size * 5, mox = S.pan.x % ms, moy = S.pan.y % ms;
  gctx.strokeStyle = major; gctx.beginPath();
  for (let x=mox; x<w; x+=ms) { gctx.moveTo(x,0); gctx.lineTo(x,h); }
  for (let y=moy; y<h; y+=ms) { gctx.moveTo(0,y); gctx.lineTo(w,y); }
  gctx.stroke();
}

// ─── MINIMAP ─────────────────────────────────────────
const minimapCanvas = document.getElementById('minimap-canvas');
const mmctx = minimapCanvas.getContext('2d');

function updateMinimap() {
  if (!S.minimapOpen) return;
  const mw = 160, mh = 110;
  const page = getPage();
  mmctx.clearRect(0, 0, mw, mh);
  mmctx.fillStyle = S.dark ? '#0c0c10' : '#f4f4f8';
  mmctx.fillRect(0, 0, mw, mh);
  if (page) {
    const sx = mw/PAGE_W, sy = mh/PAGE_H;
    mmctx.save(); mmctx.scale(sx, sy);
    page.layers.forEach(l => { if (l.visible) mmctx.drawImage(l.canvas, 0, 0); });
    mmctx.restore();
  }
  const vw = strokeCanvas.width / S.zoom * (mw/PAGE_W);
  const vh = strokeCanvas.height / S.zoom * (mh/PAGE_H);
  const vx = -S.pan.x / S.zoom * (mw/PAGE_W);
  const vy = -S.pan.y / S.zoom * (mh/PAGE_H);
  const vp = document.getElementById('minimap-viewport');
  vp.style.left=Math.max(0,vx)+'px'; vp.style.top=Math.max(0,vy)+'px';
  vp.style.width=Math.min(mw,vw)+'px'; vp.style.height=Math.min(mh,vh)+'px';
}

minimapCanvas.addEventListener('click', e => {
  const rect = minimapCanvas.getBoundingClientRect();
  const mx = e.clientX-rect.left, my = e.clientY-rect.top;
  const px=(mx/160)*PAGE_W, py=(my/110)*PAGE_H;
  S.pan.x = window.innerWidth/2 - px*S.zoom;
  S.pan.y = window.innerHeight/2 - py*S.zoom;
  renderGrid(); scheduleRender(); updateMinimap();
});

document.getElementById('minimap-btn').addEventListener('click', function() {
  S.minimapOpen = !S.minimapOpen;
  document.getElementById('minimap-wrap').classList.toggle('open', S.minimapOpen);
  this.classList.toggle('active', S.minimapOpen);
  if (S.minimapOpen) updateMinimap();
});

// ─── UNDO / REDO ─────────────────────────────────────
function undo() {
  const page = getPage();
  if (!page || !page.undoHistory.length) { showNotif('Nothing to undo'); return; }
  const action = page.undoHistory.pop();
  page.redoHistory.push(action);

  const layer = page.layers[action.layerIdx];

  switch (action.type) {
    case 'stroke':
      if (layer) { layer.strokes.pop(); redrawLayerCanvas(layer); }
      break;
    case 'erase-stroke':
      if (layer) { layer.strokes.splice(action.index, 0, action.stroke); redrawLayerCanvas(layer); }
      break;
    case 'erase-text':
      if (layer) { layer.textBoxes.splice(action.index, 0, action.textBox); redrawLayerCanvas(layer); }
      break;
    case 'text':
      if (layer) {
        const idx = layer.textBoxes.indexOf(action.textBox);
        if (idx >= 0) layer.textBoxes.splice(idx, 1);
        redrawLayerCanvas(layer);
      }
      break;
    case 'delete-text':
      if (layer) {
        layer.textBoxes.splice(action.index, 0, action.textBox);
        redrawLayerCanvas(layer);
      }
      break;
    case 'image':
      if (layer) {
        const idx = (layer.images || []).indexOf(action.image);
        if (idx >= 0) layer.images.splice(idx, 1);
        redrawLayerCanvas(layer);
      }
      break;
    case 'delete-image':
      if (layer) {
        layer.images.splice(action.index, 0, action.image);
        redrawLayerCanvas(layer);
      }
      break;
  }

  hideElementOverlay();
  renderAll(); renderPagesPanel(); updateMinimap(); updateHistorySlider();
  showNotif('↩ Undo');
  autoSave();
}

function redo() {
  const page = getPage();
  if (!page || !page.redoHistory.length) { showNotif('Nothing to redo'); return; }
  const action = page.redoHistory.pop();
  page.undoHistory.push(action);

  const layer = page.layers[action.layerIdx];

  switch (action.type) {
    case 'stroke':
      if (layer) { layer.strokes.push(action.stroke); redrawLayerCanvas(layer); }
      break;
    case 'erase-stroke':
      if (layer) {
        const idx = layer.strokes.indexOf(action.stroke);
        if (idx >= 0) layer.strokes.splice(idx, 1);
        redrawLayerCanvas(layer);
      }
      break;
    case 'erase-text':
      if (layer) {
        const idx = layer.textBoxes.indexOf(action.textBox);
        if (idx >= 0) layer.textBoxes.splice(idx, 1);
        redrawLayerCanvas(layer);
      }
      break;
    case 'text':
      if (layer) {
        layer.textBoxes.push(action.textBox);
        redrawLayerCanvas(layer);
      }
      break;
    case 'delete-text':
      if (layer) {
        const idx = layer.textBoxes.indexOf(action.textBox);
        if (idx >= 0) layer.textBoxes.splice(idx, 1);
        redrawLayerCanvas(layer);
      }
      break;
    case 'image':
      if (layer) {
        layer.images.push(action.image);
        redrawLayerCanvas(layer);
      }
      break;
    case 'delete-image':
      if (layer) {
        const idx = (layer.images || []).indexOf(action.image);
        if (idx >= 0) layer.images.splice(idx, 1);
        redrawLayerCanvas(layer);
      }
      break;
  }

  hideElementOverlay();
  renderAll(); renderPagesPanel(); updateMinimap(); updateHistorySlider();
  showNotif('↪ Redo');
  autoSave();
}

document.getElementById('undo-btn').addEventListener('click', undo);
document.getElementById('redo-btn').addEventListener('click', redo);

// ─── HISTORY SCRUBBER ────────────────────────────────
function updateHistorySlider() {
  const page = getPage();
  if (!page) return;
  const total = page.undoHistory.length + page.redoHistory.length;
  const current = page.undoHistory.length;
  const sl = document.getElementById('history-slider');
  sl.max = total; sl.value = current;
  document.getElementById('history-count').textContent = `${current}/${total}`;
}

document.getElementById('history-toggle-btn').addEventListener('click', function() {
  S.historyOpen = !S.historyOpen;
  document.getElementById('history-bar').classList.toggle('open', S.historyOpen);
  this.classList.toggle('active', S.historyOpen);
});

document.getElementById('history-slider').addEventListener('input', function() {
  const page = getPage(); if (!page) return;
  const target = +this.value, current = page.undoHistory.length;
  const fn = target < current ? undo : redo;
  const steps = Math.abs(target - current);
  for (let i=0; i<steps; i++) fn();
});

// ─── LAYERS PANEL ────────────────────────────────────
function getThumbBg() {
  return S.dark ? '#161620' : '#f0f0f4';
}

function renderLayersPanel() {
  // Layers panel removed from UI
}

// ─── PAGES PANEL ─────────────────────────────────────
function renderPagesPanel() {
  const list = document.getElementById('page-list');
  list.innerHTML = '';
  S.pages.forEach((page, i) => {
    const div = document.createElement('div');
    div.className = 'page-thumb' + (i === S.currentPage ? ' active' : '');
    const c = document.createElement('canvas');
    c.width = 62; c.height = 42;
    const tc = c.getContext('2d');
    tc.fillStyle = getThumbBg();
    tc.fillRect(0, 0, 62, 42);
    page.layers.forEach(l => { if (l.visible) tc.drawImage(l.canvas, 0, 0, 62, 42); });
    const num = document.createElement('div');
    num.className = 'page-num'; num.textContent = i + 1;
    div.appendChild(c); div.appendChild(num);
    div.addEventListener('click', () => switchPage(i));
    div.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (S.pages.length > 1 && confirm(`Delete page ${i+1}?`)) {
        S.pages.splice(i, 1);
        if (S.currentPage >= S.pages.length) S.currentPage = S.pages.length - 1;
        renderAll(); renderPagesPanel(); renderLayersPanel();
      }
    });
    list.appendChild(div);
  });
  document.getElementById('page-indicator').textContent = `Page ${S.currentPage+1} / ${S.pages.length}`;
}

function switchPage(idx) {
  S.currentPage = idx;
  S.pan = { x: getDefaultPanX(), y: getDefaultPanY() }; S.zoom = 1;
  S.selectedStrokes = []; S.selectedTextBox = null; S.selectedImage = null;
  hideElementOverlay();
  closePanel('inspector');
  renderAll(); renderPagesPanel(); renderLayersPanel(); renderGrid(); updateMinimap();
  updateZoomLabel();
}

document.getElementById('add-page-btn').addEventListener('click', () => {
  S.pages.push(createPage()); switchPage(S.pages.length - 1); showNotif('New page added');
});

// ─── TOOL SYSTEM ─────────────────────────────────────
function setTool(tool, sub) {
  if (tool === 'highlighter' || tool === 'chalk' || tool === 'graphite') {
    S.subTool = tool; S.tool = 'pen';
  } else {
    S.tool = tool;
    if (tool === 'pen') S.subTool = sub || S.subTool || 'pen';
    if (sub) S.subTool = sub;
  }
  if (tool === 'shapes') { S.tool = 'shapes'; S.shapeTool = sub || S.shapeTool || 'rect'; }

  document.querySelectorAll('.ibtn[data-tool]').forEach(b => {
    const isActive = b.dataset.tool === S.tool ||
      (S.tool === 'pen' && ['highlighter','chalk','graphite'].includes(S.subTool) && b.dataset.tool === S.subTool);
    b.classList.toggle('active', isActive);
  });

  strokeCanvas.className = '';
  strokeCanvas.classList.add('tool-' + S.tool);

  document.getElementById('eraser-cursor').style.display = S.tool === 'eraser' ? 'block' : 'none';
  laserCursor.style.display = S.tool === 'laser' ? 'block' : 'none';

  const textToolbar = document.getElementById('text-toolbar');
  textToolbar.classList.toggle('open', S.tool === 'text');

  const shapeBar = document.getElementById('shape-bar');
  shapeBar.classList.toggle('open', S.tool === 'shapes');
  if (S.tool === 'shapes') {
    shapeBar.querySelectorAll('.shape-pick').forEach(b => {
      b.classList.toggle('active', b.dataset.shape === S.shapeTool);
    });
  }

  if (S.tool !== 'select') {
    S.selectedStrokes = [];
    S.selectedTextBox = null;
    S.selectedImage = null;
    document.getElementById('sel-handles').innerHTML = '';
    hideElementOverlay();
    closePanel('inspector');
  }

  if (typeof syncMobileSidebar === 'function') syncMobileSidebar();
}

document.querySelectorAll('.ibtn[data-tool]').forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const tool = btn.dataset.tool;
    if (tool === 'pen') {
      const sub = document.getElementById('draw-sub');
      const isOpen = sub.classList.contains('open');
      closeAllFlyouts();
      if (!isOpen) sub.classList.add('open');
      setTool('pen');
    } else if (tool === 'shapes') {
      closeAllFlyouts();
      setTool('shapes');
    } else if (tool === 'eraser') {
      const sub = document.getElementById('eraser-sub');
      const isOpen = sub.classList.contains('open');
      closeAllFlyouts();
      if (!isOpen) sub.classList.add('open');
      setTool('eraser');
    } else {
      closeAllFlyouts();
      setTool(tool);
    }
  });
});

document.querySelectorAll('#draw-sub .sub-item').forEach(item => {
  item.addEventListener('click', e => {
    e.stopPropagation();
    const st = item.dataset.subtool;
    document.querySelectorAll('#draw-sub .sub-item').forEach(s => s.classList.remove('active'));
    item.classList.add('active');
    setTool('pen', st);
    document.getElementById('draw-sub').classList.remove('open');
    showNotif(`Tool: ${st.charAt(0).toUpperCase()+st.slice(1)}`);
  });
});

document.querySelectorAll('#shape-bar .shape-pick').forEach(item => {
  item.addEventListener('click', e => {
    e.stopPropagation();
    const sh = item.dataset.shape;
    document.querySelectorAll('#shape-bar .shape-pick').forEach(s => s.classList.remove('active'));
    item.classList.add('active');
    S.shapeTool = sh;
    setTool('shapes', sh);
    showNotif(`Shape: ${sh.charAt(0).toUpperCase()+sh.slice(1)}`);
  });
});

document.querySelectorAll('#eraser-sub .sub-item').forEach(item => {
  item.addEventListener('click', e => {
    e.stopPropagation();
    const mode = item.dataset.erasermode;
    S.eraserMode = mode;
    document.querySelectorAll('#eraser-sub .sub-item').forEach(s => s.classList.remove('active'));
    item.classList.add('active');
    setTool('eraser');
    document.getElementById('eraser-sub').classList.remove('open');
    showNotif(`Eraser: ${mode.charAt(0).toUpperCase()+mode.slice(1)}`);
  });
});

document.getElementById('smart-shape-btn').addEventListener('click', function() {
  S.smartSnap = !S.smartSnap;
  this.classList.toggle('active', S.smartSnap);
  showNotif('Smart Snap: ' + (S.smartSnap ? 'ON' : 'OFF'));
});

// ─── FLYOUT HELPERS ──────────────────────────────────
function openPanel(id) { document.getElementById(id).classList.add('open'); }
function closePanel(id) { document.getElementById(id).classList.remove('open'); }
function closeAllFlyouts() {
  document.querySelectorAll('.sub-tools').forEach(s => s.classList.remove('open'));
  closePanel('stroke-options');
  closePanel('color-picker-panel');
}

document.addEventListener('click', e => {
  if (!e.target.closest('.tool-group')) document.querySelectorAll('.sub-tools').forEach(s => s.classList.remove('open'));
  if (!e.target.closest('#stroke-options') && !e.target.closest('#stroke-options-btn')) closePanel('stroke-options');
  if (!e.target.closest('#color-picker-panel') && !e.target.closest('#color-btn')) closePanel('color-picker-panel');
  if (!e.target.closest('#shape-bar') && !e.target.closest('#tool-shapes') && S.tool !== 'shapes') {
    document.getElementById('shape-bar').classList.remove('open');
  }
  if (!e.target.closest('#radial-menu')) closeRadialMenu();
  if (!e.target.closest('#element-overlay') && !e.target.closest('#stroke-canvas') && S.tool === 'select') {
    // keep overlay
  }
});

// ─── STROKE OPTIONS PANEL ────────────────────────────
document.getElementById('stroke-options-btn').addEventListener('click', function(e) {
  e.stopPropagation();
  const panel = document.getElementById('stroke-options');
  const isOpen = panel.classList.contains('open');
  closeAllFlyouts();
  if (!isOpen) {
    if (window.innerWidth <= 600) {
      panel.style.top = 'auto';
    } else {
      const rect = this.getBoundingClientRect();
      panel.style.top = rect.top + 'px';
    }
    panel.classList.add('open');
  }
});

// ─── COLOR SYSTEM ────────────────────────────────────
const cpPre = document.getElementById('cp-presets');
CP_COLORS.forEach(c => {
  const s = document.createElement('div');
  s.className = 'cp-swatch'; s.style.background = c; s.dataset.color = c;
  s.title = c;
  s.addEventListener('click', () => selectColor(c));
  cpPre.appendChild(s);
});

document.getElementById('cp-native').addEventListener('input', e => selectColor(e.target.value));
document.getElementById('cp-hex').addEventListener('change', e => {
  const v = e.target.value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(v)) selectColor(v);
});

function selectColor(hex) {
  S.color = hex;
  document.querySelectorAll('.cp-swatch').forEach(s => s.classList.toggle('active', s.dataset.color === hex));
  const ring = document.getElementById('color-ring');
  if (ring) ring.style.background = hex;
  try { document.getElementById('cp-native').value = hex; } catch(e) {}
  document.getElementById('cp-hex').value = hex;
}

function rgbToHex(rgb) {
  if (!rgb || rgb.startsWith('#')) return rgb;
  const m = rgb.match(/\d+/g);
  if (!m || m.length < 3) return rgb;
  return '#' + m.slice(0,3).map(n => (+n).toString(16).padStart(2,'0')).join('');
}

document.getElementById('color-btn').addEventListener('click', function(e) {
  e.stopPropagation();
  const panel = document.getElementById('color-picker-panel');
  const isOpen = panel.classList.contains('open');
  closeAllFlyouts();
  if (!isOpen) {
    if (window.innerWidth <= 600) {
      panel.style.top = 'auto';
      panel.style.left = '50%';
    } else {
      const rect = this.getBoundingClientRect();
      panel.style.top = rect.top + 'px';
      panel.style.left = (rect.right + 8) + 'px';
    }
    panel.classList.add('open');
  }
});

// ─── PEN & ERASER SIZE SLIDERS ───────────────────────
const penSizeSlider = document.getElementById('pen-size-slider');
const eraserSizeSlider = document.getElementById('eraser-size-slider');
penSizeSlider.addEventListener('input', () => {
  S.penSize = +penSizeSlider.value;
  document.getElementById('pen-size-val').textContent = S.penSize;
});
eraserSizeSlider.addEventListener('input', () => {
  S.eraserSize = +eraserSizeSlider.value;
  document.getElementById('eraser-size-val').textContent = S.eraserSize;
});

// ─── SMOOTHING ───────────────────────────────────────
['raw','std','arch'].forEach(m => {
  document.getElementById('smooth-' + m).addEventListener('click', function() {
    S.smoothMode = m;
    document.querySelectorAll('.smooth-btn').forEach(b => b.classList.remove('active'));
    this.classList.add('active');
    showNotif(SMOOTH_MODES[m].label);
  });
});

// ─── INSPECTOR ───────────────────────────────────────
document.getElementById('insp-del').addEventListener('click', () => {
  const page = getPage(); if (!page || !S.selectedStrokes.length) return;
  page.layers.forEach(l => { l.strokes = l.strokes.filter(s => !S.selectedStrokes.includes(s)); redrawLayerCanvas(l); });
  S.selectedStrokes = [];
  closePanel('inspector');
  renderAll(); showNotif('Deleted');
  autoSave();
});

document.getElementById('insp-dupe').addEventListener('click', () => {
  const layer = getActiveLayer(); if (!layer || !S.selectedStrokes.length) return;
  S.selectedStrokes.forEach(s => {
    const clone = JSON.parse(JSON.stringify(s));
    clone.points = clone.points.map(p => ({...p, x:p.x+20, y:p.y+20}));
    layer.strokes.push(clone); drawStrokeToCtx(layer.ctx, clone);
  });
  renderAll(); showNotif('Duplicated');
  autoSave();
});

document.getElementById('insp-bring').addEventListener('click', () => {
  const layer = getActiveLayer(); if (!layer || !S.selectedStrokes.length) return;
  S.selectedStrokes.forEach(s => {
    const idx = layer.strokes.indexOf(s);
    if (idx < layer.strokes.length-1) { layer.strokes.splice(idx,1); layer.strokes.push(s); }
  });
  redrawLayerCanvas(layer); renderAll(); showNotif('Brought forward');
});

document.getElementById('insp-size').addEventListener('input', function() {
  S.selectedStrokes.forEach(s => s.size = +this.value);
  const layer = getActiveLayer();
  if (layer) { redrawLayerCanvas(layer); renderAll(); }
});

document.getElementById('insp-opacity').addEventListener('input', function() {
  S.selectedStrokes.forEach(s => s.opacity = +this.value / 100);
  const layer = getActiveLayer();
  if (layer) { redrawLayerCanvas(layer); renderAll(); }
});

// ─── RADIAL CONTEXT MENU ─────────────────────────────
const RADIAL_ITEMS = [
  { icon:'<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/>', label:'Undo', action:'undo', angle:-90 },
  { icon:'<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 000 11H13"/>', label:'Redo', action:'redo', angle:-30 },
  { icon:'<path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>', label:'Pen', action:'pen', angle:30 },
  { icon:'<path d="M20 20H7L3 16l10-10 7 7-3 3"/>', label:'Eraser', action:'eraser', angle:90 },
  { icon:'<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>', label:'Text', action:'text', angle:150 },
  { icon:'<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>', label:'Clear', action:'clear', angle:210 },
];

let radialOpen = false;
function openRadialMenu(cx, cy) {
  radialOpen = true;
  const menu = document.getElementById('radial-menu');
  menu.innerHTML = '';
  menu.style.left = cx+'px'; menu.style.top = cy+'px';

  const bg = document.createElement('div');
  bg.className = 'radial-bg'; bg.style.width='120px'; bg.style.height='120px';
  menu.appendChild(bg);

  RADIAL_ITEMS.forEach((item, i) => {
    const angle = (item.angle - 90) * Math.PI / 180, r = 56;
    const btn = document.createElement('div');
    btn.className = 'radial-item';
    btn.style.left = Math.cos(angle)*r+'px'; btn.style.top = Math.sin(angle)*r+'px';
    btn.style.transitionDelay = (i*25)+'ms';
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">${item.icon}</svg>`;
    btn.title = item.label;
    btn.addEventListener('click', () => {
      closeRadialMenu();
      if (item.action==='undo') undo();
      else if (item.action==='redo') redo();
      else if (item.action==='clear') clearPage();
      else setTool(item.action);
    });
    menu.appendChild(btn);
  });
  menu.classList.add('open');
}

function closeRadialMenu() {
  radialOpen = false;
  document.getElementById('radial-menu').classList.remove('open');
}

strokeCanvas.addEventListener('contextmenu', e => { e.preventDefault(); openRadialMenu(e.clientX, e.clientY); });

// ─── CLEAR PAGE ──────────────────────────────────────
function clearPage() {
  const page = getPage(); if (!page) return;
  if (!confirm('Clear all content on this page?')) return;
  page.layers.forEach(l => { l.strokes=[]; l.textBoxes=[]; l.images=[]; l.ctx.clearRect(0,0,PAGE_W,PAGE_H); });
  page.undoHistory=[]; page.redoHistory=[]; S.selectedStrokes=[];
  S.selectedTextBox=null; S.selectedImage=null;
  hideElementOverlay();
  closePanel('inspector');
  renderAll(); renderPagesPanel(); updateMinimap(); updateHistorySlider();
  showNotif('Page cleared');
  autoSave();
}

// ─── EXPORT ──────────────────────────────────────────
function exportPNG() {
  const page = getPage(); if (!page) return;
  const out = document.createElement('canvas');
  out.width = PAGE_W; out.height = PAGE_H;
  const oc = out.getContext('2d');
  oc.fillStyle='#ffffff'; oc.fillRect(0,0,PAGE_W,PAGE_H);
  page.layers.forEach(l => { if(l.visible){ oc.save(); oc.globalAlpha=l.opacity; oc.drawImage(l.canvas,0,0); oc.restore(); } });
  const link = document.createElement('a');
  link.download = `tirrexboard-page-${S.currentPage+1}.png`;
  link.href = out.toDataURL('image/png');
  link.click();
  showNotif('PNG exported');
}
document.getElementById('export-btn').addEventListener('click', exportPNG);

// ─── THEME ───────────────────────────────────────────
document.getElementById('theme-btn').addEventListener('click', () => {
  S.dark = !S.dark;
  document.body.classList.toggle('dark', S.dark);
  renderGrid(); scheduleRender();
  renderPagesPanel();
  showNotif(S.dark ? 'Dark mode' : 'Light mode');
});

// ─── GRID TOGGLE ─────────────────────────────────────
document.getElementById('grid-btn').addEventListener('click', function() {
  S.grid = !S.grid;
  this.classList.toggle('active', S.grid);
  renderGrid();
  showNotif(S.grid ? 'Grid ON' : 'Grid OFF');
});

// ─── ABOUT MODAL ─────────────────────────────────────
document.getElementById('about-btn').addEventListener('click', () => {
  document.getElementById('about-overlay').classList.add('open');
});
document.getElementById('about-close').addEventListener('click', () => {
  document.getElementById('about-overlay').classList.remove('open');
});
document.getElementById('about-overlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) {
    document.getElementById('about-overlay').classList.remove('open');
  }
});

// ─── MOBILE SIDEBAR ─────────────────────────────────
const mSidebar = document.getElementById('mobile-sidebar');
const mOverlay = document.getElementById('mobile-sidebar-overlay');

function openMobileSidebar() {
  mSidebar.classList.add('open');
  mOverlay.classList.add('open');
  syncMobileSidebar();
}
function closeMobileSidebar() {
  mSidebar.classList.remove('open');
  mOverlay.classList.remove('open');
}

function syncMobileSidebar() {
  mSidebar.querySelectorAll('.ms-btn[data-ms-tool]').forEach(b => {
    const matchTool = b.dataset.msTool === S.tool ||
      (S.tool === 'pen' && b.dataset.msSub && b.dataset.msSub === S.subTool);
    const matchEraser = S.tool === 'eraser' && b.dataset.msTool === 'eraser' &&
      b.dataset.msEraser === S.eraserMode;
    b.classList.toggle('active', matchTool || matchEraser);
  });
  mSidebar.querySelectorAll('.ms-shape-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.msShape === S.shapeTool);
  });
  const snapBadge = document.getElementById('ms-snap-badge');
  if (snapBadge) {
    snapBadge.textContent = S.smartSnap ? 'ON' : 'OFF';
    snapBadge.classList.toggle('on', S.smartSnap);
  }
  const gridBadge = document.getElementById('ms-grid-badge');
  if (gridBadge) {
    gridBadge.textContent = S.grid ? 'ON' : 'OFF';
    gridBadge.classList.toggle('on', S.grid);
  }
  const colorDot = document.getElementById('ms-color-dot');
  if (colorDot) colorDot.style.background = S.color;
}

document.getElementById('mobile-menu-btn').addEventListener('click', e => {
  e.stopPropagation();
  openMobileSidebar();
});
document.getElementById('mobile-sidebar-close').addEventListener('click', closeMobileSidebar);
mOverlay.addEventListener('click', closeMobileSidebar);

mSidebar.querySelectorAll('.ms-btn[data-ms-tool]').forEach(btn => {
  btn.addEventListener('click', () => {
    const tool = btn.dataset.msTool;
    const sub = btn.dataset.msSub;
    const eraserMode = btn.dataset.msEraser;
    if (tool === 'eraser' && eraserMode) {
      S.eraserMode = eraserMode;
      document.querySelectorAll('#eraser-sub .sub-item').forEach(si => {
        si.classList.toggle('active', si.dataset.erasermode === eraserMode);
      });
    }
    setTool(tool, sub);
    closeMobileSidebar();
  });
});

mSidebar.querySelectorAll('.ms-shape-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    S.shapeTool = btn.dataset.msShape;
    setTool('shapes', btn.dataset.msShape);
    syncMobileSidebar();
    closeMobileSidebar();
  });
});

mSidebar.querySelectorAll('.ms-btn[data-ms-action]').forEach(btn => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.msAction;
    switch (action) {
      case 'image':
        document.getElementById('image-input').click();
        closeMobileSidebar();
        break;
      case 'smartsnap':
        S.smartSnap = !S.smartSnap;
        document.getElementById('smart-shape-btn').classList.toggle('active', S.smartSnap);
        showNotif('Smart Snap: ' + (S.smartSnap ? 'ON' : 'OFF'));
        syncMobileSidebar();
        break;
      case 'color':
        closeMobileSidebar();
        setTimeout(() => {
          document.getElementById('color-btn').click();
        }, 300);
        break;
      case 'options':
        closeMobileSidebar();
        setTimeout(() => {
          document.getElementById('stroke-options-btn').click();
        }, 300);
        break;
      case 'grid':
        S.grid = !S.grid;
        document.getElementById('grid-btn').classList.toggle('active', S.grid);
        renderGrid();
        showNotif(S.grid ? 'Grid ON' : 'Grid OFF');
        syncMobileSidebar();
        break;
      case 'history':
        S.historyOpen = !S.historyOpen;
        document.getElementById('history-bar').classList.toggle('open', S.historyOpen);
        document.getElementById('history-toggle-btn').classList.toggle('active', S.historyOpen);
        closeMobileSidebar();
        break;
      case 'minimap':
        S.minimapOpen = !S.minimapOpen;
        document.getElementById('minimap-wrap').classList.toggle('open', S.minimapOpen);
        document.getElementById('minimap-btn').classList.toggle('active', S.minimapOpen);
        if (S.minimapOpen) updateMinimap();
        closeMobileSidebar();
        break;
      case 'theme':
        S.dark = !S.dark;
        document.body.classList.toggle('dark', S.dark);
        renderGrid(); scheduleRender();
        renderPagesPanel();
        showNotif(S.dark ? 'Dark mode' : 'Light mode');
        closeMobileSidebar();
        break;
      case 'export':
        closeMobileSidebar();
        setTimeout(() => exportPNG(), 300);
        break;
      case 'about':
        closeMobileSidebar();
        setTimeout(() => {
          document.getElementById('about-overlay').classList.add('open');
        }, 300);
        break;
    }
  });
});

// ─── KEYBOARD SHORTCUTS ──────────────────────────────
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

  S.shiftHeld = e.shiftKey;

  if (e.code === 'Space' && !S.drawing) { e.preventDefault(); setTool('pan'); return; }
  if (e.code === 'KeyP') setTool('pen', 'pen');
  if (e.code === 'KeyH') setTool('pen', 'highlighter');
  if (e.code === 'KeyE') setTool('eraser');
  if (e.code === 'KeyL') setTool('laser');
  if (e.code === 'KeyT') setTool('text');
  if (e.code === 'KeyS' && !e.ctrlKey) setTool('select');
  if (e.code === 'KeyC' && !e.ctrlKey) setTool('pen', 'chalk');

  if (e.code === 'KeyG' && !e.ctrlKey) {
    S.grid = !S.grid;
    document.getElementById('grid-btn').classList.toggle('active', S.grid);
    renderGrid();
    showNotif(S.grid ? 'Grid ON' : 'Grid OFF');
    return;
  }

  if (e.code === 'KeyR' && !e.ctrlKey) setTool('shapes', 'rect');
  if (e.code === 'KeyO') setTool('shapes', 'circle');

  if (e.ctrlKey || e.metaKey) {
    if (e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    if (e.code === 'KeyY') { e.preventDefault(); redo(); }
    if (e.code === 'Equal') { e.preventDefault(); zoomAt(1.25); }
    if (e.code === 'Minus') { e.preventDefault(); zoomAt(0.8); }
    if (e.code === 'Digit0') {
      e.preventDefault();
      S.zoom=1; S.pan={x:getDefaultPanX(),y:getDefaultPanY()}; renderGrid(); scheduleRender(); updateZoomLabel();
    }
    if (e.code === 'KeyS') { e.preventDefault(); exportPNG(); }
  }

  if (e.code === 'BracketLeft') {
    if (S.tool === 'eraser') { S.eraserSize = Math.max(4, S.eraserSize-4); eraserSizeSlider.value=S.eraserSize; eraserSizeSlider.dispatchEvent(new Event('input')); }
    else { S.penSize = Math.max(1, S.penSize-2); penSizeSlider.value=S.penSize; penSizeSlider.dispatchEvent(new Event('input')); }
  }
  if (e.code === 'BracketRight') {
    if (S.tool === 'eraser') { S.eraserSize = Math.min(120, S.eraserSize+4); eraserSizeSlider.value=S.eraserSize; eraserSizeSlider.dispatchEvent(new Event('input')); }
    else { S.penSize = Math.min(80, S.penSize+2); penSizeSlider.value=S.penSize; penSizeSlider.dispatchEvent(new Event('input')); }
  }

  if (e.code === 'Delete' || e.code === 'Backspace') {
    if (S.selectedTextBox || S.selectedImage) {
      overlayDel.click();
      return;
    }
  }

  if (e.code === 'Escape') {
    closeAllFlyouts(); closeRadialMenu(); closePanel('inspector');
    hideElementOverlay(); closeMobileSidebar();
    document.getElementById('about-overlay').classList.remove('open');
    S.selectedStrokes=[]; S.selectedTextBox=null; S.selectedImage=null;
    document.getElementById('sel-handles').innerHTML=''; scheduleRender();
  }

  const colorMap = {'Digit1':'#e8e6e3','Digit2':'#c50f1f','Digit3':'#ca5010','Digit4':'#c19c00','Digit5':'#0e7a0d','Digit6':'#0078d4','Digit7':'#7160e8'};
  if (!e.ctrlKey && colorMap[e.code]) selectColor(colorMap[e.code]);
});

document.addEventListener('keyup', e => {
  S.shiftHeld = e.shiftKey;
  if (e.code === 'Space' && S.tool === 'pan') {
    setTool('pen'); strokeCanvas.classList.remove('panning');
  }
});

// ─── AUTO SAVE ───────────────────────────────────────
let saveTimer;
function autoSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const data = S.pages.map(p => ({
        layers: p.layers.map(l => ({
          name: l.name, visible: l.visible, locked: l.locked, opacity: l.opacity,
          strokes: l.strokes,
          textBoxes: l.textBoxes,
          images: (l.images || []).map(img => ({
            id: img.id, dataURL: img.dataURL,
            x: img.x, y: img.y, width: img.width, height: img.height,
          })),
        })),
        activeLayer: p.activeLayer
      }));
      localStorage.setItem('tirrexboard_v1', JSON.stringify(data));
    } catch(e) {
      console.warn('Save failed (possibly storage full):', e.message);
    }
  }, 1200);
}

async function loadSaved() {
  try {
    const raw = localStorage.getItem('tirrexboard_v1');
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!Array.isArray(data) || !data.length) return;

    S.pages = data.map(pd => {
      const page = createPage();
      page.activeLayer = pd.activeLayer || 1;
      if (pd.layers) {
        page.layers = pd.layers.map((ld, i) => {
          const layer = createLayer(ld.name || `Layer ${i+1}`, i);
          layer.visible = ld.visible !== false;
          layer.locked = ld.locked || false;
          layer.opacity = ld.opacity ?? 1;
          layer.strokes = ld.strokes || [];
          layer.textBoxes = ld.textBoxes || [];
          layer.images = (ld.images || []).map(img => ({
            ...img, _el: null,
          }));
          return layer;
        });
      }
      return page;
    });

    const imageLoads = [];
    S.pages.forEach(page => {
      page.layers.forEach(layer => {
        (layer.images || []).forEach(img => {
          imageLoads.push(loadImageElement(img));
        });
      });
    });
    await Promise.all(imageLoads);

    S.pages.forEach(page => {
      page.layers.forEach(layer => redrawLayerCanvas(layer));
    });

    renderAll(); renderPagesPanel(); renderLayersPanel(); updateMinimap();
    showNotif('Session restored');
  } catch(e) {
    console.warn('Load failed:', e);
  }
}

// ─── NOTIFICATION ────────────────────────────────────
let notifTimer;
function showNotif(msg) {
  const el = document.getElementById('notif');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(notifTimer);
  notifTimer = setTimeout(() => el.classList.remove('show'), 2000);
}

// ─── TOUCH PINCH ZOOM ────────────────────────────────
let lastTouchDist = -1;
strokeCanvas.addEventListener('touchstart', e => { e.preventDefault(); }, { passive: false });
strokeCanvas.addEventListener('touchmove', e => {
  e.preventDefault();
  if (e.touches.length === 2) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.hypot(dx, dy);
    if (lastTouchDist > 0) {
      const factor = dist / lastTouchDist;
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const wx = (cx-S.pan.x)/S.zoom, wy = (cy-S.pan.y)/S.zoom;
      S.zoom = Math.min(12, Math.max(0.05, S.zoom*factor));
      S.pan.x = cx - wx*S.zoom; S.pan.y = cy - wy*S.zoom;
      renderGrid(); scheduleRender(); updateZoomLabel();
    }
    lastTouchDist = dist;
  } else { lastTouchDist = -1; }
}, { passive: false });
strokeCanvas.addEventListener('touchend', () => { lastTouchDist = -1; }, { passive: false });

// ─── INIT ────────────────────────────────────────────
S.pan = { x: getDefaultPanX(), y: getDefaultPanY() };
resize();
initPages();
selectColor('#e8e6e3');
setTool('pen', 'pen');
loadSaved();

setTimeout(() => showNotif('TirrexBoard · Right-click for quick menu · G for grid'), 600);

setInterval(() => {
  if (S.laserTrails.length && !S.drawing) pruneLaser();
}, 100);
