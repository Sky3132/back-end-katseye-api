export type MostSoldProductRow = {
  rank: number;
  product: {
    id: number;
    title: string;
    imgsrc: string | null;
    price: number;
    stock: number;
  };
  quantity_sold: number;
  revenue: number;
  avg_unit_price: number;
};

export type MostSoldResponse = {
  statuses_included: string[];
  total_products_sold: number;
  total_units_sold: number;
  total_revenue: number;
  best_seller: MostSoldProductRow | null;
  items: MostSoldProductRow[];
};

