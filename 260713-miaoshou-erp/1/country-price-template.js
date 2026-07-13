javascript:(function(){
'use strict';

// ==================== DOM 选择器 ====================
const ROOT_SEL = "body > div > div > div.el-dialog__body > div.jx-pro-virtual-table > div.jx-pro-virtual-table__body > div.vue-recycle-scroller__item-wrapper";

function getWrapper() {
  const w = document.querySelector(ROOT_SEL);
  if (!w) throw new Error('找不到申报价表格，请确认弹窗已打开');
  return w;
}

function extractRow(rowEl) {
  const cell0 = rowEl.children[0]?.children[0]?.children[0];
  const name = (cell0?.textContent || '').trim();
  const input = rowEl.children[0]?.children[0]?.children[1]?.querySelector('input');
  return { name, input, price: input ? input.value.trim() : '' };
}

// ==================== 收集全部国家（异步滚动） ====================
function collectAllCountries(callback) {
  const wrapper = getWrapper();
  const scroller = wrapper.parentElement; // vue-recycle-scroller
  const minH = parseInt(wrapper.style.minHeight) || 0;
  const visibleH = scroller.clientHeight || 400;

  if (minH < 100) {
    // fallback: just use visible rows
    const cs = {};
    wrapper.querySelectorAll('.vue-recycle-scroller__item-view').forEach(function(iv){
      const row = extractRow(iv);
      if (row.name) cs[row.name] = true;
    });
    callback(Object.keys(cs));
    return;
  }

  const seen = {};
  let offset = 0;
  const origScroll = scroller.scrollTop;

  function step() {
    scroller.scrollTop = offset;
    // 用双重 setTimeout 确保虚拟滚动完成 DOM 更新
    setTimeout(function() {
      setTimeout(function() {
        wrapper.querySelectorAll('.vue-recycle-scroller__item-view').forEach(function(iv){
          const row = extractRow(iv);
          if (row.name && /[\u4e00-\u9fff]/.test(row.name)) seen[row.name] = true;
        });

        offset += Math.floor(visibleH * 0.8); // 80% 重叠确保不漏
        if (offset >= minH || Object.keys(seen).length >= Math.floor(minH / 50)) {
          // 完成，恢复原位
          scroller.scrollTop = origScroll;
          callback(Object.keys(seen));
        } else {
          step();
        }
      }, 80);
    }, 80);
  }

  step();
}

// ==================== 模板存储 ====================
const STORAGE_KEY = 'hermes_country_price_templates';
function loadTemplates() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch(e) { return []; } }
function saveTemplates(arr) { localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)); }

// ==================== Input 安全写入 ====================
const nativeValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
function setInputValue(input, value) {
  nativeValueSetter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

// ==================== 持续套用监控 ====================
let activeTemplate = null;       // { name, priceMap }
let userEdited = {};             // { countryName: true }

/** 对可见行填一次 */
function fillVisibleRows(priceMap) {
  let filled = 0;
  const wrapper = getWrapper();
  wrapper.querySelectorAll('.vue-recycle-scroller__item-view').forEach(function(iv){
    const row = extractRow(iv);
    if (row.input && priceMap[row.name] !== undefined && !userEdited[row.name]) {
      setInputValue(row.input, priceMap[row.name]);
      filled++;
    }
  });
  return filled;
}

function startMonitoring(template) {
  stopMonitoring();
  activeTemplate = template;
  userEdited = {};

  const wrapper = getWrapper();
  fillVisibleRows(template.priceMap);

  // MutationObserver：监听 wrapper 子节点增删 + 文本变化
  wrapper.__hcmObserver = new MutationObserver(function(){
    wrapper.querySelectorAll('.vue-recycle-scroller__item-view').forEach(function(iv){
      const row = extractRow(iv);
      if (!row.input || !template.priceMap[row.name] || userEdited[row.name]) return;
      if (row.price !== template.priceMap[row.name]) {
        setInputValue(row.input, template.priceMap[row.name]);
      }
    });
  });
  wrapper.__hcmObserver.observe(wrapper, { childList: true, subtree: true, characterData: true });

  // input 事件委托：用户手动改过的记入黑名单
  wrapper.__hcmInputHandler = function(e){
    if (e.target.tagName !== 'INPUT') return;
    const iv = e.target.closest('.vue-recycle-scroller__item-view');
    if (!iv) return;
    const row = extractRow(iv);
    if (!row.name) return;
    if (activeTemplate && activeTemplate.priceMap[row.name] === e.target.value) {
      delete userEdited[row.name];
    } else {
      userEdited[row.name] = true;
    }
  };
  wrapper.addEventListener('input', wrapper.__hcmInputHandler, true);
}

function stopMonitoring() {
  const wrapper = getWrapper();
  if (wrapper.__hcmObserver) { wrapper.__hcmObserver.disconnect(); delete wrapper.__hcmObserver; }
  if (wrapper.__hcmInputHandler) { wrapper.removeEventListener('input', wrapper.__hcmInputHandler, true); delete wrapper.__hcmInputHandler; }
  activeTemplate = null;
  userEdited = {};
}

function applyTemplate(template) {
  const priceMap = {};
  template.prices.forEach(function(p){ priceMap[p.country.trim()] = p.price; });
  startMonitoring({ name: template.name, priceMap: priceMap });
  return Object.keys(priceMap).length;
}

// ==================== UI ====================
const style = document.createElement('style');
style.textContent = `
.hcm-overlay-bg{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:99999;display:flex;align-items:center;justify-content:center}
.hcm-panel{background:#fff;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.3);width:720px;max-height:85vh;display:flex;flex-direction:column;font:14px/1.5 "Microsoft YaHei",sans-serif;color:#333}
.hcm-header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #eee}
.hcm-header h3{margin:0;font-size:18px}
.hcm-close{width:32px;height:32px;border:none;background:#f5f5f5;border-radius:50%;cursor:pointer;font-size:18px;line-height:1;color:#999;transition:all .2s}
.hcm-close:hover{background:#e74c3c;color:#fff}
.hcm-body{flex:1;overflow-y:auto;padding:20px}
.hcm-toolbar{margin-bottom:16px;display:flex;gap:10px}
.hcm-btn{padding:8px 18px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;font-size:14px;transition:all .2s;white-space:nowrap}
.hcm-btn:hover{border-color:#409eff;color:#409eff}
.hcm-btn-primary{background:#409eff;border-color:#409eff;color:#fff}
.hcm-btn-primary:hover{background:#337ecc;border-color:#337ecc;color:#fff}
.hcm-btn-danger{color:#e74c3c;border-color:#e74c3c}
.hcm-btn-danger:hover{background:#e74c3c;color:#fff}
.hcm-btn-success{background:#67c23a;border-color:#67c23a;color:#fff}
.hcm-btn-success:hover{background:#529b2e}
.hcm-btn-sm{padding:4px 10px;font-size:12px}
.hcm-template-list{display:flex;flex-direction:column;gap:8px}
.hcm-template-item{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:#f9fafb;border-radius:8px;border:1px solid #eee;transition:all .2s}
.hcm-template-item:hover{border-color:#409eff}
.hcm-tpl-info{display:flex;flex-direction:column;gap:4px}
.hcm-tpl-name{font-weight:600;font-size:15px}
.hcm-tpl-meta{font-size:12px;color:#999}
.hcm-tpl-actions{display:flex;gap:6px}
.hcm-edit-table{width:100%;border-collapse:collapse}
.hcm-edit-table td,.hcm-edit-table th{padding:8px 12px;border:1px solid #e8e8e8;text-align:left}
.hcm-edit-table th{background:#f5f7fa;font-weight:600}
.hcm-edit-table input{width:100%;padding:6px 10px;border:1px solid #ddd;border-radius:4px;font-size:14px;box-sizing:border-box}
.hcm-edit-table input:focus{border-color:#409eff;outline:none;box-shadow:0 0 0 2px rgba(64,158,255,.2)}
.hcm-empty{text-align:center;color:#999;padding:40px 0}
.hcm-toast{position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:10px 24px;border-radius:8px;font-size:14px;z-index:999999;opacity:0;transition:opacity .3s}
.hcm-toast.show{opacity:1}
`;
document.head.appendChild(style);

let toastTimer;
function toast(msg, type) {
  type = type || '';
  let el = document.getElementById('hcm-toast');
  if (!el) { el = document.createElement('div'); el.id = 'hcm-toast'; el.className = 'hcm-toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.style.background = type === 'error' ? '#e74c3c' : '#333';
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ el.classList.remove('show'); }, 2000);
}

// ==================== 面板 ====================
let currentView = 'list', editingIndex = -1, allCountries = [];

function destroyPanel() {
  const bg = document.getElementById('hcm-overlay');
  if (bg) bg.remove();
}

function render() {
  destroyPanel();
  const templates = loadTemplates();
  const bg = document.createElement('div');
  bg.id = 'hcm-overlay'; bg.className = 'hcm-overlay-bg';
  bg.onclick = function(e){ if(e.target===bg) destroyPanel(); };
  const panel = document.createElement('div');
  panel.className = 'hcm-panel';
  panel.onclick = function(e){ e.stopPropagation(); };

  const header = document.createElement('div');
  header.className = 'hcm-header';
  header.innerHTML = '<h3>' + (currentView==='edit'?(editingIndex>=0?'编辑模板':'新建模板'):'申报价模板管理') + '</h3>';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'hcm-close'; closeBtn.textContent = '\u2715'; closeBtn.onclick = destroyPanel;
  header.appendChild(closeBtn);

  const body = document.createElement('div');
  body.className = 'hcm-body';
  body.appendChild(currentView==='list' ? renderListView(templates) : renderEditView(templates));

  panel.appendChild(header); panel.appendChild(body);
  bg.appendChild(panel); document.body.appendChild(bg);
}

function renderListView(templates) {
  const frag = document.createDocumentFragment();
  const toolbar = document.createElement('div');
  toolbar.className = 'hcm-toolbar';

  const addBtn = document.createElement('button');
  addBtn.className = 'hcm-btn hcm-btn-primary';
  addBtn.textContent = '+ 新增模板';
  addBtn.onclick = function(){
    const name = prompt('请输入模板名称：');
    if(!name||!name.trim()) return;
    editingIndex=-1; currentView='edit';
    window.__hcm_new_template={name:name.trim(),prices:allCountries.map(function(c){return{country:c,price:''};})};
    render();
  };
  toolbar.appendChild(addBtn);

  const snapBtn = document.createElement('button');
  snapBtn.className = 'hcm-btn';
  snapBtn.textContent = '\uD83D\uDCCB 从当前表格创建模板';
  snapBtn.onclick = function(){
    const name = prompt('请输入模板名称：');
    if(!name||!name.trim()) return;
    const wrapper = getWrapper();
    const ss = [];
    wrapper.querySelectorAll('.vue-recycle-scroller__item-view').forEach(function(iv){ ss.push(extractRow(iv)); });
    const tpls = loadTemplates();
    tpls.push({name:name.trim(),prices:ss.filter(function(r){return r.name;}).map(function(r){return{country:r.name,price:r.price};}),updatedAt:new Date().toISOString()});
    saveTemplates(tpls); toast('模板已保存'); render();
  };
  toolbar.appendChild(snapBtn);
  frag.appendChild(toolbar);

  // 活跃模板状态条
  if (activeTemplate) {
    const statusBar = document.createElement('div');
    statusBar.style.cssText = 'padding:8px 14px;background:#ecf5ff;border:1px solid #b3d8ff;border-radius:6px;margin-bottom:12px;font-size:13px;display:flex;align-items:center;justify-content:space-between';
    statusBar.innerHTML = '<span>\uD83D\uDD04 正在套用: <b>' + escHtml(activeTemplate.name) + '</b>（已禁止编辑 ' + Object.keys(userEdited).length + ' 国）</span>';
    const stopBtn = document.createElement('button');
    stopBtn.className = 'hcm-btn hcm-btn-danger hcm-btn-sm';
    stopBtn.textContent = '停止套用';
    stopBtn.onclick = function(){ stopMonitoring(); toast('已停止套用'); render(); };
    statusBar.appendChild(stopBtn);
    frag.appendChild(statusBar);
  }

  if(templates.length===0){
    const empty = document.createElement('div');
    empty.className = 'hcm-empty'; empty.textContent = '暂无模板';
    frag.appendChild(empty);
  }else{
    const list = document.createElement('div');
    list.className = 'hcm-template-list';
    templates.forEach(function(tpl,idx){
      const item = document.createElement('div');
      item.className = 'hcm-template-item';
      const info = document.createElement('div');
      info.className = 'hcm-tpl-info';
      info.innerHTML = '<span class="hcm-tpl-name">'+escHtml(tpl.name)+'</span><span class="hcm-tpl-meta">'+tpl.prices.length+' 个国家'+(tpl.updatedAt?' · '+new Date(tpl.updatedAt).toLocaleString():'')+'</span>';
      const actions = document.createElement('div');
      actions.className = 'hcm-tpl-actions';

      const applyBtn = document.createElement('button');
      applyBtn.className = 'hcm-btn hcm-btn-success hcm-btn-sm';
      applyBtn.textContent = '套用';
      applyBtn.onclick = function(){
        if(!confirm('确认套用模板"'+tpl.name+'"？')) return;
        toast('已套用 '+applyTemplate(tpl)+' 个国家的价格');
      };
      actions.appendChild(applyBtn);

      const editBtn = document.createElement('button');
      editBtn.className = 'hcm-btn hcm-btn-sm';
      editBtn.textContent = '编辑';
      editBtn.onclick = function(){
        editingIndex=idx; currentView='edit';
        const em={}; tpl.prices.forEach(function(p){em[p.country.trim()]=p.price;});
        window.__hcm_edit_data={name:tpl.name,prices:allCountries.map(function(c){return{country:c,price:em[c]||''};})};
        render();
      };
      actions.appendChild(editBtn);

      const delBtn = document.createElement('button');
      delBtn.className = 'hcm-btn hcm-btn-danger hcm-btn-sm';
      delBtn.textContent = '删除';
      delBtn.onclick = function(){
        if(!confirm('确认删除"'+tpl.name+'"？')) return;
        const tpls=loadTemplates(); tpls.splice(idx,1); saveTemplates(tpls); toast('已删除'); render();
      };
      actions.appendChild(delBtn);

      item.appendChild(info); item.appendChild(actions); list.appendChild(item);
    });
    frag.appendChild(list);
  }
  return frag;
}

function renderEditView(templates) {
  const data = editingIndex>=0 ? window.__hcm_edit_data : window.__hcm_new_template;
  if(!data){toast('数据丢失','error');currentView='list';render();return document.createElement('div');}
  const frag = document.createDocumentFragment();

  const nr = document.createElement('div');
  nr.style.cssText = 'margin-bottom:16px;display:flex;align-items:center;gap:12px';
  const nl = document.createElement('label'); nl.textContent='模板名称：'; nl.style.fontWeight='600';
  const ni = document.createElement('input'); ni.value=data.name;
  ni.style.cssText='flex:1;padding:8px 12px;border:1px solid #ddd;border-radius:6px;font-size:14px';
  nr.appendChild(nl); nr.appendChild(ni); frag.appendChild(nr);

  const table = document.createElement('table');
  table.className = 'hcm-edit-table';
  table.innerHTML = '<thead><tr><th style="width:40%">国家</th><th style="width:60%">申报价</th></tr></thead>';
  const tbody = document.createElement('tbody');
  data.prices.forEach(function(p,idx){
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>'+escHtml(p.country)+'</td><td><input type="text" value="'+escAttr(p.price)+'" data-idx="'+idx+'" placeholder="输入价格"></td>';
    tbody.appendChild(tr);
  });
  table.appendChild(tbody); frag.appendChild(table);

  const footer = document.createElement('div');
  footer.style.cssText = 'margin-top:20px;display:flex;gap:10px;justify-content:flex-end';
  const cb = document.createElement('button');
  cb.className='hcm-btn'; cb.textContent='取消'; cb.onclick=function(){currentView='list';render();};
  footer.appendChild(cb);
  const sb = document.createElement('button');
  sb.className='hcm-btn hcm-btn-primary'; sb.textContent='保存模板';
  sb.onclick=function(){
    const name=ni.value.trim();
    if(!name){toast('请输入模板名称','error');return;}
    const prices=[];
    tbody.querySelectorAll('input').forEach(function(inp){prices.push({country:data.prices[parseInt(inp.dataset.idx)].country,price:inp.value.trim()});});
    const nt={name,prices,updatedAt:new Date().toISOString()};
    if(editingIndex>=0) templates[editingIndex]=nt; else templates.push(nt);
    saveTemplates(templates); toast('已保存'); currentView='list'; render();
  };
  footer.appendChild(sb); frag.appendChild(footer);
  return frag;
}

function escHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function escAttr(s){return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

// ==================== 启动（异步收集） ====================
try {
  getWrapper();
  console.log('[模板工具] 正在通过自动滚动收集全部国家...');
  collectAllCountries(function(countries) {
    allCountries = countries;
    console.log('[模板工具] 收集完成，共 ' + countries.length + ' 个国家: ' + countries.join(', '));
    render();
  });
} catch(e) {
  alert('错误：' + e.message);
}

})();
