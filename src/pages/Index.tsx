import { useState, useEffect, useRef, useCallback } from "react";

const SOURCE_URL = "https://cdn.poehali.dev/projects/5a15539d-2e23-46d4-9ae4-0b3d25a0b619/bucket/69833b61-01b5-42e0-a8d3-5b99d99bbf7c.png";

type MapKey = "baseColor" | "normal" | "roughness" | "ao" | "metallic";

const MAP_META: Record<MapKey, { label: string; tag: string; desc: string }> = {
  baseColor: { label: "Base Color", tag: "ALBEDO", desc: "Оригинал — исходная текстура" },
  normal:    { label: "Normal Map", tag: "NORMAL", desc: "Рельеф поверхности (Sobel filter)" },
  roughness: { label: "Roughness",  tag: "ROUGH",  desc: "Инверсия яркости — тёмное = гладкое" },
  ao:        { label: "Ambient Occlusion", tag: "AO", desc: "Затенение впадин (blur + darken)" },
  metallic:  { label: "Metallic",   tag: "METAL",  desc: "Металличность по насыщенности канала" },
};

const PBR_SPECS = [
  { label: "Источник", value: "Оригинал 1.png" },
  { label: "Движок",   value: "Rhino / Cycles / Vray" },
  { label: "Алгоритм", value: "Canvas CPU processing" },
  { label: "Normal",   value: "Sobel edge detection" },
  { label: "Rough",    value: "Inverted luminance" },
  { label: "AO",       value: "Blur + contrast darken" },
];

// ─── алгоритмы генерации карт ────────────────────────────────────────────────

function getGrayscale(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function buildGrayscaleArray(src: ImageData): Float32Array {
  const gray = new Float32Array(src.width * src.height);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = getGrayscale(src.data[i * 4], src.data[i * 4 + 1], src.data[i * 4 + 2]);
  }
  return gray;
}

function sampleGray(gray: Float32Array, w: number, h: number, x: number, y: number): number {
  x = Math.max(0, Math.min(w - 1, x));
  y = Math.max(0, Math.min(h - 1, y));
  return gray[y * w + x];
}

function generateNormalMap(src: ImageData, strength = 6): ImageData {
  const { width: w, height: h } = src;
  const out = new ImageData(w, h);
  const gray = buildGrayscaleArray(src);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tl = sampleGray(gray, w, h, x - 1, y - 1);
      const t  = sampleGray(gray, w, h, x,     y - 1);
      const tr = sampleGray(gray, w, h, x + 1, y - 1);
      const l  = sampleGray(gray, w, h, x - 1, y);
      const r  = sampleGray(gray, w, h, x + 1, y);
      const bl = sampleGray(gray, w, h, x - 1, y + 1);
      const b  = sampleGray(gray, w, h, x,     y + 1);
      const br = sampleGray(gray, w, h, x + 1, y + 1);
      const dX = (tr + 2 * r + br - tl - 2 * l - bl) / 255 * strength;
      const dY = (bl + 2 * b + br - tl - 2 * t - tr) / 255 * strength;
      const dZ = 1.0;
      const len = Math.sqrt(dX * dX + dY * dY + dZ * dZ);
      const i = (y * w + x) * 4;
      out.data[i]     = Math.round(((dX / len) * 0.5 + 0.5) * 255);
      out.data[i + 1] = Math.round(((dY / len) * 0.5 + 0.5) * 255);
      out.data[i + 2] = Math.round(((dZ / len) * 0.5 + 0.5) * 255);
      out.data[i + 3] = 255;
    }
  }
  return out;
}

function generateRoughnessMap(src: ImageData): ImageData {
  const { width: w, height: h } = src;
  const out = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const r = src.data[i * 4], g = src.data[i * 4 + 1], b = src.data[i * 4 + 2];
    const lum = getGrayscale(r, g, b);
    const rough = 255 - lum;
    out.data[i * 4]     = rough;
    out.data[i * 4 + 1] = rough;
    out.data[i * 4 + 2] = rough;
    out.data[i * 4 + 3] = 255;
  }
  return out;
}

function generateAOMap(src: ImageData, radius = 4): ImageData {
  const { width: w, height: h } = src;
  const gray = buildGrayscaleArray(src);
  const blurred = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, cnt = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          sum += sampleGray(gray, w, h, x + dx, y + dy);
          cnt++;
        }
      }
      blurred[y * w + x] = sum / cnt;
    }
  }
  const out = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const diff = blurred[i] - gray[i];
    const ao = Math.max(0, Math.min(255, 128 + diff * 1.8));
    out.data[i * 4]     = ao;
    out.data[i * 4 + 1] = ao;
    out.data[i * 4 + 2] = ao;
    out.data[i * 4 + 3] = 255;
  }
  return out;
}

function generateMetallicMap(src: ImageData): ImageData {
  const { width: w, height: h } = src;
  const out = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const r = src.data[i * 4], g = src.data[i * 4 + 1], b = src.data[i * 4 + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    const metal = Math.round(sat * 255);
    out.data[i * 4]     = metal;
    out.data[i * 4 + 1] = metal;
    out.data[i * 4 + 2] = metal;
    out.data[i * 4 + 3] = 255;
  }
  return out;
}

// ─── компонент ───────────────────────────────────────────────────────────────

export default function Index() {
  const [activeMap, setActiveMap] = useState<MapKey>("baseColor");
  const [tileCount, setTileCount] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [normalStrength, setNormalStrength] = useState(6);
  const [maps, setMaps] = useState<Record<MapKey, string | null>>({
    baseColor: SOURCE_URL,
    normal: null,
    roughness: null,
    ao: null,
    metallic: null,
  });
  const [progress, setProgress] = useState<string | null>("Загружаю оригинал...");
  const srcRef = useRef<ImageData | null>(null);

  const processAll = useCallback((imgData: ImageData, strength: number) => {
    setProgress("Генерирую Normal Map...");
    setTimeout(() => {
      const normalData = generateNormalMap(imgData, strength);
      const roughData  = generateRoughnessMap(imgData);
      const aoData     = generateAOMap(imgData);
      const metalData  = generateMetallicMap(imgData);

      const toDataURL = (id: ImageData) => {
        const c = document.createElement("canvas");
        c.width = id.width; c.height = id.height;
        c.getContext("2d")!.putImageData(id, 0, 0);
        return c.toDataURL("image/png");
      };

      setMaps({
        baseColor: SOURCE_URL,
        normal:    toDataURL(normalData),
        roughness: toDataURL(roughData),
        ao:        toDataURL(aoData),
        metallic:  toDataURL(metalData),
      });
      setProgress(null);
    }, 50);
  }, []);

  // Загрузка через fetch → blob (обход CORS для Canvas getImageData)
  useEffect(() => {
    setProgress("Загружаю оригинал...");
    fetch(SOURCE_URL)
      .then((r) => r.blob())
      .then((blob) => {
        const blobUrl = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          const SIZE = 512;
          const c = document.createElement("canvas");
          c.width = SIZE; c.height = SIZE;
          c.getContext("2d")!.drawImage(img, 0, 0, SIZE, SIZE);
          const imgData = c.getContext("2d")!.getImageData(0, 0, SIZE, SIZE);
          srcRef.current = imgData;
          URL.revokeObjectURL(blobUrl);
          processAll(imgData, normalStrength);
        };
        img.onerror = () => setProgress("Ошибка загрузки");
        img.src = blobUrl;
      })
      .catch(() => setProgress("Ошибка загрузки"));
  }, []);

  const handleStrengthChange = (val: number) => {
    setNormalStrength(val);
    if (srcRef.current) {
      setProgress("Пересчитываю Normal Map...");
      setTimeout(() => {
        const normalData = generateNormalMap(srcRef.current!, val);
        const c = document.createElement("canvas");
        c.width = normalData.width; c.height = normalData.height;
        c.getContext("2d")!.putImageData(normalData, 0, 0);
        setMaps(prev => ({ ...prev, normal: c.toDataURL("image/png") }));
        setProgress(null);
      }, 20);
    }
  };

  const currentUrl = maps[activeMap];

  return (
    <div className="min-h-screen text-white overflow-hidden" style={{ background: "#0e0e0f", fontFamily: "'Rajdhani', sans-serif", height: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Шапка */}
      <header className="flex-shrink-0 border-b flex items-center justify-between px-6 py-3"
        style={{ borderColor: "rgba(198,40,40,0.3)", background: "#0e0e0f" }}>
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: "#C62828", boxShadow: "0 0 8px #C62828" }} />
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "11px", color: "rgba(198,40,40,0.9)", letterSpacing: "0.15em" }}>
            PBR MAP GENERATOR
          </span>
        </div>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "10px", color: "rgba(255,255,255,0.25)", letterSpacing: "0.1em" }}>
          ALGORITHMIC · CPU CANVAS · 5 MAPS
        </div>
        {progress && (
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "9px", color: "#C62828", letterSpacing: "0.12em", display: "flex", alignItems: "center", gap: "8px" }}>
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#C62828" }} />
            {progress}
          </div>
        )}
        {!progress && (
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "9px", color: "rgba(100,200,100,0.8)", letterSpacing: "0.12em" }}>
            ✓ 5 MAPS READY
          </div>
        )}
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Левая панель */}
        <aside className="w-52 flex-shrink-0 flex flex-col border-r overflow-hidden"
          style={{ borderColor: "rgba(255,255,255,0.06)", background: "#111113" }}>
          <div className="px-4 py-3 border-b" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
            <p style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "9px", letterSpacing: "0.2em", color: "rgba(255,255,255,0.3)" }}>КАРТЫ</p>
          </div>
          <div className="flex-1 overflow-auto py-1">
            {(Object.keys(MAP_META) as MapKey[]).map((key) => {
              const m = MAP_META[key];
              const active = activeMap === key;
              const url = maps[key];
              return (
                <button key={key} onClick={() => setActiveMap(key)}
                  className="w-full text-left transition-all duration-150"
                  style={{ background: active ? "rgba(198,40,40,0.15)" : "transparent", borderLeft: active ? "2px solid #C62828" : "2px solid transparent", padding: "8px 14px" }}>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "9px", letterSpacing: "0.15em", color: active ? "#C62828" : "rgba(255,255,255,0.3)" }}>{m.tag}</span>
                  <p style={{ fontSize: "13px", fontWeight: active ? 600 : 400, color: active ? "#fff" : "rgba(255,255,255,0.5)", lineHeight: 1.2, marginTop: "2px" }}>{m.label}</p>
                  <div className="mt-1.5 rounded overflow-hidden" style={{ height: "44px", opacity: active ? 1 : 0.55, background: "#0a0a0b" }}>
                    {url
                      ? <img src={url} alt={m.label} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "rgba(198,40,40,0.5)" }} />
                        </div>
                    }
                  </div>
                </button>
              );
            })}
          </div>

          {/* Спецификации */}
          <div className="border-t p-4 flex-shrink-0" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
            <p className="mb-2" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "9px", letterSpacing: "0.2em", color: "rgba(255,255,255,0.3)" }}>INFO</p>
            <div className="space-y-1">
              {PBR_SPECS.map((s) => (
                <div key={s.label}>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "8px", color: "rgba(198,40,40,0.7)", letterSpacing: "0.1em" }}>{s.label.toUpperCase()}</span>
                  <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.5)", lineHeight: 1.3 }}>{s.value}</p>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* Основной viewport */}
        <main className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 relative flex items-center justify-center overflow-hidden" style={{ background: "#0a0a0b" }}>
            {/* Сетка */}
            <div className="absolute inset-0 opacity-[0.07]" style={{
              backgroundImage: `linear-gradient(rgba(198,40,40,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(198,40,40,0.5) 1px, transparent 1px)`,
              backgroundSize: "40px 40px",
            }} />

            {progress ? (
              <div className="flex flex-col items-center gap-4">
                <div className="w-8 h-8 rounded-full border-2 border-transparent animate-spin"
                  style={{ borderTopColor: "#C62828", borderRightColor: "rgba(198,40,40,0.3)" }} />
                <p style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "11px", color: "rgba(198,40,40,0.7)", letterSpacing: "0.15em" }}>
                  {progress}
                </p>
              </div>
            ) : (
              <div style={{ transform: `scale(${zoom})`, transition: "transform 0.3s ease" }}>
                <div className="relative overflow-hidden" style={{
                  width: "420px", height: "420px",
                  outline: "1px solid rgba(198,40,40,0.4)",
                  boxShadow: "0 20px 80px rgba(0,0,0,0.8)",
                }}>
                  {currentUrl && (
                    <div style={{
                      width: "100%", height: "100%",
                      backgroundImage: `url(${currentUrl})`,
                      backgroundSize: `${100 / tileCount}%`,
                      backgroundRepeat: "repeat",
                    }} />
                  )}
                  {/* Угловые метки */}
                  {(["tl","tr","bl","br"] as const).map((pos) => (
                    <div key={pos} className="absolute w-4 h-4" style={{
                      top: pos[0]==="t"?"6px":"auto", bottom: pos[0]==="b"?"6px":"auto",
                      left: pos[1]==="l"?"6px":"auto", right: pos[1]==="r"?"6px":"auto",
                      borderTop: pos[0]==="t"?"1px solid rgba(198,40,40,0.7)":"none",
                      borderBottom: pos[0]==="b"?"1px solid rgba(198,40,40,0.7)":"none",
                      borderLeft: pos[1]==="l"?"1px solid rgba(198,40,40,0.7)":"none",
                      borderRight: pos[1]==="r"?"1px solid rgba(198,40,40,0.7)":"none",
                    }} />
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between" style={{ width: "420px" }}>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "10px", color: "rgba(198,40,40,0.8)", letterSpacing: "0.15em" }}>
                    {MAP_META[activeMap].tag}
                  </span>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "10px", color: "rgba(255,255,255,0.3)", letterSpacing: "0.1em" }}>
                    512×512 · {tileCount}×{tileCount} TILE
                  </span>
                </div>
                <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.3)", marginTop: "3px" }}>
                  {MAP_META[activeMap].desc}
                </p>
              </div>
            )}

            <div className="absolute top-4 left-4" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "10px", color: "rgba(255,255,255,0.12)", letterSpacing: "0.1em" }}>
              VIEWPORT
            </div>
          </div>

          {/* Панель управления */}
          <div className="flex-shrink-0 border-t flex items-stretch"
            style={{ borderColor: "rgba(255,255,255,0.06)", background: "#111113", minHeight: "110px" }}>

            {/* Normal strength — только для normal map */}
            <div className="flex-1 p-4 border-r" style={{ borderColor: "rgba(255,255,255,0.06)", opacity: activeMap === "normal" ? 1 : 0.3 }}>
              <label style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "9px", letterSpacing: "0.2em", color: "rgba(198,40,40,0.7)", display: "block", marginBottom: "8px" }}>
                NORMAL STRENGTH — {normalStrength}
              </label>
              <input type="range" min={1} max={20} step={1} value={normalStrength}
                onChange={(e) => handleStrengthChange(Number(e.target.value))}
                className="w-full" style={{ accentColor: "#C62828" }}
                disabled={activeMap !== "normal"} />
              <div className="mt-1 flex justify-between" style={{ fontSize: "9px", color: "rgba(255,255,255,0.2)", fontFamily: "'IBM Plex Mono', monospace" }}>
                <span>СЛАБЫЙ</span><span>——</span><span>СИЛЬНЫЙ</span>
              </div>
            </div>

            {/* Zoom */}
            <div className="flex-1 p-4 border-r" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
              <label style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "9px", letterSpacing: "0.2em", color: "rgba(198,40,40,0.7)", display: "block", marginBottom: "8px" }}>
                ZOOM — {zoom.toFixed(1)}×
              </label>
              <input type="range" min={0.5} max={2} step={0.1} value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="w-full" style={{ accentColor: "#C62828" }} />
              <div className="mt-1 flex justify-between" style={{ fontSize: "9px", color: "rgba(255,255,255,0.2)", fontFamily: "'IBM Plex Mono', monospace" }}>
                <span>0.5×</span><span>1×</span><span>2×</span>
              </div>
            </div>

            {/* Tiling */}
            <div className="flex-1 p-4">
              <label style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "9px", letterSpacing: "0.2em", color: "rgba(198,40,40,0.7)", display: "block", marginBottom: "8px" }}>
                TILING — {tileCount}×{tileCount}
              </label>
              <div className="flex gap-2">
                {[1, 2, 3, 4].map((n) => (
                  <button key={n} onClick={() => setTileCount(n)} className="flex-1 py-2 transition-all duration-150"
                    style={{ background: tileCount === n ? "#C62828" : "rgba(255,255,255,0.05)", color: tileCount === n ? "#fff" : "rgba(255,255,255,0.4)", border: `1px solid ${tileCount === n ? "#C62828" : "rgba(255,255,255,0.08)"}`, borderRadius: "3px", fontFamily: "'IBM Plex Mono', monospace", fontSize: "11px", fontWeight: 600 }}>
                    {n}×
                  </button>
                ))}
              </div>
              <p className="mt-1" style={{ fontSize: "9px", color: "rgba(255,255,255,0.2)", fontFamily: "'IBM Plex Mono', monospace" }}>SEAMLESS CHECK</p>
            </div>
          </div>
        </main>

        {/* Правая панель — сравнение всех карт */}
        <aside className="w-44 flex-shrink-0 border-l flex flex-col overflow-hidden"
          style={{ borderColor: "rgba(255,255,255,0.06)", background: "#111113" }}>
          <div className="px-4 py-3 border-b flex-shrink-0" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
            <p style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "9px", letterSpacing: "0.2em", color: "rgba(255,255,255,0.3)" }}>ALL MAPS</p>
          </div>
          <div className="flex-1 overflow-auto p-3 space-y-3">
            {(Object.keys(MAP_META) as MapKey[]).map((key) => {
              const m = MAP_META[key];
              const active = activeMap === key;
              const url = maps[key];
              return (
                <div key={key} onClick={() => setActiveMap(key)} className="cursor-pointer transition-all duration-200"
                  style={{ border: `1px solid ${active ? "#C62828" : "rgba(255,255,255,0.08)"}`, borderRadius: "4px", overflow: "hidden", boxShadow: active ? "0 0 12px rgba(198,40,40,0.3)" : "none" }}>
                  <div style={{ aspectRatio: "1", background: "#0a0a0b", overflow: "hidden" }}>
                    {url
                      ? <img src={url} alt={m.label} style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }} />
                      : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: "rgba(198,40,40,0.4)" }} />
                        </div>
                    }
                  </div>
                  <div className="px-2 py-1" style={{ background: active ? "rgba(198,40,40,0.2)" : "rgba(0,0,0,0.4)" }}>
                    <p style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "8px", letterSpacing: "0.15em", color: active ? "#C62828" : "rgba(255,255,255,0.35)" }}>{m.tag}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Скачать */}
          <div className="p-3 border-t flex-shrink-0" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
            <button
              onClick={() => {
                const url = maps[activeMap];
                if (!url) return;
                const a = document.createElement("a");
                a.href = url;
                a.download = `pbr_${activeMap}.png`;
                a.click();
              }}
              disabled={!maps[activeMap] || !!progress}
              className="w-full py-2 text-center rounded transition-all duration-150"
              style={{
                background: maps[activeMap] && !progress ? "#C62828" : "rgba(255,255,255,0.05)",
                color: maps[activeMap] && !progress ? "#fff" : "rgba(255,255,255,0.2)",
                border: `1px solid ${maps[activeMap] && !progress ? "#C62828" : "rgba(255,255,255,0.08)"}`,
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: "9px",
                letterSpacing: "0.12em",
                cursor: maps[activeMap] && !progress ? "pointer" : "default",
              }}
            >
              ↓ СКАЧАТЬ {MAP_META[activeMap].tag}
            </button>
            <p className="mt-2 text-center" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "8px", color: "rgba(255,255,255,0.2)", letterSpacing: "0.06em", lineHeight: 1.6 }}>
              PNG · 512×512
              <br />RHINO / VRAY
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}