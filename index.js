// SPDX-License-Identifier: AGPL-3.0-only

import {
    saveChatDebounced,
    syncMesToSwipe,
} from '../../../../script.js';
import {
    extension_settings,
    getContext,
    renderExtensionTemplateAsync,
} from '../../../extensions.js';

const MODULE_NAME = 'reasoningContentExtractor';
const EXTENSION_PATH = getExtensionPath();

const defaultSettings = Object.freeze({
    enabled: true,
    onlyEmptyMessages: true,
    removeExtractedBlock: true,
    keepWrapper: false,
    emitMessageUpdated: true,
    mode: 'regex',
    tagName: 'content',
    regex: '</think>\\s*([\\s\\S]*)$',
    regexFlags: 'i',
});

let suppressMessageUpdated = false;

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
    if (!extension_settings[MODULE_NAME] || typeof extension_settings[MODULE_NAME] !== 'object') {
        extension_settings[MODULE_NAME] = {};
    }

    return Object.assign(extension_settings[MODULE_NAME], {
        ...defaultSettings,
        ...extension_settings[MODULE_NAME],
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

function buildExtractor(settings) {
    if (settings.mode === 'regex') {
        const pattern = String(settings.regex ?? '').trim();
        if (!pattern) {
            return null;
        }

        try {
            return new RegExp(pattern, String(settings.regexFlags ?? ''));
        } catch (error) {
            console.warn('[Reasoning Content Extractor] Invalid custom regex.', error);
            return null;
        }
    }

    const tagName = String(settings.tagName || defaultSettings.tagName).trim();
    if (!/^[A-Za-z][A-Za-z0-9:_-]*$/.test(tagName)) {
        console.warn('[Reasoning Content Extractor] Invalid tag name:', tagName);
        return null;
    }

    const escapedTagName = escapeRegex(tagName);
    return new RegExp(`<\\s*${escapedTagName}\\b[^>]*>([\\s\\S]*?)<\\s*\\/\\s*${escapedTagName}\\s*>`, 'i');
}

function extractFromReasoning(reasoning, settings) {
    const extractor = buildExtractor(settings);
    if (!extractor) {
        return null;
    }

    const match = extractor.exec(reasoning);
    if (!match) {
        return null;
    }

    const extracted = String(settings.keepWrapper ? match[0] : (match[1] ?? match[0] ?? '')).trim();
    if (!extracted) {
        return null;
    }

    const remaining = settings.removeExtractedBlock
        ? `${reasoning.slice(0, match.index)}${reasoning.slice(match.index + match[0].length)}`.trim()
        : reasoning;

    return { extracted, remaining };
}

function hasRenderedMessage(messageId) {
    return document.querySelector(`#chat .mes[mesid="${messageId}"]`) !== null;
}

async function emitRepairEvents(messageId) {
    const context = getContext();
    suppressMessageUpdated = true;
    try {
        await context.eventSource.emit(context.eventTypes.MESSAGE_UPDATED, messageId);
        await context.eventSource.emit(context.eventTypes.MESSAGE_REASONING_EDITED, messageId);
    } finally {
        suppressMessageUpdated = false;
    }
}

async function repairMessage(messageId, {
    render = true,
    save = false,
    emit = true,
} = {}) {
    const settings = getSettings();
    if (!settings.enabled) {
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
        queueMicrotask(() => void emitRepairEvents(Number(messageId)));
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

    $('#rce_enabled').prop('checked', settings.enabled).on('change', function () {
        settings.enabled = Boolean($(this).prop('checked'));
        saveSettings();
    });

    $('#rce_only_empty').prop('checked', settings.onlyEmptyMessages).on('change', function () {
        settings.onlyEmptyMessages = Boolean($(this).prop('checked'));
        saveSettings();
    });

    $('#rce_remove_block').prop('checked', settings.removeExtractedBlock).on('change', function () {
        settings.removeExtractedBlock = Boolean($(this).prop('checked'));
        saveSettings();
    });

    $('#rce_keep_wrapper').prop('checked', settings.keepWrapper).on('change', function () {
        settings.keepWrapper = Boolean($(this).prop('checked'));
        saveSettings();
    });

    $('#rce_emit_update').prop('checked', settings.emitMessageUpdated).on('change', function () {
        settings.emitMessageUpdated = Boolean($(this).prop('checked'));
        saveSettings();
    });

    $('#rce_mode').val(settings.mode).on('change', function () {
        settings.mode = String($(this).val()) === 'regex' ? 'regex' : 'tag';
        updateModeVisibility();
        saveSettings();
    });

    $('#rce_tag_name').val(settings.tagName).on('input', function () {
        settings.tagName = String($(this).val() || defaultSettings.tagName);
        saveSettings();
    });

    $('#rce_regex').val(settings.regex).on('input', function () {
        settings.regex = String($(this).val());
        saveSettings();
    });

    $('#rce_regex_flags').val(settings.regexFlags).on('input', function () {
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
    const earlyRepair = (messageId) => void repairMessage(Number(messageId), { render: false, save: false, emit: true });
    const renderedRepair = (messageId) => void repairMessage(Number(messageId), { render: true, save: false, emit: true });
    const savedRepair = (messageId) => void repairMessage(Number(messageId), { render: true, save: true, emit: true });
    const reasoningDoneRepair = (_reasoning, _duration, messageId, state) => {
        if (state !== 'done' && state !== 'hidden') {
            return;
        }
        void repairMessage(Number(messageId), { render: true, save: true, emit: true });
    };

    context.eventSource.makeFirst(context.eventTypes.MESSAGE_RECEIVED, earlyRepair);
    context.eventSource.makeFirst(context.eventTypes.STREAM_REASONING_DONE, reasoningDoneRepair);
    context.eventSource.makeLast(context.eventTypes.CHARACTER_MESSAGE_RENDERED, renderedRepair);
    context.eventSource.on(context.eventTypes.MESSAGE_SWIPED, savedRepair);
    context.eventSource.on(context.eventTypes.MESSAGE_REASONING_EDITED, (messageId) => {
        if (suppressMessageUpdated) {
            return;
        }
        savedRepair(messageId);
    });
    context.eventSource.on(context.eventTypes.MESSAGE_UPDATED, (messageId) => {
        if (suppressMessageUpdated) {
            return;
        }
        savedRepair(messageId);
    });
}

jQuery(async () => {
    getSettings();
    const html = await renderExtensionTemplateAsync(EXTENSION_PATH, 'index');
    $('#extensions_settings2').append(html);
    bindSettingsUi();
    registerEventHandlers();
    console.debug('[Reasoning Content Extractor] Loaded.');
});
