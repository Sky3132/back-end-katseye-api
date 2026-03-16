## Full Philippines locations dataset

This repo seeds a **small sample** of PH locations by default (so dropdowns are not empty).

To seed the **full Philippines** hierarchy (Region → Province → City/Municipality → Barangay), provide:

- `prisma/data/ph-places.json`

### File format (`ph-places.json`)

It must be a JSON array of objects with these required fields:

- `id` (string): unique place id (your choice, but must be stable)
- `type` (string): one of `country | region | province | city | district`
- `parent_id` (string): parent place id (for `PH` country row you can use empty string)
- `country_code` (string): must be `"PH"`
- `name` (string): display name

Optional fields:

- `code` (string|null)
- `has_children` (boolean|0|1) (defaults to 0 if omitted)
- `sort_order` (number) (defaults to 0 if omitted)

### Example (minimal)

```json
[
  { "id": "PH", "type": "country", "parent_id": "", "country_code": "PH", "name": "Philippines", "has_children": 1, "sort_order": 1 },
  { "id": "PH-07", "type": "region", "parent_id": "PH", "country_code": "PH", "name": "Central Visayas", "has_children": 1, "sort_order": 7 },
  { "id": "PH-CEB", "type": "province", "parent_id": "PH-07", "country_code": "PH", "name": "Cebu", "has_children": 1 },
  { "id": "PH-CEB-CEBUCITY", "type": "city", "parent_id": "PH-CEB", "country_code": "PH", "name": "Cebu City", "has_children": 1 },
  { "id": "PH-CEB-CEBUCITY-LAHUG", "type": "district", "parent_id": "PH-CEB-CEBUCITY", "country_code": "PH", "name": "Lahug" }
]
```

### Notes

- The seed is **idempotent** (uses upsert via `INSERT ... ON DUPLICATE KEY UPDATE`).
- If `ph-places.json` is present and valid, it overrides the simplified PH seed and updates `location_schema` for `PH` to:
  - Region (required)
  - Province (required)
  - City / Municipality (required)
  - Barangay (optional)

