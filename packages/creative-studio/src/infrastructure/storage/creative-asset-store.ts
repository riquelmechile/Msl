import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// ── Default storage path ─────────────────────────────────────────────

const DEFAULT_STORAGE_PATH = ".msl/creative-studio/assets";

/**
 * Local file-based asset store for generated creative assets.
 *
 * Assets are stored under a configurable root path (default:
 * `.msl/creative-studio/assets/`). Each asset is saved as a file named
 * after its assetId. Metadata is persisted as a sibling `.json` file.
 *
 * This store is ephemeral-friendly: the directory is created on first use.
 */
export class CreativeAssetStore {
  private readonly storagePath: string;

  constructor(storagePath?: string) {
    this.storagePath = resolve(storagePath ?? DEFAULT_STORAGE_PATH);
    this.ensureDir();
  }

  /**
   * Save an asset buffer to local storage.
   * Returns the storage URI (file:// scheme).
   */
  saveAsset(assetId: string, buffer: Buffer, metadata: object): Promise<string> {
    
    this.ensureDir();

    const filePath = resolve(this.storagePath, assetId);
    writeFileSync(filePath, buffer);

    // Persist metadata alongside the asset
    const metaPath = resolve(this.storagePath, `${assetId}.meta.json`);
    writeFileSync(metaPath, JSON.stringify(metadata, null, 2));

    return Promise.resolve(`file://${filePath}`);
  }

  /**
   * Get the local file system path for an asset.
   */
  getAssetPath(assetId: string): Promise<string> {
    
    return Promise.resolve(resolve(this.storagePath, assetId));
  }

  /**
   * Ensure the storage directory exists.
   */
  private ensureDir(): void {
    if (!existsSync(this.storagePath)) {
      mkdirSync(this.storagePath, { recursive: true });
    }
  }
}
