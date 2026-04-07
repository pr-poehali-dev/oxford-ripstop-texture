import { type MapKey, MAPS } from "@/lib/pbr-engine";

interface ThumbnailPanelProps {
  active: MapKey;
  setActive: (key: MapKey) => void;
  urls: Partial<Record<MapKey, string>>;
}

export default function ThumbnailPanel({ active, setActive, urls }: ThumbnailPanelProps) {
  return (
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
  );
}
