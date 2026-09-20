(() => {
  'use strict';

  const R = globalThis.TemuRules;
  const AI = globalThis.TemuAI;
  const ERP_EXTENSION_ID = 'ecofkipcicjifkppbgnkaghcfofmpkia';
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const randBetween = (min, max) => {
    min = Number(min) || 0; max = Number(max) || min;
    if (max < min) [min, max] = [max, min];
    return Math.round(min + Math.random() * Math.max(0, max - min));
  };

  const els = {
    keywords: $('keywords'), keywordsPrompt: $('keywordsPrompt'),
    filterRules: $('filterRules'), filterPrompt: $('filterPrompt'),
    limitRules: $('limitRules'), limitPrompt: $('limitPrompt'),
    saveBtn: $('saveBtn'), resetBtn: $('resetBtn'), scanBtn: $('scanBtn'),
    statusCard: $('statusCard'), statusTitle: $('statusTitle'), taskId: $('taskId'), progressBar: $('progressBar'), statusText: $('statusText'),
    resumeBtn: $('resumeBtn'), stopBtn: $('stopBtn'),
    resultsCard: $('resultsCard'), resultCounts: $('resultCounts'), resultList: $('resultList'), showExcluded: $('showExcluded'),
    selectAllBtn: $('selectAllBtn'), collectBtn: $('collectBtn'), exportBtn: $('exportBtn'),
    taskHistory: $('taskHistory'), loadTaskBtn: $('loadTaskBtn'), deleteTaskBtn: $('deleteTaskBtn'),
    erpSelector: $('erpSelector'), collectDelay: $('collectDelay'), navDelayMin: $('navDelayMin'), navDelayMax: $('navDelayMax'), detailDelayMin: $('detailDelayMin'), detailDelayMax: $('detailDelayMax'),
    aiMode: $('aiMode'), aiBadge: $('aiBadge'), aiServerUrl: $('aiServerUrl'), aiPhone: $('aiPhone'), aiLoginCode: $('aiLoginCode'), aiSendCodeBtn: $('aiSendCodeBtn'), aiLoginBtn: $('aiLoginBtn'), aiLogoutBtn: $('aiLogoutBtn'), aiRefreshModelsBtn: $('aiRefreshModelsBtn'), aiLoginState: $('aiLoginState'), aiModelSelect: $('aiModelSelect'), aiTestBtn: $('aiTestBtn'), aiTestResult: $('aiTestResult'),
    toast: $('toast')
  };

  let currentTask = null;
  let running = false;
  let stopRequested = false;
  let workingTabId = null;
  let aiGateway = { baseUrl: '', phone: '', token: '', user: null, channels: [], selectedModel: '' };

  const storageGet = keys => chrome.storage.local.get(keys);
  const storageSet = obj => chrome.storage.local.set(obj);

  function nowIso() { return new Date().toISOString(); }
  function taskId() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `T${stamp}-${rand}`;
  }

  function toast(msg, ms = 2200) {
    els.toast.textContent = msg;
    els.toast.classList.remove('hidden');
    setTimeout(() => els.toast.classList.add('hidden'), ms);
  }

  function setStatus(title, text, percent = null) {
    els.statusCard.classList.remove('hidden');
    els.statusTitle.textContent = title;
    els.statusText.textContent = text || '';
    els.taskId.textContent = currentTask?.id || '';
    if (percent != null) els.progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  }

  function setRunningUI(on) {
    running = on;
    els.scanBtn.disabled = on;
    els.collectBtn.disabled = on;
    els.stopBtn.classList.toggle('hidden', !on);
  }

  function selectedModelInfo(modelId = aiGateway.selectedModel) {
    for (const ch of aiGateway.channels || []) {
      for (const m of ch.models || []) if (m.id === modelId) return { ...m, channelId: ch.id, channelName: ch.name, protocol: ch.protocol };
    }
    return null;
  }

  function activeAiService(modelId = aiGateway.selectedModel) {
    if (!aiGateway.baseUrl || !aiGateway.token || !modelId) return null;
    return { baseUrl: aiGateway.baseUrl, token: aiGateway.token, model: modelId };
  }

  function aiBusinessEnabled(mode = els.aiMode?.value) {
    return mode === 'fallback' || mode === 'risk_required';
  }

  function updateAiBadge() {
    const mode = els.aiMode?.value || 'off';
    const info = selectedModelInfo();
    if (mode === 'off') {
      els.aiBadge.textContent = 'AI 关闭';
      els.aiBadge.title = '当前不会调用 AI Relay';
    } else if (!aiGateway.token) {
      els.aiBadge.textContent = 'AI：未登录';
      els.aiBadge.title = '请先登录 AI Relay';
    } else {
      els.aiBadge.textContent = mode === 'risk_required' ? 'AI：风控强制' : 'AI：按需';
      els.aiBadge.title = `${info?.channelName || ''} / ${info?.name || info?.model_id || aiGateway.selectedModel || '未选模型'}`;
    }
    els.aiLoginState.textContent = aiGateway.token
      ? `已登录：${aiGateway.user?.phone || aiGateway.phone || ''}${aiGateway.user?.ai_enabled === false ? '（AI 权限已暂停）' : ''}`
      : '未登录';
  }

  async function loadConfig() {
    const data = await storageGet(['formConfig', 'advancedConfig', 'aiConfig']);
    const cfg = data.formConfig || R.EXAMPLE;
    els.keywords.value = cfg.keywords || R.EXAMPLE.keywords;
    els.filterRules.value = cfg.filterRules || R.EXAMPLE.filterRules;
    els.limitRules.value = cfg.limitRules || R.EXAMPLE.limitRules;
    els.keywordsPrompt.value = cfg.keywordsPrompt || '';
    els.filterPrompt.value = cfg.filterPrompt || '';
    els.limitPrompt.value = cfg.limitPrompt || '';
    const adv = data.advancedConfig || {};
    els.erpSelector.value = adv.erpSelector || adv.miaoshouSelector || '';
    els.collectDelay.value = adv.collectDelay || 3500;
    els.navDelayMin.value = adv.navDelayMin || 3500;
    els.navDelayMax.value = adv.navDelayMax || 6500;
    els.detailDelayMin.value = adv.detailDelayMin || 2200;
    els.detailDelayMax.value = adv.detailDelayMax || 4500;

    const aic = data.aiConfig || {};
    aiGateway = {
      baseUrl: aic.baseUrl || 'http://localhost:8787',
      phone: aic.phone || '',
      token: aic.token || '',
      user: aic.user || null,
      channels: Array.isArray(aic.channels) ? aic.channels : [],
      selectedModel: aic.selectedModel || ''
    };
    els.aiMode.value = aic.mode || 'off';
    els.aiServerUrl.value = aiGateway.baseUrl;
    els.aiPhone.value = aiGateway.phone;
    refreshModelSelect();
    updateAiBadge();
    if (aiGateway.token) await refreshGatewaySession(false).catch(() => {});
  }

  async function saveConfig(showToast = true) {
    const formConfig = {
      keywords: els.keywords.value.trim(),
      keywordsPrompt: els.keywordsPrompt.value.trim(),
      filterRules: els.filterRules.value.trim(),
      filterPrompt: els.filterPrompt.value.trim(),
      limitRules: els.limitRules.value.trim(),
      limitPrompt: els.limitPrompt.value.trim()
    };
    const navMin = Math.max(1500, Math.min(60000, Number(els.navDelayMin.value) || 3500));
    const navMax = Math.max(navMin, Math.min(60000, Number(els.navDelayMax.value) || 6500));
    const detailMin = Math.max(1000, Math.min(60000, Number(els.detailDelayMin.value) || 2200));
    const detailMax = Math.max(detailMin, Math.min(60000, Number(els.detailDelayMax.value) || 4500));
    const advancedConfig = {
      erpSelector: els.erpSelector.value.trim(),
      collectDelay: Math.max(1000, Math.min(30000, Number(els.collectDelay.value) || 3500)),
      navDelayMin: navMin, navDelayMax: navMax,
      detailDelayMin: detailMin, detailDelayMax: detailMax,
      erpExtensionId: ERP_EXTENSION_ID
    };
    aiGateway.baseUrl = els.aiServerUrl.value.trim().replace(/\/+$/, '');
    aiGateway.phone = els.aiPhone.value.trim();
    aiGateway.selectedModel = els.aiModelSelect.value || aiGateway.selectedModel || '';
    const aiConfig = {
      mode: els.aiMode.value,
      baseUrl: aiGateway.baseUrl,
      phone: aiGateway.phone,
      token: aiGateway.token,
      user: aiGateway.user,
      channels: aiGateway.channels,
      selectedModel: aiGateway.selectedModel
    };
    await storageSet({ formConfig, advancedConfig, aiConfig });
    updateAiBadge();
    if (showToast) toast('配置已保存');
    return { formConfig, advancedConfig, aiConfig };
  }

  function refreshModelSelect() {
    const previous = aiGateway.selectedModel || els.aiModelSelect.value || '';
    els.aiModelSelect.innerHTML = '';
    let first = '';
    for (const ch of aiGateway.channels || []) {
      const group = document.createElement('optgroup');
      group.label = ch.name || ch.id;
      for (const m of ch.models || []) {
        const o = document.createElement('option');
        o.value = m.id;
        o.textContent = `${m.name || m.model_id}${m.capabilities?.vision ? ' · 视觉' : ''}`;
        if (!first) first = m.id;
        if (m.id === previous) o.selected = true;
        group.appendChild(o);
      }
      if (group.children.length) els.aiModelSelect.appendChild(group);
    }
    aiGateway.selectedModel = [...els.aiModelSelect.options].some(o => o.value === previous) ? previous : (first || '');
    if (aiGateway.selectedModel) els.aiModelSelect.value = aiGateway.selectedModel;
  }

  async function requestLoginCode() {
    const baseUrl = els.aiServerUrl.value.trim().replace(/\/+$/, '');
    const phone = els.aiPhone.value.trim();
    if (!baseUrl || !/^1[3-9]\d{9}$/.test(phone)) return toast('请填写 Relay 服务地址和正确手机号');
    els.aiLoginState.textContent = '正在发送验证码…';
    try {
      const data = await AI.requestCode(baseUrl, phone);
      aiGateway.baseUrl = baseUrl; aiGateway.phone = phone;
      if (data?.delivery?.dev_code) els.aiLoginState.textContent = `本地 DEV 验证码：${data.delivery.dev_code}`;
      else els.aiLoginState.textContent = '验证码已通过微信发送';
      await saveConfig(false);
    } catch (e) { els.aiLoginState.textContent = `发送失败：${e.message}`; }
  }

  async function loginGateway() {
    const baseUrl = els.aiServerUrl.value.trim().replace(/\/+$/, '');
    const phone = els.aiPhone.value.trim();
    const code = els.aiLoginCode.value.trim();
    if (!baseUrl || !/^1[3-9]\d{9}$/.test(phone) || !/^\d{6}$/.test(code)) return toast('请填写服务地址、手机号和 6 位验证码');
    els.aiLoginState.textContent = '登录中…';
    try {
      const data = await AI.verifyCode(baseUrl, phone, code);
      aiGateway = { ...aiGateway, baseUrl, phone, token: data.token || '', user: data.user || null };
      els.aiLoginCode.value = '';
      await refreshGatewaySession(false);
      await saveConfig(false);
      toast('AI Relay 登录成功');
    } catch (e) { els.aiLoginState.textContent = `登录失败：${e.message}`; }
  }

  async function refreshGatewaySession(showToast = true) {
    if (!aiGateway.token || !aiGateway.baseUrl) throw new Error('尚未登录 AI Relay');
    const service = { baseUrl: aiGateway.baseUrl, token: aiGateway.token };
    try {
      const [me, models] = await Promise.all([AI.getMe(service), AI.getModels(service)]);
      aiGateway.user = me.user || aiGateway.user;
      aiGateway.channels = models.channels || [];
      refreshModelSelect();
      await saveConfig(false);
      if (showToast) toast('模型列表已刷新');
      return models;
    } catch (e) {
      if (/登录|过期|unauthorized|session/i.test(e.message)) {
        aiGateway.token = ''; aiGateway.user = null; aiGateway.channels = []; aiGateway.selectedModel = '';
        refreshModelSelect(); await saveConfig(false);
      }
      updateAiBadge();
      throw e;
    }
  }

  async function logoutGateway() {
    const service = activeAiService() || { baseUrl: aiGateway.baseUrl, token: aiGateway.token };
    if (aiGateway.token && aiGateway.baseUrl) await AI.logout(service).catch(() => {});
    aiGateway.token = ''; aiGateway.user = null; aiGateway.channels = []; aiGateway.selectedModel = '';
    refreshModelSelect(); await saveConfig(false); updateAiBadge(); toast('已退出 AI Relay');
  }

  async function testAiGateway() {
    const service = activeAiService();
    els.aiTestResult.className = 'hint'; els.aiTestResult.textContent = '测试中…';
    if (!service) { els.aiTestResult.className = 'hint err'; els.aiTestResult.textContent = '请先登录并选择模型'; return; }
    try {
      const text = await AI.callText(service, '只返回 OK 两个字母。', '连通性测试。');
      els.aiTestResult.className = 'hint ok'; els.aiTestResult.textContent = `推理成功：${String(text || '').trim().slice(0, 100)}`;
    } catch (e) { els.aiTestResult.className = 'hint err'; els.aiTestResult.textContent = `推理失败：${e.message}`; }
  }

  async function getTasks() {
    const { tasks = [] } = await storageGet(['tasks']);
    return tasks;
  }

  async function saveTask(task) {
    task.updatedAt = nowIso();
    let tasks = await getTasks();
    const idx = tasks.findIndex(t => t.id === task.id);
    const copy = structuredClone(task);
    if (idx >= 0) tasks[idx] = copy; else tasks.unshift(copy);
    tasks = tasks.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 50);
    await storageSet({ tasks });
    currentTask = task;
    await refreshHistory();
  }

  async function refreshHistory() {
    const tasks = await getTasks();
    els.taskHistory.innerHTML = '';
    if (!tasks.length) {
      const opt = document.createElement('option');
      opt.textContent = '暂无任务'; opt.value = '';
      els.taskHistory.appendChild(opt); return;
    }
    for (const t of tasks) {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = `${t.id} · ${statusLabel(t.status)} · ${t.candidates?.length || 0}件`;
      if (currentTask?.id === t.id) opt.selected = true;
      els.taskHistory.appendChild(opt);
    }
  }

  function statusLabel(s) {
    return ({ scanning: '筛选中', paused: '已暂停', review: '待审核', collecting: '采集中', completed: '已完成', stopped: '已停止', error: '错误' })[s] || s || '未知';
  }

  async function activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  function isTemuUrl(url) {
    try { return /(^|\.)temu\.com$/i.test(new URL(url).hostname); } catch (_) { return false; }
  }

  async function waitTabReady(tabId, timeout = 25000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === 'complete' && isTemuUrl(tab.url || '')) {
          await sleep(700);
          const ping = await send(tabId, { type: 'PING' }, 4000);
          if (ping?.ok) return tab;
        }
      } catch (_) {}
      await sleep(350);
    }
    throw new Error('等待 Temu 页面加载超时');
  }

  async function send(tabId, message, timeout = 30000) {
    return Promise.race([
      chrome.tabs.sendMessage(tabId, message),
      new Promise((_, reject) => setTimeout(() => reject(new Error('页面响应超时')), timeout))
    ]);
  }

  async function ensureTemuTab(preferredTabId = null) {
    let tab = null;
    if (preferredTabId != null) tab = await chrome.tabs.get(preferredTabId).catch(() => null);
    if (!tab) tab = await activeTab();
    if (!tab) throw new Error('没有可用的浏览器标签页');
    workingTabId = tab.id;
    if (!isTemuUrl(tab.url || '')) {
      await chrome.tabs.update(tab.id, { url: 'https://www.temu.com/' });
      tab = await waitTabReady(tab.id);
    } else {
      await waitTabReady(tab.id, 8000).catch(() => {});
    }
    return tab;
  }

  async function waitAfterNavigation(tabId, beforeUrl, timeout = 20000) {
    const started = Date.now();
    let lastUrl = beforeUrl;
    while (Date.now() - started < timeout) {
      try {
        const tab = await chrome.tabs.get(tabId);
        lastUrl = tab.url || lastUrl;
        if (tab.status === 'complete') {
          await sleep(900);
          const ping = await send(tabId, { type: 'PING' }, 3500).catch(() => null);
          if (ping?.ok && (!beforeUrl || lastUrl !== beforeUrl || Date.now() - started > 2500)) return tab;
        }
      } catch (_) {}
      await sleep(350);
    }
    throw new Error('Temu 页面跳转/加载超时');
  }

  async function historyRegistry() {
    const { collectedRegistry = [] } = await storageGet(['collectedRegistry']);
    return collectedRegistry;
  }

  function findHistoricalDuplicate(item, registry, threshold) {
    const fp = R.fingerprint(item);
    if (fp.id && registry.some(x => x.id === fp.id)) return true;
    if (!fp.titleNorm) return false;
    return registry.some(x => x.titleNorm && R.diceSimilarity(fp.titleNorm, x.titleNorm) >= threshold);
  }

  function findTaskDuplicate(item, candidates, threshold) {
    for (const old of candidates) {
      if (old.decision === 'excluded' && old.excludeReasonType === 'duplicate') continue;
      if (item.productId && old.productId && item.productId === old.productId) return old;
      const sim = R.diceSimilarity(item.title || '', old.title || '');
      if (sim >= threshold) return old;
    }
    return null;
  }

  function candidateKey(item) { return item.productId || item.url; }

  function evaluateCandidate(item, filter, limits, registry, taskCandidates, stage = 'list') {
    const historicalDuplicate = limits.noHistoricalRepeat && findHistoricalDuplicate(item, registry, limits.dedupeThreshold);
    const dup = findTaskDuplicate(item, taskCandidates, limits.dedupeThreshold);
    const ev = R.evaluate(item, filter, limits, {
      historicalDuplicate,
      taskDuplicateOf: dup ? (dup.productId || dup.title?.slice(0, 40)) : null
    });
    return {
      ...item,
      key: candidateKey(item),
      decision: ev.decision,
      reasons: ev.reasons,
      unknown: ev.unknown,
      packCount: ev.packCount,
      stage,
      selected: ev.decision !== 'excluded',
      collected: false,
      collectedState: null,
      scannedAt: nowIso(),
      excludeReasonType: dup ? 'duplicate' : null
    };
  }

  async function startScan() {
    if (running) return;
    stopRequested = false;
    const { formConfig, advancedConfig, aiConfig } = await saveConfig(false);
    const keywords = R.splitLines(formConfig.keywords);
    if (!keywords.length) return toast('请至少填写一个搜索关键词');
    const filter = R.parseFilterRules(formConfig.filterRules);
    const limits = R.parseLimitRules(formConfig.limitRules);
    const service = activeAiService();
    const modelInfo = selectedModelInfo();
    const hasBackupPrompt = [formConfig.keywordsPrompt, formConfig.filterPrompt, formConfig.limitPrompt].some(v => String(v || '').trim());
    const needsAiNow = aiConfig.mode === 'risk_required' || (aiBusinessEnabled(aiConfig.mode) && hasBackupPrompt);
    if (needsAiNow && !service) return toast('当前 AI 模式需要 Relay，请先完成手机号登录并选择模型');
    if (aiConfig.mode === 'risk_required' && !modelInfo?.capabilities?.vision) return toast('“风控图形验证码必须用 AI”需要选择服务端标记为“视觉”的模型');

    currentTask = {
      id: taskId(), createdAt: nowIso(), updatedAt: nowIso(), status: 'scanning',
      config: {
        ...formConfig,
        parsedFilter: filter,
        parsedLimits: limits,
        advanced: advancedConfig,
        ai: {
          mode: aiConfig.mode,
          baseUrl: aiGateway.baseUrl,
          model: aiGateway.selectedModel,
          channelId: modelInfo?.channelId || '',
          channelName: modelInfo?.channelName || '',
          modelName: modelInfo?.name || modelInfo?.model_id || '',
          vision: !!modelInfo?.capabilities?.vision
        }
      },
      resolvedKeywords: null,
      aiUsage: { calls: 0, keywordCalls: 0, reviewCalls: 0, riskCalls: 0, errors: [] },
      cursor: { keywordIndex: 0, pageIndex: 0 }, candidates: [],
      log: [], error: null
    };
    await saveTask(currentTask);
    renderTask();
    await runScan(currentTask);
  }

  function taskAiService(task) {
    const model = task.config?.ai?.model || '';
    if (!model || !aiGateway.token || !aiGateway.baseUrl) return null;
    if (task.config?.ai?.baseUrl && task.config.ai.baseUrl !== aiGateway.baseUrl) return null;
    return { baseUrl: aiGateway.baseUrl, token: aiGateway.token, model };
  }

  async function analyzeAndPauseChallenge(task, tabId, phase, baseMessage) {
    let message = baseMessage;
    if (task.config?.ai?.mode === 'risk_required') {
      const service = taskAiService(task);
      const modelInfo = selectedModelInfo(task.config?.ai?.model);
      if (!service) {
        task.log.push({ at: nowIso(), type: 'risk-ai-required-but-unavailable', phase, error: 'AI Relay 登录会话不可用或服务地址已变化' });
        message += '\n当前模式要求风控图形验证必须调用 AI，但 Relay 登录会话不可用。请重新登录后再继续。';
      } else if (!modelInfo?.capabilities?.vision && !task.config?.ai?.vision) {
        task.log.push({ at: nowIso(), type: 'risk-ai-required-but-no-vision-model', phase, model: task.config?.ai?.model });
        message += '\n当前模式要求使用 AI，但任务绑定模型未标记视觉能力。请在服务端授权视觉模型并在插件中重新选择。';
      } else {
        setStatus('AI 识别风控验证', `模型：${task.config.ai.channelName || ''} / ${task.config.ai.modelName || task.config.ai.model}`, null);
        try {
          const tab = await chrome.tabs.get(tabId);
          await chrome.tabs.update(tabId, { active: true });
          await sleep(450);
          const pageInfo = await send(tabId, { type: 'GET_CHALLENGE_INFO' }, 5000).catch(() => ({ challenge: true }));
          const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 58 });
          const result = await AI.inspectRiskChallenge(service, screenshot, pageInfo || {});
          task.aiUsage = task.aiUsage || { calls: 0, keywordCalls: 0, reviewCalls: 0, riskCalls: 0, errors: [] };
          task.aiUsage.calls++; task.aiUsage.riskCalls = (task.aiUsage.riskCalls || 0) + 1;
          task.lastRiskChallenge = { ...result, phase, model: task.config.ai.model, at: nowIso() };
          task.log.push({ at: nowIso(), type: 'risk-ai-inspection', phase, model: task.config.ai.model, result });
          message += `\nAI 识别：${result.type}（置信度 ${Math.round((result.confidence || 0) * 100)}%）。${result.summary}\n请人工完成页面验证后点击“继续当前任务”。`;
        } catch (e) {
          task.aiUsage = task.aiUsage || { calls: 0, keywordCalls: 0, reviewCalls: 0, riskCalls: 0, errors: [] };
          task.aiUsage.errors.push({ at: nowIso(), stage: 'risk-challenge', error: String(e?.message || e) });
          task.log.push({ at: nowIso(), type: 'ai-error', stage: 'risk-challenge', phase, error: String(e?.message || e) });
          message += `\n当前模式要求调用 AI；本次 AI 识别失败：${String(e?.message || e)}。任务不会绕过验证，请先修复 AI 配置或人工完成验证后再继续。`;
        }
      }
    }
    return pauseTask(task, message, phase);
  }

  async function runScan(task) {
    setRunningUI(true);
    els.resumeBtn.classList.add('hidden');
    try {
      const tab = await ensureTemuTab(task.workingTabId || null);
      task.workingTabId = tab.id;
      const filter = task.config.parsedFilter || R.parseFilterRules(task.config.filterRules);
      const limits = task.config.parsedLimits || R.parseLimitRules(task.config.limitRules);
      const adv = task.config.advanced || { navDelayMin: 3500, navDelayMax: 6500, detailDelayMin: 2200, detailDelayMax: 4500 };
      const service = taskAiService(task);
      const explicitKeywords = R.splitLines(task.config.keywords);
      if (!task.resolvedKeywords) {
        let resolved = [...explicitKeywords];
        if (aiBusinessEnabled(task.config?.ai?.mode) && task.config.keywordsPrompt?.trim() && service) {
          setStatus('AI 补充搜索词', `使用模型：${task.config.ai.channelName || ''} / ${task.config.ai.modelName || task.config.ai.model}`, 1);
          try {
            const extra = await AI.expandKeywords(service, explicitKeywords, task.config.keywordsPrompt);
            task.aiUsage = task.aiUsage || { calls: 0, keywordCalls: 0, reviewCalls: 0, riskCalls: 0, errors: [] };
            task.aiUsage.calls++; task.aiUsage.keywordCalls++;
            for (const kw of extra) if (!resolved.some(x => x.toLowerCase() === kw.toLowerCase())) resolved.push(kw);
            task.log.push({ at: nowIso(), type: 'ai-keywords', model: task.config.ai.model, added: extra.length });
          } catch (e) {
            task.aiUsage.errors.push({ at: nowIso(), stage: 'keywords', error: String(e?.message || e) });
            task.log.push({ at: nowIso(), type: 'ai-error', stage: 'keywords', error: String(e?.message || e) });
          }
        }
        task.resolvedKeywords = resolved;
        await saveTask(task);
      }
      const keywords = task.resolvedKeywords || explicitKeywords;
      const registry = await historyRegistry();

      for (let ki = task.cursor?.keywordIndex || 0; ki < keywords.length; ki++) {
        if (stopRequested) throw new StopError();
        const kw = keywords[ki];
        task.cursor = { keywordIndex: ki, pageIndex: 0 };
        setStatus('正在搜索', `关键词 ${ki + 1}/${keywords.length}：${kw}`, (ki / keywords.length) * 70);
        const before = (await chrome.tabs.get(tab.id)).url;
        const sr = await send(tab.id, { type: 'SEARCH_KEYWORD', keyword: kw });
        if (sr?.challenge) return analyzeAndPauseChallenge(task, tab.id, 'scan', 'Temu 要求人机/安全验证。');
        if (!sr?.ok) throw new Error(sr?.error || '搜索失败');
        await waitAfterNavigation(tab.id, before).catch(async () => { await sleep(2200); });
        await sleep(randBetween(adv.navDelayMin, adv.navDelayMax));

        for (let pi = 0; pi < limits.maxPages; pi++) {
          if (stopRequested) throw new StopError();
          const keywordCount = task.candidates.filter(c => c.keyword === kw).length;
          const remainingForKeyword = limits.maxProductsPerKeyword - keywordCount;
          if (remainingForKeyword <= 0) break;
          task.cursor = { keywordIndex: ki, pageIndex: pi };
          setStatus('扫描商品列表', `关键词：${kw}\n第 ${pi + 1}/${limits.maxPages} 页/批次，正在滚动并提取商品…`, ((ki + (pi / limits.maxPages)) / keywords.length) * 70);
          const scan = await send(tab.id, { type: 'SCAN_RESULTS', options: { maxProducts: remainingForKeyword, maxScrolls: limits.maxScrollsPerPage } }, 45000);
          if (scan?.challenge) return analyzeAndPauseChallenge(task, tab.id, 'scan', '扫描过程中出现 Temu 人机/安全验证。');
          if (!scan?.ok) throw new Error(scan?.error || '扫描商品列表失败');

          let added = 0;
          for (const raw of scan.items || []) {
            if (task.candidates.some(c => c.key === candidateKey(raw))) continue;
            const cand = evaluateCandidate({ ...raw, keyword: kw, pageIndex: pi }, filter, limits, registry, task.candidates, 'list');
            task.candidates.push(cand); added++;
          }
          task.log.push({ at: nowIso(), type: 'scan-page', keyword: kw, pageIndex: pi, found: scan.items?.length || 0, added });
          await saveTask(task);
          renderTask();

          const reachedKeywordCap = task.candidates.filter(c => c.keyword === kw).length >= limits.maxProductsPerKeyword;
          if (reachedKeywordCap || !scan.hasNext || pi >= limits.maxPages - 1) break;
          const prev = (await chrome.tabs.get(tab.id)).url;
          const nx = await send(tab.id, { type: 'CLICK_NEXT' });
          if (nx?.challenge) return analyzeAndPauseChallenge(task, tab.id, 'scan', '翻页时出现 Temu 人机/安全验证。');
          if (!nx?.ok) break;
          await waitAfterNavigation(tab.id, prev).catch(async () => { await sleep(2200); });
          await sleep(randBetween(adv.navDelayMin, adv.navDelayMax));
        }

        task.cursor = { keywordIndex: ki + 1, pageIndex: 0 };
        await saveTask(task);
      }

      const detailCompleted = await verifyDetails(task, filter, limits, registry, adv);
      if (detailCompleted === false || task.status === 'paused') return;
      await verifyWithAI(task);
      if (task.status === 'paused') return;
      task.status = 'review'; task.cursor = null;
      await saveTask(task);
      setStatus('筛选完成', '请审核结果；确认后点击“执行采集”。', 100);
      renderTask();
    } catch (err) {
      if (err instanceof StopError) {
        task.status = 'stopped'; task.error = null;
        await saveTask(task);
        setStatus('已停止', '任务已停止，临时数据已归档。', 100);
      } else {
        task.status = 'error'; task.error = String(err?.message || err);
        await saveTask(task);
        setStatus('任务出错', task.error, 100);
      }
    } finally {
      setRunningUI(false);
      renderTask();
    }
  }

  async function verifyDetails(task, filter, limits, registry, adv) {
    const pending = task.candidates.filter(c => c.decision === 'review').slice(0, limits.maxDetails);
    if (!pending.length) return true;
    for (let i = 0; i < pending.length; i++) {
      if (stopRequested) throw new StopError();
      const cand = pending[i];
      setStatus('打开详情确认', `${i + 1}/${pending.length}：${cand.title.slice(0, 70)}`, 70 + ((i + 1) / pending.length) * 25);
      let tab, keepTab = false;
      try {
        tab = await chrome.tabs.create({ url: cand.url, active: false });
        await waitTabReady(tab.id, 22000);
        const detail = await send(tab.id, { type: 'GET_DETAIL' }, 12000);
        if (detail?.challenge) {
          task.log.push({ at: nowIso(), type: 'detail-challenge', productId: cand.productId });
          keepTab = true;
          task.challengeTemporaryTabId = tab.id;
          await analyzeAndPauseChallenge(task, tab.id, 'scan', `商品详情页出现 Temu 风控图形验证：${cand.title.slice(0, 60)}`);
          return false;
        }
        if (!detail?.ok) continue;
        const merged = { ...cand, ...detail, title: detail.title || cand.title, image: cand.image };
        const others = task.candidates.filter(x => x.key !== cand.key);
        const reevaluated = evaluateCandidate(merged, filter, limits, registry, others, 'detail');
        Object.assign(cand, reevaluated, { key: candidateKey(cand), selected: reevaluated.decision !== 'excluded' });
      } catch (e) {
        task.log.push({ at: nowIso(), type: 'detail-error', productId: cand.productId, error: String(e?.message || e) });
      } finally {
        if (tab?.id && !keepTab) await chrome.tabs.remove(tab.id).catch(() => {});
      }
      await sleep(randBetween(adv?.detailDelayMin || 2200, adv?.detailDelayMax || 4500));
      await saveTask(task);
      renderTask();
    }
    return true;
  }

  async function verifyWithAI(task) {
    if (!aiBusinessEnabled(task.config?.ai?.mode)) return;
    const filterPrompt = task.config.filterPrompt?.trim() || '';
    const limitPrompt = task.config.limitPrompt?.trim() || '';
    if (!filterPrompt && !limitPrompt) return;
    const service = taskAiService(task);
    if (!service) {
      task.log.push({ at: nowIso(), type: 'ai-skip', reason: '任务绑定的 AI Relay 登录会话不可用' });
      return;
    }
    const maxReviews = task.config?.parsedLimits?.maxDetails ?? 20;
    const pending = task.candidates.filter(c => c.decision === 'review' && !c.aiReview).slice(0, maxReviews);
    for (let i = 0; i < pending.length; i++) {
      if (stopRequested) throw new StopError();
      const cand = pending[i];
      setStatus('AI 兜底复核', `${i + 1}/${pending.length} · ${task.config.ai.channelName || ''} / ${task.config.ai.modelName || task.config.ai.model}\n${cand.title.slice(0, 75)}`, 95 + ((i + 1) / Math.max(1, pending.length)) * 4);
      try {
        const result = await AI.reviewCandidate(service, cand, { filterPrompt, limitPrompt });
        task.aiUsage = task.aiUsage || { calls: 0, keywordCalls: 0, reviewCalls: 0, riskCalls: 0, errors: [] };
        task.aiUsage.calls++; task.aiUsage.reviewCalls++;
        cand.aiReview = { ...result, channel: task.config.ai.channelName, model: task.config.ai.model, at: nowIso() };
        cand.decision = result.decision;
        cand.selected = result.decision !== 'excluded';
        cand.reasons = [...(cand.reasons || []), ...(result.reasons || []).map(x => `AI兜底：${x}`)];
        if (result.decision !== 'review') cand.unknown = [];
        task.log.push({ at: nowIso(), type: 'ai-review', productId: cand.productId, decision: result.decision, confidence: result.confidence, model: task.config.ai.model });
      } catch (e) {
        task.aiUsage = task.aiUsage || { calls: 0, keywordCalls: 0, reviewCalls: 0, riskCalls: 0, errors: [] };
        task.aiUsage.errors.push({ at: nowIso(), stage: 'review', productId: cand.productId, error: String(e?.message || e) });
        cand.aiReview = { error: String(e?.message || e), at: nowIso() };
        task.log.push({ at: nowIso(), type: 'ai-error', stage: 'review', productId: cand.productId, error: String(e?.message || e) });
      }
      await saveTask(task);
      renderTask();
      await sleep(350);
    }
  }

  async function pauseTask(task, message, phase = 'scan') {
    task.status = 'paused'; task.error = message; task.pausePhase = phase;
    await saveTask(task);
    setStatus('已暂停', message, null);
    els.resumeBtn.classList.remove('hidden');
    setRunningUI(false);
    renderTask();
  }

  async function resumeTask() {
    if (!currentTask || currentTask.status !== 'paused') return;
    const phase = currentTask.pausePhase || 'scan';
    if (currentTask.challengeTemporaryTabId) {
      await chrome.tabs.remove(currentTask.challengeTemporaryTabId).catch(() => {});
      currentTask.challengeTemporaryTabId = null;
    }
    currentTask.error = null; currentTask.pausePhase = null;
    if (phase === 'collect') {
      currentTask.status = 'review';
      await saveTask(currentTask);
      return collectSelected();
    }
    currentTask.status = 'scanning';
    await saveTask(currentTask);
    await runScan(currentTask);
  }

  async function collectSelected() {
    if (running || !currentTask) return;
    const selected = currentTask.candidates.filter(c => c.selected && c.decision !== 'excluded' && !c.collected);
    if (!selected.length) return toast('没有选中的待采集商品');
    const { advancedConfig = {} } = await storageGet(['advancedConfig']);
    const delay = Math.max(1000, Number(advancedConfig.collectDelay) || 3500);
    const selector = advancedConfig.erpSelector || advancedConfig.miaoshouSelector || '';
    stopRequested = false;
    setRunningUI(true);
    currentTask.status = 'collecting';
    await saveTask(currentTask);

    try {
      const tab = await ensureTemuTab(currentTask.workingTabId || null);
      currentTask.workingTabId = tab.id;
      for (let i = 0; i < selected.length; i++) {
        if (stopRequested) throw new StopError();
        const item = selected[i];
        setStatus('执行跨境ERP助手采集', `${i + 1}/${selected.length}：${item.title.slice(0, 70)}`, (i / selected.length) * 100);
        await chrome.tabs.update(tab.id, { url: item.url, active: true });
        await waitTabReady(tab.id, 25000);
        const challenge = await send(tab.id, { type: 'CHECK_CHALLENGE' });
        if (challenge?.challenge) {
          return analyzeAndPauseChallenge(currentTask, tab.id, 'collect', '采集过程中出现 Temu 人机/安全验证。已完成商品不会重复执行。');
        }
        const res = await send(tab.id, { type: 'TRIGGER_ERP', options: { customSelector: selector, extensionId: ERP_EXTENSION_ID } }, 12000);
        if (!res?.ok) {
          item.collectedState = 'failed'; item.collectError = res?.error || '未找到跨境ERP助手采集按钮';
          currentTask.log.push({ at: nowIso(), type: 'collect-failed', productId: item.productId, error: item.collectError });
          await saveTask(currentTask);
          renderTask();
          // Stop on adapter failure to avoid silently skipping a batch.
          currentTask.status = 'paused'; currentTask.error = item.collectError; currentTask.pausePhase = 'adapter';
          await saveTask(currentTask);
          setStatus('跨境ERP助手适配已暂停', `${item.collectError}\n已完成的商品不会重复执行。`, (i / selected.length) * 100);
          els.resumeBtn.classList.add('hidden');
          return;
        }
        item.collected = true;
        item.collectedState = res.confirmed ? 'confirmed' : 'triggered';
        item.collectedAt = nowIso();
        currentTask.log.push({ at: nowIso(), type: 'collect-triggered', productId: item.productId, confirmed: !!res.confirmed });
        await addRegistry(item, currentTask.id);
        await saveTask(currentTask);
        renderTask();
        await sleep(delay);
      }
      currentTask.status = 'completed'; currentTask.error = null;
      await saveTask(currentTask);
      setStatus('采集执行完成', '已对所有选中商品触发跨境ERP助手采集入口。ERP 后台入库结果请在跨境ERP助手中查看。', 100);
    } catch (err) {
      if (err instanceof StopError) {
        currentTask.status = 'stopped';
        await saveTask(currentTask);
        setStatus('已停止', '采集已停止，已完成商品已写入历史去重记录。', 100);
      } else {
        currentTask.status = 'error'; currentTask.error = String(err?.message || err);
        await saveTask(currentTask);
        setStatus('采集出错', currentTask.error, 100);
      }
    } finally {
      setRunningUI(false);
      renderTask();
    }
  }

  async function addRegistry(item, taskId) {
    const { collectedRegistry = [] } = await storageGet(['collectedRegistry']);
    const fp = R.fingerprint(item);
    if (!collectedRegistry.some(x => fp.id && x.id === fp.id)) {
      collectedRegistry.unshift({ ...fp, taskId, collectedAt: nowIso(), url: item.url, title: item.title });
    }
    await storageSet({ collectedRegistry: collectedRegistry.slice(0, 10000) });
  }

  function renderTask() {
    if (!currentTask) {
      els.resultsCard.classList.add('hidden');
      return;
    }
    els.statusCard.classList.remove('hidden');
    els.taskId.textContent = currentTask.id;
    const cands = currentTask.candidates || [];
    if (cands.length) els.resultsCard.classList.remove('hidden');

    const pass = cands.filter(c => c.decision === 'pass').length;
    const review = cands.filter(c => c.decision === 'review').length;
    const excluded = cands.filter(c => c.decision === 'excluded').length;
    const collected = cands.filter(c => c.collected).length;
    els.resultCounts.textContent = `通过 ${pass} · 待确认 ${review} · 排除 ${excluded} · 已触发采集 ${collected} · AI ${currentTask.aiUsage?.calls || 0} 次`;

    els.resultList.innerHTML = '';
    const showExcluded = els.showExcluded.checked;
    for (const c of cands) {
      if (c.decision === 'excluded' && !showExcluded) continue;
      const item = document.createElement('div');
      item.className = `result-item ${c.decision === 'excluded' ? 'excluded' : ''}`;
      const chk = document.createElement('input');
      chk.type = 'checkbox'; chk.checked = !!c.selected; chk.disabled = c.decision === 'excluded' || c.collected;
      chk.addEventListener('change', async () => { c.selected = chk.checked; await saveTask(currentTask); });
      const img = document.createElement('img');
      img.src = c.image || ''; img.alt = ''; img.referrerPolicy = 'no-referrer';
      img.onerror = () => { img.style.visibility = 'hidden'; };
      const info = document.createElement('div');
      const title = document.createElement('div'); title.className = 'result-title'; title.textContent = c.title || '(无标题)';
      const badges = document.createElement('div'); badges.className = 'badges';
      badges.appendChild(badge(c.decision === 'pass' ? '通过' : c.decision === 'review' ? '需人工确认' : '已排除', c.decision));
      if (c.stage === 'detail') badges.appendChild(badge('已查详情', 'review'));
      if (c.aiReview && !c.aiReview.error) badges.appendChild(badge(`AI ${Math.round((c.aiReview.confidence || 0) * 100)}%`, 'review'));
      if (c.collected) badges.appendChild(badge(c.collectedState === 'confirmed' ? 'ERP已确认' : '已触发ERP', 'collected'));
      const reasons = document.createElement('div'); reasons.className = 'reasons';
      const rs = [...(c.reasons || []), ...(c.unknown || [])];
      reasons.textContent = rs.length ? rs.join('；') : '规则检查通过';
      const meta = document.createElement('div'); meta.className = 'item-meta';
      const bits = [c.keyword ? `关键词：${c.keyword}` : '', c.packCount ? `${c.packCount}片` : '', c.price != null ? `价格 ${c.price}` : '', c.sold != null ? `已售 ${c.sold}` : '', c.rating != null ? `评分 ${c.rating}` : ''].filter(Boolean);
      meta.textContent = bits.join(' · ');
      const actions = document.createElement('div'); actions.className = 'item-actions';
      const link = document.createElement('a'); link.href = c.url; link.target = '_blank'; link.rel = 'noreferrer'; link.textContent = '打开商品详情'; actions.appendChild(link);
      info.append(title, badges, reasons, meta, actions);
      item.append(chk, img, info);
      els.resultList.appendChild(item);
    }

    els.resumeBtn.classList.toggle('hidden', currentTask.status !== 'paused' || currentTask.pausePhase === 'adapter');
    els.collectBtn.disabled = running || !cands.some(c => c.selected && c.decision !== 'excluded' && !c.collected);
  }

  function badge(text, cls) {
    const b = document.createElement('span'); b.className = `badge ${cls}`; b.textContent = text; return b;
  }

  async function loadTaskById(id) {
    const tasks = await getTasks();
    const t = tasks.find(x => x.id === id);
    if (!t) return;
    currentTask = structuredClone(t);
    renderTask();
    els.statusCard.classList.remove('hidden');
    setStatus(statusLabel(t.status), t.error || `任务创建于 ${new Date(t.createdAt).toLocaleString()}`, t.status === 'completed' || t.status === 'review' ? 100 : null);
  }

  async function deleteCurrentTask() {
    const id = els.taskHistory.value;
    if (!id) return;
    let tasks = await getTasks();
    tasks = tasks.filter(t => t.id !== id);
    await storageSet({ tasks });
    if (currentTask?.id === id) currentTask = null;
    await refreshHistory(); renderTask(); toast('任务已删除');
  }

  function exportTask() {
    if (!currentTask) return;
    const blob = new Blob([JSON.stringify(currentTask, null, 2)], { type: 'application/json;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `${currentTask.id}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  class StopError extends Error {}

  els.saveBtn.addEventListener('click', () => saveConfig(true));
  els.resetBtn.addEventListener('click', async () => {
    els.keywords.value = R.EXAMPLE.keywords; els.filterRules.value = R.EXAMPLE.filterRules; els.limitRules.value = R.EXAMPLE.limitRules;
    els.keywordsPrompt.value = ''; els.filterPrompt.value = ''; els.limitPrompt.value = '';
    await saveConfig(false); toast('已恢复示例配置');
  });
  els.scanBtn.addEventListener('click', startScan);
  els.resumeBtn.addEventListener('click', resumeTask);
  els.stopBtn.addEventListener('click', () => { stopRequested = true; toast('正在停止当前步骤…'); });
  els.showExcluded.addEventListener('change', renderTask);
  els.selectAllBtn.addEventListener('click', async () => {
    if (!currentTask) return;
    currentTask.candidates.forEach(c => { if (c.decision !== 'excluded' && !c.collected) c.selected = true; });
    await saveTask(currentTask); renderTask();
  });
  els.collectBtn.addEventListener('click', collectSelected);
  els.exportBtn.addEventListener('click', exportTask);
  els.loadTaskBtn.addEventListener('click', () => loadTaskById(els.taskHistory.value));
  els.deleteTaskBtn.addEventListener('click', deleteCurrentTask);

  for (const el of [els.erpSelector, els.collectDelay, els.navDelayMin, els.navDelayMax, els.detailDelayMin, els.detailDelayMax]) {
    el.addEventListener('change', () => saveConfig(false));
  }
  els.aiMode.addEventListener('change', () => saveConfig(false));
  els.aiServerUrl.addEventListener('change', () => saveConfig(false));
  els.aiPhone.addEventListener('change', () => saveConfig(false));
  els.aiModelSelect.addEventListener('change', async () => {
    aiGateway.selectedModel = els.aiModelSelect.value;
    updateAiBadge();
    await saveConfig(false);
  });
  els.aiSendCodeBtn.addEventListener('click', requestLoginCode);
  els.aiLoginBtn.addEventListener('click', loginGateway);
  els.aiLogoutBtn.addEventListener('click', logoutGateway);
  els.aiRefreshModelsBtn.addEventListener('click', () => refreshGatewaySession(true).catch(e => toast(`刷新失败：${e.message}`)));
  els.aiTestBtn.addEventListener('click', testAiGateway);

  (async function init() {
    await loadConfig();
    await refreshHistory();
    const tasks = await getTasks();
    if (tasks.length) await loadTaskById(tasks[0].id);
  })();
})();
