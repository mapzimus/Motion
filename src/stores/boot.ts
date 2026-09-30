import { signal } from '@preact/signals';

export const loadingMessage = signal<string | null>('LOADING NEW ENGLAND…');
export const fatalError = signal<Error | null>(null);

export function setLoading(message: string | null) {
  loadingMessage.value = message;
}

export function setFatal(error: Error) {
  fatalError.value = error;
}
