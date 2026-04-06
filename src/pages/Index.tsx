import { useState } from "react";

const MAPS = {
  baseColor: {
    label: "Base Color",
    tag: "ALBEDO",
    desc: "Алый глянцевый цвет поверхности",
    url: "https://cdn.poehali.dev/projects/5a15539d-2e23-46d4-9ae4-0b3d25a0b619/files/108defb7-1cf6-4829-81ac-974b18622e20.jpg",
  },
  normal: {
    label: "Normal Map",
    tag: "NORMAL",
    desc: "Рельеф рёбер сотовой структуры",
    url: "https://cdn.poehali.dev/projects/5a15539d-2e23-46d4-9ae4-0b3d25a0b619/files/d6b190e3-b95a-4a96-be9b-58783c7233f7.jpg",
  },
  roughness: {
    label: "Roughness",
    tag: "ROUGH",
    desc: "Шероховатость: ячейки — глянец, рёбра — матовость",
    url: "https://cdn.poehali.dev/projects/5a15539d-2e23-46d4-9ae4-0b3d25a0b619/files/790784b2-1edb-4e63-a966-37b0220a0696.jpg",
  },
  ao: {
    label: "Ambient Occlusion",
    tag: "AO",
    desc: "Глубина тени в пазах между ячейками",
    url: "https://cdn.poehali.dev/projects/5a15539d-2e23-46d4-9ae4-0b3d25a0b619/files/15931093-6335-4f25-a6cd-5f872d470e1f.jpg",
  },
};

type MapKey = keyof typeof MAPS;

const PBR_SPECS = [
  { label: "Тип", value: "PBR Metallic-Roughness" },
  { label: "Движок", value: "Rhino / Cycles / Vray" },
  { label: "Тайлинг", value: "Seamless · 1024×1024px" },
  { label: "Цвет", value: "#CC0020 Scarlet Red" },
  { label: "Блеск", value: "Glossy Lacquer Sheen" },
  { label: "Карты", value: "Albedo · Normal · Rough · AO" },
];

export default function Index() {
  const [activeMap, setActiveMap] = useState<MapKey>("baseColor");
  const [lightAngle, setLightAngle] = useState(45);
  const [roughness, setRoughness] = useState(0.15);
  const [zoom, setZoom] = useState(1);
  const [tileCount, setTileCount] = useState(2);

  const gloss = 1 - roughness;
  const lightX = Math.cos((lightAngle * Math.PI) / 180) * 60;
  const lightY = Math.sin((lightAngle * Math.PI) / 180) * 60;

  return (
    <div
      className="min-h-screen text-white overflow-x-hidden"
      style={{ background: "#0e0e0f", fontFamily: "'Rajdhani', sans-serif" }}
    >
      {/* Верхняя полоса */}
      <header
        className="border-b flex items-center justify-between px-6 py-3"
        style={{
          borderColor: "rgba(204,0,32,0.3)",
          background: "rgba(14,14,15,0.98)",
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-2 h-2 rounded-full animate-pulse"
            style={{ background: "#CC0020", boxShadow: "0 0 8px #CC0020" }}
          />
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: "11px",
              color: "rgba(204,0,32,0.9)",
              letterSpacing: "0.15em",
            }}
          >
            PBR MATERIAL EDITOR
          </span>
        </div>
        <div
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: "10px",
            color: "rgba(255,255,255,0.25)",
            letterSpacing: "0.1em",
          }}
        >
          HONEYCOMB · SCARLET · v1.0
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full" style={{ background: "#CC0020" }} />
          <div className="w-3 h-3 rounded-full" style={{ background: "#2a2a2a" }} />
          <div className="w-3 h-3 rounded-full" style={{ background: "#2a2a2a" }} />
        </div>
      </header>

      <div className="flex" style={{ height: "calc(100vh - 49px)" }}>
        {/* Левая панель */}
        <aside
          className="w-52 flex-shrink-0 flex flex-col border-r"
          style={{ borderColor: "rgba(255,255,255,0.06)", background: "#111113" }}
        >
          <div className="px-4 py-3 border-b" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
            <p
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: "9px",
                letterSpacing: "0.2em",
                color: "rgba(255,255,255,0.3)",
              }}
            >
              TEXTURE MAPS
            </p>
          </div>
          <div className="flex-1 overflow-auto py-2">
            {(Object.keys(MAPS) as MapKey[]).map((key) => {
              const m = MAPS[key];
              const active = activeMap === key;
              return (
                <button
                  key={key}
                  onClick={() => setActiveMap(key)}
                  className="w-full text-left transition-all duration-200"
                  style={{
                    background: active ? "rgba(204,0,32,0.15)" : "transparent",
                    borderLeft: active ? "2px solid #CC0020" : "2px solid transparent",
                    padding: "10px 14px",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: "9px",
                      letterSpacing: "0.15em",
                      color: active ? "#CC0020" : "rgba(255,255,255,0.3)",
                    }}
                  >
                    {m.tag}
                  </span>
                  <p
                    style={{
                      fontSize: "13px",
                      fontWeight: active ? 600 : 400,
                      color: active ? "#fff" : "rgba(255,255,255,0.5)",
                      lineHeight: 1.2,
                      marginTop: "2px",
                    }}
                  >
                    {m.label}
                  </p>
                  <div
                    className="mt-2 rounded overflow-hidden"
                    style={{ height: "48px", opacity: active ? 1 : 0.5 }}
                  >
                    <img src={m.url} alt={m.label} className="w-full h-full object-cover" />
                  </div>
                </button>
              );
            })}
          </div>

          <div className="border-t p-4" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
            <p
              className="mb-3"
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: "9px",
                letterSpacing: "0.2em",
                color: "rgba(255,255,255,0.3)",
              }}
            >
              SPECIFICATIONS
            </p>
            <div className="space-y-1">
              {PBR_SPECS.map((s) => (
                <div key={s.label}>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: "8px",
                      color: "rgba(204,0,32,0.7)",
                      letterSpacing: "0.1em",
                    }}
                  >
                    {s.label.toUpperCase()}
                  </span>
                  <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.55)", lineHeight: 1.3 }}>
                    {s.value}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* Главный viewport */}
        <main className="flex-1 flex flex-col overflow-hidden">
          <div
            className="flex-1 relative flex items-center justify-center overflow-hidden"
            style={{ background: "#0a0a0b" }}
          >
            {/* Сетка */}
            <div
              className="absolute inset-0 opacity-10"
              style={{
                backgroundImage: `
                  linear-gradient(rgba(204,0,32,0.4) 1px, transparent 1px),
                  linear-gradient(90deg, rgba(204,0,32,0.4) 1px, transparent 1px)
                `,
                backgroundSize: "40px 40px",
              }}
            />

            {/* Световой блик */}
            <div
              className="absolute pointer-events-none transition-all duration-500"
              style={{
                width: "400px",
                height: "400px",
                borderRadius: "50%",
                background: `radial-gradient(circle, rgba(204,0,32,${gloss * 0.22}) 0%, transparent 70%)`,
                left: `calc(50% + ${lightX}px - 200px)`,
                top: `calc(50% + ${lightY}px - 200px)`,
                filter: "blur(40px)",
              }}
            />

            {/* Текстура */}
            <div style={{ transform: `scale(${zoom})`, transition: "transform 0.3s ease" }}>
              <div
                className="relative overflow-hidden rounded"
                style={{
                  width: "400px",
                  height: "400px",
                  boxShadow: `
                    0 0 0 1px rgba(204,0,32,0.35),
                    0 24px 80px rgba(0,0,0,0.85),
                    ${lightX * 0.08}px ${lightY * 0.08}px ${gloss * 50 + 15}px rgba(204,0,32,${gloss * 0.35})
                  `,
                }}
              >
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    backgroundImage: `url(${MAPS[activeMap].url})`,
                    backgroundSize: `${100 / tileCount}%`,
                    backgroundRepeat: "repeat",
                    filter:
                      activeMap === "baseColor"
                        ? `brightness(${0.75 + gloss * 0.45}) contrast(1.1) saturate(${1 + gloss * 0.35})`
                        : "none",
                  }}
                />
                {activeMap === "baseColor" && (
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      background: `radial-gradient(ellipse at ${50 + lightX * 0.25}% ${50 + lightY * 0.25}%, rgba(255,255,255,${gloss * 0.2}) 0%, transparent 55%)`,
                      mixBlendMode: "screen",
                    }}
                  />
                )}
                {(["tl", "tr", "bl", "br"] as const).map((pos) => (
                  <div
                    key={pos}
                    className="absolute w-4 h-4"
                    style={{
                      top: pos[0] === "t" ? "8px" : "auto",
                      bottom: pos[0] === "b" ? "8px" : "auto",
                      left: pos[1] === "l" ? "8px" : "auto",
                      right: pos[1] === "r" ? "8px" : "auto",
                      borderTop: pos[0] === "t" ? "1px solid rgba(204,0,32,0.6)" : "none",
                      borderBottom: pos[0] === "b" ? "1px solid rgba(204,0,32,0.6)" : "none",
                      borderLeft: pos[1] === "l" ? "1px solid rgba(204,0,32,0.6)" : "none",
                      borderRight: pos[1] === "r" ? "1px solid rgba(204,0,32,0.6)" : "none",
                    }}
                  />
                ))}
              </div>

              <div className="mt-3 flex items-center justify-between">
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: "10px",
                    color: "rgba(204,0,32,0.8)",
                    letterSpacing: "0.15em",
                  }}
                >
                  {MAPS[activeMap].tag}
                </span>
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: "10px",
                    color: "rgba(255,255,255,0.3)",
                    letterSpacing: "0.1em",
                  }}
                >
                  400×400 · {tileCount}×{tileCount} TILE
                </span>
              </div>
              <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.35)", marginTop: "4px" }}>
                {MAPS[activeMap].desc}
              </p>
            </div>

            <div
              className="absolute top-4 left-4"
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: "10px",
                color: "rgba(255,255,255,0.15)",
                letterSpacing: "0.1em",
              }}
            >
              VIEWPORT · MATERIAL PREVIEW
            </div>
          </div>

          {/* Панель управления */}
          <div
            className="border-t flex items-stretch flex-shrink-0"
            style={{ borderColor: "rgba(255,255,255,0.06)", background: "#111113", minHeight: "120px" }}
          >
            {/* Угол света */}
            <div className="flex-1 p-5 border-r" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
              <label
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: "9px",
                  letterSpacing: "0.2em",
                  color: "rgba(204,0,32,0.7)",
                  display: "block",
                  marginBottom: "8px",
                }}
              >
                LIGHT ANGLE — {lightAngle}°
              </label>
              <input
                type="range" min={0} max={360} value={lightAngle}
                onChange={(e) => setLightAngle(Number(e.target.value))}
                className="w-full" style={{ accentColor: "#CC0020" }}
              />
              <div className="mt-2 flex justify-between" style={{ fontSize: "9px", color: "rgba(255,255,255,0.2)", fontFamily: "'IBM Plex Mono', monospace" }}>
                <span>0°</span><span>90°</span><span>180°</span><span>360°</span>
              </div>
            </div>

            {/* Шероховатость */}
            <div className="flex-1 p-5 border-r" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
              <label
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: "9px",
                  letterSpacing: "0.2em",
                  color: "rgba(204,0,32,0.7)",
                  display: "block",
                  marginBottom: "8px",
                }}
              >
                ROUGHNESS — {roughness.toFixed(2)}
              </label>
              <input
                type="range" min={0} max={1} step={0.01} value={roughness}
                onChange={(e) => setRoughness(Number(e.target.value))}
                className="w-full" style={{ accentColor: "#CC0020" }}
              />
              <div className="mt-2 flex justify-between" style={{ fontSize: "9px", color: "rgba(255,255,255,0.2)", fontFamily: "'IBM Plex Mono', monospace" }}>
                <span>ГЛЯНЕЦ</span><span>——</span><span>МАТОВЫЙ</span>
              </div>
            </div>

            {/* Масштаб */}
            <div className="flex-1 p-5 border-r" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
              <label
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: "9px",
                  letterSpacing: "0.2em",
                  color: "rgba(204,0,32,0.7)",
                  display: "block",
                  marginBottom: "8px",
                }}
              >
                ZOOM — {zoom.toFixed(1)}×
              </label>
              <input
                type="range" min={0.5} max={2} step={0.1} value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="w-full" style={{ accentColor: "#CC0020" }}
              />
              <div className="mt-2 flex justify-between" style={{ fontSize: "9px", color: "rgba(255,255,255,0.2)", fontFamily: "'IBM Plex Mono', monospace" }}>
                <span>0.5×</span><span>1×</span><span>1.5×</span><span>2×</span>
              </div>
            </div>

            {/* Тайлинг */}
            <div className="flex-1 p-5">
              <label
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: "9px",
                  letterSpacing: "0.2em",
                  color: "rgba(204,0,32,0.7)",
                  display: "block",
                  marginBottom: "8px",
                }}
              >
                TILING — {tileCount}×{tileCount}
              </label>
              <div className="flex gap-2">
                {[1, 2, 3, 4].map((n) => (
                  <button
                    key={n}
                    onClick={() => setTileCount(n)}
                    className="flex-1 py-2 transition-all duration-150"
                    style={{
                      background: tileCount === n ? "#CC0020" : "rgba(255,255,255,0.05)",
                      color: tileCount === n ? "#fff" : "rgba(255,255,255,0.4)",
                      border: `1px solid ${tileCount === n ? "#CC0020" : "rgba(255,255,255,0.08)"}`,
                      borderRadius: "3px",
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: "11px",
                      fontWeight: 600,
                    }}
                  >
                    {n}×
                  </button>
                ))}
              </div>
              <p className="mt-2" style={{ fontSize: "9px", color: "rgba(255,255,255,0.2)", fontFamily: "'IBM Plex Mono', monospace" }}>
                SEAMLESS TILE REPEAT
              </p>
            </div>
          </div>
        </main>

        {/* Правая панель */}
        <aside
          className="w-44 flex-shrink-0 border-l flex flex-col"
          style={{ borderColor: "rgba(255,255,255,0.06)", background: "#111113" }}
        >
          <div className="px-4 py-3 border-b" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
            <p style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "9px", letterSpacing: "0.2em", color: "rgba(255,255,255,0.3)" }}>
              ALL MAPS
            </p>
          </div>
          <div className="flex-1 overflow-auto p-3 space-y-3">
            {(Object.keys(MAPS) as MapKey[]).map((key) => {
              const m = MAPS[key];
              const active = activeMap === key;
              return (
                <div
                  key={key}
                  onClick={() => setActiveMap(key)}
                  className="cursor-pointer transition-all duration-200"
                  style={{
                    border: `1px solid ${active ? "#CC0020" : "rgba(255,255,255,0.08)"}`,
                    borderRadius: "4px",
                    overflow: "hidden",
                    boxShadow: active ? "0 0 14px rgba(204,0,32,0.35)" : "none",
                  }}
                >
                  <img
                    src={m.url} alt={m.label}
                    style={{ display: "block", width: "100%", aspectRatio: "1", objectFit: "cover" }}
                  />
                  <div className="px-2 py-1" style={{ background: active ? "rgba(204,0,32,0.2)" : "rgba(0,0,0,0.4)" }}>
                    <p style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "8px", letterSpacing: "0.15em", color: active ? "#CC0020" : "rgba(255,255,255,0.35)" }}>
                      {m.tag}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-3 border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
            <div
              className="w-full py-2 text-center rounded"
              style={{
                background: "rgba(204,0,32,0.12)",
                border: "1px solid rgba(204,0,32,0.35)",
                color: "rgba(204,0,32,0.85)",
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: "9px",
                letterSpacing: "0.1em",
              }}
            >
              4 MAPS READY
            </div>
            <p className="mt-2 text-center" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "8px", color: "rgba(255,255,255,0.2)", letterSpacing: "0.08em", lineHeight: 1.6 }}>
              RHINO COMPATIBLE<br />PBR FORMAT
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
