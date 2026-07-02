# Delta for ml-questions-answer

## ADDED Requirements

### Requirement: getQuestions Safe-Read

The system MUST expose a read-only `getQuestions` method on `MlcApiClient` that queries seller questions via the `/questions/search` endpoint. The method SHALL accept `seller_id` and optional filters (status, date range) and return normalized question data using existing `normalizeQuestions` logic. This is a safe-read operation: it MUST NOT execute any mutation or require approval.

#### Scenario: Questions retrieved for a seller

- GIVEN a seller with questions in their MercadoLibre account
- WHEN `getQuestions` is called with a valid `seller_id`
- THEN it MUST return normalized question data including id, text, status, date, and product_id
- AND it MUST NOT execute any mutation

#### Scenario: Seller has no questions

- GIVEN a seller with no questions in the filtered date range
- WHEN `getQuestions` is called
- THEN it MUST return an empty result set without error
