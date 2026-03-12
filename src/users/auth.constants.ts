const oneHourSeconds = 60 * 60;

export const AUTH_TOKEN_EXPIRES_IN_SECONDS = Number(
  process.env.JWT_EXPIRES_IN_SECONDS ?? oneHourSeconds,
);

export const AUTH_COOKIE_MAX_AGE_MS = AUTH_TOKEN_EXPIRES_IN_SECONDS * 1000;
