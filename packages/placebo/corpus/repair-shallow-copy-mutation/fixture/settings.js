export const withRetries = (config, retries) => ({
  ...config,
  limits: { ...config.limits, retries },
});
