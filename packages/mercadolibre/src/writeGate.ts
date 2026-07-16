/** Error thrown whenever a MercadoLibre mutation reaches the shared client boundary. */
export class MercadoLibreWriteBlockedError extends Error {
  readonly operation: string;
  readonly sellerId: string | undefined;

  constructor(operation: string, sellerId?: string) {
    const sellerPart = sellerId ? ` for seller ${sellerId}` : "";
    super(`MercadoLibre write operations are blocked. Attempted: ${operation}${sellerPart}.`);
    this.name = "MercadoLibreWriteBlockedError";
    this.operation = operation;
    this.sellerId = sellerId;
  }
}

/**
 * Fail-closed production boundary for every MercadoLibre mutation.
 * This intentionally has no feature flag until publishing is explicitly enabled.
 */
export function assertMercadoLibreWriteDisabled(operation: string, sellerId?: string): never {
  throw new MercadoLibreWriteBlockedError(operation, sellerId);
}
