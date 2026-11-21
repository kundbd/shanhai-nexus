export const binCardDataPath = "/bin-data/issuer-cards-fcc907c-v1.bin";

export type BinCard = readonly [code: string, issuer: string, brand: string, type: string];

export function readBinCards(buffer: ArrayBuffer) {
  const indexSize = 2_000_000;
  if (buffer.byteLength <= 4 + indexSize) throw new Error("Invalid card index");
  const view = new DataView(buffer);
  const headerSize = view.getUint32(0, true);
  const offset = 4 + headerSize;
  if (offset + indexSize !== buffer.byteLength) throw new Error("Invalid card index");
  const header = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(buffer, 4, headerSize));
  const [cards, exact] = JSON.parse(header) as [Array<BinCard | null>, Record<string, number>];

  return (prefix: string) => {
    const specific = prefix.length === 8 ? exact[prefix] : undefined;
    const id = specific ?? view.getUint16(offset + Number(prefix.slice(0, 6)) * 2, true);
    const card = cards[id];
    if (card) return { card, digits: specific === undefined ? 6 : 8 };
  };
}
