import { type MapKey, MAPS } from "@/lib/pbr-engine";

interface SidebarPanelProps {
  active: MapKey;
  setActive: (key: MapKey) => void;
  urls: Partial<Record<MapKey, string>>;
  ready: boolean;
  onDownload: () => void;
  onDownloadAll: () => void;
}

export default function SidebarPanel({ active, setActive, urls, ready, onDownload, onDownloadAll }: SidebarPanelProps) {
  return (
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
        <button onClick={onDownload} disabled={!ready} style={{
          width:"100%", padding:"8px 0", textAlign:"center",
          background: ready ? "#c62828" : "rgba(255,255,255,0.05)",
          color: ready ? "#fff" : "rgba(255,255,255,0.2)",
          border:`1px solid ${ready ? "#c62828" : "rgba(255,255,255,0.08)"}`,
          borderRadius:"3px", cursor: ready ? "pointer" : "default",
          fontSize:"9px", letterSpacing:"0.14em", fontFamily:"'IBM Plex Mono',monospace",
        }}>
          ↓ СКАЧАТЬ {MAPS[active]?.tag}
        </button>
        <button onClick={onDownloadAll} disabled={!ready} style={{
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
  );
}
