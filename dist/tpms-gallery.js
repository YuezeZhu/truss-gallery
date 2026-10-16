(() => {
  const $=id=>document.getElementById(id);
  const state={family:null,geometries:[],geometry:null,variant:null,page:0,vfOrder:"asc",shapeOrder:"asc",viewer:null,request:0,cards:[],shapeCards:[],catalog:null,allShapes:[],shapePage:0,shapeRenderEpoch:0,shapeIndexReady:false};
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
  async function catalog() {
    state.shapeRenderEpoch++;state.shapeCards.forEach(v=>v.dispose());state.shapeCards=[];
    const data=await query("catalog");state.catalog=data;
    const shapeCount=data.families.reduce((sum,f)=>sum+f.geometries,0);
    $("tpms-stats").textContent=`${data.count.toLocaleString()} solved records · ${shapeCount.toLocaleString()} shapes · ${data.families.filter(f=>f.count).length} formula families`;
    state.cards.forEach(v=>v.dispose());state.cards=[];$("tpms-grid").replaceChildren();
    for(const family of data.families) {
      const card=document.createElement("article");card.className="topology-card";
      const button=document.createElement("button");button.type="button";button.className="topology-card-open";
      const wrap=document.createElement("div");wrap.className="topology-card-visual-wrap";
      const canvas=document.createElement("canvas");canvas.className="topology-card-image";canvas.setAttribute("aria-label",`${family.name} preview`);wrap.append(canvas);
      const label=document.createElement("span");label.className="topology-card-open-label";label.textContent=family.count?"Open variants ↗":"No passing samples yet";wrap.append(label);
      const body=document.createElement("div");body.className="topology-card-body";
      const heading=document.createElement("div");heading.className="topology-card-title-row";
      const title=document.createElement("h3");title.textContent=family.name;
      const count=document.createElement("span");count.className="topology-card-variant-pill";count.textContent=`${family.count.toLocaleString()} variants`;
      heading.append(title,count);const facts=document.createElement("div");facts.className="topology-card-facts";
      facts.textContent=`${family.geometries} shapes · ${family.mode==="sheet"?"Sheet band":"Solid phase"} · Periodic`;
      body.append(heading,facts);button.append(wrap,body);card.append(button);$("tpms-grid").append(card);
      button.disabled=!family.count;button.addEventListener("click",()=>openFamily(family).catch(showError));
      if(family.representative_id)mesh(family.representative_id,canvas,32,[.12,.65,.93]).then(v=>state.cards.push(v)).catch(()=>{label.textContent="Open to load mesh";});
    }
  }
  async function loadShapeIndex(){
    if(state.shapeIndexReady)return;
    const families=state.catalog.families.filter(f=>f.count);
    const groups=await Promise.all(families.map(async family=>{
      const data=await query("geometries",{family:family.id,order:"asc"});
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
    const pageSize=8,pages=Math.max(1,Math.ceil(rows.length/pageSize));state.shapePage=Math.min(state.shapePage,pages-1);
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
      const canvas=document.createElement("canvas");canvas.className="topology-card-image";canvas.setAttribute("aria-label",`${row.family.name} G${String(row.index+1).padStart(4,"0")} preview`);wrap.append(canvas);
      const label=document.createElement("span");label.className="topology-card-open-label";label.textContent="Open VF variants ↗";wrap.append(label);
      const body=document.createElement("div");body.className="topology-card-body";
      const heading=document.createElement("div");heading.className="topology-card-title-row";
      const title=document.createElement("h3");title.textContent=`${row.family.name} · G${String(row.index+1).padStart(4,"0")}`;
      const count=document.createElement("span");count.className="topology-card-variant-pill";count.textContent=`${row.count} variants`;
      heading.append(title,count);
      const facts=document.createElement("div");facts.className="topology-card-facts";facts.textContent=`Perturbation ${row.magnitude.toFixed(4)} · VF ${pct(row.min_vf)}–${pct(row.max_vf)}`;
      body.append(heading,facts);button.append(wrap,body);card.append(button);
      button.addEventListener("click",()=>openFamily(row.family,row.index).catch(showError));$("tpms-shape-grid").append(card);
      previews.push({row,canvas,label});
    }
    let cursor=0;
    async function previewWorker(){while(cursor<previews.length){const item=previews[cursor++];try{const v=await mesh(item.row.representative_id,item.canvas,32,[.12,.65,.93],.82);if(epoch===state.shapeRenderEpoch)state.shapeCards.push(v);else v.dispose();}catch{item.label.textContent="Preview unavailable · open for details";}}}
    for(let worker=0;worker<Math.min(4,previews.length);worker++)previewWorker();
  }
  function showError(error){$("tpms-detail-status").textContent=error.message;}
  async function openFamily(family,shapeIndex=null) {
    ++state.request;state.viewer?.dispose();state.viewer=null;state.family=family;state.geometry=null;state.variant=null;state.page=0;
    $("tpms-dialog-title").textContent=family.name;$("tpms-dialog-count").textContent=`${family.count.toLocaleString()} variants`;
    $("tpms-dialog").showModal();$("tpms-detail-status").textContent="Loading shapes…";
    const data=await query("geometries",{family:family.id,order:state.shapeOrder});state.geometries=data.rows;
    renderGeometries();$("tpms-shape-list-count").textContent=`${data.total.toLocaleString()} shape configurations · ${family.count.toLocaleString()} total VF results`;
    if(data.rows.length)await selectGeometry(data.rows.find(row=>row.index===shapeIndex)||data.rows[0]);
  }
  function renderGeometries(){
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
    state.viewer=new window.ShellViewer($("tpms-mesh-canvas"),obj,{zoom:1.5});
    $("tpms-detail-status").textContent="Analytic MC 80³ preview · properties computed on 32³ · drag to rotate, scroll to zoom · no stored mesh";
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
  $("tpms-shape-sort").onclick=()=>{state.shapeOrder=state.shapeOrder==="asc"?"desc":"asc";state.geometries.reverse();renderGeometries();$("tpms-shape-sort").textContent=state.shapeOrder==="asc"?"Perturbation ↑":"Perturbation ↓";};
  $("tpms-vf-sort").onclick=()=>{state.vfOrder=state.vfOrder==="asc"?"desc":"asc";state.page=0;$("tpms-vf-sort").textContent=state.vfOrder==="asc"?"VF ↑":"VF ↓";renderVariants().catch(showError);};
  $("tpms-browse-shapes").onclick=async()=>{
    const open=$("tpms-shape-browser").hidden;
    $("tpms-shape-browser").hidden=!open;$("tpms-grid").hidden=open;
    $("tpms-browse-shapes").textContent=open?"Show formula families":"Browse all shapes";
    if(open){state.cards.forEach(v=>v.dispose());state.cards=[];try{await loadShapeIndex();}catch(error){$("tpms-shape-count").textContent=error.message;}}
    else catalog().catch(error=>$("tpms-stats").textContent=error.message);
  };
  $("tpms-shape-search").addEventListener("input",()=>{state.shapePage=0;renderShapeIndex();});
  $("tpms-family-filter").addEventListener("change",()=>{state.shapePage=0;renderShapeIndex();});
  $("tpms-shape-prev").onclick=()=>{if(state.shapePage>0){--state.shapePage;renderShapeIndex();}};
  $("tpms-shape-next").onclick=()=>{++state.shapePage;renderShapeIndex();};
  $("tpms-refresh").onclick=()=>{catalog().catch(e=>$("tpms-stats").textContent=e.message);refreshProgress();document.querySelectorAll("#tpms-property-charts img").forEach(img=>img.src=img.src.split("?")[0]+`?t=${Date.now()}`);};
  addEventListener("resize",()=>{state.cards.forEach(v=>v.draw());state.viewer?.draw();});
  catalog().catch(e=>$("tpms-stats").textContent=e.message);refreshProgress();setInterval(refreshProgress,15000);
})();
