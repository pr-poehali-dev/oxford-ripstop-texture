import { useState, useEffect, useRef } from "react";

const SOURCE_URL =
  "https://cdn.poehali.dev/projects/5a15539d-2e23-46d4-9ae4-0b3d25a0b619/bucket/69833b61-01b5-42e0-a8d3-5b99d99bbf7c.png";

const PROXY_URL =
  "https://functions.poehali.dev/358ebaa8-0b09-4cd9-bba4-f5ef4f0fcff6";

// ─── PBR алгоритмы ────────────────────────────────────────────────────────

function luma(r: number, g: number, b: number) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Gaussian blur для float array (для нормализации теней)
function gaussBlur(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const sigma = radius / 2;
  const twoSigSq = 2 * sigma * sigma;
  const kernelSize = Math.ceil(radius * 2) | 0;
  // horizontal pass
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, weight = 0;
      for (let k = -kernelSize; k <= kernelSize; k++) {
        const xx = Math.max(0, Math.min(w - 1, x + k));
        const w_ = Math.exp(-(k * k) / twoSigSq);
        sum += src[y * w + xx] * w_;
        weight += w_;
      }
      tmp[y * w + x] = sum / weight;
    }
  }
  // vertical pass
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, weight = 0;
      for (let k = -kernelSize; k <= kernelSize; k++) {
        const yy = Math.max(0, Math.min(h - 1, y + k));
        const w_ = Math.exp(-(k * k) / twoSigSq);
        sum += tmp[yy * w + x] * w_;
        weight += w_;
      }
      out[y * w + x] = sum / weight;
    }
  }
  return out;
}

// Auto-crop: находит bounding box непустых пикселей,
// вырезает квадратный кусок по центру и масштабирует в 512×512
function autoCropToSquare(src: ImageData): ImageData {
  const { width: w, height: h, data } = src;

  // Определяем "фон" по углам (медиана 4 угловых пикселей)
  const corners = [
    { r: data[0], g: data[1], b: data[2] },
    { r: data[(w-1)*4], g: data[(w-1)*4+1], b: data[(w-1)*4+2] },
    { r: data[(h-1)*w*4], g: data[(h-1)*w*4+1], b: data[(h-1)*w*4+2] },
    { r: data[((h-1)*w+(w-1))*4], g: data[((h-1)*w+(w-1))*4+1], b: data[((h-1)*w+(w-1))*4+2] },
  ];
  const bgR = Math.round(corners.reduce((s,c)=>s+c.r,0)/4);
  const bgG = Math.round(corners.reduce((s,c)=>s+c.g,0)/4);
  const bgB = Math.round(corners.reduce((s,c)=>s+c.b,0)/4);
  const thresh = 28;

  let minX = w, minY = h, maxX = 0, maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const dr = Math.abs(data[i] - bgR);
      const dg = Math.abs(data[i+1] - bgG);
      const db = Math.abs(data[i+2] - bgB);
      if (dr + dg + db > thresh) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  // Отступ 4% от краёв
  const pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.04);
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad);
  maxY = Math.min(h - 1, maxY + pad);

  // Делаем квадратный crop по центру
  const cw = maxX - minX;
  const ch = maxY - minY;
  const side = Math.max(cw, ch);
  const cx = Math.round((minX + maxX) / 2);
  const cy = Math.round((minY + maxY) / 2);
  const x0 = Math.max(0, cx - Math.round(side / 2));
  const y0 = Math.max(0, cy - Math.round(side / 2));
  const x1 = Math.min(w, x0 + side);
  const y1 = Math.min(h, y0 + side);

  // Рисуем обрезанный кусок в 512×512
  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = w; srcCanvas.height = h;
  srcCanvas.getContext("2d")!.putImageData(src, 0, 0);

  const out = document.createElement("canvas");
  out.width = 512; out.height = 512;
  const octx = out.getContext("2d")!;
  octx.drawImage(srcCanvas, x0, y0, x1 - x0, y1 - y0, 0, 0, 512, 512);
  return octx.getImageData(0, 0, 512, 512);
}

// BaseColor: убираем глобальные тени (делим на low-frequency освещение)
function makeBaseColor(src: ImageData): ImageData {
  const { width: w, height: h, data } = src;
  const rF = new Float32Array(w * h);
  const gF = new Float32Array(w * h);
  const bF = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    rF[i] = data[i*4];
    gF[i] = data[i*4+1];
    bF[i] = data[i*4+2];
  }
  // Сильное размытие = «освещение» сцены
  const blurR = gaussBlur(rF, w, h, 80);
  const blurG = gaussBlur(gF, w, h, 80);
  const blurB = gaussBlur(bF, w, h, 80);

  // Средняя яркость для нормализации
  let avgL = 0;
  for (let i = 0; i < w * h; i++) avgL += luma(blurR[i], blurG[i], blurB[i]);
  avgL /= (w * h);

  const out = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const scale = avgL / Math.max(1, luma(blurR[i], blurG[i], blurB[i]));
    out.data[i*4]   = Math.max(0, Math.min(255, Math.round(rF[i] * scale)));
    out.data[i*4+1] = Math.max(0, Math.min(255, Math.round(gF[i] * scale)));
    out.data[i*4+2] = Math.max(0, Math.min(255, Math.round(bF[i] * scale)));
    out.data[i*4+3] = 255;
  }
  return out;
}

function makeNormal(src: ImageData, strength: number): ImageData {
  const { width: w, height: h, data } = src;
  const out = new ImageData(w, h);
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++)
    gray[i] = luma(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  // Сначала сглаживаем серый для нормалей (убираем шум)
  const smoothGray = gaussBlur(gray, w, h, 1.5);
  const g = (x: number, y: number) =>
    smoothGray[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))];
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
  // Roughness = инвертированный high-frequency luma (мелкие детали = шероховатость)
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++)
    gray[i] = luma(data[i*4], data[i*4+1], data[i*4+2]);
  const smooth = gaussBlur(gray, w, h, 3);
  // min/max для stretch
  let mn = 255, mx = 0;
  for (let i = 0; i < w * h; i++) {
    const hf = Math.abs(gray[i] - smooth[i]);
    if (hf < mn) mn = hf;
    if (hf > mx) mx = hf;
  }
  const range = Math.max(1, mx - mn);
  const out = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const hf = Math.abs(gray[i] - smooth[i]);
    const v = Math.round(((hf - mn) / range) * 255);
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
  const blurred = gaussBlur(gray, w, h, radius * 4);
  // AO = локальные впадины темнее среднего
  let mn = 255, mx = 0;
  for (let i = 0; i < w * h; i++) {
    const diff = Math.max(0, blurred[i] - gray[i]);
    if (diff < mn) mn = diff;
    if (diff > mx) mx = diff;
  }
  const range = Math.max(1, mx - mn);
  const out = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const diff = Math.max(0, blurred[i] - gray[i]);
    const v = 255 - Math.round(((diff - mn) / range) * 200);
    out.data[i*4] = out.data[i*4+1] = out.data[i*4+2] = Math.max(0, Math.min(255, v));
    out.data[i*4+3] = 255;
  }
  return out;
}

function makeGloss(src: ImageData): ImageData {
  // Gloss = нормализованный luma с контрастом
  const { width: w, height: h, data } = src;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++)
    gray[i] = luma(data[i*4], data[i*4+1], data[i*4+2]);
  // stretch contrast
  let mn = 255, mx = 0;
  for (let i = 0; i < w * h; i++) { if (gray[i] < mn) mn = gray[i]; if (gray[i] > mx) mx = gray[i]; }
  const range = Math.max(1, mx - mn);
  const out = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = Math.round(((gray[i] - mn) / range) * 255);
    out.data[i*4] = out.data[i*4+1] = out.data[i*4+2] = v;
    out.data[i*4+3] = 255;
  }
  return out;
}

// Seamless: сдвиг на 50% + blend краёв через cos-маску
function makeSeamless(src: ImageData): ImageData {
  const { width: w, height: h, data } = src;
  const out = new Uint8ClampedArray(w * h * 4);

  const get = (x: number, y: number, ch: number) => {
    const xi = ((x % w) + w) % w;
    const yi = ((y % h) + h) % h;
    return data[(yi * w + xi) * 4 + ch];
  };

  // Ширина зоны смешивания — 30% от размера
  const blendW = Math.round(w * 0.30);
  const blendH = Math.round(h * 0.30);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Оригинал и сдвинутая версия
      const sx = (x + w / 2) | 0;
      const sy = (y + h / 2) | 0;

      // Вес смешивания по X: края → shifted, центр → original
      let wx = 1.0;
      if (x < blendW) wx = 0.5 - 0.5 * Math.cos(Math.PI * x / blendW);
      else if (x > w - blendW) wx = 0.5 + 0.5 * Math.cos(Math.PI * (x - (w - blendW)) / blendW);

      let wy = 1.0;
      if (y < blendH) wy = 0.5 - 0.5 * Math.cos(Math.PI * y / blendH);
      else if (y > h - blendH) wy = 0.5 + 0.5 * Math.cos(Math.PI * (y - (h - blendH)) / blendH);

      const t = Math.min(wx, wy);
      const idx = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const orig = get(x, y, c);
        const shifted = get(sx, sy, c);
        out[idx + c] = Math.round(orig * t + shifted * (1 - t));
      }
      out[idx + 3] = 255;
    }
  }
  return new ImageData(out, w, h);
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
      const seamless = makeSeamless(makeBaseColor(img));
      setUrls({
        baseColor: toDataURL(seamless),
        normal:    toDataURL(makeNormal(seamless, ns)),
        roughness: toDataURL(makeRoughness(seamless)),
        ao:        toDataURL(makeAO(seamless, aor)),
        gloss:     toDataURL(makeGloss(seamless)),
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
          c.width = img.naturalWidth; c.height = img.naturalHeight;
          const ctx = c.getContext("2d")!;
          ctx.drawImage(img, 0, 0);
          const raw = ctx.getImageData(0, 0, img.naturalWidth, img.naturalHeight);
          srcRef.current = autoCropToSquare(raw);
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

  const downloadAll = () => {
    const keys = Object.keys(MAPS) as MapKey[];
    keys.forEach((key, i) => {
      const url = urls[key];
      if (!url) return;
      setTimeout(() => {
        const a = document.createElement("a");
        a.href = url; a.download = `pbr_${key}.png`; a.click();
      }, i * 300);
    });
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
            <button onClick={downloadAll} disabled={!ready} style={{
              width:"100%", marginTop:"6px", padding:"8px 0", textAlign:"center",
              background: "transparent",
              color: ready ? "rgba(198,40,40,0.8)" : "rgba(255,255,255,0.15)",
              border:`1px solid ${ready ? "rgba(198,40,40,0.35)" : "rgba(255,255,255,0.06)"}`,
              borderRadius:"3px", cursor: ready ? "pointer" : "default",
              fontSize:"9px", letterSpacing:"0.14em", fontFamily:"'IBM Plex Mono',monospace",
            }}>
              ↓ ВСЕ 5 КАРТ
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