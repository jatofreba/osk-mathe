// Shared JS engine for all lerntheken
// Constants (KEY, META, CONTENT, etc.) are defined inline in each HTML file


// ── Pokal-System ──────────────────────────────────────────────────────────────
function trophyCount(done, req, total) {
  if (done < req || total <= 0) return 0;
  const extra = total - req;
  if (extra === 0) return 1;
  const t2 = req + Math.ceil(extra / 3);
  if (done >= total) return 3;
  if (done >= t2)    return 2;
  return 1;
}
function trophyHtml(count) {
  const cls = ['locked','bronze','silver','gold'];
  return '<div class="trophy-bar">' +
    [1,2,3].map(i => '<span class="trophy-icon ' + (count>=i ? cls[i] : 'locked') + '">🏆</span>').join('') +
  '</div>';
}

// ── Input Enhancements (Unit-Suffix + Floating Labels) ───────────────────────
function enhanceInputs() {
  // 1. Table inputs: hide black thead, add unit suffix from header text
  document.querySelectorAll('#st-body table').forEach(table => {
    const thead = table.querySelector('thead');
    const ths = thead ? Array.from(thead.querySelectorAll('th')) : [];
    const headers = ths.map(th => th.textContent.trim());
    if (!headers.length) return;

    // Hide the dark header row (unit info moved into inputs)
    if (thead) thead.style.visibility = 'hidden'; // keep space to avoid layout jump

    table.querySelectorAll('tbody tr').forEach(row => {
      Array.from(row.querySelectorAll('td')).forEach((cell, colIdx) => {
        const input = cell.querySelector('.cell-input');
        if (!input || cell.querySelector('.cell-unit-wrap')) return;
        const unit = headers[colIdx] || '';
        if (!unit) return;

        // Wrap input + add unit badge
        const wrap = document.createElement('div');
        wrap.className = 'cell-unit-wrap';
        cell.insertBefore(wrap, input);
        wrap.appendChild(input);
        const badge = document.createElement('span');
        badge.className = 'cell-unit-badge';
        badge.textContent = unit;
        wrap.appendChild(badge);
      });
    });
  });

  // 2. Standalone inputs (not in tables): add floating label from placeholder
  document.querySelectorAll('#st-body .cell-input').forEach(input => {
    if (input.closest('table') || input.closest('.input-md3') || input.closest('.cell-unit-wrap')) return;
    const label = input.placeholder || input.dataset.label;
    if (!label || label === '?') return;
    const wrap = document.createElement('div');
    wrap.className = 'input-md3';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    const lbl = document.createElement('span');
    lbl.className = 'md3-label';
    lbl.textContent = label;
    wrap.appendChild(lbl);
    input.placeholder = ' '; // keep placeholder for :not(:placeholder-shown) to work
  });
}

// ── Generic station check/reset (used by stations with cell-inputs) ──────────
function checkStation(stId) {
  saveInputs();
  const inputs = document.querySelectorAll('#st-body .cell-input');
  let correct=0, total=0, empty=0;
  inputs.forEach(inp => {
    total++;
    const ans = parseFloat(inp.dataset.ans);
    const val = parseVal(inp.value);
    inp.classList.remove('input-ok','input-err','input-empty');
    if (!inp.value.trim()) { inp.classList.add('input-empty'); empty++; }
    else if (approxEq(val, ans)) { inp.classList.add('input-ok'); correct++; }
    else { inp.classList.add('input-err'); }
  });
  const pct = Math.round(correct/total*100);
  const passed = pct >= 75 && empty === 0;
  const res = document.getElementById('check-result-'+stId);
  if (res) {
    if (empty > 0) { res.innerHTML='⚠️ Noch <strong>'+empty+'</strong> Feld'+(empty===1?'':'er')+' leer.'; res.className='check-result warn'; }
    else if (pct===100) { res.innerHTML='🎉 <strong>100% richtig!</strong> Perfekt!'; res.className='check-result success'; }
    else if (passed) { res.innerHTML='✓ <strong>'+pct+'%</strong> richtig – Lösung freigeschaltet!'; res.className='check-result success'; }
    else { res.innerHTML='<strong>'+pct+'%</strong> ('+correct+'/'+total+') – mind. 75% zum Freischalten.'; res.className='check-result error'; }
  }
  const solWrap = document.querySelector('.sol-wrap');
  const solLock = document.getElementById('sol-lock-'+stId);
  if (passed) {
    if (solWrap) solWrap.style.display = '';
    if (solLock) solLock.style.display = 'none';
    if (!done.has(cur)) { done.add(cur); save(); updProg(); buildOverview(); }
  } else {
    if (solWrap) solWrap.style.display = 'none';
    if (solLock) solLock.style.display = 'flex';
  }
}
function resetStation(stId) {
  document.querySelectorAll('#st-body .cell-input').forEach(inp => {
    inp.value = ''; inp.classList.remove('input-ok','input-err','input-empty');
  });
  const res = document.getElementById('check-result-'+stId);
  if (res) { res.textContent = ''; res.className = 'check-result'; }
}
function abgebenStation(stId, taId) {
  const ta = document.getElementById(taId);
  const res = document.getElementById('check-result-'+stId);
  if (!ta || !ta.value.trim()) {
    if (res) { res.innerHTML='⚠️ Bitte etwas eintragen.'; res.className='check-result warn'; }
    return;
  }
  if (res) { res.innerHTML='✓ <strong>Abgegeben!</strong>'; res.className='check-result success'; }
  if (!done.has(cur)) { done.add(cur); save(); updProg(); buildOverview(); }
}

function save(){
  const val=JSON.stringify([...done]);
  localStorage.setItem(KEY,val);
  // Only sync to server after initial load is done (prevent overwriting with empty state)
  if(serverSyncDone){
    window.parent.postMessage({type:'SAVE_PROGRESS',key:KEY,value:val},'*');
  }
}

window.addEventListener('message', e => {
  if (!e.data) return;
  if (e.data.type === 'RELOAD_KORREKTUR') {
    korrekturState = e.data.data || {};
    buildOverview();
    return;
  }
  if (e.data.type !== 'RELOAD_PROGRESS') return;
  const stored = localStorage.getItem(KEY);
  if (stored) { try { done = new Set(JSON.parse(stored)); } catch {} }
  const storedAbgabe = localStorage.getItem(ABGABE_KEY);
  if (storedAbgabe) { try { abgabeState = JSON.parse(storedAbgabe); } catch {} }
  serverSyncDone = true;
  if (done.size > 0) save();
  // Sync abgabe back to server (ensures server always has the latest)
  if (abgabeState && Object.keys(abgabeState).some(k => abgabeState[k])) {
    const enc = JSON.stringify(abgabeState);
    localStorage.setItem(ABGABE_KEY, enc);
    window.parent.postMessage({type:'SAVE_PROGRESS', key:ABGABE_KEY, value:enc}, '*');
  }
  // Load korrektur then build overview (ensures both abgabe + korrektur are ready)
  loadKorrektur().then(() => { updProg(); buildOverview(); });
});

function groupStats(){
  const stats={};
  GROUP_ORDER.forEach(g=>{
    const all=META.filter(s=>s.group===g);
    const doneCount=all.filter(s=>done.has(s.id)).length;
    const req=GROUPS[g].required;
    const stationsOk=doneCount>=req;
    const needsAbgabe=g!=='Pflicht';
    const abgabeOk=needsAbgabe?abgabeChecked(g):true;
    const korOk=needsAbgabe?((korrekturState[g]&&korrekturState[g].status)==='bestanden'):true;
    stats[g]={done:doneCount,total:all.length,req,complete:stationsOk&&abgabeOk&&korOk,stationsOk,abgabeOk,korOk};
  });
  return stats;
}

function updProg(){
  const stats=groupStats();
  let steps=0,total=0;
  GROUP_ORDER.forEach(g=>{
    const st=stats[g];
    steps+=Math.min(st.done,st.req); total+=st.req;
    if(g!=='Pflicht'){
      if(st.abgabeOk)steps++;total++;
      if(st.korOk&&st.abgabeOk)steps++;total++;
    }
  });
  const pct=total?Math.round(steps/total*100):0;
  document.getElementById('prog-lbl').textContent=pct+' %';
  document.getElementById('prog-fill').style.width=pct+'%';
}

function showView(id){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo({top:0,behavior:'smooth'});
}

function buildReqCards(stats){}


function buildGrid(stats){
  const gridEl=document.getElementById('grid');
  if(!gridEl)return;
  const groups=GROUP_ORDER.filter(g=>GROUPS[g]&&stats[g]&&stats[g].total>0);
  if(!groups.length){gridEl.innerHTML='';return;}

  gridEl.innerHTML=groups.map(g=>{
    const all=META.filter(s=>s&&s.group===g);
    const st=stats[g];
    const gInfo=GROUPS[g];

    // Sort: erledigt first, then unbearbeitet
    const sorted=[...all].sort((a,b)=>{
      const aD=done.has(a.id)?0:1;
      const bD=done.has(b.id)?0:1;
      return aD-bD;
    });

    const cards=sorted.map(s=>{
      if(!CONTENT[s.id])return'';
      const isDone=done.has(s.id);
      const state=isDone?'state-erledigt':'state-unbearbeitet';
      return `<div class="station-card ${state}" onclick="showSt(${s.id})">
        ${isDone?'<span class="station-card-badge">✓</span>':''}
        <div class="station-card-title">${s.title}</div>
      </div>`;
    }).join('');

    // Group status text
    const statusText=st.stationsOk
      ? (st.complete?'Abgeschlossen':'Aufgabe abgeben')
      : `${st.done} von ${st.req} erledigt`;

    // Abgabe row
    const needsAbgabe=g!=='Pflicht';
    const abgabeRow=needsAbgabe?`<div class="group-abgabe">
      ${(()=>{
        const k=korrekturState[g];
        if(k&&k.status==='bestanden') return '<span class="korrektur-badge bestanden">✓ Bestanden</span>';
        if(k&&k.status==='nicht_bestanden') return `
          <span class="korrektur-badge nicht_bestanden">✗ Nicht bestanden</span>
          <label style="display:flex;align-items:center;gap:8px;margin-top:8px;cursor:pointer;">
            <input type="checkbox" class="abgabe-cb" id="grp-abgabe-${g}"
              ${abgabeChecked(g)?'checked':''}
              onchange="toggleAbgabe('${g}',this.checked)">
            <span class="abgabe-label">Erneut zur Korrektur abgeben</span>
          </label>`;
        return `
          <input type="checkbox" class="abgabe-cb" id="grp-abgabe-${g}"
            ${abgabeChecked(g)?'checked':''}
            onchange="toggleAbgabe('${g}',this.checked)">
          <label for="grp-abgabe-${g}" class="abgabe-label">Aufgabe zur Korrektur abgegeben</label>
          ${abgabeChecked(g)?'<span class="korrektur-badge ausstehend">⏳ Wartet auf Korrektur</span>':''}`;
      })()}
    </div>`:'';

    return `<div class="group-section">
      <div class="group-heading">
        <h2 class="group-title">${g}</h2>
        <div class="group-progress">
          <div class="progress-dots">
            ${Array.from({length:st.req},(_,i)=>`<span class="progress-dot ${i<Math.min(st.done,st.req)?'filled':''}"></span>`).join('')}
          </div>
          <span class="progress-label">${st.done>=st.req?(st.complete?'✓ Abgeschlossen':'Aufgabe abgeben'):`${Math.min(st.done,st.req)} / ${st.req}`}</span>
          ${trophyHtml(trophyCount(st.done, st.req, st.total))}
        </div>
      </div>
      <div class="stations-grid">${cards}</div>
      ${abgabeRow}
    </div>`;
  }).join('');
}

function buildReqCards(stats){
  // req-grid is hidden – progress shown inline in group headings
}

let _activeGroup='all';
function setGroupFilter(g){_activeGroup=g;buildGrid(groupStats());}
function buildOverview(){
  const stats=groupStats();
  buildReqCards(stats);
  // LZK status bar – always visible, shows progress toward next milestone
  const lzkEl=document.getElementById('lzk-status');
  if(lzkEl){
    const pflichtOk=stats['Pflicht']&&stats['Pflicht'].stationsOk;
    const basisOk=stats['Basis']&&stats['Basis'].stationsOk;
    const aufbauOk=stats['Aufbau']&&stats['Aufbau'].stationsOk;
    const bDone=stats['Basis']?stats['Basis'].done:0;
    const bReq=stats['Basis']?stats['Basis'].req:4;
    const aDone=stats['Aufbau']?stats['Aufbau'].done:0;
    const aReq=stats['Aufbau']?stats['Aufbau'].req:4;
    if(aufbauOk&&pflichtOk){
      lzkEl.className='lzk-status aufbau';
      const basisHint=basisOk?'':' · Basis: '+bDone+'/'+bReq;
      lzkEl.innerHTML='<span class="lzk-status-icon">🚀</span><div class="lzk-status-text"><strong>Bereit für die Aufbau-LZK!</strong>Pflicht ✓ · Aufbau-Stationen erledigt'+basisHint+'.</div>';
    } else if(basisOk&&pflichtOk){
      lzkEl.className='lzk-status basis';
      lzkEl.innerHTML='<span class="lzk-status-icon">✅</span><div class="lzk-status-text"><strong>Bereit für die Basis-LZK!</strong>Weiter mit Aufbau für die Aufbau-LZK ('+aDone+'/'+aReq+' Aufbau-Stationen).</div>';
    } else {
      lzkEl.className='lzk-status neutral';
      lzkEl.innerHTML='<span class="lzk-status-icon">🎯</span><div class="lzk-status-text"><strong>Nächstes Ziel: Basis-LZK</strong>Pflicht + mind. '+bReq+' Basis-Stationen – bisher: '+bDone+'/'+bReq+' Basis.</div>';
    }
  }
  buildGrid(stats);
  updProg();
}

function showSt(id){
  saveInputs();
  cur=id;
  const m=META[id],c=CONTENT[id];
  const badge=document.getElementById('st-badge');
  badge.textContent=''; badge.style.display='none';
  // Group chip
  const gc2 = document.getElementById('st-group-chip');
  if(gc2){
    const gName2=m.group; const gSts=META.filter(s=>s.group===gName2);
    const gD=gSts.filter(s=>done.has(s.id)).length; const gR=GROUPS[gName2].required;
    const gOk=gD>=gR;
    gc2.textContent=(gOk?'✓ ':'')+gName2+(gOk?' vollständig':': '+gD+'/'+gR);
    gc2.style.cssText='font-family:DM Mono,monospace;font-size:11px;padding:4px 12px;border-radius:99px;font-weight:600;background:'+m.gbg+';color:'+m.gc+';border:1.5px solid '+m.gbr+';';
  }
  badge.style.background=m.gc;
  document.getElementById('st-title').textContent=m.title;
  const isDone=done.has(id);
  // Show group completion status in st-top
  const gName=m.group;
  const gStations=META.filter(s=>s.group===gName);
  const gDone=gStations.filter(s=>done.has(s.id)).length;
  const gReq=GROUPS[gName].required;
  const gComplete=gDone>=gReq;
  let groupStatusEl=document.getElementById('st-group-status');
  if(!groupStatusEl){
    const stTop=document.getElementById('st-top-bar');
    if(stTop){
      groupStatusEl=document.createElement('span');
      groupStatusEl.id='st-group-status';
      groupStatusEl.style.cssText='font-family:DM Mono,monospace;font-size:11px;padding:4px 10px;border-radius:99px;font-weight:600;';
      stTop.appendChild(groupStatusEl);
    }
  }
  const db=document.getElementById('btn-done');
  db.className='btn-done'+(isDone?' active':'');
  db.textContent=isDone?'✓ Erledigt':'Als erledigt markieren';
  const isCheckStation = (id === 0 || id === 1 || id === 2 || id === 3 || id === 4 || id === 5 || id === 8 || id === 9 || id === 10 || id === 11 || id === 13 || id === 14 || id === 15 || id === 16); // Stations with check-gate
  // Hide manual done-button for check stations
  document.getElementById('btn-done').style.display = isCheckStation ? 'none' : '';
  let body=`<div class="panel"><div class="panel-lbl">Aufgabe</div>${c.task_html}</div>`;
  if(c.sol_html){
    if(isCheckStation){
      // If already done: show solution immediately, hide lock
      const lockDisplay  = isDone ? 'display:none' : '';
      const wrapDisplay  = isDone ? ''             : 'display:none';
      body+=`<div class="sol-lock" id='${id===0?'sol-lock-einheiten-l':id===1?'sol-lock-einheiten-f':id===2?'sol-lock-einheiten-v':id===3?'sol-lock-fa':id===4?'sol-lock-pizza':id===5?'sol-lock-ring':id===6?'sol-lock-reifen':id===7?'sol-lock-sportplatz':id===12?'sol-lock-minipizza':id===8?'sol-lock-kreisaus':id===9?'sol-lock-flugzeug':id===10?'sol-lock-sonnensystem':id===11?'sol-lock-geraet':id===13?'sol-lock-frisbee':id===15?'sol-lock-tunnel':id===16?'sol-lock-london':'sol-lock-rep'}' style="${lockDisplay}">🔒 Lösung wird nach 75% richtiger Antworten freigeschaltet.</div>`;
      body+=`<div class="sol-wrap" style="${wrapDisplay}"><button class="btn-reveal" onclick="toggleSol(this)">🔍 Lösung anzeigen</button><div class="panel sol-panel"><div class="panel-lbl">Lösung</div>${c.sol_html}</div></div>`;
    } else {
      body+=`<div class="sol-wrap"><button class="btn-reveal" onclick="toggleSol(this)">🔍 Lösung anzeigen</button><div class="panel sol-panel"><div class="panel-lbl">Lösung</div>${c.sol_html}</div></div>`;
    }
  }
  document.getElementById('st-body').innerHTML=body;
  const strip=document.getElementById('hilfe-strip');
  if(m.hilfen.length){
    document.getElementById('hilfe-btns').innerHTML=m.hilfen.map(h=>{
      const hd=HILFEN[h-1];
      return `<button class="btn-hilfe" onclick="showH(${h-1})">💡 Hilfe: ${hd.title}</button>`;
    }).join('');
    strip.style.display='block';
  }else{strip.style.display='none';}
  showView('view-st');
  setTimeout(()=>{
    loadInputs(id);
    enhanceInputs();
    document.querySelectorAll('#st-body textarea, #st-body .cell-input').forEach(el => {
      el.addEventListener('input', saveInputs);
    });
    window.scrollTo({top:0,behavior:'instant'});
  },50);
}

function toggleSol(btn){
  const p=btn.nextElementSibling;
  const open=p.classList.toggle('open');
  btn.textContent=open?'🙈 Lösung ausblenden':'🔍 Lösung anzeigen';
}

function toggleDone(){
  if(done.has(cur))done.delete(cur);else done.add(cur);
  save();updProg();
  const isDone=done.has(cur);
  const db=document.getElementById('btn-done');
  db.className='btn-done'+(isDone?' active':'');
  db.textContent=isDone?'✓ Erledigt':'Als erledigt markieren';
  const m2=META[cur]; const gc3=document.getElementById('st-group-chip');
  if(gc3&&m2){
    const gSts2=META.filter(s=>s.group===m2.group);
    const gD2=gSts2.filter(s=>done.has(s.id)).length; const gR2=GROUPS[m2.group].required;
    const gOk2=gD2>=gR2;
    gc3.textContent=(gOk2?'✓ ':'')+m2.group+(gOk2?' vollständig':': '+gD2+'/'+gR2);
  }
  buildOverview();showView('view-st');
}

function showH(idx){
  const h=HILFEN[idx];
  if(!h)return;
  const badge=document.getElementById('hv-badge');
  if(badge)badge.textContent='Hilfe';
  document.getElementById('hv-title').textContent=h.title;
  document.getElementById('btn-back-h').onclick=()=>showSt(cur);
  document.getElementById('hilfe-card').innerHTML=h.html;
  showView('view-h');
}


function parseVal(str) {
  if (!str) return NaN;
  let s = str.trim().replace(/,/g, '.').replace(/\s+/g, '').replace(/[a-zA-Zäöü²³]+$/, '');
  return parseFloat(s);
}
function approxEq(a, b) {
  if (isNaN(a) || isNaN(b)) return false;
  if (a === 0 && b === 0) return true;
  const rel = Math.abs(a - b) / Math.max(Math.abs(b), 1e-15); return rel < 0.03;
}
function checkEinheiten() {
  saveInputs();
  const inputs = document.querySelectorAll('#st-body .cell-input');
  let correct=0, total=0, wrong=0, empty=0;
  inputs.forEach(inp => {
    total++;
    const ans = parseFloat(inp.dataset.ans);
    const val = parseVal(inp.value);
    inp.classList.remove('input-ok','input-err','input-empty');
    if (inp.value.trim()==='') { inp.classList.add('input-empty'); empty++; }
    else if (approxEq(val, ans)) { inp.classList.add('input-ok'); correct++; }
    else { inp.classList.add('input-err'); wrong++; }
  });
  const pct = Math.round(correct / total * 100);
  const passed = pct >= 75 && empty === 0;
  const res = document.getElementById('check-result-einheiten');
  if (empty > 0) {
    res.innerHTML = '⚠️ Noch <strong>' + empty + '</strong> Feld' + (empty===1?'':'er') + ' leer.';
    res.className = 'check-result warn';
  } else if (pct === 100) {
    res.innerHTML = '🎉 <strong>100 % richtig!</strong> Perfekt!';
    res.className = 'check-result success';
  } else if (passed) {
    res.innerHTML = '✓ <strong>' + pct + ' %</strong> richtig – Lösung freigeschaltet!';
    res.className = 'check-result success';
  } else {
    res.innerHTML = '<strong>' + pct + ' %</strong> richtig (' + correct + '/' + total + ') – mind. 75 % zum Freischalten.';
    res.className = 'check-result error';
  }
  const solWrap = document.querySelector('.sol-wrap');
  const solLock = document.getElementById('sol-lock-einheiten');
  if (passed) {
    if (solWrap) solWrap.style.display = '';
    if (solLock) solLock.style.display = 'none';
    if (!done.has(cur)) { done.add(cur); save(); updProg(); buildOverview(); }
  } else {
    if (solWrap) solWrap.style.display = 'none';
    if (solLock) solLock.style.display = 'flex';
  }
}
function resetEinheiten() {
  document.querySelectorAll('.cell-input').forEach(inp => {
    inp.value = '';
    inp.classList.remove('input-ok','input-err','input-empty');
  });
  const res = document.getElementById('check-result-einheiten');
  if (res) { res.textContent=''; res.className='check-result'; }
}

function checkRep() {
  const inputs = [...document.querySelectorAll('.rep-inputs .cell-input'), 
                  ...document.querySelectorAll('.rep-inputs .cell-textarea')];
  let correct=0, total=0, open_count=0, empty=0;
  inputs.forEach(inp => {
    const ans = inp.dataset.ans;
    const val = inp.value.trim();
    inp.classList.remove('input-ok','input-err','input-empty','input-open');
    if (ans === 'rep-open') {
      // Open text question - just check not empty
      total++;
      if (!val) { inp.classList.add('input-empty'); empty++; }
      else { inp.classList.add('input-open'); correct++; open_count++; }
    } else if (ans === 'rep-text') {
      // Text answer - check against alternatives in data-check
      total++;
      const checks = (inp.dataset.check || '').split(';').map(s => s.trim().toLowerCase());
      const valNorm = val.toLowerCase().replace(/\s+/g,'').replace(/·/g,'*');
      const match = checks.some(c => {
        const cNorm = c.replace(/\s+/g,'').replace(/·/g,'*');
        return valNorm === cNorm || valNorm.includes(cNorm) || cNorm.includes(valNorm);
      });
      if (!val) { inp.classList.add('input-empty'); empty++; }
      else if (match) { inp.classList.add('input-ok'); correct++; }
      else { inp.classList.add('input-err'); }
    } else {
      // Numeric
      total++;
      const numAns = parseFloat(ans);
      const numVal = parseVal(val);
      if (!val) { inp.classList.add('input-empty'); empty++; }
      else if (approxEq(numVal, numAns)) { inp.classList.add('input-ok'); correct++; }
      else { inp.classList.add('input-err'); }
    }
  });
  const pct = Math.round(correct / total * 100);
  const passed = pct >= 75 && empty === 0;
  const res = document.getElementById('check-result-rep');
  if (empty > 0) {
    res.innerHTML = '⚠️ Noch <strong>' + empty + '</strong> Feld' + (empty===1?'':'er') + ' leer.';
    res.className = 'check-result warn';
  } else if (pct === 100) {
    res.innerHTML = '🎉 <strong>100 % richtig!</strong> Super!';
    res.className = 'check-result success';
  } else if (passed) {
    res.innerHTML = '✓ <strong>' + pct + ' %</strong> richtig – Lösung freigeschaltet!';
    res.className = 'check-result success';
  } else {
    res.innerHTML = '<strong>' + pct + ' %</strong> richtig (' + correct + '/' + total + ') – mind. 75 % zum Freischalten.';
    res.className = 'check-result error';
  }
  const solWrap = document.querySelector('.sol-wrap');
  const solLock = document.getElementById('sol-lock-rep');
  if (passed) {
    if (solWrap) solWrap.style.display = '';
    if (solLock) solLock.style.display = 'none';
    if (!done.has(cur)) { done.add(cur); save(); updProg(); buildOverview(); }
  } else {
    if (solWrap) solWrap.style.display = 'none';
    if (solLock) solLock.style.display = 'flex';
  }
}
function resetRep() {
  document.querySelectorAll('.rep-inputs .cell-input, .rep-inputs .cell-textarea').forEach(inp => {
    inp.value = '';
    inp.classList.remove('input-ok','input-err','input-empty','input-open');
  });
  const res = document.getElementById('check-result-rep');
  if (res) { res.textContent=''; res.className='check-result'; }
}
function checkFA() {
  const inputs = document.querySelectorAll('.fa-table .cell-input');
  let correct=0, total=0, empty=0;
  inputs.forEach(inp => {
    total++;
    const ans = parseFloat(inp.dataset.ans);
    const val = parseVal(inp.value);
    inp.classList.remove('input-ok','input-err','input-empty');
    if (inp.value.trim()==='') { inp.classList.add('input-empty'); empty++; }
    else if (approxEq(val, ans)) { inp.classList.add('input-ok'); correct++; }
    else { inp.classList.add('input-err'); }
  });
  const pct = Math.round(correct / total * 100);
  const passed = pct >= 75 && empty === 0;
  const res = document.getElementById('check-result-fa');
  if (empty > 0) {
    res.innerHTML = '⚠️ Noch <strong>' + empty + '</strong> Feld' + (empty===1?'':'er') + ' leer.';
    res.className = 'check-result warn';
  } else if (pct === 100) {
    res.innerHTML = '🎉 <strong>100 % richtig!</strong> Perfekt!';
    res.className = 'check-result success';
  } else if (passed) {
    res.innerHTML = '✓ <strong>' + pct + ' %</strong> richtig – Lösung freigeschaltet!';
    res.className = 'check-result success';
  } else {
    res.innerHTML = '<strong>' + pct + ' %</strong> richtig (' + correct + '/' + total + ') – mind. 75 % zum Freischalten.';
    res.className = 'check-result error';
  }
  const solWrap = document.querySelector('.sol-wrap');
  const solLock = document.getElementById('sol-lock-fa');
  if (passed) {
    if (solWrap) solWrap.style.display = '';
    if (solLock) solLock.style.display = 'none';
    if (!done.has(cur)) { done.add(cur); save(); updProg(); buildOverview(); }
  } else {
    if (solWrap) solWrap.style.display = 'none';
    if (solLock) solLock.style.display = 'flex';
  }
}
function resetFA() {
  document.querySelectorAll('.fa-table .cell-input').forEach(inp => {
    inp.value = '';
    inp.classList.remove('input-ok','input-err','input-empty');
  });
  const res = document.getElementById('check-result-fa');
  if (res) { res.textContent=''; res.className='check-result'; }
}

function checkKA() {
  const inputs = document.querySelectorAll('.ka-card .cell-input');
  let correct=0, total=0, empty=0;
  inputs.forEach(inp => {
    total++;
    const ans = parseFloat(inp.dataset.ans);
    const val = parseVal(inp.value);
    inp.classList.remove('input-ok','input-err','input-empty');
    if (inp.value.trim()==='') { inp.classList.add('input-empty'); empty++; }
    else if (approxEq(val, ans)) { inp.classList.add('input-ok'); correct++; }
    else { inp.classList.add('input-err'); }
  });
  const pct = Math.round(correct/total*100);
  const passed = pct>=75 && empty===0;
  const res = document.getElementById('check-result-ka');
  if (empty>0) { res.innerHTML='⚠️ Noch <strong>'+empty+'</strong> Feld'+(empty===1?'':'er')+' leer.'; res.className='check-result warn'; }
  else if (pct===100) { res.innerHTML='🎉 <strong>100 % richtig!</strong>'; res.className='check-result success'; }
  else if (passed) { res.innerHTML='✓ <strong>'+pct+' %</strong> richtig – Lösung freigeschaltet!'; res.className='check-result success'; }
  else { res.innerHTML='<strong>'+pct+' %</strong> ('+correct+'/'+total+') – mind. 75 % zum Freischalten.'; res.className='check-result error'; }
  const solWrap=document.querySelector('.sol-wrap');
  const solLock=document.getElementById('sol-lock-ka');
  if (passed) { if(solWrap) solWrap.style.display=''; if(solLock) solLock.style.display='none'; if(!done.has(cur)){done.add(cur);save();updProg();buildOverview();} }
  else { if(solWrap) solWrap.style.display='none'; if(solLock) solLock.style.display='flex'; }
}
function resetKA() {
  document.querySelectorAll('.ka-card .cell-input').forEach(inp=>{inp.value='';inp.classList.remove('input-ok','input-err','input-empty');});
  const res=document.getElementById('check-result-ka');
  if(res){res.textContent='';res.className='check-result';}
}

function makeCheckFn(selector, resultId, lockId) {
  return function() {
    saveInputs();
    const inputs = document.querySelectorAll(selector + ' .cell-input');
    let correct=0, total=0, empty=0;
    inputs.forEach(inp => {
      total++;
      const ans = parseFloat(inp.dataset.ans);
      const val = parseVal(inp.value);
      inp.classList.remove('input-ok','input-err','input-empty');
      if (inp.value.trim()==='') { inp.classList.add('input-empty'); empty++; }
      else if (approxEq(val, ans)) { inp.classList.add('input-ok'); correct++; }
      else { inp.classList.add('input-err'); }
    });
    const pct = Math.round(correct/total*100);
    const passed = pct>=75 && empty===0;
    const res = document.getElementById(resultId);
    if (empty>0) {
      res.innerHTML='⚠️ Noch <strong>'+empty+'</strong> Feld'+(empty===1?'':'er')+' leer.';
      res.className='check-result warn';
    } else if (pct===100) {
      res.innerHTML='🎉 <strong>100 % richtig!</strong> Perfekt!';
      res.className='check-result success';
    } else if (passed) {
      res.innerHTML='✓ <strong>'+pct+' %</strong> richtig – Lösung freigeschaltet!';
      res.className='check-result success';
    } else {
      res.innerHTML='<strong>'+pct+' %</strong> richtig ('+correct+'/'+total+') – mind. 75 % zum Freischalten.';
      res.className='check-result error';
    }
    const solWrap=document.querySelector('.sol-wrap');
    const solLock=document.getElementById(lockId);
    if (passed) {
      if (solWrap) solWrap.style.display='';
      if (solLock) solLock.style.display='none';
      if (!done.has(cur)) { done.add(cur); save(); updProg(); buildOverview(); }
    } else {
      if (solWrap) solWrap.style.display='none';
      if (solLock) solLock.style.display='flex';
    }
  };
}
function resetInputs(selector, resultId) {
  document.querySelectorAll(selector+' .cell-input').forEach(inp=>{
    inp.value='';
    inp.classList.remove('input-ok','input-err','input-empty');
  });
  const res=document.getElementById(resultId);
  if(res){res.textContent='';res.className='check-result';}
}
const checkRing = makeCheckFn('.ring-grid','check-result-ring','sol-lock-ring');
const checkKreisaus = makeCheckFn('.ring-grid','check-result-kreisaus','sol-lock-kreisaus');
function resetRing(){resetInputs('.ring-grid','check-result-ring');}
function resetKreisaus(){resetInputs('.ring-grid','check-result-kreisaus');}

function checkFrisbee2() {
  const inputs = document.querySelectorAll('#st-body .cell-input');
  let correct=0,total=0,empty=0;
  inputs.forEach(inp=>{
    total++;
    const ans=parseFloat(inp.dataset.ans);
    const val=parseVal(inp.value);
    inp.classList.remove('input-ok','input-err','input-empty');
    if(!inp.value.trim()){inp.classList.add('input-empty');empty++;}
    else if(approxEq(val,ans)){inp.classList.add('input-ok');correct++;}
    else{inp.classList.add('input-err');}
  });
  const pct=Math.round(correct/total*100);
  const passed=pct>=75&&empty===0;
  const res=document.getElementById('check-result-frisbee');
  if(empty>0){res.innerHTML='⚠️ Noch <strong>'+empty+'</strong> Feld'+(empty===1?'':'er')+' leer.';res.className='check-result warn';}
  else if(pct===100){res.innerHTML='🎉 <strong>100 % richtig!</strong>';res.className='check-result success';}
  else if(passed){res.innerHTML='✓ <strong>'+pct+' %</strong> richtig – Lösung freigeschaltet!';res.className='check-result success';}
  else{res.innerHTML='<strong>'+pct+' %</strong> ('+correct+'/'+total+') – mind. 75 %.';res.className='check-result error';}
  const solWrap=document.querySelector('.sol-wrap');
  const solLock=document.getElementById('sol-lock-frisbee');
  if(passed){if(solWrap)solWrap.style.display='';if(solLock)solLock.style.display='none';if(!done.has(cur)){done.add(cur);save();updProg();buildOverview();}}
  else{if(solWrap)solWrap.style.display='none';if(solLock)solLock.style.display='flex';}
}
function checkFrisbee(){saveInputs();checkFrisbee2();}
function resetFrisbee(){
  document.querySelectorAll('#st-body .cell-input').forEach(inp=>{
    inp.value='';inp.classList.remove('input-ok','input-err','input-empty');
  });
  const res=document.getElementById('check-result-frisbee');
  if(res){res.textContent='';res.className='check-result';}
}

function checkPizza() {
  const inputs = document.querySelectorAll('.pizza-inputs .cell-input');
  let correct=0,total=0,empty=0;
  inputs.forEach(inp=>{
    total++;
    const ans=parseFloat(inp.dataset.ans);
    const val=parseVal(inp.value);
    inp.classList.remove('input-ok','input-err','input-empty');
    if(!inp.value.trim()){inp.classList.add('input-empty');empty++;}
    else if(approxEq(val,ans)){inp.classList.add('input-ok');correct++;}
    else{inp.classList.add('input-err');}
  });
  const pct=Math.round(correct/total*100);
  const passed=pct>=75&&empty===0;
  const res=document.getElementById('check-result-pizza');
  if(empty>0){res.innerHTML='⚠️ Noch <strong>'+empty+'</strong> Feld'+(empty===1?'':'er')+' leer.';res.className='check-result warn';}
  else if(pct===100){res.innerHTML='🎉 <strong>100 % richtig!</strong> Perfekt!';res.className='check-result success';}
  else if(passed){res.innerHTML='✓ <strong>'+pct+' %</strong> richtig – Lösung freigeschaltet!';res.className='check-result success';}
  else{res.innerHTML='<strong>'+pct+' %</strong> ('+correct+'/'+total+') – mind. 75 % zum Freischalten.';res.className='check-result error';}
  const solWrap=document.querySelector('.sol-wrap');
  const solLock=document.getElementById('sol-lock-pizza');
  if(passed){if(solWrap)solWrap.style.display='';if(solLock)solLock.style.display='none';if(!done.has(cur)){done.add(cur);save();updProg();buildOverview();}}
  else{if(solWrap)solWrap.style.display='none';if(solLock)solLock.style.display='flex';}
}
function resetPizza(){
  document.querySelectorAll('.pizza-inputs .cell-input').forEach(inp=>{
    inp.value='';inp.classList.remove('input-ok','input-err','input-empty');
  });
  const res=document.getElementById('check-result-pizza');
  if(res){res.textContent='';res.className='check-result';}
}
function checkReifen() {
  const ta=document.getElementById('reifen-textarea');
  const res=document.getElementById('check-result-reifen');
  const solWrap=document.querySelector('.sol-wrap');
  const solLock=document.getElementById('sol-lock-reifen');
  if(!ta||!ta.value.trim()){
    if(res){res.innerHTML='⚠️ Bitte erst etwas eintragen.';res.className='check-result warn';}
    return;
  }
  res.innerHTML='✓ <strong>Abgegeben!</strong> Lösung freigeschaltet.';res.className='check-result success';
  if(solWrap)solWrap.style.display='';
  if(solLock)solLock.style.display='none';
  if(!done.has(cur)){done.add(cur);save();updProg();buildOverview();}
}
function resetReifen(){
  const ta=document.getElementById('reifen-textarea');
  if(ta)ta.value='';
  const res=document.getElementById('check-result-reifen');
  if(res){res.textContent='';res.className='check-result';}
}
function checkSportplatz() {
  const ta=document.getElementById('sportplatz-textarea');
  const res=document.getElementById('check-result-sportplatz');
  const solWrap=document.querySelector('.sol-wrap');
  const solLock=document.getElementById('sol-lock-sportplatz');
  if(!ta||!ta.value.trim()){
    if(res){res.innerHTML='⚠️ Bitte erst etwas eintragen.';res.className='check-result warn';}
    return;
  }
  res.innerHTML='✓ <strong>Abgegeben!</strong> Lösung freigeschaltet.';res.className='check-result success';
  if(solWrap)solWrap.style.display='';
  if(solLock)solLock.style.display='none';
  if(!done.has(cur)){done.add(cur);save();updProg();buildOverview();}
}
function resetSportplatz(){
  const ta=document.getElementById('sportplatz-textarea');
  if(ta)ta.value='';
  const res=document.getElementById('check-result-sportplatz');
  if(res){res.textContent='';res.className='check-result';}
}
function checkMinipizza() {
  const ids = ['minipizza-a','minipizza-b','minipizza-c'];
  const empty = ids.filter(id => { const el=document.getElementById(id); return !el||!el.value.trim(); });
  const res = document.getElementById('check-result-minipizza');
  const solWrap = document.querySelector('.sol-wrap');
  const solLock = document.getElementById('sol-lock-minipizza');
  if (empty.length > 0) {
    res.innerHTML='⚠️ Bitte alle Felder ausfüllen ('+empty.length+' fehlen noch).'; res.className='check-result warn';
    return;
  }
  res.innerHTML='✓ <strong>Abgegeben!</strong> Lösung freigeschaltet.'; res.className='check-result success';
  if(solWrap) solWrap.style.display='';
  if(solLock) solLock.style.display='none';
  if(!done.has(cur)){done.add(cur);save();updProg();buildOverview();}
}
function resetMinipizza() {
  ['minipizza-a','minipizza-b','minipizza-c'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  const res=document.getElementById('check-result-minipizza');
  if(res){res.textContent='';res.className='check-result';}
}
function checkSeil() {
  const inputs = document.querySelectorAll('.seil-inputs .cell-input');
  let correct=0, total=0, empty=0;
  inputs.forEach(inp => {
    total++;
    const ans = parseFloat(inp.dataset.ans);
    const val = parseVal(inp.value);
    inp.classList.remove('input-ok','input-err','input-empty');
    if (!inp.value.trim()) { inp.classList.add('input-empty'); empty++; }
    else if (approxEq(val, ans)) { inp.classList.add('input-ok'); correct++; }
    else { inp.classList.add('input-err'); }
  });
  const ta = document.getElementById('seil-textarea');
  const res = document.getElementById('check-result-seil');
  if (empty > 0) {
    res.innerHTML='⚠️ Noch <strong>'+empty+'</strong> Feld'+(empty===1?'':'er')+' leer.'; res.className='check-result warn'; return;
  }
  if (!ta || !ta.value.trim()) {
    res.innerHTML='⚠️ Bitte Aufgabe c) ausfüllen.'; res.className='check-result warn'; return;
  }
  const pct = Math.round(correct/total*100);
  const passed = pct >= 75;
  if (pct===100) { res.innerHTML='🎉 <strong>100 % richtig!</strong> Perfekt!'; res.className='check-result success'; }
  else if (passed) { res.innerHTML='✓ <strong>'+pct+' %</strong> richtig – weiter so!'; res.className='check-result success'; }
  else { res.innerHTML='<strong>'+pct+' %</strong> ('+correct+'/'+total+') – überprüfe deine Rechnung.'; res.className='check-result error'; }
  if (passed && !done.has(cur)) { done.add(cur); save(); updProg(); buildOverview(); }
}
function resetSeil() {
  document.querySelectorAll('.seil-inputs .cell-input').forEach(inp => {
    inp.value=''; inp.classList.remove('input-ok','input-err','input-empty');
  });
  const ta = document.getElementById('seil-textarea');
  if (ta) ta.value='';
  const res = document.getElementById('check-result-seil');
  if (res) { res.textContent=''; res.className='check-result'; }
}
function checkHippokrates() {
  const ta = document.getElementById('hippokrates-textarea');
  const res = document.getElementById('check-result-hippokrates');
  if (!ta || !ta.value.trim()) {
    res.innerHTML = '⚠️ Bitte etwas eintragen.'; res.className = 'check-result warn'; return;
  }
  res.innerHTML = '✓ <strong>Abgegeben!</strong>'; res.className = 'check-result success';
  if (!done.has(cur)) { done.add(cur); save(); updProg(); buildOverview(); }
}
function resetHippokrates() {
  const ta = document.getElementById('hippokrates-textarea');
  if (ta) ta.value = '';
  const res = document.getElementById('check-result-hippokrates');
  if (res) { res.textContent = ''; res.className = 'check-result'; }
}






function checkFlugzeug() {
  const inputs = document.querySelectorAll('#st-body .cell-input');
  let correct=0,total=0,empty=0;
  inputs.forEach(inp=>{
    total++;
    const ans=parseFloat(inp.dataset.ans);
    const val=parseVal(inp.value);
    inp.classList.remove('input-ok','input-err','input-empty');
    if(!inp.value.trim()){inp.classList.add('input-empty');empty++;}
    else if(approxEq(val,ans)){inp.classList.add('input-ok');correct++;}
    else{inp.classList.add('input-err');}
  });
  const pct=Math.round(correct/total*100);
  const passed=pct>=75&&empty===0;
  const res=document.getElementById('check-result-flugzeug');
  if(empty>0){res.innerHTML='⚠️ Noch <strong>'+empty+'</strong> Feld'+(empty===1?'':'er')+' leer.';res.className='check-result warn';}
  else if(pct===100){res.innerHTML='🎉 <strong>100 % richtig!</strong>';res.className='check-result success';}
  else if(passed){res.innerHTML='✓ <strong>'+pct+' %</strong> richtig – Lösung freigeschaltet!';res.className='check-result success';}
  else{res.innerHTML='<strong>'+pct+' %</strong> ('+correct+'/'+total+') – mind. 75 %.';res.className='check-result error';}
  const solWrap=document.querySelector('.sol-wrap');
  const solLock=document.getElementById('sol-lock-flugzeug');
  if(passed){if(solWrap)solWrap.style.display='';if(solLock)solLock.style.display='none';if(!done.has(cur)){done.add(cur);save();updProg();buildOverview();}}
  else{if(solWrap)solWrap.style.display='none';if(solLock)solLock.style.display='flex';}
}
function resetFlugzeug(){
  document.querySelectorAll('#st-body .cell-input').forEach(inp=>{
    inp.value='';inp.classList.remove('input-ok','input-err','input-empty');
  });
  const res=document.getElementById('check-result-flugzeug');
  if(res){res.textContent='';res.className='check-result';}
}

function checkSonnensystem() {
  const inputs = document.querySelectorAll('#st-body .cell-input');
  let correct=0,total=0,empty=0;
  inputs.forEach(inp=>{
    total++;
    const ans=parseFloat(inp.dataset.ans);
    const val=parseVal(inp.value);
    inp.classList.remove('input-ok','input-err','input-empty');
    if(!inp.value.trim()){inp.classList.add('input-empty');empty++;}
    else if(approxEq(val,ans)){inp.classList.add('input-ok');correct++;}
    else{inp.classList.add('input-err');}
  });
  const pct=Math.round(correct/total*100);
  const passed=pct>=75&&empty===0;
  const res=document.getElementById('check-result-sonnensystem');
  if(empty>0){res.innerHTML='⚠️ Noch <strong>'+empty+'</strong> Feld'+(empty===1?'':'er')+' leer.';res.className='check-result warn';}
  else if(pct===100){res.innerHTML='🎉 <strong>100 % richtig!</strong> Super!';res.className='check-result success';}
  else if(passed){res.innerHTML='✓ <strong>'+pct+' %</strong> richtig – Lösung freigeschaltet!';res.className='check-result success';}
  else{res.innerHTML='<strong>'+pct+' %</strong> ('+correct+'/'+total+') – mind. 75 %.';res.className='check-result error';}
  const solWrap=document.querySelector('.sol-wrap');
  const solLock=document.getElementById('sol-lock-sonnensystem');
  if(passed){if(solWrap)solWrap.style.display='';if(solLock)solLock.style.display='none';if(!done.has(cur)){done.add(cur);save();updProg();buildOverview();}}
  else{if(solWrap)solWrap.style.display='none';if(solLock)solLock.style.display='flex';}
}
function resetSonnensystem(){
  document.querySelectorAll('#st-body .cell-input').forEach(inp=>{inp.value='';inp.classList.remove('input-ok','input-err','input-empty');});
  const res=document.getElementById('check-result-sonnensystem');
  if(res){res.textContent='';res.className='check-result';}
}

function makeCheckGeneric(resultId, lockId) {
  return function() {
    saveInputs();
    const inputs = document.querySelectorAll('#st-body .cell-input');
    let correct=0,total=0,empty=0;
    inputs.forEach(inp=>{
      total++;
      const ans=parseFloat(inp.dataset.ans);
      const val=parseVal(inp.value);
      inp.classList.remove('input-ok','input-err','input-empty');
      if(!inp.value.trim()){inp.classList.add('input-empty');empty++;}
      else if(approxEq(val,ans)){inp.classList.add('input-ok');correct++;}
      else{inp.classList.add('input-err');}
    });
    const pct=Math.round(correct/total*100);
    const passed=pct>=75&&empty===0;
    const res=document.getElementById(resultId);
    if(empty>0){res.innerHTML='⚠️ Noch <strong>'+empty+'</strong> Feld'+(empty===1?'':'er')+' leer.';res.className='check-result warn';}
    else if(pct===100){res.innerHTML='🎉 <strong>100 % richtig!</strong>';res.className='check-result success';}
    else if(passed){res.innerHTML='✓ <strong>'+pct+' %</strong> richtig – Lösung freigeschaltet!';res.className='check-result success';}
    else{res.innerHTML='<strong>'+pct+' %</strong> ('+correct+'/'+total+') – mind. 75 %.';res.className='check-result error';}
    const solWrap=document.querySelector('.sol-wrap');
    const solLock=document.getElementById(lockId);
    if(passed){if(solWrap)solWrap.style.display='';if(solLock)solLock.style.display='none';if(!done.has(cur)){done.add(cur);save();updProg();buildOverview();}}
    else{if(solWrap)solWrap.style.display='none';if(solLock)solLock.style.display='flex';}
  };
}
function makeResetGeneric(resultId){
  return function(){
    document.querySelectorAll('#st-body .cell-input').forEach(inp=>{inp.value='';inp.classList.remove('input-ok','input-err','input-empty');});
    const res=document.getElementById(resultId);
    if(res){res.textContent='';res.className='check-result';}
  };
}
const checkGeraet=makeCheckGeneric('check-result-geraet','sol-lock-geraet');
const resetGeraet=makeResetGeneric('check-result-geraet');
const checkTunnel=makeCheckGeneric('check-result-tunnel','sol-lock-tunnel');
const resetTunnel=makeResetGeneric('check-result-tunnel');

const checkLondon=makeCheckGeneric('check-result-london','sol-lock-london');
const resetLondon=makeResetGeneric('check-result-london');

let korrekturState={};
async function loadKorrektur(){
  try{const r=await fetch('/api/korrektur');if(r.ok)korrekturState=await r.json();}catch(e){}
}
if(window.self!==window.top)loadKorrektur();
let abgabeState = _inIframe ? {} : JSON.parse(localStorage.getItem(ABGABE_KEY)||'{}');
function abgabeChecked(g){return !!abgabeState[g];}
function toggleAbgabe(g,val){
  abgabeState[g]=val;
  const encoded=JSON.stringify(abgabeState);
  localStorage.setItem(ABGABE_KEY,encoded);
  // Sync to server via parent shell
  window.parent.postMessage({type:'SAVE_PROGRESS',key:ABGABE_KEY,value:encoded},'*');
  buildOverview();
}

const checkEinheitenFlaeche = makeCheckGeneric('check-result-einheiten-flaeche','sol-lock-einheiten-f');
const resetEinheitenFlaeche = makeResetGeneric('check-result-einheiten-flaeche');
const checkEinheitenVolumen = makeCheckGeneric('check-result-einheiten-volumen','sol-lock-einheiten-v');
const resetEinheitenVolumen = makeResetGeneric('check-result-einheiten-volumen');

function _inputKey(id){ return KEY+'_i'+id; }
function saveInputs(){
  if(cur===null) return;
  const inputs = document.querySelectorAll('#st-body .cell-input, #st-body textarea');
  if(!inputs.length) return;
  const vals = {};
  inputs.forEach((inp,i) => { vals[i] = inp.value; });
  const key = _inputKey(cur);
  const encoded = JSON.stringify(vals);
  localStorage.setItem(key, encoded);
  window.parent.postMessage({type:'SAVE_PROGRESS', key, value: encoded}, '*');
}

function loadInputs(id){
  const key = _inputKey(id);
  // also try legacy key for backward compat
  const raw = localStorage.getItem(key) || localStorage.getItem('lerntheke_inputs_' + id);
  if(!raw) return;
  try {
    const vals = JSON.parse(raw);
    const inputs = document.querySelectorAll('#st-body .cell-input, #st-body textarea');
    inputs.forEach((inp,i) => {
      if(vals[i] !== undefined && vals[i] !== '') inp.value = vals[i];
    });
  } catch(e) {}
}

function showOv(){saveInputs();buildOverview();showView('view-ov');}
if(_inIframe){
  // RELOAD_PROGRESS will call loadKorrektur().then(buildOverview) after sync
} else {
  loadKorrektur().then(() => { buildOverview(); });
}