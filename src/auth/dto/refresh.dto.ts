export class RefreshDto {
  /** The Cognito username (the access token's `username` claim) — the
   *  client-secret hash must be computed against it, not the email. */
  username: string;
  refreshToken: string;
}
