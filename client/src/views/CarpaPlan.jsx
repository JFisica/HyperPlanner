import { useEffect, useMemo, useRef, useState } from 'react';

const STORAGE_KEY = 'ehw-carpa-plan-v2';
const BASE_WIDTH = 1280;
const BASE_HEIGHT = 800;
const GRID_PX = 40;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 3;

const TOOL_LABELS = {
  select: 'Seleccionar',
  brush: 'Pincel',
  line: 'Línea',
  rect: 'Rectángulo',
  circle: 'Círculo',
  text: 'Texto',
  eraser: 'Goma',
};

const PALETTE = ['#111827', '#ef4444', '#f59e0b', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7', '#ffffff'];

const DEFAULT_VIEW = { zoom: 1, panX: 0, panY: 0 };

function createId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `e-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function metersToWorld(meters, metersPerGrid) {
  return (Number(meters) || 0) * GRID_PX / (Number(metersPerGrid) || 1);
}

function worldToMeters(world, metersPerGrid) {
  return (Number(world) || 0) / GRID_PX * (Number(metersPerGrid) || 1);
}

function normalizeRect(x1, y1, x2, y2) {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  return {
    x,
    y,
    w: Math.abs(x2 - x1),
    h: Math.abs(y2 - y1),
  };
}

function distance(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function pointToSegmentDistance(p, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = p.x - a.x;
  const wy = p.y - a.y;
  const lenSq = vx * vx + vy * vy;
  if (lenSq === 0) return distance(p, a);
  let t = (wx * vx + wy * vy) / lenSq;
  t = clamp(t, 0, 1);
  const proj = { x: a.x + t * vx, y: a.y + t * vy };
  return distance(p, proj);
}

function pointInRect(p, r, padding = 0) {
  return p.x >= r.x - padding && p.x <= r.x + r.w + padding && p.y >= r.y - padding && p.y <= r.y + r.h + padding;
}

function pointInCircle(p, c, padding = 0) {
  return distance(p, { x: c.cx, y: c.cy }) <= c.r + padding;
}

function pointOnHandle(p, handle, radius = 18) {
  return distance(p, handle) <= radius;
}

function alignDown(value, step) {
  return Math.floor(value / step) * step;
}

function textBox(el) {
  const fontSize = el.fontSize || 22;
  const width = Math.max(40, (el.text || '').length * fontSize * 0.58);
  const height = fontSize * 1.25;
  return { x: el.x, y: el.y - fontSize, w: width, h: height };
}

function elementBounds(el) {
  switch (el.type) {
    case 'brush':
    case 'eraser': {
      const points = el.points || [];
      if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      const pad = (el.strokeWidth || 4) * 1.5;
      return {
        x: Math.min(...xs) - pad,
        y: Math.min(...ys) - pad,
        w: Math.max(...xs) - Math.min(...xs) + pad * 2,
        h: Math.max(...ys) - Math.min(...ys) + pad * 2,
      };
    }
    case 'line': {
      const stroke = (el.strokeWidth || 4) * 1.5;
      const x = Math.min(el.x1, el.x2) - stroke;
      const y = Math.min(el.y1, el.y2) - stroke;
      const w = Math.abs(el.x2 - el.x1) + stroke * 2;
      const h = Math.abs(el.y2 - el.y1) + stroke * 2;
      return { x, y, w, h };
    }
    case 'rect': {
      const stroke = (el.strokeWidth || 4) / 2;
      return { x: Math.min(el.x, el.x + el.w) - stroke, y: Math.min(el.y, el.y + el.h) - stroke, w: Math.abs(el.w) + stroke * 2, h: Math.abs(el.h) + stroke * 2 };
    }
    case 'circle': {
      const stroke = (el.strokeWidth || 4) / 2;
      return { x: el.cx - el.r - stroke, y: el.cy - el.r - stroke, w: (el.r + stroke) * 2, h: (el.r + stroke) * 2 };
    }
    case 'text':
      return textBox(el);
    default:
      return { x: 0, y: 0, w: 0, h: 0 };
  }
}

function hitTestElement(p, el) {
  switch (el.type) {
    case 'brush':
    case 'eraser': {
      const bounds = elementBounds(el);
      return pointInRect(p, bounds, 4 + (el.strokeWidth || 4));
    }
    case 'line': {
      const pad = 10 + (el.strokeWidth || 4);
      return pointToSegmentDistance(p, { x: el.x1, y: el.y1 }, { x: el.x2, y: el.y2 }) <= pad;
    }
    case 'rect':
      return pointInRect(p, { x: Math.min(el.x, el.x + el.w), y: Math.min(el.y, el.y + el.h), w: Math.abs(el.w), h: Math.abs(el.h) }, 8 + (el.strokeWidth || 4));
    case 'circle':
      return pointInCircle(p, el, 8 + (el.strokeWidth || 4));
    case 'text':
      return pointInRect(p, textBox(el), 6);
    default:
      return false;
  }
}

function migratePoint(p) {
  if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') return { x: 0, y: 0 };
  if (p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1) {
    return { x: p.x * BASE_WIDTH, y: p.y * BASE_HEIGHT };
  }
  return { x: p.x, y: p.y };
}

function migrateElement(el) {
  const id = el.id || createId();
  if (el.type === 'brush' || el.type === 'eraser') {
    return {
      id,
      type: el.type,
      color: el.color || '#111827',
      strokeWidth: Number(el.strokeWidth || (el.size ? el.size * BASE_WIDTH : 6)),
      points: Array.isArray(el.points) ? el.points.map(migratePoint) : [],
    };
  }
  if (el.type === 'line') {
    if (typeof el.x1 === 'number') {
      return {
        id,
        type: 'line',
        color: el.color || '#111827',
        strokeWidth: Number(el.strokeWidth || 6),
        x1: el.x1,
        y1: el.y1,
        x2: el.x2,
        y2: el.y2,
      };
    }
    const from = migratePoint(el.from || el.start || { x: 0, y: 0 });
    const to = migratePoint(el.to || el.end || { x: 0, y: 0 });
    return {
      id,
      type: 'line',
      color: el.color || '#111827',
      strokeWidth: Number(el.strokeWidth || (el.size ? el.size * BASE_WIDTH : 6)),
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
    };
  }
  if (el.type === 'rect') {
    if (typeof el.x === 'number') {
      return {
        id,
        type: 'rect',
        color: el.color || '#111827',
        strokeWidth: Number(el.strokeWidth || 6),
        fill: !!el.fill,
        x: el.x,
        y: el.y,
        w: el.w,
        h: el.h,
      };
    }
    const from = migratePoint(el.from || { x: 0, y: 0 });
    const to = migratePoint(el.to || { x: 0, y: 0 });
    const r = normalizeRect(from.x, from.y, to.x, to.y);
    return {
      id,
      type: 'rect',
      color: el.color || '#111827',
      strokeWidth: Number(el.strokeWidth || (el.size ? el.size * BASE_WIDTH : 6)),
      fill: !!el.fill,
      ...r,
    };
  }
  if (el.type === 'circle') {
    if (typeof el.cx === 'number') {
      return {
        id,
        type: 'circle',
        color: el.color || '#111827',
        strokeWidth: Number(el.strokeWidth || 6),
        fill: !!el.fill,
        cx: el.cx,
        cy: el.cy,
        r: el.r,
      };
    }
    const center = migratePoint(el.center || el.from || { x: 0, y: 0 });
    const edge = migratePoint(el.to || { x: center.x + 40, y: center.y });
    return {
      id,
      type: 'circle',
      color: el.color || '#111827',
      strokeWidth: Number(el.strokeWidth || 6),
      fill: !!el.fill,
      cx: center.x,
      cy: center.y,
      r: distance(center, edge),
    };
  }
  if (el.type === 'text') {
    const point = migratePoint(el.point || { x: 0, y: 0 });
    return {
      id,
      type: 'text',
      color: el.color || '#111827',
      text: el.text || '',
      fontSize: Number(el.fontSize || (el.size ? el.size * BASE_WIDTH : 22)),
      x: el.x ?? point.x,
      y: el.y ?? point.y,
    };
  }
  return { ...el, id };
}

function loadSavedPlan() {
  if (typeof window === 'undefined') return { elements: [], metersPerGrid: 1 };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { elements: [], metersPerGrid: 1 };
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return { elements: parsed.map(migrateElement), metersPerGrid: 1 };
    }
    const elements = Array.isArray(parsed.elements) ? parsed.elements.map(migrateElement) : [];
    return {
      elements,
      metersPerGrid: Number(parsed.metersPerGrid) || 1,
    };
  } catch {
    return { elements: [], metersPerGrid: 1 };
  }
}

function fmtMeters(value) {
  const v = Number(value) || 0;
  return `${Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2)} m`;
}

function formatViewZoom(value) {
  return `${Math.round((value || 1) * 100)}%`;
}

function elementLabel(el, metersPerGrid) {
  if (!el) return '';
  if (el.type === 'rect') {
    return `${fmtMeters(worldToMeters(el.w, metersPerGrid))} × ${fmtMeters(worldToMeters(el.h, metersPerGrid))}`;
  }
  if (el.type === 'circle') {
    return `r ${fmtMeters(worldToMeters(el.r, metersPerGrid))}`;
  }
  if (el.type === 'line') {
    const len = Math.sqrt((el.x2 - el.x1) ** 2 + (el.y2 - el.y1) ** 2);
    return fmtMeters(worldToMeters(len, metersPerGrid));
  }
  if (el.type === 'text') return el.text || 'Texto';
  if (el.type === 'brush') return 'Pincel';
  if (el.type === 'eraser') return 'Borrado';
  return el.type;
}

function duplicateElement(el) {
  const copy = JSON.parse(JSON.stringify(el));
  copy.id = createId();
  const offset = 24;
  if (copy.type === 'brush' || copy.type === 'eraser') {
    copy.points = (copy.points || []).map((p) => ({ x: p.x + offset, y: p.y + offset }));
  } else if (copy.type === 'line') {
    copy.x1 += offset;
    copy.y1 += offset;
    copy.x2 += offset;
    copy.y2 += offset;
  } else if (copy.type === 'rect') {
    copy.x += offset;
    copy.y += offset;
  } else if (copy.type === 'circle') {
    copy.cx += offset;
    copy.cy += offset;
  } else if (copy.type === 'text') {
    copy.x += offset;
    copy.y += offset;
  }
  return copy;
}

export default function CarpaPlan() {
  const stageRef = useRef(null);
  const svgRef = useRef(null);
  const interactionRef = useRef(null);
  const [{ elements, metersPerGrid }, setPlan] = useState(loadSavedPlan);
  const [tool, setTool] = useState('select');
  const [color, setColor] = useState('#111827');
  const [size, setSize] = useState(6);
  const [fill, setFill] = useState(false);
  const [grid, setGrid] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [view, setView] = useState(DEFAULT_VIEW);
  const [viewport, setViewport] = useState({ width: 1200, height: 700 });

  const selectedElement = useMemo(
    () => elements.find((el) => el.id === selectedId) || null,
    [elements, selectedId]
  );

  const selectedBounds = useMemo(() => (selectedElement ? elementBounds(selectedElement) : null), [selectedElement]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ elements, metersPerGrid }));
    } catch {
      // Ignore persistence failures.
    }
  }, [elements, metersPerGrid]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;

    function update() {
      const rect = el.getBoundingClientRect();
      setViewport({
        width: Math.max(840, Math.floor(rect.width)),
        height: Math.max(620, Math.floor(window.innerHeight * 0.68)),
      });
    }

    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }

    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        setDraft(null);
        interactionRef.current = null;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault();
        setPlan((prev) => ({ ...prev, elements: prev.elements.filter((el) => el.id !== selectedId) }));
        setSelectedId(null);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && selectedElement) {
        e.preventDefault();
        const copy = duplicateElement(selectedElement);
        setPlan((prev) => ({ ...prev, elements: [...prev.elements, copy] }));
        setSelectedId(copy.id);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedElement, selectedId]);

  const viewBox = useMemo(() => ({
    x: view.panX,
    y: view.panY,
    width: viewport.width / view.zoom,
    height: viewport.height / view.zoom,
  }), [view, viewport]);

  function toWorldPoint(clientX, clientY) {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    return {
      x: viewBox.x + sx / view.zoom,
      y: viewBox.y + sy / view.zoom,
    };
  }

  function screenDeltaToWorld(dx, dy) {
    return { x: dx / view.zoom, y: dy / view.zoom };
  }

  function setInteraction(next) {
    interactionRef.current = next;
  }

  function updatePlanElement(id, updater) {
    setPlan((prev) => ({
      ...prev,
      elements: prev.elements.map((el) => (el.id === id ? updater(el) : el)),
    }));
  }

  function addElement(element) {
    setPlan((prev) => ({
      ...prev,
      elements: [...prev.elements, element],
    }));
    setSelectedId(element.id);
  }

  function startDrawing(toolName, start) {
    const base = {
      id: createId(),
      color,
      strokeWidth: size,
    };

    if (toolName === 'brush' || toolName === 'eraser') {
      setDraft({
        ...base,
        type: toolName,
        points: [start],
      });
      return;
    }
    if (toolName === 'line') {
      setDraft({
        ...base,
        type: 'line',
        x1: start.x,
        y1: start.y,
        x2: start.x,
        y2: start.y,
      });
      return;
    }
    if (toolName === 'rect') {
      setDraft({
        ...base,
        type: 'rect',
        fill,
        x: start.x,
        y: start.y,
        w: 0,
        h: 0,
      });
      return;
    }
    if (toolName === 'circle') {
      setDraft({
        ...base,
        type: 'circle',
        fill,
        cx: start.x,
        cy: start.y,
        r: 0,
      });
    }
  }

  function updateDraft(start, current) {
    setDraft((prev) => {
      if (!prev) return prev;
      if (prev.type === 'brush' || prev.type === 'eraser') {
        return { ...prev, points: [...prev.points, current] };
      }
      if (prev.type === 'line') {
        return { ...prev, x2: current.x, y2: current.y };
      }
      if (prev.type === 'rect') {
        const r = normalizeRect(start.x, start.y, current.x, current.y);
        return { ...prev, ...r };
      }
      if (prev.type === 'circle') {
        return { ...prev, r: distance(start, current) };
      }
      return prev;
    });
  }

  function finishDraft() {
    setDraft((prev) => {
      if (!prev) return prev;
      if (prev.type === 'brush' || prev.type === 'eraser') {
        if ((prev.points || []).length === 0) return null;
        addElement(prev);
        return null;
      }
      if (prev.type === 'line' && distance({ x: prev.x1, y: prev.y1 }, { x: prev.x2, y: prev.y2 }) < 2) {
        return null;
      }
      if ((prev.type === 'rect' || prev.type === 'circle') && ((prev.w || prev.r || 0) < 2 || (prev.h || prev.r || 0) < 2)) {
        return null;
      }
      addElement(prev);
      return null;
    });
  }

  function selectElementAt(point) {
    for (let i = elements.length - 1; i >= 0; i -= 1) {
      const el = elements[i];
      if (hitTestElement(point, el)) return el;
    }
    return null;
  }

  function selectedHandles(element) {
    if (!element) return [];
    if (element.type === 'rect') {
      const x = Math.min(element.x, element.x + element.w);
      const y = Math.min(element.y, element.y + element.h);
      const w = Math.abs(element.w);
      const h = Math.abs(element.h);
      return [
        { key: 'nw', x, y },
        { key: 'ne', x: x + w, y },
        { key: 'sw', x, y: y + h },
        { key: 'se', x: x + w, y: y + h },
      ];
    }
    if (element.type === 'circle') {
      return [
        { key: 'radius', x: element.cx + element.r, y: element.cy },
        { key: 'center', x: element.cx, y: element.cy },
      ];
    }
    if (element.type === 'line') {
      return [
        { key: 'start', x: element.x1, y: element.y1 },
        { key: 'end', x: element.x2, y: element.y2 },
      ];
    }
    if (element.type === 'text') {
      const box = textBox(element);
      return [
        { key: 'resize', x: box.x + box.w, y: box.y },
      ];
    }
    return [];
  }

  function handleHit(point, element) {
    const handles = selectedHandles(element);
    for (const handle of handles) {
      if (pointOnHandle(point, handle, 18)) return handle.key;
    }
    return null;
  }

  function applyResize(id, handle, startElement, currentPoint) {
    updatePlanElement(id, () => {
      const el = JSON.parse(JSON.stringify(startElement));
      if (el.type === 'rect') {
        const r = normalizeRect(el.x, el.y, el.x + el.w, el.y + el.h);
        const opposite = {
          nw: { x: r.x + r.w, y: r.y + r.h },
          ne: { x: r.x, y: r.y + r.h },
          sw: { x: r.x + r.w, y: r.y },
          se: { x: r.x, y: r.y },
        }[handle] || { x: r.x, y: r.y };
        const next = normalizeRect(handle === 'nw' ? currentPoint.x : opposite.x, handle === 'nw' ? currentPoint.y : opposite.y, handle === 'se' ? currentPoint.x : opposite.x, handle === 'se' ? currentPoint.y : opposite.y);
        if (handle === 'ne') {
          const x = currentPoint.x;
          const y = opposite.y;
          const w = opposite.x - currentPoint.x;
          const h = currentPoint.y - opposite.y;
          return { ...el, x, y, w, h };
        }
        if (handle === 'sw') {
          const x = currentPoint.x;
          const y = currentPoint.y;
          const w = opposite.x - currentPoint.x;
          const h = opposite.y - currentPoint.y;
          return { ...el, x, y, w, h };
        }
        if (handle === 'nw') {
          const x = currentPoint.x;
          const y = currentPoint.y;
          const w = opposite.x - currentPoint.x;
          const h = opposite.y - currentPoint.y;
          return { ...el, x, y, w, h };
        }
        return { ...el, ...next };
      }
      if (el.type === 'circle') {
        if (handle === 'center') {
          const dx = currentPoint.x - (startElement.cx || 0);
          const dy = currentPoint.y - (startElement.cy || 0);
          return { ...el, cx: startElement.cx + dx, cy: startElement.cy + dy };
        }
        return { ...el, r: Math.max(4, distance({ x: el.cx, y: el.cy }, currentPoint)) };
      }
      if (el.type === 'line') {
        if (handle === 'start') return { ...el, x1: currentPoint.x, y1: currentPoint.y };
        return { ...el, x2: currentPoint.x, y2: currentPoint.y };
      }
      if (el.type === 'text') {
        const box = textBox(el);
        const currentSize = el.fontSize || 22;
        const dx = currentPoint.x - box.x;
        const nextSize = clamp(currentSize + dx * 0.12, 10, 120);
        return { ...el, fontSize: nextSize };
      }
      return el;
    });
  }

  function onStagePointerDown(e) {
    if (e.button !== 0) return;
    const point = toWorldPoint(e.clientX, e.clientY);
    if (!point) return;
    const hit = selectElementAt(point);
    const svg = svgRef.current;
    if (!svg) return;
    svg.setPointerCapture?.(e.pointerId);

    if (tool === 'select') {
      if (hit) {
        setSelectedId(hit.id);
        const handle = hit.id === selectedId ? handleHit(point, hit) : null;
        if (handle) {
          setInteraction({ type: 'resize', id: hit.id, handle, start: point, startElement: JSON.parse(JSON.stringify(hit)) });
          return;
        }
        setInteraction({ type: 'move', id: hit.id, start: point, startElement: JSON.parse(JSON.stringify(hit)) });
        return;
      }
      setSelectedId(null);
      setInteraction({ type: 'pan', start: { x: e.clientX, y: e.clientY }, startView: { ...view } });
      return;
    }

    if (hit) {
      setSelectedId(hit.id);
      return;
    }

    if (tool === 'text') {
      const text = window.prompt('Texto para el plano');
      if (!text || !text.trim()) return;
      addElement({
        id: createId(),
        type: 'text',
        color,
        text: text.trim(),
        fontSize: clamp(size * 1.8, 12, 120),
        x: point.x,
        y: point.y,
      });
      return;
    }

    startDrawing(tool, point);
    setInteraction({ type: 'draw', tool, start: point });
  }

  function onStagePointerMove(e) {
    const interaction = interactionRef.current;
    if (!interaction) return;
    const point = toWorldPoint(e.clientX, e.clientY);
    if (!point) return;

    if (interaction.type === 'pan') {
      const dx = e.clientX - interaction.start.x;
      const dy = e.clientY - interaction.start.y;
      const delta = screenDeltaToWorld(dx, dy);
      setView({
        ...interaction.startView,
        panX: interaction.startView.panX - delta.x,
        panY: interaction.startView.panY - delta.y,
      });
      return;
    }

    if (interaction.type === 'move') {
      const delta = { x: point.x - interaction.start.x, y: point.y - interaction.start.y };
      updatePlanElement(interaction.id, (el) => {
        const base = interaction.startElement;
        if (base.type === 'brush' || base.type === 'eraser') {
          return {
            ...base,
            points: (base.points || []).map((p) => ({ x: p.x + delta.x, y: p.y + delta.y })),
          };
        }
        if (base.type === 'line') {
          return {
            ...base,
            x1: base.x1 + delta.x,
            y1: base.y1 + delta.y,
            x2: base.x2 + delta.x,
            y2: base.y2 + delta.y,
          };
        }
        if (base.type === 'rect') {
          return { ...base, x: base.x + delta.x, y: base.y + delta.y };
        }
        if (base.type === 'circle') {
          return { ...base, cx: base.cx + delta.x, cy: base.cy + delta.y };
        }
        if (base.type === 'text') {
          return { ...base, x: base.x + delta.x, y: base.y + delta.y };
        }
        return el;
      });
      return;
    }

    if (interaction.type === 'resize') {
      applyResize(interaction.id, interaction.handle, interaction.startElement, point);
      return;
    }

    if (interaction.type === 'draw') {
      updateDraft(interaction.start, point);
    }
  }

  function onStagePointerUp() {
    const interaction = interactionRef.current;
    if (!interaction) return;
    if (interaction.type === 'draw') {
      finishDraft();
    }
    setInteraction(null);
  }

  function onWheel(e) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const pointer = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    const worldBefore = {
      x: viewBox.x + pointer.x / view.zoom,
      y: viewBox.y + pointer.y / view.zoom,
    };
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const nextZoom = clamp(view.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    const nextView = {
      zoom: nextZoom,
      panX: worldBefore.x - pointer.x / nextZoom,
      panY: worldBefore.y - pointer.y / nextZoom,
    };
    setView(nextView);
  }

  function changeZoom(delta) {
    const nextZoom = clamp(view.zoom + delta, MIN_ZOOM, MAX_ZOOM);
    setView((prev) => ({
      ...prev,
      zoom: nextZoom,
    }));
  }

  function fitToContent() {
    if (!elements.length) {
      setView(DEFAULT_VIEW);
      return;
    }
    const bounds = elements.map(elementBounds).reduce((acc, b) => ({
      minX: Math.min(acc.minX, b.x),
      minY: Math.min(acc.minY, b.y),
      maxX: Math.max(acc.maxX, b.x + b.w),
      maxY: Math.max(acc.maxY, b.y + b.h),
    }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    const margin = 120;
    const contentW = Math.max(1, bounds.maxX - bounds.minX + margin * 2);
    const contentH = Math.max(1, bounds.maxY - bounds.minY + margin * 2);
    const zoomFit = clamp(Math.min(viewport.width / contentW, viewport.height / contentH), MIN_ZOOM, MAX_ZOOM);
    setView({
      zoom: zoomFit,
      panX: bounds.minX - margin,
      panY: bounds.minY - margin,
    });
  }

  function clearPlan() {
    if (!window.confirm('¿Borrar todo el plano?')) return;
    setPlan((prev) => ({ ...prev, elements: [] }));
    setSelectedId(null);
  }

  function deleteSelected() {
    if (!selectedId) return;
    setPlan((prev) => ({ ...prev, elements: prev.elements.filter((el) => el.id !== selectedId) }));
    setSelectedId(null);
  }

  function duplicateSelected() {
    if (!selectedElement) return;
    const copy = duplicateElement(selectedElement);
    addElement(copy);
  }

  function updateSelected(next) {
    if (!selectedElement) return;
    updatePlanElement(selectedElement.id, () => next);
  }

  function handleSelectedField(field, value) {
    if (!selectedElement) return;
    const meters = Number(value) || 0;
    if (selectedElement.type === 'rect') {
      if (field === 'x') updateSelected({ ...selectedElement, x: metersToWorld(meters, metersPerGrid) });
      if (field === 'y') updateSelected({ ...selectedElement, y: metersToWorld(meters, metersPerGrid) });
      if (field === 'w') updateSelected({ ...selectedElement, w: metersToWorld(meters, metersPerGrid) });
      if (field === 'h') updateSelected({ ...selectedElement, h: metersToWorld(meters, metersPerGrid) });
      if (field === 'strokeWidth') updateSelected({ ...selectedElement, strokeWidth: clamp(Number(value) || 1, 1, 40) });
      if (field === 'color') updateSelected({ ...selectedElement, color: value });
      if (field === 'fill') updateSelected({ ...selectedElement, fill: !!value });
      return;
    }
    if (selectedElement.type === 'circle') {
      if (field === 'cx') updateSelected({ ...selectedElement, cx: metersToWorld(meters, metersPerGrid) });
      if (field === 'cy') updateSelected({ ...selectedElement, cy: metersToWorld(meters, metersPerGrid) });
      if (field === 'r') updateSelected({ ...selectedElement, r: metersToWorld(meters, metersPerGrid) });
      if (field === 'strokeWidth') updateSelected({ ...selectedElement, strokeWidth: clamp(Number(value) || 1, 1, 40) });
      if (field === 'color') updateSelected({ ...selectedElement, color: value });
      if (field === 'fill') updateSelected({ ...selectedElement, fill: !!value });
      return;
    }
    if (selectedElement.type === 'line') {
      if (field === 'x1') updateSelected({ ...selectedElement, x1: metersToWorld(meters, metersPerGrid) });
      if (field === 'y1') updateSelected({ ...selectedElement, y1: metersToWorld(meters, metersPerGrid) });
      if (field === 'x2') updateSelected({ ...selectedElement, x2: metersToWorld(meters, metersPerGrid) });
      if (field === 'y2') updateSelected({ ...selectedElement, y2: metersToWorld(meters, metersPerGrid) });
      if (field === 'strokeWidth') updateSelected({ ...selectedElement, strokeWidth: clamp(Number(value) || 1, 1, 40) });
      if (field === 'color') updateSelected({ ...selectedElement, color: value });
      return;
    }
    if (selectedElement.type === 'text') {
      if (field === 'x') updateSelected({ ...selectedElement, x: metersToWorld(meters, metersPerGrid) });
      if (field === 'y') updateSelected({ ...selectedElement, y: metersToWorld(meters, metersPerGrid) });
      if (field === 'fontSize') updateSelected({ ...selectedElement, fontSize: clamp(Number(value) || 10, 10, 120) });
      if (field === 'text') updateSelected({ ...selectedElement, text: value });
      if (field === 'color') updateSelected({ ...selectedElement, color: value });
      return;
    }
    if (selectedElement.type === 'brush' || selectedElement.type === 'eraser') {
      if (field === 'strokeWidth') updateSelected({ ...selectedElement, strokeWidth: clamp(Number(value) || 1, 1, 40) });
      if (field === 'color') updateSelected({ ...selectedElement, color: value });
    }
  }

  function renderInspector() {
    if (!selectedElement) {
      return <p className="muted">Selecciona una figura para ver y editar sus dimensiones.</p>;
    }

    const label = elementLabel(selectedElement, metersPerGrid);

    return (
      <div className="paint-inspector-card">
        <div className="paint-inspector-title">Elemento seleccionado</div>
        <div className="paint-inspector-sub">{selectedElement.type} · {label}</div>

        <label className="paint-field">
          Color
          <input type="color" value={selectedElement.color || '#111827'} onChange={(e) => handleSelectedField('color', e.target.value)} />
        </label>

        {(selectedElement.type === 'rect' || selectedElement.type === 'circle' || selectedElement.type === 'line' || selectedElement.type === 'text' || selectedElement.type === 'brush' || selectedElement.type === 'eraser') && (
          <label className="paint-field">
            Grosor
            <input type="number" min="1" max="40" step="1" value={selectedElement.strokeWidth || 6} onChange={(e) => handleSelectedField('strokeWidth', e.target.value)} />
          </label>
        )}

        {selectedElement.type === 'rect' && (
          <>
            <label className="paint-field">
              X (m)
              <input type="number" step="0.1" value={worldToMeters(selectedElement.x, metersPerGrid).toFixed(2)} onChange={(e) => handleSelectedField('x', e.target.value)} />
            </label>
            <label className="paint-field">
              Y (m)
              <input type="number" step="0.1" value={worldToMeters(selectedElement.y, metersPerGrid).toFixed(2)} onChange={(e) => handleSelectedField('y', e.target.value)} />
            </label>
            <label className="paint-field">
              Ancho (m)
              <input type="number" step="0.1" value={worldToMeters(Math.abs(selectedElement.w), metersPerGrid).toFixed(2)} onChange={(e) => handleSelectedField('w', e.target.value)} />
            </label>
            <label className="paint-field">
              Alto (m)
              <input type="number" step="0.1" value={worldToMeters(Math.abs(selectedElement.h), metersPerGrid).toFixed(2)} onChange={(e) => handleSelectedField('h', e.target.value)} />
            </label>
            <label className="paint-toggle">
              <input type="checkbox" checked={!!selectedElement.fill} onChange={(e) => handleSelectedField('fill', e.target.checked)} />
              Relleno
            </label>
          </>
        )}

        {selectedElement.type === 'circle' && (
          <>
            <label className="paint-field">
              Centro X (m)
              <input type="number" step="0.1" value={worldToMeters(selectedElement.cx, metersPerGrid).toFixed(2)} onChange={(e) => handleSelectedField('cx', e.target.value)} />
            </label>
            <label className="paint-field">
              Centro Y (m)
              <input type="number" step="0.1" value={worldToMeters(selectedElement.cy, metersPerGrid).toFixed(2)} onChange={(e) => handleSelectedField('cy', e.target.value)} />
            </label>
            <label className="paint-field">
              Radio (m)
              <input type="number" step="0.1" value={worldToMeters(selectedElement.r, metersPerGrid).toFixed(2)} onChange={(e) => handleSelectedField('r', e.target.value)} />
            </label>
            <label className="paint-toggle">
              <input type="checkbox" checked={!!selectedElement.fill} onChange={(e) => handleSelectedField('fill', e.target.checked)} />
              Relleno
            </label>
          </>
        )}

        {selectedElement.type === 'line' && (
          <>
            <label className="paint-field">
              X1 (m)
              <input type="number" step="0.1" value={worldToMeters(selectedElement.x1, metersPerGrid).toFixed(2)} onChange={(e) => handleSelectedField('x1', e.target.value)} />
            </label>
            <label className="paint-field">
              Y1 (m)
              <input type="number" step="0.1" value={worldToMeters(selectedElement.y1, metersPerGrid).toFixed(2)} onChange={(e) => handleSelectedField('y1', e.target.value)} />
            </label>
            <label className="paint-field">
              X2 (m)
              <input type="number" step="0.1" value={worldToMeters(selectedElement.x2, metersPerGrid).toFixed(2)} onChange={(e) => handleSelectedField('x2', e.target.value)} />
            </label>
            <label className="paint-field">
              Y2 (m)
              <input type="number" step="0.1" value={worldToMeters(selectedElement.y2, metersPerGrid).toFixed(2)} onChange={(e) => handleSelectedField('y2', e.target.value)} />
            </label>
          </>
        )}

        {selectedElement.type === 'text' && (
          <>
            <label className="paint-field">
              Texto
              <input type="text" value={selectedElement.text || ''} onChange={(e) => handleSelectedField('text', e.target.value)} />
            </label>
            <label className="paint-field">
              X (m)
              <input type="number" step="0.1" value={worldToMeters(selectedElement.x, metersPerGrid).toFixed(2)} onChange={(e) => handleSelectedField('x', e.target.value)} />
            </label>
            <label className="paint-field">
              Y (m)
              <input type="number" step="0.1" value={worldToMeters(selectedElement.y, metersPerGrid).toFixed(2)} onChange={(e) => handleSelectedField('y', e.target.value)} />
            </label>
            <label className="paint-field">
              Tamaño (px)
              <input type="number" min="10" max="120" step="1" value={selectedElement.fontSize || 22} onChange={(e) => handleSelectedField('fontSize', e.target.value)} />
            </label>
          </>
        )}

        {(selectedElement.type === 'brush' || selectedElement.type === 'eraser') && (
          <p className="muted" style={{ marginTop: 8 }}>
            El trazo libre se puede mover y duplicar, pero no redimensionar con precisión. Si necesitas una figura editable, usa rectángulo, círculo o línea.
          </p>
        )}

        <div className="row gap wrap" style={{ marginTop: 10 }}>
          <button onClick={duplicateSelected}>Duplicar</button>
          <button onClick={deleteSelected} className="danger">Eliminar</button>
        </div>
      </div>
    );
  }

  const verticalLines = Array.from({ length: Math.ceil(viewBox.width / GRID_PX) + 4 }, (_, i) => alignDown(viewBox.x, GRID_PX) + i * GRID_PX);
  const horizontalLines = Array.from({ length: Math.ceil(viewBox.height / GRID_PX) + 4 }, (_, i) => alignDown(viewBox.y, GRID_PX) + i * GRID_PX);

  return (
    <div className="view paint-page">
      <div className="paint-hero">
        <div>
          <h2>Plano carpa</h2>
          <p className="muted">Cuadrícula infinita, zoom, arrastre, redimensionado y edición de medidas.</p>
        </div>
        <div className="paint-legend muted">Ctrl + rueda para zoom · arrastra figuras en modo seleccionar · doble clic no hace falta</div>
      </div>

      <div className="paint-toolbar">
        <div className="tool-group">
          {Object.entries(TOOL_LABELS).map(([id, label]) => (
            <button key={id} className={tool === id ? 'primary' : ''} onClick={() => setTool(id)}>
              {label}
            </button>
          ))}
        </div>

        <div className="tool-group">
          {PALETTE.map((swatch) => (
            <button
              key={swatch}
              className={`paint-swatch${color === swatch ? ' active' : ''}`}
              style={{ background: swatch }}
              onClick={() => setColor(swatch)}
              title={swatch}
            />
          ))}
          <label className="paint-color">
            Color
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
          </label>
        </div>

        <label className="paint-scale">
          Escala
          <span>1 cuadricula =</span>
          <input type="number" min="0.1" step="0.1" value={metersPerGrid} onChange={(e) => setPlan((prev) => ({ ...prev, metersPerGrid: Number(e.target.value) || 1 }))} />
          <span>m</span>
        </label>

        <div className="tool-group">
          <button onClick={() => changeZoom(-0.1)}>-</button>
          <button onClick={() => setView(DEFAULT_VIEW)}>100%</button>
          <button onClick={() => changeZoom(0.1)}>+</button>
          <button onClick={fitToContent}>Encajar</button>
          <span className="muted">Zoom {formatViewZoom(view.zoom)}</span>
        </div>

        <label className="paint-size">
          Grosor
          <input type="range" min="1" max="28" value={size} onChange={(e) => setSize(Number(e.target.value))} />
          <span>{size}px</span>
        </label>

        <label className="paint-toggle">
          <input type="checkbox" checked={fill} onChange={(e) => setFill(e.target.checked)} />
          Relleno figuras
        </label>

        <label className="paint-toggle">
          <input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} />
          Cuadrícula
        </label>

        <div className="tool-group">
          <button onClick={clearPlan}>Limpiar</button>
          <button onClick={() => setPlan((prev) => ({ ...prev, elements: prev.elements.slice(0, -1) }))}>Deshacer</button>
          <button onClick={duplicateSelected}>Duplicar</button>
        </div>
      </div>

      <div className="paint-shell">
        <div className="paint-stage" ref={stageRef} onWheel={onWheel}>
          <svg
            ref={svgRef}
            className="paint-canvas"
            viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
            onPointerDown={onStagePointerDown}
            onPointerMove={onStagePointerMove}
            onPointerUp={onStagePointerUp}
            onPointerCancel={onStagePointerUp}
          >
            <defs>
              <pattern id="grid-small" width={GRID_PX} height={GRID_PX} patternUnits="userSpaceOnUse">
                <path d={`M ${GRID_PX} 0 L 0 0 0 ${GRID_PX}`} fill="none" stroke="rgba(17, 24, 39, 0.08)" strokeWidth="1" />
              </pattern>
              <pattern id="grid-large" width={GRID_PX * 5} height={GRID_PX * 5} patternUnits="userSpaceOnUse">
                <rect width={GRID_PX * 5} height={GRID_PX * 5} fill="url(#grid-small)" />
                <path d={`M ${GRID_PX * 5} 0 L 0 0 0 ${GRID_PX * 5}`} fill="none" stroke="rgba(17, 24, 39, 0.16)" strokeWidth="1.2" />
              </pattern>
            </defs>

            <rect x={viewBox.x} y={viewBox.y} width={viewBox.width} height={viewBox.height} fill="#fff" />

            {grid && (
              <g>
                <rect x={viewBox.x} y={viewBox.y} width={viewBox.width} height={viewBox.height} fill="url(#grid-small)" />
                {verticalLines.filter((x) => Math.round(x / GRID_PX) % 5 === 0).map((x) => (
                  <line key={`vx-${x}`} x1={x} y1={viewBox.y} x2={x} y2={viewBox.y + viewBox.height} stroke="rgba(17, 24, 39, 0.16)" strokeWidth="1.2" />
                ))}
                {horizontalLines.filter((y) => Math.round(y / GRID_PX) % 5 === 0).map((y) => (
                  <line key={`hy-${y}`} x1={viewBox.x} y1={y} x2={viewBox.x + viewBox.width} y2={y} stroke="rgba(17, 24, 39, 0.16)" strokeWidth="1.2" />
                ))}
              </g>
            )}

            {elements.map((el) => {
              const selected = el.id === selectedId;
              const common = {
                key: el.id,
                stroke: el.color || '#111827',
                strokeWidth: el.strokeWidth || 4,
                strokeLinejoin: 'round',
                strokeLinecap: 'round',
                vectorEffect: 'non-scaling-stroke',
              };

              if (el.type === 'brush' || el.type === 'eraser') {
                const points = (el.points || []).map((p) => `${p.x},${p.y}`).join(' ');
                return (
                  <polyline
                    key={el.id}
                    points={points}
                    fill="none"
                    stroke={el.type === 'eraser' ? '#ffffff' : common.stroke}
                    strokeWidth={el.strokeWidth || 4}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    onClick={() => setSelectedId(el.id)}
                    opacity={selected ? 0.96 : 1}
                  />
                );
              }

              if (el.type === 'line') {
                return (
                  <g key={el.id} onClick={() => setSelectedId(el.id)}>
                    <line x1={el.x1} y1={el.y1} x2={el.x2} y2={el.y2} {...common} />
                    {selected && (
                      <line x1={el.x1} y1={el.y1} x2={el.x2} y2={el.y2} stroke="#60a5fa" strokeWidth={common.strokeWidth + 6} strokeOpacity="0.25" strokeLinecap="round" fill="none" />
                    )}
                  </g>
                );
              }

              if (el.type === 'rect') {
                const x = Math.min(el.x, el.x + el.w);
                const y = Math.min(el.y, el.y + el.h);
                const w = Math.abs(el.w);
                const h = Math.abs(el.h);
                return (
                  <g key={el.id} onClick={() => setSelectedId(el.id)}>
                    <rect
                      x={x}
                      y={y}
                      width={w}
                      height={h}
                      fill={el.fill ? el.color : 'transparent'}
                      fillOpacity={el.fill ? 0.18 : 0}
                      {...common}
                    />
                    {selected && <rect x={x} y={y} width={w} height={h} fill="none" stroke="#60a5fa" strokeWidth={2} strokeDasharray="8 6" />}
                  </g>
                );
              }

              if (el.type === 'circle') {
                return (
                  <g key={el.id} onClick={() => setSelectedId(el.id)}>
                    <circle
                      cx={el.cx}
                      cy={el.cy}
                      r={el.r}
                      fill={el.fill ? el.color : 'transparent'}
                      fillOpacity={el.fill ? 0.18 : 0}
                      {...common}
                    />
                    {selected && <circle cx={el.cx} cy={el.cy} r={el.r} fill="none" stroke="#60a5fa" strokeWidth={2} strokeDasharray="8 6" />}
                  </g>
                );
              }

              if (el.type === 'text') {
                return (
                  <g key={el.id} onClick={() => setSelectedId(el.id)}>
                    <text
                      x={el.x}
                      y={el.y}
                      fill={el.color || '#111827'}
                      fontSize={el.fontSize || 22}
                      fontWeight="600"
                      dominantBaseline="alphabetic"
                    >
                      {el.text}
                    </text>
                    {selected && <rect x={textBox(el).x} y={textBox(el).y} width={textBox(el).w} height={textBox(el).h} fill="none" stroke="#60a5fa" strokeWidth={2} strokeDasharray="8 6" />}
                  </g>
                );
              }

              return null;
            })}

            {draft && (
              <g opacity="0.75">
                {draft.type === 'brush' || draft.type === 'eraser' ? (
                  <polyline
                    points={(draft.points || []).map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke={draft.type === 'eraser' ? '#ffffff' : draft.color}
                    strokeWidth={draft.strokeWidth}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ) : draft.type === 'line' ? (
                  <line x1={draft.x1} y1={draft.y1} x2={draft.x2} y2={draft.y2} stroke={draft.color} strokeWidth={draft.strokeWidth} strokeLinecap="round" />
                ) : draft.type === 'rect' ? (
                  <rect x={draft.x} y={draft.y} width={draft.w} height={draft.h} fill={draft.fill ? draft.color : 'transparent'} fillOpacity={draft.fill ? 0.18 : 0} stroke={draft.color} strokeWidth={draft.strokeWidth} />
                ) : draft.type === 'circle' ? (
                  <circle cx={draft.cx} cy={draft.cy} r={draft.r} fill={draft.fill ? draft.color : 'transparent'} fillOpacity={draft.fill ? 0.18 : 0} stroke={draft.color} strokeWidth={draft.strokeWidth} />
                ) : null}
              </g>
            )}

            {selectedElement && selectedHandles(selectedElement).map((handle) => (
              <circle
                key={handle.key}
                cx={handle.x}
                cy={handle.y}
                r={8}
                fill="#fff"
                stroke="#60a5fa"
                strokeWidth={2}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  const svg = svgRef.current;
                  if (!svg) return;
                  svg.setPointerCapture?.(e.pointerId);
                  setInteraction({
                    type: 'resize',
                    id: selectedElement.id,
                    handle: handle.key,
                    startElement: JSON.parse(JSON.stringify(selectedElement)),
                  });
                }}
              />
            ))}
          </svg>
        </div>

        <aside className="paint-inspector">
          {renderInspector()}
        </aside>
      </div>
    </div>
  );
}
