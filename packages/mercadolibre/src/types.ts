// Types for dual-account ML API integration (PR 1+2)

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
};

export type NewItem = {
  title: string;
  category_id: string;
  price: number;
  available_quantity: number;
  pictures: string[];
  description: string;
  attributes: Array<{ id: string; value_name: string }>;
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
