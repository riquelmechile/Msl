import type { NewItem } from "./types.js";

// ---------------------------------------------------------------------------
// Mock data helpers for stub mode
// ---------------------------------------------------------------------------

export const MOCK_LISTINGS_PAYLOAD = {
  results: [
    {
      id: "MLC1001",
      title: "Producto de prueba",
      status: "active",
      available_quantity: 10,
      price: 15000,
      currency_id: "CLP",
      permalink: "https://articulo.mercadolibre.cl/MLC1001",
    },
    {
      id: "MLC1002",
      title: "Artículo demo",
      status: "active",
      available_quantity: 5,
      price: 25000,
      currency_id: "CLP",
      permalink: "https://articulo.mercadolibre.cl/MLC1002",
    },
  ],
};

const MOCK_ORDERS_PAYLOAD = {
  results: [
    {
      id: "ORDER-1",
      status: "paid",
      total_amount: 12000,
      currency_id: "CLP",
      date_created: "2026-06-25T12:00:00Z",
      buyer: { id: 501 },
    },
  ],
};

const MOCK_QUESTIONS_PAYLOAD = {
  questions: [
    {
      id: "Q-1",
      text: "¿Tiene stock disponible?",
      status: "UNANSWERED",
      date_created: "2026-06-25T10:00:00Z",
      item_id: "MLC1001",
      from: { id: 501 },
    },
  ],
};

const MOCK_CATEGORIES_PAYLOAD = [
  { id: "MLC1000", name: "Electrónica" },
  { id: "MLC2000", name: "Ropa y Accesorios" },
];

const MOCK_USER_PAYLOAD = {
  id: 12345,
  nickname: "TESTSELLER",
  points: 100,
  seller_experience: "Novato",
  status: { site_status: "active" },
};

export const MOCK_ITEM_PAYLOAD = {
  id: "MLC1001",
  title: "Producto de prueba",
  price: 15000,
  available_quantity: 10,
  category_id: "MLC1000",
  seller_id: 12345,
  status: "active",
  pictures: [{ url: "https://http2.mlstatic.com/D_IMG_1.jpg" }],
  attributes: [{ id: "BRAND", value_name: "Genérica" }],
  currency_id: "CLP",
  buying_mode: "buy_it_now",
  listing_type_id: "gold_special",
  condition: "new",
  warranty: "Garantía del vendedor: 3 meses",
  shipping: {
    mode: "me2",
    free_shipping: false,
    logistic_type: "drop_off",
    tags: [],
  },
  sale_terms: [
    { id: "WARRANTY_TYPE", value_id: "2230280", value_name: "Garantía del vendedor" },
    { id: "WARRANTY_TIME", value_name: "3 meses" },
  ],
  permalink: "https://articulo.mercadolibre.cl/MLC1001",
  domain_id: "MLC-TEST",
};

export function mockResponse(path: string, _method: "GET" | "POST" | "PUT", body?: unknown): unknown {
  // POST /items
  if (_method === "POST" && path === "/items") {
    const newItem = body as NewItem | undefined;
    const mockId = "MLC-MOCK-9999";
    return {
      id: mockId,
      permalink: `https://articulo.mercadolibre.cl/${mockId}`,
      status: "active",
      ...(newItem ? { title: newItem.title } : {}),
      ...(newItem?.variations?.length
        ? {
            variations: newItem.variations.map((v, i) => ({
              id: 1000 + i,
              price: v.price,
              available_quantity: v.available_quantity,
              attribute_combinations: v.attribute_combinations,
              picture_ids: v.picture_ids ?? [],
              sold_quantity: 0,
            })),
          }
        : {}),
      ...(newItem?.catalog_listing ? { catalog_listing: true } : {}),
      ...(newItem?.catalog_product_id ? { catalog_product_id: newItem.catalog_product_id } : {}),
    };
  }

  // POST /items/{id}/relist
  if (_method === "POST" && path.includes("/relist")) {
    const mockId = "MLC-RELIST-9999";
    return {
      id: mockId,
      permalink: `https://articulo.mercadolibre.cl/${mockId}`,
      status: "active",
      parent_item_id: path.split("/")[2],
    };
  }

  // POST /items/catalog_listings
  if (_method === "POST" && path === "/items/catalog_listings") {
    const mockId = "MLC-CATALOG-9999";
    return {
      id: mockId,
      permalink: `https://articulo.mercadolibre.cl/${mockId}`,
      status: "active",
      catalog_listing: true,
      ...(body && typeof body === "object"
        ? { catalog_product_id: (body as Record<string, unknown>).catalog_product_id }
        : {}),
    };
  }

  // PUT /items/{id} or GET /items/{id}
  if (path.startsWith("/items/") && !path.includes("/search")) {
    if (_method === "PUT") {
      return {
        id: path.split("/").pop() ?? "MLC-MOCK-9999",
        permalink: `https://articulo.mercadolibre.cl/${path.split("/").pop() ?? "MLC-MOCK-9999"}`,
        status: "active",
      };
    }
    return MOCK_ITEM_PAYLOAD;
  }

  if (path.includes("/items/search")) return MOCK_LISTINGS_PAYLOAD;
  if (path.includes("/orders/search")) return MOCK_ORDERS_PAYLOAD;
  if (path.includes("/questions/search")) return MOCK_QUESTIONS_PAYLOAD;
  if (path.includes("/categories")) return MOCK_CATEGORIES_PAYLOAD;
  if (path.includes("/users/me")) return MOCK_USER_PAYLOAD;

  return {};
}
