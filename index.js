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

const FILTER_OPTIONS = Object.freeze(['initial_model', 'unload_model']);

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

async function apiGetModel(apiUrl) {
  try {
    const response = await fetch(`${apiUrl}${KOBOLDCPP_API.getModel}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!response.ok) {
      throw new Error(`HTTP status ${response.status}`);
    }
    const data = await response.json();
    return data.result;
  } catch (error) {
    return undefined;
  }
}
async function apiGetListOptions(apiUrl) {
  try {
    const response = await fetch(`${apiUrl}${KOBOLDCPP_API.getListOptions}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!response.ok) {
      throw new Error(`HTTP status ${response.status}`);
    }
    const data = await response.json();
    return data.filter((option) => !FILTER_OPTIONS.includes(option));
  } catch (error) {
    return [];
  }
}

async function apiPostReloadConfig(apiUrl, filename) {
  try {
    const response = await fetch(`${apiUrl}${KOBOLDCPP_API.postReloadConfig}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename })
    });
    if (!response.ok) {
      throw new Error(`HTTP status ${response.status}`);
    }
    const data = await response.json();
    return data.success;
  } catch (error) {
    return false;
  }
}

// async function loadModel(apiUrl, modelPath) {
//   try {
//     const response = await fetch(`${apiUrl}${KOBOLDCPP_API.load}`, {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
      
//     });
//     return response.ok;
//   } catch (error) {
//     return false;
//   }
// }

// async function waitForModelLoad(apiUrl, maxAttempts = 60, interval = 2000) {
//   for (let i = 0; i < maxAttempts; i++) {
//     try {
//       const response = await fetch(`${apiUrl}${KOBOLDCPP_API.status}`);
//       if (response.ok) {
//         const data = await response.json();
//         if (data.model_loaded || data.queue === 0) {
//           return true;
//         }
//       }
//     } catch (error) {
//       /* empty */
//     }
//     await new Promise(resolve => setTimeout(resolve, interval));
//   }
//   return false;
// }

// async function switchModel(modelPath) {
//   const apiUrl = extensionSettings.koboldcppApiUrl;

//   toastr.info(t`Unloading current model`, t`KoboldCpp Model Loader`);
 
//   const unloaded = await unloadModel(apiUrl);
//   if (!unloaded) {
//     toastr.error(t`Error unloading current model: ${error.message}`, t`KoboldCpp Model Loader`);
//     return false; 
//   }

//   await new Promise(resolve => setTimeout(resolve, 2000));

//   toastr.info(t`Loading model: ${modelPath}`, t`KoboldCpp Model Loader`);

//   const loaded = await loadModel(apiUrl, modelPath);
//   if (!loaded) {
//     toastr.error(t`Error loading model: ${error.message}`, t`KoboldCpp Model Loader`);
//     return false;
//   }

//   const ready = await waitForModelLoad(apiUrl);

//   if (ready) {
//     toastr.success('Model loaded successfully', t`KoboldCpp Model Loader`);
//     return true;
//   } else {
//     toastr.error(t`Can't load model`, t`KoboldCpp Model Loader`);
//     return false;
//   }
// }

function setExtensionSettings(settings = {}) {
  extensionSettings[MODULE_NAME] = lodash.assign({}, extensionSettings[MODULE_NAME], settings);
  saveSettingsDebounced();
}

function getExtensionSettings(setting = [], defaultValue) {
  return lodash.get(extensionSettings[MODULE_NAME], setting, defaultValue);
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
    let model = await apiGetModel(koboldcppApiUrl);
    let listOptions = await apiGetListOptions(koboldcppApiUrl);
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

  const listOptions = getExtensionSettings('listOptions');
  if (!listOptions.includes(modelConfiguration)) {
    return toastr.error(t`Select a valid model configuration`, t`KoboldCpp Model Loader`);
  }

  const koboldcppApiUrl = getExtensionSettings('koboldcppApiUrl');
  const success = await apiPostReloadConfig(koboldcppApiUrl, modelConfiguration);
  if (!success) {
    return toastr.error(t`Load model configuration failed`, t`KoboldCpp Model Loader`);
  }

  changeMainAPI('textgenerationwebui');
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
  const html = await renderExtensionTemplateAsync(`third-party/${MODULE_NAME}`, 'content', getExtensionSettings());
  jQuery('#st-koboldcpp-model-loader--content').html(html);
  jQuery('#st-koboldcpp-model-loader--model-configuration-form').on('submit', onSubmitHandler);
}

async function templateRender() {
  const html = await renderExtensionTemplateAsync(`third-party/${MODULE_NAME}`, 'template', getExtensionSettings());
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
