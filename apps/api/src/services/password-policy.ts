/**
 * The password rules. One copy: the auth service applies them when a user sets
 * a password, and the development seed applies them to SEED_USER_PASSWORD.
 */

/** Returns what is wrong with the password; empty when it meets the rules. */
export function passwordPolicyErrors(password: string): string[] {
  const errors: string[] = [];
  if (password.length < 12) errors.push("Password must be at least 12 characters");
  if (!/[A-Z]/.test(password)) errors.push("Password must contain an uppercase letter");
  if (!/[a-z]/.test(password)) errors.push("Password must contain a lowercase letter");
  if (!/[0-9]/.test(password)) errors.push("Password must contain a digit");
  return errors;
}
