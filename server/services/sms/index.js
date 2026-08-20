const provider = require('./sms-provider.service');

module.exports = {
    sendViaProvider: provider.sendViaProvider,
    getProviderStatus: provider.getProviderStatus,
    classifySmsError: provider.classifySmsError,
    readEnvSmsConfig: provider.readEnvSmsConfig
};
