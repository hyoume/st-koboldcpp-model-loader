import {
  lodash
} from '../../../../lib.js';
import {
  saveSettingsDebounced,
  eventSource,
  changeMainAPI,
  event_types as eventTypes,
  main_api as mainApi,
  online_status as onlineStatus
} from '../../../../script.js';
import {
  renderExtensionTemplateAsync,
  extension_settings as extensionSettings
} from '../../../extensions.js';
import {
  t
} from '../../../i18n.js';
import {
  textgenerationwebui_settings as textCompletionSettings
} from '../../../textgen-settings.js';

const MODULE_NAME = Object.freeze('st-koboldcpp-model-loader');

const MODULE_LOAD_MAX_ATTEMPS = Object.freeze(10);
const MODULE_LOAD_INTERVAL = Object.freeze(5000);

const MODULE_OPTIONS_FILTER = Object.freeze(['initial_model', 'unload_model']);

const KOBOLDCPP_API_INTERVAL = Object.freeze(2000);
const KOBOLDCPP_API = Object.freeze({
  getListOptions: '/api/admin/list_options',
  postReloadConfig: '/api/admin/reload_config',
  getModel: '/api/v1/model'
});

const DEFAULT_SETTINGS = Object.freeze({
  updated: false,
  enabled: false,
  connected: false,
  koboldcppApiUrl: 'http://localhost:5001',
  listOptions: [],
  model: undefined
});

async function apiGetModel(apiUrl, timeout = 0) {
  try {
    const [response] = await Promise.all([
      fetch(`${apiUrl}${KOBOLDCPP_API.getModel}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      }),
      new Promise((resolve) => setTimeout(resolve, timeout))
    ]);
    if (!response.ok) {
      throw new Error(`HTTP status ${response.status}`);
    }
    const data = await response.json();
    return data.result;
  } catch (error) {
    return undefined;
  }
}
async function apiGetListOptions(apiUrl, timeout = 0) {
  try {
    const [response] = await Promise.all([
      fetch(`${apiUrl}${KOBOLDCPP_API.getListOptions}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      }),
      new Promise((resolve) => setTimeout(resolve, timeout))
    ]);
    if (!response.ok) {
      throw new Error(`HTTP status ${response.status}`);
    }
    const data = await response.json();
    return data.filter((option) => !MODULE_OPTIONS_FILTER.includes(option));
  } catch (error) {
    return [];
  }
}

async function apiPostReloadConfig(apiUrl, filename, timeout = 0) {
  try {
    const [response] = await Promise.all([
      fetch(`${apiUrl}${KOBOLDCPP_API.postReloadConfig}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename })
      }),
      new Promise((resolve) => setTimeout(resolve, timeout))
    ]);
    if (!response.ok) {
      throw new Error(`HTTP status ${response.status}`);
    }
    const data = await response.json();
    return data.success;
  } catch (error) {
    return false;
  }
}

function setExtensionSettings(settings = {}) {
  extensionSettings[MODULE_NAME] = lodash.assign({}, extensionSettings[MODULE_NAME], settings);
  saveSettingsDebounced();
}

function getExtensionSettings(setting = [], defaultValue) {
  return lodash.get(extensionSettings, lodash.concat([MODULE_NAME], setting), defaultValue);
}

async function onEnabledHandler() {
  const currentEnabled = getExtensionSettings('enabled');
  const currentConnected = getExtensionSettings('connected');

  const enabled = (
    mainApi === 'textgenerationwebui'
    && textCompletionSettings.type === 'koboldcpp'
  );
  const connected = (
    enabled
    && onlineStatus !== 'no_connection'
  );
  const updated = (
    enabled !== currentEnabled
    || connected !== currentConnected
  );

  if (enabled && connected && updated) {
    const koboldcppApiUrl = textCompletionSettings.server_urls.koboldcpp;
    const model = await apiGetModel(koboldcppApiUrl);
    const listOptions = await apiGetListOptions(koboldcppApiUrl);
    setExtensionSettings({ koboldcppApiUrl, model, listOptions });
  }
  setExtensionSettings({ enabled, updated, connected });
}

async function onUpdatedHandler() {
  const updated = getExtensionSettings('updated');
  if (updated) {
    await contentRender();
  }
}

async function onSubmitHandler(e) {
  e.preventDefault();
  const { modelConfiguration } = jQuery(this).serializeArray().reduce(
    (obj, { name, value }) => lodash.assign(obj, { [name]: value })
  , {});

  const koboldcppApiUrl = getExtensionSettings('koboldcppApiUrl');
  const listOptions = getExtensionSettings('listOptions');

  if (!listOptions.includes(modelConfiguration)) {
    return toastr.error(t`Select a valid model configuration`, t`KoboldCpp Model Loader`);
  }

  const success = await apiPostReloadConfig(koboldcppApiUrl, modelConfiguration, KOBOLDCPP_API_INTERVAL);
  if (!success) {
    return toastr.error(t`Model configuration failed`, t`KoboldCpp Model Loader`);
  }

  setExtensionSettings({ model: 'no_connection', listOptions: [], connected: false });
  changeMainAPI();

  for (let i = 0; i < MODULE_LOAD_MAX_ATTEMPS; i++) {
    const [{ value }] = await Promise.allSettled([
      apiGetModel(koboldcppApiUrl),
      new Promise((resolve) => {
        toastr.info(t`Wait for model configuration`, t`KoboldCpp Model Loader`, {
          progressBar: true,
          closeButton: false,
          timeOut: MODULE_LOAD_INTERVAL,
          onHidden: resolve
        })
      })
    ]);
    if (typeof value !== 'undefined') {
      return toastr.success(t`Model configuration succeeded`, t`KoboldCpp Model Loader`);
    }
  }

  return toastr.warn(t`Timeout for model configuration has expired`, t`KoboldCpp Model Loader`);
}

function setEventHandlers() {
  [
    eventTypes.APP_INITIALIZED,
    eventTypes.MAIN_API_CHANGED,
    eventTypes.ONLINE_STATUS_CHANGED
  ].forEach((eventType) => {
    eventSource.on(eventType, onEnabledHandler);
  });

  eventSource.on(eventTypes.SETTINGS_UPDATED, onUpdatedHandler);
}

async function contentRender() {
  const settings = getExtensionSettings();
  const html = await renderExtensionTemplateAsync(`third-party/${MODULE_NAME}`, 'content', settings)
  jQuery('#st-koboldcpp-model-loader--content').html(html);
  jQuery('#st-koboldcpp-model-loader--model-configuration-form').on('submit', onSubmitHandler);
}

async function templateRender() {
  const settings = getExtensionSettings();
  const html = await renderExtensionTemplateAsync(`third-party/${MODULE_NAME}`, 'template', settings)
  jQuery('#extensions_settings').append(html);
}

async function initialize() {
  setExtensionSettings(DEFAULT_SETTINGS);
  setEventHandlers();
  await templateRender();
}

jQuery(async () => {
  await initialize();
});
