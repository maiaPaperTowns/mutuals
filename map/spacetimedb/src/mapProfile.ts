export function mapHeadline(profile: unknown): string {
  const value = profile && typeof profile === 'object' && 'headline' in profile ? profile.headline : undefined;
  if (typeof value !== 'string') return '';
  const text = value.trim();
  return text.length > 140 ? `${text.slice(0, 139)}…` : text;
}
