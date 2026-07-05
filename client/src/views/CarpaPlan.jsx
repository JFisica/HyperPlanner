import { useEffect, useMemo, useRef, useState } from 'react';

const STORAGE_KEY = 'ehw-carpa-plan-v1';
const DEFAULT_SIZE = { width: 1280, height: 800 };

const TOOL_LABELS = {
  brush: 'Pincel',
  line: 'Línea',
  rect: 'Rectángulo',
  text: 'Texto',
  eraser: 'Goma',
};

const PALETTE = ['#111827', '#ef4444', '#f59e0b', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7', '#ffffff'];

function loadSavedElements() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
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

export default function CarpaPlan() {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [elements, setElements] = useState(loadSavedElements);
  const [tool, setTool] = useState('brush');
  const [color, setColor] = useState('#111827');
  const [size, setSize] = useState(6);
  const [fill, setFill] = useState(false);
  const [grid, setGrid] = useState(true);
  const [current, setCurrent] = useState(null);
  const [canvasSize, setCanvasSize] = useState(DEFAULT_SIZE);

  const title = useMemo(() => 'Plano carpa', []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(elements));
    } catch {
      // Ignore persistence failures.
    }
  }, [elements]);

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
      for (let x = 0; x <= width; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y <= height; y += 40) {
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
  }, [elements, current, canvasSize, grid]);

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
      setElements((prev) => [
        ...prev,
        {
          type: 'text',
          text: text.trim(),
          point,
          color,
          size: Math.max(0.008, size / canvasSize.width),
        },
      ]);
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
      setElements((items) => [...items, prev]);
      return null;
    });
  }

  function undo() {
    setElements((prev) => prev.slice(0, -1));
  }

  function clearCanvas() {
    if (window.confirm('¿Borrar todo el plano?')) setElements([]);
  }

  function downloadPNG() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement('a');
    a.download = 'plano-carpa.png';
    a.href = canvas.toDataURL('image/png');
    a.click();
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

      <div className="paint-stage" ref={wrapRef}>
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