// A storage adapter: handed to the app by the runtime.
export const deckFiles = () => ({ ids: () => [] as string[] });
export type DeckFiles = ReturnType<typeof deckFiles>;
