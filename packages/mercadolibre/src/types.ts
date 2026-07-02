// Types for dual-account ML API integration (PR 1+2)

export type MlShipping = {
  mode?: string;
  local_pick_up?: boolean;
  free_shipping?: boolean;
  logistic_type?: string;
  dimensions?: string | null;
  tags?: string[];
};

export type MlSaleTerm = {
  id: string;
  name?: string;
  value_id?: string | null;
  value_name?: string;
};

export type MlItemVariation = {
  id: number;
  attribute_combinations: Array<{
    id?: string;
    name?: string;
    value_id?: string;
    value_name?: string;
  }>;
  price: number;
  available_quantity: number;
  sold_quantity: number;
  picture_ids: string[];
  catalog_product_id?: string | null;
  attributes?: Array<{
    id: string;
    name?: string;
    value_id?: string | null;
    value_name?: string;
  }>;
};

export type MlItem = {
  id: string;
  title: string;
  price: number;
  available_quantity: number;
  category_id: string;
  seller_id: number;
  status: "active" | "paused" | "closed";
  pictures: Array<{ url: string }>;
  attributes: Array<{ id: string; value_name: string }>;
  variations?: MlItemVariation[];
  catalog_product_id?: string | null;
  catalog_listing?: boolean;
  shipping?: MlShipping;
  sale_terms?: MlSaleTerm[];
  currency_id?: string;
  buying_mode?: string;
  listing_type_id?: string;
  condition?: string;
  warranty?: string;
  permalink?: string;
  domain_id?: string;
};

export type NewItem = {
  title: string;
  category_id: string;
  price: number;
  currency_id: string;
  available_quantity: number;
  buying_mode: string;
  listing_type_id: string;
  condition: string;
  pictures: Array<{ source: string }>;
  descriptions?: Array<{ plain_text: string }>;
  attributes?: Array<{ id: string; value_name: string }>;
  warranty?: string;
  video_id?: string;
  shipping?: MlShipping;
  sale_terms?: MlSaleTerm[];
  variations?: Array<{
    attribute_combinations: Array<{
      name?: string;
      value_id?: string;
      value_name?: string;
    }>;
    price: number;
    available_quantity: number;
    picture_ids?: string[];
    attributes?: Array<{
      id: string;
      value_name?: string;
    }>;
  }>;
  catalog_product_id?: string;
  catalog_listing?: boolean;
};

export type MlOrder = {
  id: string;
  status: string;
  total_amount: number;
  date_created: string;
  order_items: Array<{
    item: { id: string; title: string };
    quantity: number;
    unit_price: number;
  }>;
};

export type MlQuestion = {
  id: string;
  text: string;
  status: string;
  date_created: string;
  item_id: string;
};

export type MlUserInfo = {
  id: number;
  nickname: string;
  points: number;
  level: string;
  status: string;
};

export type OAuthTokens = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id: string;
  nickname: string;
  account_level: "classic" | "premium" | "platinum";
  /** OAuth scopes granted (e.g. "offline_access read write"). Must include offline_access for refresh tokens. */
  scope?: string;
};

export type StoredToken = {
  seller_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  user_id: string;
  nickname: string;
  account_level: string;
};

export type MlWriteSnapshot = {
  id: string;
  permalink: string;
  status: string;
  capturedAt: string;
};

export type MlCategory = {
  id: string;
  name: string;
  path_from_root?: Array<{ id: string; name: string }>;
  children_categories?: Array<{ id: string; name: string }>;
};

export type MlCategoriesSnapshot = {
  sellerId: string;
  data: MlCategory[];
  capturedAt: string;
};

export type MlUserSnapshot = {
  sellerId: string;
  data: MlUserInfo;
  capturedAt: string;
};
