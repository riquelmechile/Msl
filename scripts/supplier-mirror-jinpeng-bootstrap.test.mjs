import { describe, expect, it } from "vitest";

import {
  formatJinpengBootstrapEvidence,
  parseJinpengBootstrapCliArgs,
  redactJinpengBootstrapConfig,
  resolveSupplierMirrorDbPath,
} from "./supplier-mirror-jinpeng-bootstrap.mjs";

describe("Jinpeng Supplier Mirror bootstrap CLI", () => {
  it("defaults to dry-run and rejects ambiguous mutation flags", () => {
    expect(parseJinpengBootstrapCliArgs([])).toEqual({ help: false, mode: "dry-run" });
    expect(parseJinpengBootstrapCliArgs(["--apply-seed"])).toEqual({
      help: false,
      mode: "apply-seed",
    });
    expect(() => parseJinpengBootstrapCliArgs(["--dry-run", "--apply-seed"])).toThrow(
      /either --dry-run or --apply-seed/,
    );
  });

  it("requires an explicit SQLite path from env before opening a store", () => {
    expect(() => resolveSupplierMirrorDbPath({})).toThrow(/MSL_SUPPLIER_MIRROR_DB_PATH/);
    expect(
      resolveSupplierMirrorDbPath({ MSL_SUPPLIER_MIRROR_DB_PATH: "/tmp/jinpeng.sqlite" }),
    ).toBe("/tmp/jinpeng.sqlite");
  });

  it("redacts runtime config and reports no external mutation side effects", () => {
    const config = {
      mode: "dry-run",
      mlSellerId: "123456",
      xkpUrl: "https://www.xkp.cl/products",
      maustianSellerId: "maustian",
      plasticovSellerId: "plasticov",
      mlAccessTokenPresent: true,
      mlClientIdPresent: true,
      mlClientSecretPresent: true,
    };
    const result = {
      noMutationExecuted: true,
      readinessReport: {
        status: "ready-for-ceo-decision",
        workerEnabled: false,
      },
      ledgerRecords: [{ id: "supplier-mirror:ledger:jinpeng:enablement-block" }],
    };

    expect(redactJinpengBootstrapConfig(config)).toEqual({
      mode: "dry-run",
      supplierId: "jinpeng",
      mlSellerIdProvided: true,
      mlNicknameProvided: false,
      mlProfileUrlProvided: false,
      xkpUrlProvided: true,
      maustianSellerIdProvided: true,
      plasticovSellerIdProvided: true,
      mlAccessTokenPresent: true,
      mlClientIdPresent: true,
      mlClientSecretPresent: true,
      secretsPersisted: false,
    });
    expect(
      formatJinpengBootstrapEvidence({ dbPath: "/tmp/jinpeng.sqlite", config, result }),
    ).toMatchObject({
      safety: {
        noMutationExecuted: true,
        workerEnabled: false,
        externalApiCalled: false,
        secretsStored: false,
        publishCalled: false,
        pauseCalled: false,
        priceUpdateCalled: false,
      },
    });
  });
});
