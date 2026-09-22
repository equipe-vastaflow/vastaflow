const DATE_FORMAT = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });
const DATE_TIME_FORMAT = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export const formatDate = (iso: string): string => DATE_FORMAT.format(new Date(iso));
export const formatDateTime = (iso: string): string => DATE_TIME_FORMAT.format(new Date(iso));
