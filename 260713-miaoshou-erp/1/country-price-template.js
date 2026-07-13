javascript:(function(){
'use strict';

// ==================== DOM 读取 ====================
const ROOT_SEL = "body > div > div > div.el-dialog__body > div.jx-pro-virtual-table > div.jx-pro-virtual-table__body > div.vue-recycle-scroller__item-wrapper";

function getLines() {
  const wrapper = document.querySelector(ROOT_SEL);
  if (!wrapper) throw new Error('找不到申报价表格，请确认弹窗已打开');
  return [...wrapper.children];
}

function extractCountryPrice(line) {
  const name = (line.children[0]?.children[0]?.children[0]?.textContent || '').trim();
  const input = line.children[0]?.children[0]?.children[1]?.children[0]?.querySelector('input');
  return { name, input, price: input ? input.value.trim() : '' };
}

function getCurrentSnapshot() {
  return getLines().map(extractCountryPrice);
}

function getCountries() {
  return getCurrentSnapshot().map(c => c.name);
}

// ==================== 模板存储 ====================
const STORAGE_KEY = 'hermes_country_price_templates';

function loadTemplates() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
}
function saveTemplates(arr) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
}

// ==================== Input 安全写入 (适配 Vue) ====================
const nativeValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;

function setInputValue(input, value) {
  nativeValueSetter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

// ==================== 套用模板 ====================
function applyTemplate(template) {
  const countries = getCountries();
  const lines = getLines();
  const priceMap = {};
  template.prices.forEach(p => { priceMap[p.country.trim()] = p.price; });

  let applied = 0;
  const curSnapshot = getCurrentSnapshot();
  curSnapshot.forEach((snap, idx) => {
    const key = snap.name;
    if (priceMap[key] !== undefined && snap.input) {
      setInputValue(snap.input, priceMap[key]);
      applied++;
    }
  });

  return applied;
}

// ==================== UI 构建 ====================
// 注入样式
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

// Toast
let toastTimer;
function toast(msg, type = '') {
  let el = document.getElementById('hcm-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'hcm-toast';
    el.className = 'hcm-toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.background = type === 'error' ? '#e74c3c' : '#333';
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
}

// ==================== 面板渲染 ====================
let currentView = 'list'; // 'list' | 'edit'
let editingIndex = -1;

function destroyPanel() {
  const bg = document.getElementById('hcm-overlay');
  if (bg) bg.remove();
}

function render() {
  destroyPanel();
  const templates = loadTemplates();

  const bg = document.createElement('div');
  bg.id = 'hcm-overlay';
  bg.className = 'hcm-overlay-bg';
  bg.onclick = (e) => { if (e.target === bg) destroyPanel(); };

  const panel = document.createElement('div');
  panel.className = 'hcm-panel';
  panel.onclick = (e) => e.stopPropagation();

  // Header
  const header = document.createElement('div');
  header.className = 'hcm-header';
  header.innerHTML = `<h3>${currentView === 'edit' ? (editingIndex >= 0 ? '编辑模板' : '新建模板') : '申报价模板管理'}</h3>`;
  const closeBtn = document.createElement('button');
  closeBtn.className = 'hcm-close';
  closeBtn.textContent = '✕';
  closeBtn.onclick = destroyPanel;
  header.appendChild(closeBtn);

  // Body
  const body = document.createElement('div');
  body.className = 'hcm-body';

  if (currentView === 'list') {
    body.appendChild(renderListView(templates));
  } else {
    body.appendChild(renderEditView(templates));
  }

  panel.appendChild(header);
  panel.appendChild(body);
  bg.appendChild(panel);
  document.body.appendChild(bg);
}

function renderListView(templates) {
  const frag = document.createDocumentFragment();

  // Toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'hcm-toolbar';

  const addBtn = document.createElement('button');
  addBtn.className = 'hcm-btn hcm-btn-primary';
  addBtn.textContent = '+ 新增模板';
  addBtn.onclick = () => {
    const name = prompt('请输入模板名称：');
    if (!name || !name.trim()) return;
    const countries = getCountries();
    if (countries.length === 0) { toast('当前表格没有数据', 'error'); return; }
    editingIndex = -1;
    currentView = 'edit';
    // 暂存新建模板数据
    window.__hcm_new_template = { name: name.trim(), prices: countries.map(c => ({ country: c, price: '' })) };
    render();
  };
  toolbar.appendChild(addBtn);

  const snapshotBtn = document.createElement('button');
  snapshotBtn.className = 'hcm-btn';
  snapshotBtn.textContent = '📋 从当前表格创建模板';
  snapshotBtn.onclick = () => {
    const name = prompt('请输入模板名称：');
    if (!name || !name.trim()) return;
    const snapshot = getCurrentSnapshot();
    if (snapshot.length === 0) { toast('当前表格没有数据', 'error'); return; }
    const templates = loadTemplates();
    templates.push({ name: name.trim(), prices: snapshot.map(s => ({ country: s.name, price: s.price })), updatedAt: new Date().toISOString() });
    saveTemplates(templates);
    toast('模板已保存');
    render();
  };
  toolbar.appendChild(snapshotBtn);

  frag.appendChild(toolbar);

  // Template list
  if (templates.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'hcm-empty';
    empty.textContent = '暂无模板，点击上方按钮创建';
    frag.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'hcm-template-list';

    templates.forEach((tpl, idx) => {
      const item = document.createElement('div');
      item.className = 'hcm-template-item';

      const info = document.createElement('div');
      info.className = 'hcm-tpl-info';
      info.innerHTML = `<span class="hcm-tpl-name">${escHtml(tpl.name)}</span><span class="hcm-tpl-meta">${tpl.prices.length} 个国家 · ${tpl.updatedAt ? '更新于 ' + new Date(tpl.updatedAt).toLocaleString() : ''}</span>`;

      const actions = document.createElement('div');
      actions.className = 'hcm-tpl-actions';

      // Apply
      const applyBtn = document.createElement('button');
      applyBtn.className = 'hcm-btn hcm-btn-success hcm-btn-sm';
      applyBtn.textContent = '套用';
      applyBtn.onclick = () => {
        if (!confirm(`确认将模板"${tpl.name}"的申报价套用到当前表格？`)) return;
        const n = applyTemplate(tpl);
        toast(`已套用 ${n} 个国家的价格`);
      };
      actions.appendChild(applyBtn);

      // Edit
      const editBtn = document.createElement('button');
      editBtn.className = 'hcm-btn hcm-btn-sm';
      editBtn.textContent = '编辑';
      editBtn.onclick = () => {
        editingIndex = idx;
        currentView = 'edit';
        // 合并当前国家列表和已有价格
        const curCountries = getCountries();
        const existingMap = {};
        tpl.prices.forEach(p => { existingMap[p.country.trim()] = p.price; });
        window.__hcm_edit_data = {
          name: tpl.name,
          prices: curCountries.map(c => ({ country: c, price: existingMap[c] || '' }))
        };
        render();
      };
      actions.appendChild(editBtn);

      // Delete
      const delBtn = document.createElement('button');
      delBtn.className = 'hcm-btn hcm-btn-danger hcm-btn-sm';
      delBtn.textContent = '删除';
      delBtn.onclick = () => {
        if (!confirm(`确认删除模板"${tpl.name}"？`)) return;
        const templates = loadTemplates();
        templates.splice(idx, 1);
        saveTemplates(templates);
        toast('模板已删除');
        render();
      };
      actions.appendChild(delBtn);

      item.appendChild(info);
      item.appendChild(actions);
      list.appendChild(item);
    });

    frag.appendChild(list);
  }

  return frag;
}

function renderEditView(templates) {
  const data = editingIndex >= 0 ? window.__hcm_edit_data : window.__hcm_new_template;
  if (!data) { toast('数据丢失', 'error'); currentView = 'list'; render(); return document.createElement('div'); }

  const frag = document.createDocumentFragment();

  // Template name row
  const nameRow = document.createElement('div');
  nameRow.style.cssText = 'margin-bottom:16px;display:flex;align-items:center;gap:12px';
  const nameLabel = document.createElement('label');
  nameLabel.textContent = '模板名称：';
  nameLabel.style.fontWeight = '600';
  const nameInput = document.createElement('input');
  nameInput.value = data.name;
  nameInput.style.cssText = 'flex:1;padding:8px 12px;border:1px solid #ddd;border-radius:6px;font-size:14px';
  nameRow.appendChild(nameLabel);
  nameRow.appendChild(nameInput);
  frag.appendChild(nameRow);

  // Editable table
  const table = document.createElement('table');
  table.className = 'hcm-edit-table';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th style="width:40%">国家</th><th style="width:60%">申报价</th></tr>';
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  data.prices.forEach((p, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escHtml(p.country)}</td><td><input type="text" value="${escAttr(p.price)}" data-idx="${idx}" placeholder="输入价格"></td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  frag.appendChild(table);

  // Footer buttons
  const footer = document.createElement('div');
  footer.style.cssText = 'margin-top:20px;display:flex;gap:10px;justify-content:flex-end';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'hcm-btn';
  cancelBtn.textContent = '取消';
  cancelBtn.onclick = () => { currentView = 'list'; render(); };
  footer.appendChild(cancelBtn);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'hcm-btn hcm-btn-primary';
  saveBtn.textContent = '保存模板';
  saveBtn.onclick = () => {
    const name = nameInput.value.trim();
    if (!name) { toast('请输入模板名称', 'error'); return; }
    const prices = [];
    tbody.querySelectorAll('input').forEach(inp => {
      const idx = parseInt(inp.dataset.idx);
      prices.push({ country: data.prices[idx].country, price: inp.value.trim() });
    });

    const newTpl = { name, prices, updatedAt: new Date().toISOString() };
    if (editingIndex >= 0) {
      templates[editingIndex] = newTpl;
    } else {
      templates.push(newTpl);
    }
    saveTemplates(templates);
    toast('模板已保存');
    currentView = 'list';
    render();
  };
  footer.appendChild(saveBtn);

  frag.appendChild(footer);
  return frag;
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(s) {
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ==================== 启动 ====================
try {
  getLines(); // 先检查 DOM 是否存在
  render();
} catch(e) {
  alert('错误：' + e.message);
}

})();
