// Invite codes skip look-alike characters (0/O, 1/I) so they can be read aloud.
export const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const INVITE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
export const inviteUrl = (origin: string, code: string) => `${origin}/versus?invite=${code}`;
