import { useState, useEffect, useRef } from "react";

// Исходная текстура — оригинальный образец
const SOURCE_URL =
  "https://cdn.poehali.dev/projects/5a15539d-2e23-46d4-9ae4-0b3d25a0b619/bucket/69833b61-01b5-42e0-a8d3-5b99d99bbf7c.png";

// ─── алгоритмы PBR-карт ────────────────────────────────────────────────────

function toLuma(r: number, g: number, b: number) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Base Color — оригинал без изменений (просто копия) */
function makeBaseColor(src: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
}

/** Normal Map — оператор Собеля по яркости */
function makeNormal(src: ImageData, strength: number): ImageData {
  const { width: w, height: h, data } = src;
  const out = new ImageData(w, h);
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++)
    gray[i] = toLuma(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);

  const g = (x: number, y: number) =>
    gray[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx =
        -g(x - 1, y - 1) - 2 * g(x - 1, y) - g(x - 1, y + 1) +
         g(x + 1, y - 1) + 2 * g(x + 1, y) + g(x + 1, y + 1);
      const dy =
        -g(x - 1, y - 1) - 2 * g(x, y - 1) - g(x + 1, y - 1) +
         g(x - 1, y + 1) + 2 * g(x, y + 1) + g(x + 1, y + 1);
      const nx = (dx / 255) * strength;
      const ny = (dy / 255) * strength;
      const nz = 1.0;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const i = (y * w + x) * 4;
      out.data[i]     = Math.round((nx / len * 0.5 + 0.5) * 255);
      out.data[i + 1] = Math.round((ny / len * 0.5 + 0.5) * 255);
      out.data[i + 2] = Math.round((nz / len * 0.5 + 0.5) * 255);
      out.data[i + 3] = 255;
    }
  }
  return out;
}

/** Roughness — инверсия яркости: тёмные участки = гладкие, светлые = матовые */
function makeRoughness(src: ImageData): ImageData {
  const { width: w, height: h, data } = src;
  const out = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = 255 - Math.round(toLuma(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]));
    out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = v;
    out.data[i * 4 + 3] = 255;
  }
  return out;
}

/** AO — локальное затенение: впадины темнее гребней */
function makeAO(src: ImageData, radius: number): ImageData {
  const { width: w, height: h, data } = src;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++)
    gray[i] = toLuma(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);

  const blur = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, cnt = 0;
      for (let dy = -radius; dy <= radius; dy++)
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = Math.max(0, Math.min(w - 1, x + dx));
          const ny = Math.max(0, Math.min(h - 1, y + dy));
          sum += gray[ny * w + nx]; cnt++;
        }
      blur[y * w + x] = sum / cnt;
    }
  }

  const out = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = Math.max(0, Math.min(255, Math.round(blur[i] - (blur[i] - gray[i]) * 2)));
    out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = v;
    out.data[i * 4 + 3] = 255;
  }
  return out;
}

/** Glossiness (Specular) — насыщенность канала, инвертированная Roughness */
function makeGloss(src: ImageData): ImageData {
  const { width: w, height: h, data } = src;
  const out = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const luma = toLuma(r, g, b);
    // Глянец = яркость (светлые гребни блестят)
    const v = Math.round(luma);
    out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = v;
    out.data[i * 4 + 3] = 255;
  }
  return out;
}

function imageDataToURL(id: ImageData): string {
  const c = document.createElement("canvas");
  c.width = id.width; c.height = id.height;
  c.getContext("2d")!.putImageData(id, 0, 0);
  return c.toDataURL("image/png");
}

// ─── типы ─────────────────────────────────────────────────────────────────

type MapKey = "baseColor" | "normal" | "roughness" | "ao" | "gloss";

interface MapInfo {
  label: string;
  tag: string;
  desc: string;
  hint: string;
}

const MAP_INFO: Record<MapKey, MapInfo> = {
  baseColor: {
    label: "Base Color",
    tag: "ALBEDO",
    desc: "Цвет поверхности — оригинал без изменений",
    hint: "Подключается в слот Diffuse / Base Color",
  },
  normal: {
    label: "Normal Map",
    tag: "NORMAL",
    desc: "Карта рельефа, вычислена оператором Собеля",
    hint: "Слот Normal / Bump в рендерере",
  },
  roughness: {
    label: "Roughness",
    tag: "ROUGH",
    desc: "Шероховатость: светлое = матово, тёмное = гладко",
    hint: "Слот Roughness / Glossiness (инверт.)",
  },
  ao: {
    label: "Ambient Occlusion",
    tag: "AO",
    desc: "Затенение впадин — глубина рельефа",
    hint: "Multiply поверх Diffuse или слот AO",
  },
  gloss: {
    label: "Glossiness",
    tag: "GLOSS",
    desc: "Блеск поверхности — яркость гребней",
    hint: "Слот Specular / Reflection в Vray/Cycles",
  },
};

// ─── компонент ────────────────────────────────────────────────────────────

export default function Index() {
  const [active, setActive] = useState<MapKey>("baseColor");
  const [urls, setUrls] = useState<Partial<Record<MapKey, string>>>({});
  const [status, setStatus] = useState<"loading" | "processing" | "done" | "error">("loading");
  const [normalStr, setNormalStr] = useState(8);
  const [aoRadius, setAoRadius] = useState(4);
  const [tiling, setTiling] = useState(1);
  const srcData = useRef<ImageData | null>(null);

  // Пересчёт всех карт из сырых данных
  const buildMaps = (img: ImageData, ns: number, aor: number) => {
    setStatus("processing");
    setTimeout(() => {
      setUrls({
        baseColor: imageDataToURL(makeBaseColor(img)),
        normal:    imageDataToURL(makeNormal(img, ns)),
        roughness: imageDataToURL(makeRoughness(img)),
        ao:        imageDataToURL(makeAO(img, aor)),
        gloss:     imageDataToURL(makeGloss(img)),
      });
      setStatus("done");
    }, 30);
  };

  // Загрузка исходника
  useEffect(() => {
    setStatus("loading");
    fetch(SOURCE_URL)
      .then(r => r.blob())
      .then(blob => {
        const blobUrl = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          const SIZE = 512;
          const c = document.createElement("canvas");
          c.width = SIZE; c.height = SIZE;
          const ctx = c.getContext("2d")!;
          ctx.drawImage(img, 0, 0, SIZE, SIZE);
          srcData.current = ctx.getImageData(0, 0, SIZE, SIZE);
          URL.revokeObjectURL(blobUrl);
          buildMaps(srcData.current, normalStr, aoRadius);
        };
        img.onerror = () => setStatus("error");
        img.src = blobUrl;
      })
      .catch(() => setStatus("error"));
  }, []);

  const recompute = (ns: number, aor: number) => {
    if (srcData.current) buildMaps(srcData.current, ns, aor);
  };

  const download = () => {
    const url = urls[active];
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `${active}.png`;
    a.click();
  };

  const isReady = status === "done";
  const currentUrl = urls[active];

  return (
    <div style={{
      height: "100vh", display: "flex", flexDirection: "column",
      background: "#111", color: "#fff",
      fontFamily: "'IBM Plex Mono', monospace",
    }}>

      {/* ── ШАПКА ── */}
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 24px", height: "48px", flexShrink: 0,
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        background: "#0d0d0d",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#c62828", boxShadow: "0 0 6px #c62828" }} />
          <span style={{ fontSize: "11px", letterSpacing: "0.18em", color: "#c62828" }}>PBR MAP GENERATOR</span>
        </div>
        <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.22)", letterSpacing: "0.12em" }}>
          BASE COLOR · NORMAL · ROUGHNESS · AO · GLOSS
        </div>
        <div style={{ fontSize: "10px", letterSpacing: "0.1em", color: status === "done" ? "rgba(100,220,100,0.8)" : status === "error" ? "#f44" : "#c62828" }}>
          {status === "loading" && "● ЗАГРУЗКА..."}
          {status === "processing" && "● ВЫЧИСЛЕНИЕ..."}
          {status === "done" && "✓ ГОТОВО — 5 КАРТ"}
          {status === "error" && "✕ ОШИБКА ЗАГРУЗКИ"}
        </div>
      </header>

      {/* ── ТЕЛО ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* ── ЛЕВАЯ ПАНЕЛЬ: список карт ── */}
        <aside style={{
          width: "200px", flexShrink: 0,
          borderRight: "1px solid rgba(255,255,255,0.07)",
          background: "#0d0d0d",
          display: "flex", flexDirection: "column",
          overflow: "hidden",
        }}>
          <div style={{ padding: "10px 14px 6px", fontSize: "9px", letterSpacing: "0.22em", color: "rgba(255,255,255,0.28)" }}>
            PBR MAPS
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {(Object.keys(MAP_INFO) as MapKey[]).map(key => {
              const m = MAP_INFO[key];
              const sel = active === key;
              return (
                <button key={key} onClick={() => setActive(key)} style={{
                  width: "100%", textAlign: "left", padding: "9px 14px",
                  background: sel ? "rgba(198,40,40,0.13)" : "transparent",
                  borderLeft: sel ? "2px solid #c62828" : "2px solid transparent",
                  border: "none", cursor: "pointer",
                  borderBottom: "1px solid rgba(255,255,255,0.04)",
                  transition: "all 0.12s",
                }}>
                  <div style={{ fontSize: "8px", letterSpacing: "0.18em", color: sel ? "#c62828" : "rgba(255,255,255,0.28)", marginBottom: "2px" }}>{m.tag}</div>
                  <div style={{ fontSize: "13px", fontWeight: sel ? 600 : 400, color: sel ? "#fff" : "rgba(255,255,255,0.52)", lineHeight: 1.2, fontFamily: "'Rajdhani', sans-serif" }}>{m.label}</div>
                  {/* превью */}
                  <div style={{ marginTop: "6px", height: "42px", background: "#0a0a0b", borderRadius: "2px", overflow: "hidden" }}>
                    {urls[key]
                      ? <img src={urls[key]} style={{ width: "100%", height: "100%", objectFit: "cover", opacity: sel ? 1 : 0.55 }} />
                      : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "rgba(198,40,40,0.35)" }} />
                        </div>
                    }
                  </div>
                </button>
              );
            })}
          </div>
          {/* Кнопка скачать */}
          <div style={{ padding: "12px", borderTop: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
            <button onClick={download} disabled={!isReady} style={{
              width: "100%", padding: "8px 0", textAlign: "center",
              background: isReady ? "#c62828" : "rgba(255,255,255,0.05)",
              color: isReady ? "#fff" : "rgba(255,255,255,0.2)",
              border: `1px solid ${isReady ? "#c62828" : "rgba(255,255,255,0.08)"}`,
              borderRadius: "3px", cursor: isReady ? "pointer" : "default",
              fontSize: "9px", letterSpacing: "0.14em",
              fontFamily: "'IBM Plex Mono', monospace",
              transition: "all 0.15s",
            }}>
              ↓ СКАЧАТЬ {MAP_INFO[active]?.tag}
            </button>
            <div style={{ marginTop: "6px", fontSize: "8px", color: "rgba(255,255,255,0.18)", textAlign: "center", lineHeight: 1.5, letterSpacing: "0.06em" }}>
              PNG 512×512
            </div>
          </div>
        </aside>

        {/* ── ЦЕНТР: просмотр карты ── */}
        <main style={{
          flex: 1, display: "flex", flexDirection: "column",
          background: "#0a0a0b", overflow: "hidden",
        }}>
          {/* viewport */}
          <div style={{
            flex: 1, position: "relative",
            display: "flex", alignItems: "center", justifyContent: "center",
            overflow: "hidden",
          }}>
            {/* сетка */}
            <div style={{
              position: "absolute", inset: 0, opacity: 0.06,
              backgroundImage: "linear-gradient(rgba(198,40,40,0.5) 1px,transparent 1px),linear-gradient(90deg,rgba(198,40,40,0.5) 1px,transparent 1px)",
              backgroundSize: "40px 40px",
            }} />

            {status === "loading" || status === "processing" ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
                <div style={{
                  width: "32px", height: "32px", borderRadius: "50%",
                  border: "2px solid rgba(198,40,40,0.2)",
                  borderTopColor: "#c62828",
                  animation: "spin 0.8s linear infinite",
                }} />
                <div style={{ fontSize: "10px", color: "rgba(198,40,40,0.6)", letterSpacing: "0.15em" }}>
                  {status === "loading" ? "ЗАГРУЗКА ОРИГИНАЛА..." : "ВЫЧИСЛЕНИЕ КАРТ..."}
                </div>
              </div>
            ) : status === "error" ? (
              <div style={{ fontSize: "11px", color: "#f44", letterSpacing: "0.12em" }}>ОШИБКА ЗАГРУЗКИ ФАЙЛА</div>
            ) : (
              <div>
                {/* Тайловый превью */}
                <div style={{
                  width: "440px", height: "440px",
                  outline: "1px solid rgba(198,40,40,0.35)",
                  boxShadow: "0 16px 60px rgba(0,0,0,0.75)",
                  overflow: "hidden", position: "relative",
                }}>
                  {currentUrl && (
                    <div style={{
                      width: "100%", height: "100%",
                      backgroundImage: `url(${currentUrl})`,
                      backgroundSize: `${100 / tiling}%`,
                      backgroundRepeat: "repeat",
                    }} />
                  )}
                  {/* угловые метки */}
                  {(["tl","tr","bl","br"] as const).map(p => (
                    <div key={p} style={{
                      position: "absolute", width: "14px", height: "14px",
                      top: p[0]==="t" ? "6px" : "auto", bottom: p[0]==="b" ? "6px" : "auto",
                      left: p[1]==="l" ? "6px" : "auto", right: p[1]==="r" ? "6px" : "auto",
                      borderTop: p[0]==="t" ? "1px solid rgba(198,40,40,0.6)" : "none",
                      borderBottom: p[0]==="b" ? "1px solid rgba(198,40,40,0.6)" : "none",
                      borderLeft: p[1]==="l" ? "1px solid rgba(198,40,40,0.6)" : "none",
                      borderRight: p[1]==="r" ? "1px solid rgba(198,40,40,0.6)" : "none",
                    }} />
                  ))}
                </div>
                {/* подпись */}
                <div style={{ marginTop: "10px", display: "flex", justifyContent: "space-between", width: "440px" }}>
                  <span style={{ fontSize: "10px", color: "rgba(198,40,40,0.8)", letterSpacing: "0.15em" }}>
                    {MAP_INFO[active].tag}
                  </span>
                  <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.25)", letterSpacing: "0.08em" }}>
                    512×512 · TILE {tiling}×{tiling}
                  </span>
                </div>
                <div style={{ marginTop: "4px", fontSize: "11px", color: "rgba(255,255,255,0.3)", fontFamily: "'Rajdhani',sans-serif" }}>
                  {MAP_INFO[active].desc}
                </div>
                <div style={{ marginTop: "2px", fontSize: "10px", color: "rgba(198,40,40,0.5)", letterSpacing: "0.04em" }}>
                  {MAP_INFO[active].hint}
                </div>
              </div>
            )}

            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>

          {/* ── ПАНЕЛЬ ПАРАМЕТРОВ ── */}
          <div style={{
            flexShrink: 0, display: "flex",
            borderTop: "1px solid rgba(255,255,255,0.07)",
            background: "#0d0d0d", minHeight: "100px",
          }}>
            {/* Normal Strength */}
            <div style={{ flex: 1, padding: "14px 18px", borderRight: "1px solid rgba(255,255,255,0.06)" }}>
              <label style={{ display: "block", fontSize: "9px", letterSpacing: "0.18em", color: "rgba(198,40,40,0.65)", marginBottom: "8px" }}>
                NORMAL STRENGTH — {normalStr}
              </label>
              <input type="range" min={1} max={20} step={1} value={normalStr}
                style={{ width: "100%", accentColor: "#c62828" }}
                onChange={e => { const v = Number(e.target.value); setNormalStr(v); recompute(v, aoRadius); }} />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px", fontSize: "8px", color: "rgba(255,255,255,0.18)" }}>
                <span>СЛАБО</span><span>СИЛЬНО</span>
              </div>
            </div>

            {/* AO Radius */}
            <div style={{ flex: 1, padding: "14px 18px", borderRight: "1px solid rgba(255,255,255,0.06)" }}>
              <label style={{ display: "block", fontSize: "9px", letterSpacing: "0.18em", color: "rgba(198,40,40,0.65)", marginBottom: "8px" }}>
                AO RADIUS — {aoRadius}px
              </label>
              <input type="range" min={1} max={12} step={1} value={aoRadius}
                style={{ width: "100%", accentColor: "#c62828" }}
                onChange={e => { const v = Number(e.target.value); setAoRadius(v); recompute(normalStr, v); }} />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px", fontSize: "8px", color: "rgba(255,255,255,0.18)" }}>
                <span>МАЛО</span><span>ГЛУБОКО</span>
              </div>
            </div>

            {/* Tiling */}
            <div style={{ flex: 1, padding: "14px 18px" }}>
              <label style={{ display: "block", fontSize: "9px", letterSpacing: "0.18em", color: "rgba(198,40,40,0.65)", marginBottom: "8px" }}>
                TILING — {tiling}×{tiling}
              </label>
              <div style={{ display: "flex", gap: "8px" }}>
                {[1, 2, 3, 4].map(n => (
                  <button key={n} onClick={() => setTiling(n)} style={{
                    flex: 1, padding: "6px 0",
                    background: tiling === n ? "#c62828" : "rgba(255,255,255,0.05)",
                    color: tiling === n ? "#fff" : "rgba(255,255,255,0.35)",
                    border: `1px solid ${tiling === n ? "#c62828" : "rgba(255,255,255,0.08)"}`,
                    borderRadius: "3px", cursor: "pointer",
                    fontFamily: "'IBM Plex Mono',monospace", fontSize: "11px", fontWeight: 600,
                    transition: "all 0.12s",
                  }}>{n}×</button>
                ))}
              </div>
              <div style={{ marginTop: "6px", fontSize: "8px", color: "rgba(255,255,255,0.18)" }}>
                ПРОВЕРКА БЕСШОВНОСТИ
              </div>
            </div>
          </div>
        </main>

        {/* ── ПРАВАЯ ПАНЕЛЬ: все карты рядом ── */}
        <aside style={{
          width: "160px", flexShrink: 0,
          borderLeft: "1px solid rgba(255,255,255,0.07)",
          background: "#0d0d0d",
          display: "flex", flexDirection: "column",
          overflow: "hidden",
        }}>
          <div style={{ padding: "10px 12px 6px", fontSize: "9px", letterSpacing: "0.22em", color: "rgba(255,255,255,0.28)", flexShrink: 0 }}>
            ВСЕ КАРТЫ
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "8px", display: "flex", flexDirection: "column", gap: "8px" }}>
            {(Object.keys(MAP_INFO) as MapKey[]).map(key => {
              const sel = active === key;
              return (
                <div key={key} onClick={() => setActive(key)} style={{
                  border: `1px solid ${sel ? "#c62828" : "rgba(255,255,255,0.08)"}`,
                  borderRadius: "4px", overflow: "hidden", cursor: "pointer",
                  boxShadow: sel ? "0 0 10px rgba(198,40,40,0.25)" : "none",
                  transition: "all 0.12s",
                }}>
                  <div style={{ aspectRatio: "1", background: "#0a0a0b" }}>
                    {urls[key]
                      ? <img src={urls[key]} style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }} />
                      : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "rgba(198,40,40,0.3)" }} />
                        </div>
                    }
                  </div>
                  <div style={{ padding: "3px 6px", background: sel ? "rgba(198,40,40,0.18)" : "rgba(0,0,0,0.4)" }}>
                    <span style={{ fontSize: "8px", letterSpacing: "0.14em", color: sel ? "#c62828" : "rgba(255,255,255,0.3)" }}>
                      {MAP_INFO[key].tag}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

      </div>
    </div>
  );
}
