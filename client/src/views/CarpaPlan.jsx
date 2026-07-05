import { useEffect, useMemo, useRef, useState } from 'react';

const STORAGE_KEY = 'ehw-carpa-plan-v1';
const DEFAULT_SIZE = { width: 1280, height: 800 };
const GRID_PX = 40;

const TOOL_LABELS = {
  brush: 'Pincel',
  line: 'Línea',
  rect: 'Rectángulo',
  text: 'Texto',
  eraser: 'Goma',
};

const PALETTE = ['#111827', '#ef4444', '#f59e0b', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7', '#ffffff'];

function loadSavedPlan() {
  if (typeof window === 'undefined') return { elements: [], metersPerGrid: 1 };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { elements: [], metersPerGrid: 1 };
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return { elements: parsed, metersPerGrid: 1 };
    return {
      elements: Array.isArray(parsed.elements) ? parsed.elements : [],
      metersPerGrid: Number(parsed.metersPerGrid) || 1,
    };
  } catch {
    return { elements: [], metersPerGrid: 1 };
  }
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function makePoint(x, y, width, height) {
  return { x: clamp01(x / width), y: clamp01(y / height) };
}

function pxX(point, width) {
  return point.x * width;
}

function pxY(point, height) {
  return point.y * height;
}

function drawLine(ctx, from, to, width, height) {
  ctx.beginPath();
  ctx.moveTo(pxX(from, width), pxY(from, height));
  ctx.lineTo(pxX(to, width), pxY(to, height));
  ctx.stroke();
}

function distanceMeters(from, to, width, height, metersPerGrid) {
  const dx = (pxX(to, width) - pxX(from, width)) / GRID_PX;
  const dy = (pxY(to, height) - pxY(from, height)) / GRID_PX;
  return Math.sqrt(dx * dx + dy * dy) * metersPerGrid;
}

function formatMeters(value) {
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} m`;
}

function drawLabel(ctx, text, x, y) {
  ctx.save();
  ctx.font = '600 12px system-ui, sans-serif';
  const paddingX = 7;
  const paddingY = 4;
  const width = ctx.measureText(text).width + paddingX * 2;
  const height = 18;
  ctx.fillStyle = 'rgba(17, 24, 39, 0.84)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#f8fafc';
  ctx.textBaseline = 'top';
  ctx.fillText(text, x + paddingX, y + paddingY);
  ctx.restore();
}

export default function CarpaPlan() {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [{ elements, metersPerGrid }, setPlan] = useState(loadSavedPlan);
  const [tool, setTool] = useState('brush');
  const [color, setColor] = useState('#111827');
  const [size, setSize] = useState(6);
  const [fill, setFill] = useState(false);
  const [grid, setGrid] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [current, setCurrent] = useState(null);
  const [canvasSize, setCanvasSize] = useState(DEFAULT_SIZE);

  const title = useMemo(() => 'Plano carpa', []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ elements, metersPerGrid }));
    } catch {
      // Ignore persistence failures.
    }
  }, [elements, metersPerGrid]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;

    function update() {
      const rect = el.getBoundingClientRect();
      const width = Math.max(840, Math.floor(rect.width));
      const height = Math.max(620, Math.floor(window.innerHeight * 0.68));
      setCanvasSize({ width, height });
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
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const { width, height } = canvasSize;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.transform = `scale(${zoom})`;
    canvas.style.transformOrigin = 'top left';

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    if (grid) {
      ctx.save();
      ctx.strokeStyle = 'rgba(17, 24, 39, 0.08)';
      ctx.lineWidth = 1;
      for (let x = 0; x <= width; x += GRID_PX) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y <= height; y += GRID_PX) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
      ctx.restore();
    }

    const renderStroke = (element, preview = false) => {
      const strokeSize = Math.max(1, element.size * width);
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = strokeSize;
      ctx.strokeStyle = element.color;
      ctx.fillStyle = element.color;
      ctx.globalAlpha = preview ? 0.65 : 1;
      if (element.type === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
      }

      if (element.type === 'brush' || element.type === 'eraser') {
        const points = element.points || [];
        if (points.length === 1) {
          const p = points[0];
          ctx.beginPath();
          ctx.arc(pxX(p, width), pxY(p, height), strokeSize / 2, 0, Math.PI * 2);
          ctx.fill();
        } else if (points.length > 1) {
          ctx.beginPath();
          ctx.moveTo(pxX(points[0], width), pxY(points[0], height));
          for (const point of points.slice(1)) {
            ctx.lineTo(pxX(point, width), pxY(point, height));
          }
          ctx.stroke();
        }
      } else if (element.type === 'line') {
        drawLine(ctx, element.from, element.to, width, height);
        const meters = distanceMeters(element.from, element.to, width, height, metersPerGrid);
        const midX = (pxX(element.from, width) + pxX(element.to, width)) / 2;
        const midY = (pxY(element.from, height) + pxY(element.to, height)) / 2;
        drawLabel(ctx, formatMeters(meters), midX + 8, midY + 8);
      } else if (element.type === 'rect') {
        const x1 = pxX(element.from, width);
        const y1 = pxY(element.from, height);
        const x2 = pxX(element.to, width);
        const y2 = pxY(element.to, height);
        const x = Math.min(x1, x2);
        const y = Math.min(y1, y2);
        const w = Math.abs(x2 - x1);
        const h = Math.abs(y2 - y1);
        if (element.fill) {
          ctx.globalAlpha = preview ? 0.16 : 0.18;
          ctx.fillRect(x, y, w, h);
          ctx.globalAlpha = preview ? 0.65 : 1;
        }
        ctx.strokeRect(x, y, w, h);
        const widthMeters = (w / GRID_PX) * metersPerGrid;
        const heightMeters = (h / GRID_PX) * metersPerGrid;
        const label = `${formatMeters(widthMeters)} × ${formatMeters(heightMeters)}`;
        if (w > 70 && h > 34) drawLabel(ctx, label, x + 8, y + 8);
      } else if (element.type === 'text') {
        const fontSize = Math.max(12, element.size * width);
        ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
        ctx.textBaseline = 'top';
        ctx.fillText(element.text, pxX(element.point, width), pxY(element.point, height));
      }
      ctx.restore();
    };

    for (const element of elements) renderStroke(element, false);
    if (current) renderStroke(current, true);
  }, [elements, current, canvasSize, grid, metersPerGrid, zoom]);

  function pointerToPoint(event) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    return makePoint(x, y, rect.width, rect.height);
  }

  function beginDraw(event) {
    const point = pointerToPoint(event);
    if (!point) return;
    event.preventDefault();

    if (tool === 'text') {
      const text = window.prompt('Texto para el plano');
      if (!text || !text.trim()) return;
      setPlan((prev) => ({
        ...prev,
        elements: [
          ...prev.elements,
          {
            type: 'text',
            text: text.trim(),
            point,
            color,
            size: Math.max(0.008, size / canvasSize.width),
          },
        ],
      }));
      return;
    }

    const base = {
      color,
      size: Math.max(0.004, size / canvasSize.width),
    };

    if (tool === 'brush' || tool === 'eraser') {
      setCurrent({
        type: tool,
        ...base,
        points: [point],
      });
      return;
    }

    if (tool === 'line' || tool === 'rect') {
      setCurrent({
        type: tool,
        ...base,
        from: point,
        to: point,
        fill: tool === 'rect' ? fill : false,
      });
    }
  }

  function moveDraw(event) {
    if (!current) return;
    const point = pointerToPoint(event);
    if (!point) return;
    event.preventDefault();

    setCurrent((prev) => {
      if (!prev) return prev;
      if (prev.type === 'brush' || prev.type === 'eraser') {
        return { ...prev, points: [...prev.points, point] };
      }
      return { ...prev, to: point };
    });
  }

  function endDraw() {
    setCurrent((prev) => {
      if (!prev) return prev;
      if ((prev.type === 'brush' || prev.type === 'eraser') && prev.points.length < 2) {
        return null;
      }
      setPlan((state) => ({
        ...state,
        elements: [...state.elements, prev],
      }));
      return null;
    });
  }

  function undo() {
    setPlan((prev) => ({ ...prev, elements: prev.elements.slice(0, -1) }));
  }

  function clearCanvas() {
    if (window.confirm('¿Borrar todo el plano?')) setPlan((prev) => ({ ...prev, elements: [] }));
  }

  function downloadPNG() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement('a');
    a.download = 'plano-carpa.png';
    a.href = canvas.toDataURL('image/png');
    a.click();
  }

  function changeZoom(delta) {
    setZoom((prev) => Math.max(0.5, Math.min(2.5, Math.round((prev + delta) * 100) / 100)));
  }

  function handleWheel(e) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    setZoom((prev) => Math.max(0.5, Math.min(2.5, prev + (e.deltaY > 0 ? -0.1 : 0.1))));
  }

  return (
    <div className="view paint-page">
      <div className="paint-hero">
        <div>
          <h2>{title}</h2>
          <p className="muted">Dibuja el plano de la carpa con herramientas simples tipo Paint.</p>
        </div>
        <div className="paint-legend muted">Arrastra para dibujar · texto con clic · guardado local</div>
      </div>

      <div className="paint-toolbar">
        <div className="tool-group">
          {Object.entries(TOOL_LABELS).map(([id, label]) => (
            <button
              key={id}
              className={tool === id ? 'primary' : ''}
              onClick={() => setTool(id)}
            >
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
          <span>1 cuadrícula =</span>
          <input
            type="number"
            min="0.1"
            step="0.1"
            value={metersPerGrid}
            onChange={(e) => setPlan((prev) => ({ ...prev, metersPerGrid: Number(e.target.value) || 1 }))}
          />
          <span>m</span>
        </label>

        <div className="tool-group">
          <button onClick={() => changeZoom(-0.1)}>-</button>
          <button onClick={() => setZoom(1)}>100%</button>
          <button onClick={() => changeZoom(0.1)}>+</button>
          <span className="muted">Zoom {Math.round(zoom * 100)}%</span>
        </div>

        <label className="paint-size">
          Grosor
          <input
            type="range"
            min="1"
            max="28"
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
          />
          <span>{size}px</span>
        </label>

        <label className="paint-toggle">
          <input type="checkbox" checked={fill} onChange={(e) => setFill(e.target.checked)} />
          Relleno rectángulo
        </label>

        <label className="paint-toggle">
          <input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} />
          Cuadrícula
        </label>

        <div className="tool-group">
          <button onClick={undo}>Deshacer</button>
          <button onClick={clearCanvas}>Limpiar</button>
          <button onClick={downloadPNG} className="primary">Exportar PNG</button>
        </div>
      </div>

      <div className="paint-stage" ref={wrapRef} onWheel={handleWheel}>
        <canvas
          ref={canvasRef}
          className="paint-canvas"
          onPointerDown={beginDraw}
          onPointerMove={moveDraw}
          onPointerUp={endDraw}
          onPointerLeave={endDraw}
          onPointerCancel={endDraw}
        />
      </div>
    </div>
  );
}