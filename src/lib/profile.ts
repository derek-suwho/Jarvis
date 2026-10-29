export interface ProfileAccount {
  name?: string | null;
  email?: string | null;
}

/** Prefer an explicit name, then connected account names, then an honest identity fallback. */
export function resolveProfileName(
  preferredName: string,
  ...accounts: (ProfileAccount | null | undefined)[]
): string {
  const preferred = preferredName.trim();
  if (preferred) return preferred;
  for (const account of accounts) {
    const name = account?.name?.trim();
    if (name) return name;
  }
  for (const account of accounts) {
    const email = account?.email?.trim();
    if (email) return email;
  }
  return 'Account';
}
