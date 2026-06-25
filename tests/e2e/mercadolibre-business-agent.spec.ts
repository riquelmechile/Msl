import { expect, test } from "@playwright/test";

test.describe("MercadoLibre business agent MVP", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("answers business advice in Spanish", async ({ page }) => {
    const chatCard = page.locator("article").filter({
      has: page.getByRole("heading", { name: "Chat de negocio" }),
    });

    await expect(chatCard.getByRole("heading", { name: "Chat de negocio" })).toBeVisible();
    await expect(
      chatCard.getByText("Recomendación preparada con la información disponible.").first(),
    ).toBeVisible();
    await expect(
      chatCard.getByText("proteger margen mínimo antes de competir por precio").first(),
    ).toBeVisible();
  });

  test("asks the seller to reconnect before protected access", async ({ page }) => {
    await page.getByRole("button", { name: "Ver datos protegidos" }).click();

    await expect(
      page.getByRole("alert").filter({
        hasText: "Vuelve a conectar MercadoLibre para ver datos protegidos.",
      }),
    ).toContainText("Vuelve a conectar MercadoLibre para ver datos protegidos.");
  });

  test("shows connected MLC account state", async ({ page }) => {
    await page.getByRole("button", { name: "Conectar MercadoLibre" }).click();
    await expect(page.getByText("Estado: Conectado a MLC")).toBeVisible();
  });

  test("shows daily summary priorities and stale-data warning", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Resumen diario" })).toBeVisible();
    await expect(page.getByText("Prioridad 1:")).toBeVisible();
    await expect(page.getByText("Datos desactualizados en reclamos")).toBeVisible();
  });

  test("blocks a prepared write until seller approval", async ({ page }) => {
    await expect(page.getByRole("status").filter({ hasText: "Ejecución bloqueada" })).toBeVisible();
    await expect(page.getByText("Cambio exacto: Precio: $12.990 → $12.490")).toBeVisible();
  });

  test("records audit copy after approved write", async ({ page }) => {
    await page.getByRole("button", { name: "Aprobar acción preparada" }).click();

    await expect(page.getByLabel("Auditoría de acción aprobada")).toContainText(
      "Aprobado por vendedor",
    );
    await expect(page.getByText("se registró quién aprobó", { exact: false })).toBeVisible();
  });

  test("shows creative preview and requires creative approval", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Vista previa creativa" })).toBeVisible();
    await expect(page.getByText("Borrador solamente; publicación pendiente")).toBeVisible();

    await page.getByRole("button", { name: "Aprobar publicación creativa" }).click();

    await expect(page.getByRole("status").filter({ hasText: "Aprobación creativa" })).toContainText(
      "Aprobación creativa registrada; publicación real fuera de alcance.",
    );
  });
});
