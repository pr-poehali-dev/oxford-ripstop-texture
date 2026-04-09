import { useState, useEffect, useRef } from "react";
import { type MapKey, MAPS, loadFlattenedTexture, buildAllMaps } from "@/lib/pbr-engine";
import SidebarPanel from "@/components/pbr/SidebarPanel";
import PreviewArea from "@/components/pbr/PreviewArea";
import ThumbnailPanel from "@/components/pbr/ThumbnailPanel";

export default function Index() {
  const [active, setActive]       = useState<MapKey>("baseColor");
  const [urls, setUrls]           = useState<Partial<Record<MapKey, string>>>({});
  const [status, setStatus]       = useState<"loading"|"processing"|"done"|"error">("loading");
  const [normalStr, setNormalStr] = useState(8);
  const [aoRadius, setAoRadius]   = useState(4);
  const [tiling, setTiling]       = useState(1);
  const [fabricColor, setFabricColor] = useState("#808080");
  const [variant, setVariant] = useState(2);
  const srcRef = useRef<ImageData | null>(null);

  const buildMaps = (img: ImageData, ns: number, aor: number, color: string) => {
    setStatus("processing");
    setTimeout(() => {
      setUrls(buildAllMaps(img, ns, aor, color));
      setStatus("done");
    }, 30);
  };

  const loadVariant = (v: number) => {
    setStatus("loading");
    loadFlattenedTexture(1024, v).then(img => {
      srcRef.current = img;
      buildMaps(img, normalStr, aoRadius, fabricColor);
    }).catch(() => setStatus("error"));
  };

  useEffect(() => { loadVariant(variant); }, []);

  const recompute = (ns: number, aor: number, color: string) => {
    if (srcRef.current) buildMaps(srcRef.current, ns, aor, color);
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
        <SidebarPanel
          active={active} setActive={setActive} urls={urls}
          ready={ready} onDownload={download} onDownloadAll={downloadAll}
        />
        <PreviewArea
          status={status} active={active} cur={cur}
          tiling={tiling} setTiling={setTiling}
          normalStr={normalStr} setNormalStr={setNormalStr}
          aoRadius={aoRadius} setAoRadius={setAoRadius}
          fabricColor={fabricColor} setFabricColor={setFabricColor}
          onRecompute={recompute}
          variant={variant}
          onVariantChange={(v) => { setVariant(v); loadVariant(v); }}
        />
        <ThumbnailPanel active={active} setActive={setActive} urls={urls} />
      </div>
    </div>
  );
}