// SPDX-License-Identifier: AGPL-3.0-only

const MODULE_NAME = 'reasoningContentExtractor';
const EXTENSION_PATH = getExtensionPath();

const defaultSettings = Object.freeze({
  enabled: true,
  onlyEmptyMessages: true,
  removeExtractedBlock: true,
  keepWrapper: true,
  emitMessageUpdated: true,
  mode: 'tag',
  tagName: 'content',
  regex: '<\\/(?:think|thinking)>\\s*([\\s\\S]*?)$',
  regexFlags: 'i',
});

let suppressMessageUpdated = false;
let saveChatTimer = null;

function getContext() {
  const context = globalThis.SillyTavern?.getContext?.() ?? globalThis.SillyTavern;
  if (!context) {
    throw new Error('[Reasoning Content Extractor] SillyTavern context is not available.');
  }
  return context;
}

function saveChatDebounced() {
  if (saveChatTimer) {
    clearTimeout(saveChatTimer);
  }

  saveChatTimer = setTimeout(() => {
    saveChatTimer = null;
    void getContext().saveChat?.();
  }, 1000);
}

function syncMesToSwipe(messageId) {
  const message = getContext().chat?.[messageId];
  if (!message || !Array.isArray(message.swipes)) {
    return;
  }

  const swipeId = Number(message.swipe_id ?? 0);
  if (!Number.isInteger(swipeId) || swipeId < 0 || swipeId >= message.swipes.length) {
    return;
  }

  message.swipes[swipeId] = message.mes;
}

function getExtensionPath() {
  const marker = '/scripts/extensions/';
  const directory = new URL('.', import.meta.url).pathname.replace(/\/$/, '');
  const markerIndex = directory.indexOf(marker);

  if (markerIndex === -1) {
    return 'third-party/reasoning-content-extractor';
  }

  return decodeURIComponent(directory.slice(markerIndex + marker.length));
}

function getSettings() {
  const extensionSettings = getContext().extensionSettings;
  if (!extensionSettings[MODULE_NAME] || typeof extensionSettings[MODULE_NAME] !== 'object') {
    extensionSettings[MODULE_NAME] = {};
  }

  return Object.assign(extensionSettings[MODULE_NAME], {
    ...defaultSettings,
    ...extensionSettings[MODULE_NAME],
  });
}

function saveSettings() {
  getContext().saveSettingsDebounced();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isBlankVisibleMessage(message) {
  const text = String(message?.mes ?? '').trim();
  return text === '' || text === '...';
}

function getTagNames(value) {
  const source = String(value ?? '').trim() || defaultSettings.tagName;
  const seen = new Set();
  const tagNames = [];
  const invalidTagNames = [];

  for (const part of source.split(/[\n,，]+/)) {
    const tagName = part.trim();
    if (!tagName) {
      continue;
    }

    if (!/^[A-Za-z][A-Za-z0-9:_-]*$/.test(tagName)) {
      invalidTagNames.push(tagName);
      continue;
    }

    const key = tagName.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      tagNames.push(tagName);
    }
  }

  if (invalidTagNames.length > 0) {
    console.warn('[Reasoning Content Extractor] Ignoring invalid tag names:', invalidTagNames);
  }

  return tagNames;
}

function buildExtractor(settings) {
  if (settings.mode === 'regex') {
    const pattern = String(settings.regex ?? '').trim();
    if (!pattern) {
      return null;
    }

    try {
      return {
        regex: new RegExp(pattern, String(settings.regexFlags ?? '')),
        contentGroup: 1,
      };
    } catch (error) {
      console.warn('[Reasoning Content Extractor] Invalid custom regex.', error);
      return null;
    }
  }

  const tagNames = getTagNames(settings.tagName);
  if (!tagNames.length) {
    console.warn('[Reasoning Content Extractor] No valid tag names configured.');
    return null;
  }

  const escapedTagNames = tagNames.map(escapeRegex).join('|');
  return {
    regex: new RegExp(`<\\s*(${escapedTagNames})\\b[^>]*>([\\s\\S]*?)<\\s*\\/\\s*\\1\\s*>`, 'gi'),
    contentGroup: 2,
  };
}

function collectMatches(reasoning, extractor) {
  const matches = [];
  extractor.regex.lastIndex = 0;

  if (!extractor.regex.global) {
    const match = extractor.regex.exec(reasoning);
    return match ? [match] : [];
  }

  let match;
  while ((match = extractor.regex.exec(reasoning)) !== null) {
    matches.push(match);

    if (match[0] === '') {
      extractor.regex.lastIndex++;
    }
  }

  return matches;
}

function removeMatches(reasoning, matches) {
  let cursor = 0;
  let remaining = '';

  for (const match of matches) {
    remaining += reasoning.slice(cursor, match.index);
    cursor = match.index + match[0].length;
  }

  remaining += reasoning.slice(cursor);
  return remaining.trim();
}

function extractFromReasoning(reasoning, settings) {
  const extractor = buildExtractor(settings);
  if (!extractor) {
    return null;
  }

  const matches = collectMatches(reasoning, extractor);
  if (!matches.length) {
    return null;
  }

  const extractedParts = matches
    .map(match => String(settings.keepWrapper ? match[0] : (match[extractor.contentGroup] ?? match[0] ?? '')).trim())
    .filter(Boolean);

  if (!extractedParts.length) {
    return null;
  }

  const remaining = settings.removeExtractedBlock
    ? removeMatches(reasoning, matches)
    : reasoning;

  return { extracted: extractedParts.join('\n\n'), remaining };
}

function hasRenderedMessage(messageId) {
  return document.querySelector(`#chat .mes[mesid="${messageId}"]`) !== null;
}

function isMvuExtraAnalysisMode() {
  const getVariables = globalThis.TavernHelper?.getVariables;
  if (typeof getVariables !== 'function') {
    return false;
  }

  const mvuSettings = getVariables({ type: 'extension', extension_id: 'mvu_settings' });
  if (!mvuSettings || typeof mvuSettings !== 'object') {
    return false;
  }

  return mvuSettings['更新方式'] !== '随AI输出';
}

function isMvuExtraAnalysisRunning() {
  return typeof globalThis.Mvu?.isDuringExtraAnalysis === 'function' && Boolean(globalThis.Mvu.isDuringExtraAnalysis());
}

async function emitMessageUpdated(messageId) {
  const context = getContext();
  suppressMessageUpdated = true;
  try {
    await context.eventSource.emit(context.eventTypes.MESSAGE_UPDATED, messageId);
  } finally {
    suppressMessageUpdated = false;
  }
}

async function repairMessage(messageId, { render = true, save = false, emit = true } = {}) {
  const settings = getSettings();
  if (!settings.enabled || isMvuExtraAnalysisRunning()) {
    return false;
  }

  const context = getContext();
  const message = context.chat[messageId];
  if (!message || message.is_user || message.is_system) {
    return false;
  }

  if (settings.onlyEmptyMessages && !isBlankVisibleMessage(message)) {
    return false;
  }

  if (!message.extra || typeof message.extra !== 'object') {
    return false;
  }

  const reasoning = String(message.extra.reasoning ?? '');
  if (!reasoning) {
    return false;
  }

  const result = extractFromReasoning(reasoning, settings);
  if (!result) {
    return false;
  }

  message.mes = result.extracted;
  message.extra.reasoning = result.remaining;
  delete message.extra.display_text;
  delete message.extra.reasoning_display_text;

  if (!message.extra.reasoning) {
    delete message.extra.reasoning_type;
    delete message.extra.reasoning_duration;
  }

  syncMesToSwipe(Number(messageId));

  if (render && hasRenderedMessage(messageId)) {
    context.updateMessageBlock(Number(messageId), message);
  }

  if (save) {
    saveChatDebounced();
  }

  if (emit && settings.emitMessageUpdated) {
    queueMicrotask(() => void emitMessageUpdated(Number(messageId)));
  }

  console.debug('[Reasoning Content Extractor] Repaired message', messageId);
  return true;
}

async function repairLatest({ save = true } = {}) {
  const context = getContext();
  for (let i = context.chat.length - 1; i >= 0; i--) {
    if (await repairMessage(i, { render: true, save, emit: true })) {
      return 1;
    }
  }
  return 0;
}

async function repairCurrentChat() {
  const context = getContext();
  let count = 0;
  for (let i = 0; i < context.chat.length; i++) {
    if (await repairMessage(i, { render: true, save: false, emit: true })) {
      count++;
    }
  }

  if (count > 0) {
    await context.saveChat();
  }

  return count;
}

function updateModeVisibility() {
  const settings = getSettings();
  $('#rce_tag_settings').toggle(settings.mode === 'tag');
  $('#rce_regex_settings').toggle(settings.mode === 'regex');
}

function bindSettingsUi() {
  const settings = getSettings();

  $('#rce_enabled')
    .prop('checked', settings.enabled)
    .on('change', function () {
      settings.enabled = Boolean($(this).prop('checked'));
      saveSettings();
    });

  $('#rce_only_empty')
    .prop('checked', settings.onlyEmptyMessages)
    .on('change', function () {
      settings.onlyEmptyMessages = Boolean($(this).prop('checked'));
      saveSettings();
    });

  $('#rce_remove_block')
    .prop('checked', settings.removeExtractedBlock)
    .on('change', function () {
      settings.removeExtractedBlock = Boolean($(this).prop('checked'));
      saveSettings();
    });

  $('#rce_keep_wrapper')
    .prop('checked', settings.keepWrapper)
    .on('change', function () {
      settings.keepWrapper = Boolean($(this).prop('checked'));
      saveSettings();
    });

  $('#rce_emit_update')
    .prop('checked', settings.emitMessageUpdated)
    .on('change', function () {
      settings.emitMessageUpdated = Boolean($(this).prop('checked'));
      saveSettings();
    });

  $('#rce_mode')
    .val(settings.mode)
    .on('change', function () {
      settings.mode = String($(this).val()) === 'regex' ? 'regex' : 'tag';
      updateModeVisibility();
      saveSettings();
    });

  $('#rce_tag_name')
    .val(settings.tagName)
    .on('input', function () {
      settings.tagName = String($(this).val() || defaultSettings.tagName);
      saveSettings();
    });

  $('#rce_regex')
    .val(settings.regex)
    .on('input', function () {
      settings.regex = String($(this).val());
      saveSettings();
    });

  $('#rce_regex_flags')
    .val(settings.regexFlags)
    .on('input', function () {
      settings.regexFlags = String($(this).val());
      saveSettings();
    });

  $('#rce_repair_latest').on('click', async () => {
    const count = await repairLatest();
    $('#rce_status').text(count ? `已修复 ${count} 条消息。` : '未找到可修复的最新消息。');
  });

  $('#rce_repair_chat').on('click', async () => {
    const count = await repairCurrentChat();
    $('#rce_status').text(count ? `已修复 ${count} 条消息。` : '未找到可修复的消息。');
  });

  updateModeVisibility();
}

function registerEventHandlers() {
  const context = getContext();
  const earlyRepair = messageId => void repairMessage(Number(messageId), { render: true, save: false, emit: true });
  const renderedRepair = messageId => void repairMessage(Number(messageId), { render: true, save: false, emit: true });
  const savedRepair = messageId => void repairMessage(Number(messageId), { render: true, save: true, emit: true });
  const reasoningDoneRepair = (_reasoning, _duration, messageId, state) => {
    if (!isMvuExtraAnalysisMode() || (state !== 'done' && state !== 'hidden')) {
      return;
    }
    void repairMessage(Number(messageId), { render: false, save: true, emit: true });
  };

  context.eventSource.makeFirst(context.eventTypes.MESSAGE_RECEIVED, earlyRepair);
  context.eventSource.makeFirst(context.eventTypes.STREAM_REASONING_DONE, reasoningDoneRepair);
  context.eventSource.makeLast(context.eventTypes.CHARACTER_MESSAGE_RENDERED, renderedRepair);
  context.eventSource.on(context.eventTypes.MESSAGE_SWIPED, savedRepair);
  context.eventSource.on(context.eventTypes.MESSAGE_REASONING_EDITED, savedRepair);
  context.eventSource.on(context.eventTypes.MESSAGE_UPDATED, messageId => {
    if (suppressMessageUpdated) {
      return;
    }
    savedRepair(messageId);
  });
}

jQuery(async () => {
  const context = getContext();
  getSettings();
  const html = await context.renderExtensionTemplateAsync(EXTENSION_PATH, 'index');
  $('#extensions_settings2').append(html);
  bindSettingsUi();
  registerEventHandlers();
  console.debug('[Reasoning Content Extractor] Loaded.');
});
