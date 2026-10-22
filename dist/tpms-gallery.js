(() => {
  const $=id=>document.getElementById(id);
  const state={family:null,geometries:[],geometry:null,variant:null,page:0,vfOrder:"asc",shapeOrder:"desc",viewer:null,request:0,cards:[],shapeCards:[],catalog:null,allShapes:[],shapePage:0,shapeRenderEpoch:0,shapeIndexReady:false,showTopology:true,showMesh:true};
  const pct=x=>`${(x*100).toFixed(2)}%`;
  const metric=x=>formatValue(Number(x),4);
  async function query(action,params={}) {
    const response=await fetch(`/api/tpms-data?${new URLSearchParams({action,...params})}`,{cache:"no-store"});
    if(!response.ok)throw new Error(await response.text());return response.json();
  }
  async function mesh(id,canvas,resolution=72,color=null,zoom=1.5) {
    const response=await fetch(`/api/tpms-mesh?id=${id}&resolution=${resolution}&revision=2`);
    if(!response.ok)throw new Error(await response.text());
    return new window.ShellViewer(canvas,await response.text(),color?{color,zoom}:{zoom});
  }
  function drawCellFrame(yaw=-.7,pitch=.45,zoom=1.5){
    const canvas=$("tpms-frame-canvas"),rect=canvas.getBoundingClientRect(),ratio=Math.min(devicePixelRatio||1,1.5);
    const width=Math.max(1,Math.floor(rect.width*ratio)),height=Math.max(1,Math.floor(rect.height*ratio));
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
    const ctx=canvas.getContext("2d");ctx.clearRect(0,0,width,height);
    if(!state.showTopology)return;
    const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
    const points=[];
    for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1]){
      const qx=cy*x+sy*z,qz=-sy*x+cy*z,py=cp*y-sp*qz,pz=sp*y+cp*qz,w=3-pz;
      points.push([width/2+(qx*zoom/w)*(width/2),height/2-(py*zoom/w)*(height/2),pz]);
    }
    const edges=[];
    for(let i=0;i<8;i++)for(let j=i+1;j<8;j++){
      // Vertex index bits identify cube corners; adjacent corners differ by one bit.
      if(((i^j)&((i^j)-1))===0)edges.push([i,j,(points[i][2]+points[j][2])/2]);
    }
    ctx.lineWidth=Math.max(1,ratio*.85);ctx.lineCap="round";ctx.strokeStyle="rgba(76,199,255,.25)";
    for(const [i,j] of edges.sort((a,b)=>a[2]-b[2])){ctx.beginPath();ctx.moveTo(points[i][0],points[i][1]);ctx.lineTo(points[j][0],points[j][1]);ctx.stroke();}
  }
  function syncViewerControls(){
    const topology=$("tpms-topology-toggle"),meshToggle=$("tpms-mesh-toggle");
    topology.textContent=state.showTopology?"Hide topology":"Show topology";topology.setAttribute("aria-pressed",String(state.showTopology));topology.classList.toggle("is-active",state.showTopology);
    meshToggle.textContent=state.showMesh?"Hide mesh":"Show mesh";meshToggle.setAttribute("aria-pressed",String(state.showMesh));meshToggle.classList.toggle("is-active",state.showMesh);
    $("tpms-frame-canvas").style.visibility=state.showTopology?"visible":"hidden";
    $("tpms-mesh-canvas").style.visibility=state.showMesh?"visible":"hidden";
    if(!state.showMesh&&state.viewer){const gl=state.viewer.gl;gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);}
    $("tpms-legend-frame").hidden=!state.showTopology;$("tpms-legend-mesh").hidden=!state.showMesh;
    const mode=$("tpms-dialog").querySelector(".visual-mode-label");if(mode)mode.textContent=state.showMesh?(state.showTopology?"Mesh + topology":"Mesh only"):(state.showTopology?"Topology preview":"Topology hidden");
  }
  async function thumbnail(id) {
    // Small 24³ thumbnails alias away the bounded coordinate warps, making
    // different shape configurations look identical. Use a denser preview
    // mesh while keeping the full-resolution interactive viewer unchanged.
    const response=await fetch(`/api/tpms-mesh?id=${id}&resolution=32&revision=3`);
    if(!response.ok)throw new Error(await response.text());
    const vertices=[],faces=[];
    for(const line of (await response.text()).split(/\r?\n/)){
      if(line.startsWith("v "))vertices.push(line.trim().split(/\s+/).slice(1,4).map(Number));
      else if(line.startsWith("f ")){
        const indices=line.trim().split(/\s+/).slice(1).map(token=>Number(token.split("/")[0])-1);
        for(let i=1;i+1<indices.length;i++)faces.push([indices[0],indices[i],indices[i+1]]);
      }
    }
    if(!vertices.length||!faces.length)throw new Error("Mesh has no renderable surface");
    const center=[0,1,2].map(axis=>(Math.min(...vertices.map(p=>p[axis]))+Math.max(...vertices.map(p=>p[axis])))/2);
    const extent=Math.max(...[0,1,2].map(axis=>Math.max(...vertices.map(p=>p[axis]))-Math.min(...vertices.map(p=>p[axis]))),1e-6);
    const yaw=-.7,pitch=.48,cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
    const rotated=vertices.map(p=>{
      const x=(p[0]-center[0])/extent,y=(p[1]-center[1])/extent,z=(p[2]-center[2])/extent;
      const qx=cy*x+sy*z,qz=-sy*x+cy*z;
      return [qx,cp*y-sp*qz,sp*y+cp*qz];
    });
    const projected=rotated.map(([x,y,z])=>{const perspective=2.8/(2.8-z);return [x*perspective,-y*perspective,z];});
    const triangles=faces.map(face=>{
      const pts=face.map(index=>projected[index]);
      if(pts.some(p=>!p))return null;
      const [a,b,c]=face.map(index=>vertices[index]);
      const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
      const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,nl=Math.hypot(nx,ny,nz)||1;
      const light=Math.min(1,Math.max(.38,.48+.52*Math.abs((nx*.35+ny*.75+nz*.56)/nl)));
      return {pts,depth:(pts[0][2]+pts[1][2]+pts[2][2])/3,light};
    }).filter(Boolean).sort((a,b)=>a.depth-b.depth);
    const xs=projected.map(p=>p[0]),ys=projected.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
    const scale=Math.min(320/Math.max(maxX-minX,1e-6),190/Math.max(maxY-minY,1e-6));
    const path=triangles.map(({pts,light})=>{
      const points=pts.map(([x,y])=>`${(180+(x-(minX+maxX)/2)*scale).toFixed(1)},${(120+(y-(minY+maxY)/2)*scale).toFixed(1)}`).join(" ");
      const g=Math.round(112+112*light),b=Math.round(148+107*light);
      return `<polygon points="${points}" fill="rgb(28,${g},${b})" stroke="rgba(132,225,255,.16)" stroke-width=".32" stroke-linejoin="round"/>`;
    }).join("");
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 240"><defs><radialGradient id="bg"><stop stop-color="#173541"/><stop offset="1" stop-color="#091523"/></radialGradient></defs><rect width="360" height="240" fill="url(#bg)"/>${path}</svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }
  async function catalog() {
    state.shapeRenderEpoch++;state.shapeCards.forEach(v=>v.dispose());state.shapeCards=[];
    const data=await query("catalog");state.catalog=data;
    const shapeCount=data.families.reduce((sum,f)=>sum+f.geometries,0);
    $("tpms-stats").textContent=`${data.count.toLocaleString()} solved records · ${shapeCount.toLocaleString()} shapes · ${data.families.filter(f=>f.count).length} formula families`;
    state.shapeIndexReady=false;state.allShapes=[];
    // The gallery opens directly on all available shapes; formula families
    // remain a filter, not a nine-card landing page.
    await loadShapeIndex();
  }
  async function loadShapeIndex(){
    if(state.shapeIndexReady)return;
    const families=state.catalog.families.filter(f=>f.count);
    const groups=await Promise.all(families.map(async family=>{
      const data=await query("geometries",{family:family.id,order:state.shapeOrder});
      return data.rows.map(row=>({...row,family}));
    }));
    state.allShapes=groups.flat();state.shapeIndexReady=true;
    const filter=$("tpms-family-filter");filter.replaceChildren(new Option("All formula families",""));
    for(const family of families)filter.add(new Option(family.name,family.id));
    renderShapeIndex();
  }
  function renderShapeIndex(){
    const familyId=$("tpms-family-filter").value,needle=$("tpms-shape-search").value.trim().toLowerCase();
    const rows=state.allShapes.filter(row=>(!familyId||row.family.id===familyId)&&(!needle||`${row.family.name} ${row.family.id} G${String(row.index+1).padStart(4,"0")}`.toLowerCase().includes(needle)));
    const pageSize=24,pages=Math.max(1,Math.ceil(rows.length/pageSize));state.shapePage=Math.min(state.shapePage,pages-1);
    const start=state.shapePage*pageSize,end=Math.min(start+pageSize,rows.length),epoch=++state.shapeRenderEpoch;
    state.shapeCards.forEach(v=>v.dispose());state.shapeCards=[];$("tpms-shape-grid").replaceChildren();
    $("tpms-shape-count").textContent=`${rows.length.toLocaleString()} shapes · showing ${rows.length?start+1:0}–${end} of ${rows.length.toLocaleString()}`;
    $("tpms-shape-page").textContent=`Page ${state.shapePage+1} of ${pages}`;
    $("tpms-shape-prev").disabled=state.shapePage===0;$("tpms-shape-next").disabled=state.shapePage+1>=pages;
    const pageRows=rows.slice(start,end),previews=[];
    for(const row of pageRows){
      const card=document.createElement("article");card.className="topology-card tpms-shape-card";
      const button=document.createElement("button");button.type="button";button.className="topology-card-open";
      const wrap=document.createElement("div");wrap.className="topology-card-visual-wrap";
      const image=document.createElement("img");image.className="topology-card-image";image.alt=`${row.family.name} G${String(row.index+1).padStart(4,"0")} preview`;image.loading="lazy";wrap.append(image);
      const label=document.createElement("span");label.className="topology-card-open-label";label.textContent="Open VF variants ↗";wrap.append(label);
      const body=document.createElement("div");body.className="topology-card-body";
      const heading=document.createElement("div");heading.className="topology-card-title-row";
      const title=document.createElement("h3");title.textContent=`${row.family.name} · G${String(row.index+1).padStart(4,"0")}`;
      const count=document.createElement("span");count.className="topology-card-variant-pill";count.textContent=`${row.count} variants`;
      heading.append(title,count);
      const facts=document.createElement("div");facts.className="topology-card-facts";facts.textContent=`Perturbation ${row.magnitude.toFixed(4)} · VF ${pct(row.min_vf)}–${pct(row.max_vf)}`;
      body.append(heading,facts);button.append(wrap,body);card.append(button);
      button.addEventListener("click",()=>openFamily(row.family,row.index).catch(showError));$("tpms-shape-grid").append(card);
      previews.push({row,image,label});
    }
    let cursor=0;
    async function previewWorker(){while(cursor<previews.length){const item=previews[cursor++];try{const src=await thumbnail(item.row.representative_id);if(epoch===state.shapeRenderEpoch)item.image.src=src;}catch{item.label.textContent="Preview unavailable · open for details";}}}
    for(let worker=0;worker<Math.min(4,previews.length);worker++)previewWorker();
  }
  function showError(error){$("tpms-detail-status").textContent=error.message;}
  async function openFamily(family,shapeIndex=null) {
    ++state.request;state.viewer?.dispose();state.viewer=null;state.family=family;state.geometry=null;state.variant=null;state.page=0;
    state.showTopology=true;state.showMesh=true;syncViewerControls();
    $("tpms-dialog-title").textContent=family.name;$("tpms-dialog-count").textContent=`${family.count.toLocaleString()} variants`;
    $("tpms-dialog").showModal();$("tpms-detail-status").textContent="Loading shapes…";
    const data=await query("geometries",{family:family.id,order:state.shapeOrder});state.geometries=data.rows;
    renderGeometries();$("tpms-shape-list-count").textContent=`${data.total.toLocaleString()} shape configurations · ${family.count.toLocaleString()} total VF results`;
    if(data.rows.length)await selectGeometry(data.rows.find(row=>row.index===shapeIndex)||data.rows[0]);
  }
  function renderGeometries(){
    $("tpms-shape-sort").textContent=state.shapeOrder==="asc"?"Perturbation ↑":"Perturbation ↓";
    $("tpms-geometry-list").replaceChildren();
    for(const row of state.geometries){
      const b=document.createElement("button");b.type="button";b.className=`topology-variant-button${row.index===state.geometry?.index?" is-active":""}`;
      b.innerHTML=`<span>G${String(row.index+1).padStart(4,"0")}</span><small>perturbation ${row.magnitude.toFixed(4)} · ${row.count} variants</small>`;
      b.addEventListener("click",()=>selectGeometry(row).catch(showError));$("tpms-geometry-list").append(b);
    }
  }
  async function selectGeometry(row){state.geometry=row;state.page=0;renderGeometries();await renderVariants(true);}
  async function renderVariants(selectFirst=false){
    const data=await query("variants",{family:state.family.id,geometry:state.geometry.index,page:state.page,order:state.vfOrder});
    $("tpms-variant-list").replaceChildren();
    for(const row of data.rows){
      const b=document.createElement("button");b.type="button";b.className=`topology-variant-button${row.id===state.variant?" is-active":""}`;
      b.innerHTML=`<span>TPMS-${String(row.id).padStart(6,"0")}</span><small>VF ${pct(row.vf)} · E ${metric(row.young)}</small>`;
      b.addEventListener("click",()=>selectVariant(row.id).catch(showError));$("tpms-variant-list").append(b);
    }
    const foot=document.createElement("div");foot.className="shell-100k-list-footer";
    const text=document.createElement("span");text.textContent=`${Math.min(state.page*80+1,data.total)}–${Math.min((state.page+1)*80,data.total)} / ${data.total}`;
    const previous=document.createElement("button");previous.textContent="Previous";previous.disabled=state.page===0;previous.onclick=()=>{--state.page;renderVariants().catch(showError);};
    const next=document.createElement("button");next.textContent="Next";next.disabled=(state.page+1)*80>=data.total;next.onclick=()=>{++state.page;renderVariants().catch(showError);};
    foot.append(previous,text,next);$("tpms-variant-list").append(foot);
    if(selectFirst&&data.rows.length)await selectVariant(data.rows[0].id);
  }
  async function selectVariant(id){
    state.variant=id;const request=++state.request;state.viewer?.dispose();state.viewer=null;
    $("tpms-detail-status").textContent="Rebuilding analytic mesh from saved parameters…";
    const r=await query("record",{id});if(request!==state.request)return;
    $("tpms-selected").textContent=`${r.id} · VF ${pct(r.density)}`;
    $("tpms-facts").innerHTML=[["VF",pct(r.density)],["Field threshold",metric(r.threshold)],["Mean Young's modulus Ē",metric(r.young_mean)],["Mean diagonal conductivity",metric(r.K_mean)]]
      .map(([label,value])=>`<div><span>${label}</span><strong>${value}</strong></div>`).join("");
    const C=unpackUpper(r.C_H_upper,6),K=unpackUpper(r.K_H_upper,3);
    $("tpms-mechanical-bars").innerHTML=barsMarkup(C.map((row,i)=>row[i]),["C₁₁","C₂₂","C₃₃","C₄₄","C₅₅","C₆₆"]);
    $("tpms-mechanical-matrix").innerHTML=matrixMarkup(C,["xx","yy","zz","xy","yz","zx"]);
    $("tpms-thermal-bars").innerHTML=barsMarkup(K.map((row,i)=>row[i]),["Kₓₓ","Kᵧᵧ","Kzz"]);
    $("tpms-thermal-matrix").innerHTML=matrixMarkup(K,["x","y","z"]);
    $("tpms-quality").textContent=`Periodic components: ${r.quality.periodic_connected_components} · Spanning rank: ${r.quality.periodic_winding_rank}/3 · Six-face contact passed · max C residual ${r.quality.mechanical_residual.toExponential(2)} · max K residual ${r.quality.thermal_residual.toExponential(2)}. Material E₀=1, ν=0.3, k₀=1. Field bandwidth is not physical wall thickness.`;
    const response=await fetch(`/api/tpms-mesh?id=${id}&resolution=80&revision=2`);if(!response.ok)throw new Error(await response.text());
    const obj=await response.text();if(request!==state.request||!$("tpms-dialog").open)return;
    state.viewer=new window.ShellViewer($("tpms-mesh-canvas"),obj,{zoom:1.5,onRotate:(yaw,pitch,zoom)=>drawCellFrame(yaw,pitch,zoom)});
    $("tpms-mesh-canvas").style.visibility=state.showMesh?"visible":"hidden";
    $("tpms-frame-canvas").style.visibility=state.showTopology?"visible":"hidden";
    drawCellFrame(state.viewer.yaw,state.viewer.pitch,state.viewer.zoom);syncViewerControls();
    $("tpms-detail-status").textContent="Marching Cubes 80³ mesh · properties computed on 32³ · drag to rotate, scroll to zoom · no stored mesh";
  }
  async function refreshProgress(){
    try{
      const response=await fetch("/api/tpms-live",{cache:"no-store"});if(!response.ok)return;const r=await response.json();
      $("tpms-progress").value=r.accepted;$("tpms-progress-label").textContent=`${r.accepted.toLocaleString()} / ${r.goal.toLocaleString()} · ${r.phase.replaceAll("_"," ")} · ${Math.round(r.new_records_per_hour).toLocaleString()} new records/hour`;
      $("tpms-vf-bins").textContent=r.vf_bin_counts.map((n,i)=>`${5+3*i}–${8+3*i}%: ${n.toLocaleString()}`).join(" · ");
    }catch{/* Keep the last confirmed snapshot. */}
  }
  $("tpms-close").addEventListener("click",()=>$("tpms-dialog").close());
  $("tpms-dialog").addEventListener("close",()=>{++state.request;state.viewer?.dispose();state.viewer=null;});
  $("tpms-topology-toggle").onclick=()=>{state.showTopology=!state.showTopology;syncViewerControls();if(state.viewer)drawCellFrame(state.viewer.yaw,state.viewer.pitch,state.viewer.zoom);};
  $("tpms-mesh-toggle").onclick=()=>{state.showMesh=!state.showMesh;syncViewerControls();if(state.viewer&&state.showMesh)state.viewer.draw();};
  $("tpms-view-reset").onclick=()=>{if(!state.viewer)return;state.viewer.yaw=-.7;state.viewer.pitch=.45;state.viewer.zoom=1.5;state.viewer.draw();drawCellFrame(state.viewer.yaw,state.viewer.pitch,state.viewer.zoom);};
  $("tpms-shape-sort").onclick=()=>{state.shapeOrder=state.shapeOrder==="asc"?"desc":"asc";state.geometries.reverse();renderGeometries();$("tpms-shape-sort").textContent=state.shapeOrder==="asc"?"Perturbation ↑":"Perturbation ↓";};
  $("tpms-vf-sort").onclick=()=>{state.vfOrder=state.vfOrder==="asc"?"desc":"asc";state.page=0;$("tpms-vf-sort").textContent=state.vfOrder==="asc"?"VF ↑":"VF ↓";renderVariants().catch(showError);};
  $("tpms-shape-search").addEventListener("input",()=>{state.shapePage=0;renderShapeIndex();});
  $("tpms-family-filter").addEventListener("change",()=>{state.shapePage=0;renderShapeIndex();});
  $("tpms-shape-prev").onclick=()=>{if(state.shapePage>0){--state.shapePage;renderShapeIndex();}};
  $("tpms-shape-next").onclick=()=>{++state.shapePage;renderShapeIndex();};
  $("tpms-refresh").onclick=()=>{catalog().catch(e=>$("tpms-stats").textContent=e.message);refreshProgress();document.querySelectorAll("#tpms-property-charts img").forEach(img=>img.src=img.src.split("?")[0]+`?t=${Date.now()}`);};
  addEventListener("resize",()=>{state.viewer?.draw();if(state.viewer)drawCellFrame(state.viewer.yaw,state.viewer.pitch,state.viewer.zoom);});
  catalog().catch(e=>$("tpms-stats").textContent=e.message);refreshProgress();setInterval(refreshProgress,15000);
})();
