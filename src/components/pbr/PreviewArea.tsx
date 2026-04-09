import { type MapKey, MAPS } from "@/lib/pbr-engine";

interface PreviewAreaProps {
  status: "loading" | "processing" | "done" | "error";
  active: MapKey;
  cur: string | undefined;
  tiling: number;
  setTiling: (n: number) => void;
  normalStr: number;
  setNormalStr: (v: number) => void;
  aoRadius: number;
  setAoRadius: (v: number) => void;
  fabricColor: string;
  setFabricColor: (c: string) => void;
  onRecompute: (ns: number, aor: number, color: string) => void;
  variant: number;
  onVariantChange: (v: number) => void;
}

const COLOR_PRESETS = ["#808080","#c62828","#1565c0","#2e7d32","#f9a825","#4a148c","#bf360c","#00695c","#1a1a1a","#e0e0e0"];

const VARIANT_LABELS = ["#1 Мелкий", "#2 Крупный hex", "#3 Basketweave", "#4 Bold hex"];

export default function PreviewArea({
  status, active, cur, tiling, setTiling,
  normalStr, setNormalStr, aoRadius, setAoRadius,
  fabricColor, setFabricColor, onRecompute,
  variant, onVariantChange,
}: PreviewAreaProps) {
  const ready = status === "done";

  return (
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
              <span style={{ fontSize:"10px", color:"rgba(255,255,255,0.25)" }}>1024×1024 · TILE {tiling}×{tiling}</span>
            </div>
            <div style={{ marginTop:"3px", fontSize:"11px", color:"rgba(255,255,255,0.28)", fontFamily:"'Rajdhani',sans-serif" }}>
              {MAPS[active].label} — {MAPS[active].hint}
            </div>
          </div>
        )}
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>

      <div style={{ flexShrink:0, display:"flex", borderTop:"1px solid rgba(255,255,255,0.07)", background:"#0d0d0d", minHeight:"100px" }}>
        <div style={{ flex:1, padding:"14px 18px", borderRight:"1px solid rgba(255,255,255,0.06)" }}>
          <label style={{ display:"block", fontSize:"9px", letterSpacing:"0.18em", color:"rgba(198,40,40,0.65)", marginBottom:"8px" }}>
            NORMAL STRENGTH — {normalStr}
          </label>
          <input type="range" min={1} max={20} value={normalStr} style={{ width:"100%", accentColor:"#c62828" }}
            onChange={e => { const v=Number(e.target.value); setNormalStr(v); onRecompute(v, aoRadius, fabricColor); }} />
          <div style={{ display:"flex", justifyContent:"space-between", marginTop:"4px", fontSize:"8px", color:"rgba(255,255,255,0.18)" }}>
            <span>СЛАБО</span><span>СИЛЬНО</span>
          </div>
        </div>
        <div style={{ flex:1, padding:"14px 18px", borderRight:"1px solid rgba(255,255,255,0.06)" }}>
          <label style={{ display:"block", fontSize:"9px", letterSpacing:"0.18em", color:"rgba(198,40,40,0.65)", marginBottom:"8px" }}>
            AO RADIUS — {aoRadius}px
          </label>
          <input type="range" min={1} max={12} value={aoRadius} style={{ width:"100%", accentColor:"#c62828" }}
            onChange={e => { const v=Number(e.target.value); setAoRadius(v); onRecompute(normalStr, v, fabricColor); }} />
          <div style={{ display:"flex", justifyContent:"space-between", marginTop:"4px", fontSize:"8px", color:"rgba(255,255,255,0.18)" }}>
            <span>МАЛО</span><span>ГЛУБОКО</span>
          </div>
        </div>
        <div style={{ flex:1, padding:"14px 18px", borderRight:"1px solid rgba(255,255,255,0.06)" }}>
          <label style={{ display:"block", fontSize:"9px", letterSpacing:"0.18em", color:"rgba(198,40,40,0.65)", marginBottom:"8px" }}>
            ЦВЕТ ТКАНИ
          </label>
          <div style={{ display:"flex", gap:"6px", flexWrap:"wrap" }}>
            {COLOR_PRESETS.map(c => (
              <button key={c} onClick={() => { setFabricColor(c); onRecompute(normalStr, aoRadius, c); }} style={{
                width:"24px", height:"24px", borderRadius:"3px", border: fabricColor===c ? "2px solid #fff" : "1px solid rgba(255,255,255,0.15)",
                background: c, cursor:"pointer", boxShadow: fabricColor===c ? "0 0 8px rgba(255,255,255,0.3)" : "none",
              }} />
            ))}
            <label style={{ width:"24px", height:"24px", borderRadius:"3px", border:"1px dashed rgba(255,255,255,0.25)", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", position:"relative", overflow:"hidden" }}>
              <span style={{ fontSize:"12px", color:"rgba(255,255,255,0.4)" }}>+</span>
              <input type="color" value={fabricColor} onChange={e => { setFabricColor(e.target.value); onRecompute(normalStr, aoRadius, e.target.value); }}
                style={{ position:"absolute", opacity:0, width:"100%", height:"100%", cursor:"pointer" }} />
            </label>
          </div>
        </div>
        <div style={{ flex:1, padding:"14px 18px", borderRight:"1px solid rgba(255,255,255,0.06)" }}>
          <label style={{ display:"block", fontSize:"9px", letterSpacing:"0.18em", color:"rgba(198,40,40,0.65)", marginBottom:"8px" }}>
            ВАРИАНТ ТЕКСТУРЫ
          </label>
          <div style={{ display:"flex", gap:"4px", flexWrap:"wrap" }}>
            {[1,2,3,4].map(v => (
              <button key={v} onClick={() => { onVariantChange(v); }} style={{
                padding:"4px 8px",
                background: variant===v ? "#c62828" : "rgba(255,255,255,0.05)",
                color: variant===v ? "#fff" : "rgba(255,255,255,0.35)",
                border:`1px solid ${variant===v ? "#c62828" : "rgba(255,255,255,0.08)"}`,
                borderRadius:"3px", cursor:"pointer",
                fontFamily:"'IBM Plex Mono',monospace", fontSize:"9px",
              }}>{VARIANT_LABELS[v-1]}</button>
            ))}
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
  );
}