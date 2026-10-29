export const SETTING_KEYS = {
  platformName: 'platformName',
  whatsappNumber: 'whatsappNumber',
  aiTutorModel: 'aiTutorModel',
  aiDailyBudgetUsd: 'aiDailyBudgetUsd',
  aiLastTestAt: 'aiLastTestAt',
  aiLastTestOk: 'aiLastTestOk',
  freemiusProductId: 'freemiusProductId',
  freemiusDeveloperId: 'freemiusDeveloperId',
  freemiusSyncEnabled: 'freemiusSyncEnabled',
  freemiusLastVerifiedAt: 'freemiusLastVerifiedAt',
  freemiusLastVerifiedSummary: 'freemiusLastVerifiedSummary',
} as const;

export const SECRET_KEYS = {
  openaiApiKey: 'openaiApiKey',
  freemiusApiKey: 'freemiusApiKey',
  freemiusSecretKey: 'freemiusSecretKey',
  freemiusPublicKey: 'freemiusPublicKey',
  freemiusDeveloperSecret: 'freemiusDeveloperSecret',
} as const;

export type PlainSettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];
export type SecretSettingKey = (typeof SECRET_KEYS)[keyof typeof SECRET_KEYS];
