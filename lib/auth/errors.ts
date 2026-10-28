export class AuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthConfigError';
  }
}

export type AuthErrorCode =
  | 'oauth_exchange_failed'
  | 'email_unverified'
  | 'missing_email'
  | 'user_create_failed';

export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode) {
    super(code);
    this.name = 'AuthError';
  }
}
