import { useState, useEffect, useRef } from "react";

const SOURCE_URL =
  "https://cdn.poehali.dev/projects/5a15539d-2e23-46d4-9ae4-0b3d25a0b619/bucket/69833b61-01b5-42e0-a8d3-5b99d99bbf7c.png";

const PROXY_URL =
  "https://functions.poehali.dev/358ebaa8-0b09-4cd9-bba4-f5ef4f0fcff6";

// ─── PBR алгоритмы ────────────────────────────────────────────────────────

function luma(r: number, g: number, b: number) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function makeBaseColor(src: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
}

function makeNormal(src: ImageData, strength: number): ImageData {
  const { width: w, height: h, data } = src;
  const out = new ImageData(w, h);
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++)
    gray[i] = luma(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  const g = (x: number, y: number) =>
    gray[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = -g(x-1,y-1) - 2*g(x-1,y) - g(x-1,y+1) + g(x+1,y-1) + 2*g(x+1,y) + g(x+1,y+1);
      const dy = -g(x-1,y-1) - 2*g(x,y-1) - g(x+1,y-1) + g(x-1,y+1) + 2*g(x,y+1) + g(x+1,y+1);
      const nx = (dx / 255) * strength, ny = (dy / 255) * strength, nz = 1;
      const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
      const i = (y * w + x) * 4;
      out.data[i]   = Math.round((nx/len*0.5+0.5)*255);
      out.data[i+1] = Math.round((ny/len*0.5+0.5)*255);
      out.data[i+2] = Math.round((nz/len*0.5+0.5)*255);
      out.data[i+3] = 255;
    }
  }
  return out;
}

function makeRoughness(src: ImageData): ImageData {
  const { width: w, height: h, data } = src;
  const out = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = 255 - Math.round(luma(data[i*4], data[i*4+1], data[i*4+2]));
    out.data[i*4] = out.data[i*4+1] = out.data[i*4+2] = v;
    out.data[i*4+3] = 255;
  }
  return out;
}

function makeAO(src: ImageData, radius: number): ImageData {
  const { width: w, height: h, data } = src;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++)
    gray[i] = luma(data[i*4], data[i*4+1], data[i*4+2]);
  const blur = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let sum = 0, cnt = 0;
      for (let dy = -radius; dy <= radius; dy++)
        for (let dx = -radius; dx <= radius; dx++) {
          sum += gray[Math.max(0,Math.min(h-1,y+dy))*w + Math.max(0,Math.min(w-1,x+dx))];
          cnt++;
        }
      blur[y*w+x] = sum/cnt;
    }
  const out = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = Math.max(0, Math.min(255, Math.round(blur[i] - (blur[i]-gray[i])*2)));
    out.data[i*4] = out.data[i*4+1] = out.data[i*4+2] = v;
    out.data[i*4+3] = 255;
  }
  return out;
}

function makeGloss(src: ImageData): ImageData {
  const { width: w, height: h, data } = src;
  const out = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = Math.round(luma(data[i*4], data[i*4+1], data[i*4+2]));
    out.data[i*4] = out.data[i*4+1] = out.data[i*4+2] = v;
    out.data[i*4+3] = 255;
  }
  return out;
}

function toDataURL(id: ImageData): string {
  const c = document.createElement("canvas");
  c.width = id.width; c.height = id.height;
  c.getContext("2d")!.putImageData(id, 0, 0);
  return c.toDataURL("image/png");
}

// ─── типы ─────────────────────────────────────────────────────────────────

type MapKey = "baseColor" | "normal" | "roughness" | "ao" | "gloss";

const MAPS: Record<MapKey, { tag: string; label: string; hint: string }> = {
  baseColor: { tag: "BASE COLOR", label: "Цвет поверхности",   hint: "Слот: Diffuse / Base Color" },
  normal:    { tag: "NORMAL",     label: "Карта рельефа",      hint: "Слот: Normal / Bump" },
  roughness: { tag: "ROUGHNESS",  label: "Шероховатость",      hint: "Слот: Roughness" },
  ao:        { tag: "AO",         label: "Затенение впадин",   hint: "Слот: Ambient Occlusion" },
  gloss:     { tag: "GLOSS",      label: "Блеск / Glossiness", hint: "Слот: Specular / Reflection" },
};

// ─── компонент ────────────────────────────────────────────────────────────

export default function Index() {
  const [active, setActive]       = useState<MapKey>("baseColor");
  const [urls, setUrls]           = useState<Partial<Record<MapKey, string>>>({});
  const [status, setStatus]       = useState<"loading"|"processing"|"done"|"error">("loading");
  const [normalStr, setNormalStr] = useState(8);
  const [aoRadius, setAoRadius]   = useState(4);
  const [tiling, setTiling]       = useState(1);
  const srcRef = useRef<ImageData | null>(null);

  const buildMaps = (img: ImageData, ns: number, aor: number) => {
    setStatus("processing");
    setTimeout(() => {
      setUrls({
        baseColor: toDataURL(makeBaseColor(img)),
        normal:    toDataURL(makeNormal(img, ns)),
        roughness: toDataURL(makeRoughness(img)),
        ao:        toDataURL(makeAO(img, aor)),
        gloss:     toDataURL(makeGloss(img)),
      });
      setStatus("done");
    }, 30);
  };

  useEffect(() => {
    setStatus("loading");
    fetch(`${PROXY_URL}?url=${encodeURIComponent(SOURCE_URL)}`)
      .then(r => r.json())
      .then(({ data }: { data: string }) => {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement("canvas");
          c.width = 512; c.height = 512;
          const ctx = c.getContext("2d")!;
          ctx.drawImage(img, 0, 0, 512, 512);
          srcRef.current = ctx.getImageData(0, 0, 512, 512);
          buildMaps(srcRef.current, normalStr, aoRadius);
        };
        img.src = `data:image/png;base64,${data}`;
      })
      .catch(() => setStatus("error"));
  }, []);

  const recompute = (ns: number, aor: number) => {
    if (srcRef.current) buildMaps(srcRef.current, ns, aor);
  };

  const download = () => {
    const url = urls[active];
    if (!url) return;
    const a = document.createElement("a");
    a.href = url; a.download = `${active}.png`; a.click();
  };

  const ready = status === "done";
  const cur = urls[active];

  return (
    <div style={{ height:"100vh", display:"flex", flexDirection:"column", background:"#111", color:"#fff", fontFamily:"'IBM Plex Mono',monospace", overflow:"hidden" }}>

      {/* шапка */}
      <header style={{ height:"48px", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 24px", background:"#0d0d0d", borderBottom:"1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
          <div style={{ width:"7px", height:"7px", borderRadius:"50%", background:"#c62828", boxShadow:"0 0 6px #c62828" }} />
          <span style={{ fontSize:"11px", letterSpacing:"0.18em", color:"#c62828" }}>PBR MAP GENERATOR</span>
        </div>
        <div style={{ fontSize:"10px", color:"rgba(255,255,255,0.2)", letterSpacing:"0.1em" }}>
          BASE COLOR · NORMAL · ROUGHNESS · AO · GLOSS
        </div>
        <div style={{ fontSize:"10px", letterSpacing:"0.1em", color: ready ? "rgba(100,220,100,0.8)" : status==="error" ? "#f55" : "#c62828" }}>
          {status==="loading" && "● ЗАГРУЗКА..."}
          {status==="processing" && "● ВЫЧИСЛЕНИЕ..."}
          {status==="done" && "✓ 5 КАРТ ГОТОВЫ"}
          {status==="error" && "✕ ОШИБКА"}
        </div>
      </header>

      <div style={{ flex:1, display:"flex", overflow:"hidden" }}>

        {/* левая панель */}
        <aside style={{ width:"190px", flexShrink:0, background:"#0d0d0d", borderRight:"1px solid rgba(255,255,255,0.07)", display:"flex", flexDirection:"column", overflow:"hidden" }}>
          <div style={{ padding:"10px 14px 6px", fontSize:"9px", letterSpacing:"0.2em", color:"rgba(255,255,255,0.28)" }}>PBR MAPS</div>
          <div style={{ flex:1, overflowY:"auto" }}>
            {(Object.keys(MAPS) as MapKey[]).map(key => {
              const m = MAPS[key];
              const sel = active === key;
              return (
                <button key={key} onClick={() => setActive(key)} style={{
                  width:"100%", textAlign:"left", padding:"8px 14px",
                  background: sel ? "rgba(198,40,40,0.13)" : "transparent",
                  borderLeft: sel ? "2px solid #c62828" : "2px solid transparent",
                  border:"none", cursor:"pointer",
                  borderBottom:"1px solid rgba(255,255,255,0.04)",
                }}>
                  <div style={{ fontSize:"8px", letterSpacing:"0.18em", color: sel ? "#c62828" : "rgba(255,255,255,0.3)", marginBottom:"2px" }}>{m.tag}</div>
                  <div style={{ fontSize:"12px", fontWeight: sel ? 600 : 400, color: sel ? "#fff" : "rgba(255,255,255,0.5)", fontFamily:"'Rajdhani',sans-serif" }}>{m.label}</div>
                  <div style={{ marginTop:"5px", height:"40px", background:"#0a0a0b", borderRadius:"2px", overflow:"hidden" }}>
                    {urls[key]
                      ? <img src={urls[key]} style={{ width:"100%", height:"100%", objectFit:"cover", opacity: sel ? 1 : 0.5 }} />
                      : <div style={{ width:"100%", height:"100%", display:"flex", alignItems:"center", justifyContent:"center" }}>
                          <div style={{ width:"5px", height:"5px", borderRadius:"50%", background:"rgba(198,40,40,0.3)" }} />
                        </div>
                    }
                  </div>
                </button>
              );
            })}
          </div>
          <div style={{ padding:"12px", borderTop:"1px solid rgba(255,255,255,0.07)", flexShrink:0 }}>
            <button onClick={download} disabled={!ready} style={{
              width:"100%", padding:"8px 0", textAlign:"center",
              background: ready ? "#c62828" : "rgba(255,255,255,0.05)",
              color: ready ? "#fff" : "rgba(255,255,255,0.2)",
              border:`1px solid ${ready ? "#c62828" : "rgba(255,255,255,0.08)"}`,
              borderRadius:"3px", cursor: ready ? "pointer" : "default",
              fontSize:"9px", letterSpacing:"0.14em", fontFamily:"'IBM Plex Mono',monospace",
            }}>
              ↓ СКАЧАТЬ {MAPS[active]?.tag}
            </button>
            <div style={{ marginTop:"6px", fontSize:"8px", color:"rgba(255,255,255,0.18)", textAlign:"center", letterSpacing:"0.06em" }}>PNG 512×512</div>
          </div>
        </aside>

        {/* центр */}
        <main style={{ flex:1, display:"flex", flexDirection:"column", background:"#0a0a0b", overflow:"hidden" }}>
          <div style={{ flex:1, position:"relative", display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden" }}>
            <div style={{ position:"absolute", inset:0, opacity:0.06, backgroundImage:"linear-gradient(rgba(198,40,40,0.5) 1px,transparent 1px),linear-gradient(90deg,rgba(198,40,40,0.5) 1px,transparent 1px)", backgroundSize:"40px 40px" }} />

            {(status==="loading" || status==="processing") && (
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:"16px" }}>
                <div style={{ width:"32px", height:"32px", borderRadius:"50%", border:"2px solid rgba(198,40,40,0.2)", borderTopColor:"#c62828", animation:"spin 0.8s linear infinite" }} />
                <div style={{ fontSize:"10px", color:"rgba(198,40,40,0.6)", letterSpacing:"0.15em" }}>
                  {status==="loading" ? "ЗАГРУЗКА ОРИГИНАЛА..." : "ВЫЧИСЛЕНИЕ КАРТ..."}
                </div>
              </div>
            )}

            {status==="error" && (
              <div style={{ fontSize:"11px", color:"#f55", letterSpacing:"0.12em" }}>ОШИБКА ЗАГРУЗКИ</div>
            )}

            {ready && cur && (
              <div>
                <div style={{ width:"440px", height:"440px", outline:"1px solid rgba(198,40,40,0.35)", boxShadow:"0 16px 60px rgba(0,0,0,0.75)", overflow:"hidden", position:"relative" }}>
                  <div style={{ width:"100%", height:"100%", backgroundImage:`url(${cur})`, backgroundSize:`${100/tiling}%`, backgroundRepeat:"repeat" }} />
                  {(["tl","tr","bl","br"] as const).map(p => (
                    <div key={p} style={{
                      position:"absolute", width:"14px", height:"14px",
                      top:p[0]==="t"?"6px":"auto", bottom:p[0]==="b"?"6px":"auto",
                      left:p[1]==="l"?"6px":"auto", right:p[1]==="r"?"6px":"auto",
                      borderTop:p[0]==="t"?"1px solid rgba(198,40,40,0.6)":"none",
                      borderBottom:p[0]==="b"?"1px solid rgba(198,40,40,0.6)":"none",
                      borderLeft:p[1]==="l"?"1px solid rgba(198,40,40,0.6)":"none",
                      borderRight:p[1]==="r"?"1px solid rgba(198,40,40,0.6)":"none",
                    }} />
                  ))}
                </div>
                <div style={{ marginTop:"10px", display:"flex", justifyContent:"space-between", width:"440px" }}>
                  <span style={{ fontSize:"10px", color:"rgba(198,40,40,0.8)", letterSpacing:"0.15em" }}>{MAPS[active].tag}</span>
                  <span style={{ fontSize:"10px", color:"rgba(255,255,255,0.25)" }}>512×512 · TILE {tiling}×{tiling}</span>
                </div>
                <div style={{ marginTop:"3px", fontSize:"11px", color:"rgba(255,255,255,0.28)", fontFamily:"'Rajdhani',sans-serif" }}>
                  {MAPS[active].label} — {MAPS[active].hint}
                </div>
              </div>
            )}
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          </div>

          {/* панель параметров */}
          <div style={{ flexShrink:0, display:"flex", borderTop:"1px solid rgba(255,255,255,0.07)", background:"#0d0d0d", minHeight:"100px" }}>
            <div style={{ flex:1, padding:"14px 18px", borderRight:"1px solid rgba(255,255,255,0.06)" }}>
              <label style={{ display:"block", fontSize:"9px", letterSpacing:"0.18em", color:"rgba(198,40,40,0.65)", marginBottom:"8px" }}>
                NORMAL STRENGTH — {normalStr}
              </label>
              <input type="range" min={1} max={20} value={normalStr} style={{ width:"100%", accentColor:"#c62828" }}
                onChange={e => { const v=Number(e.target.value); setNormalStr(v); recompute(v, aoRadius); }} />
              <div style={{ display:"flex", justifyContent:"space-between", marginTop:"4px", fontSize:"8px", color:"rgba(255,255,255,0.18)" }}>
                <span>СЛАБО</span><span>СИЛЬНО</span>
              </div>
            </div>
            <div style={{ flex:1, padding:"14px 18px", borderRight:"1px solid rgba(255,255,255,0.06)" }}>
              <label style={{ display:"block", fontSize:"9px", letterSpacing:"0.18em", color:"rgba(198,40,40,0.65)", marginBottom:"8px" }}>
                AO RADIUS — {aoRadius}px
              </label>
              <input type="range" min={1} max={12} value={aoRadius} style={{ width:"100%", accentColor:"#c62828" }}
                onChange={e => { const v=Number(e.target.value); setAoRadius(v); recompute(normalStr, v); }} />
              <div style={{ display:"flex", justifyContent:"space-between", marginTop:"4px", fontSize:"8px", color:"rgba(255,255,255,0.18)" }}>
                <span>МАЛО</span><span>ГЛУБОКО</span>
              </div>
            </div>
            <div style={{ flex:1, padding:"14px 18px" }}>
              <label style={{ display:"block", fontSize:"9px", letterSpacing:"0.18em", color:"rgba(198,40,40,0.65)", marginBottom:"8px" }}>
                TILING — {tiling}×{tiling}
              </label>
              <div style={{ display:"flex", gap:"8px" }}>
                {[1,2,3,4].map(n => (
                  <button key={n} onClick={() => setTiling(n)} style={{
                    flex:1, padding:"6px 0",
                    background: tiling===n ? "#c62828" : "rgba(255,255,255,0.05)",
                    color: tiling===n ? "#fff" : "rgba(255,255,255,0.35)",
                    border:`1px solid ${tiling===n ? "#c62828" : "rgba(255,255,255,0.08)"}`,
                    borderRadius:"3px", cursor:"pointer",
                    fontFamily:"'IBM Plex Mono',monospace", fontSize:"11px", fontWeight:600,
                  }}>{n}×</button>
                ))}
              </div>
              <div style={{ marginTop:"6px", fontSize:"8px", color:"rgba(255,255,255,0.18)" }}>ПРОВЕРКА БЕСШОВНОСТИ</div>
            </div>
          </div>
        </main>

        {/* правая панель */}
        <aside style={{ width:"150px", flexShrink:0, background:"#0d0d0d", borderLeft:"1px solid rgba(255,255,255,0.07)", display:"flex", flexDirection:"column", overflow:"hidden" }}>
          <div style={{ padding:"10px 12px 6px", fontSize:"9px", letterSpacing:"0.2em", color:"rgba(255,255,255,0.28)", flexShrink:0 }}>ВСЕ КАРТЫ</div>
          <div style={{ flex:1, overflowY:"auto", padding:"8px", display:"flex", flexDirection:"column", gap:"8px" }}>
            {(Object.keys(MAPS) as MapKey[]).map(key => {
              const sel = active === key;
              return (
                <div key={key} onClick={() => setActive(key)} style={{
                  border:`1px solid ${sel ? "#c62828" : "rgba(255,255,255,0.08)"}`,
                  borderRadius:"3px", overflow:"hidden", cursor:"pointer",
                  boxShadow: sel ? "0 0 10px rgba(198,40,40,0.25)" : "none",
                }}>
                  <div style={{ aspectRatio:"1", background:"#0a0a0b" }}>
                    {urls[key]
                      ? <img src={urls[key]} style={{ display:"block", width:"100%", height:"100%", objectFit:"cover" }} />
                      : <div style={{ width:"100%", height:"100%", display:"flex", alignItems:"center", justifyContent:"center" }}>
                          <div style={{ width:"5px", height:"5px", borderRadius:"50%", background:"rgba(198,40,40,0.3)" }} />
                        </div>
                    }
                  </div>
                  <div style={{ padding:"3px 6px", background: sel ? "rgba(198,40,40,0.18)" : "rgba(0,0,0,0.4)" }}>
                    <span style={{ fontSize:"8px", letterSpacing:"0.12em", color: sel ? "#c62828" : "rgba(255,255,255,0.3)" }}>{MAPS[key].tag}</span>
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
