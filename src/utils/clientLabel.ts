/** A client's name for display, or a neutral fallback when they never set one. */
export const clientLabel = (name: string | null | undefined): string => name?.trim() || 'your client';
