# listing-composer Specification

## Purpose

Account-aware listing assembly agent. Composes ML-compliant product listings using DeepSeek with account-specific system prompts. Plasticov and Maustian have different tones, pricing strategies, and listing approaches.

## Requirements

### Requirement: Account-Aware Listing Assembly

The composer MUST generate a complete listing payload: title, description, attributes, category, price, shipping info, and image references. It MUST use the account-specific system prompt for the target seller (Plasticov or Maustian). The CEO MUST select the target account before composition.

#### Scenario: Plasticov listing

- GIVEN product data and account=Plasticov
- WHEN the composer assembles the listing
- THEN the tone reflects Plasticov's brand voice: mid-market, volume-focused, competitive pricing
- AND pricing targets mid-market positioning

#### Scenario: Maustian listing

- GIVEN product data and account=Maustian
- WHEN the composer assembles the listing
- THEN the tone reflects Maustian's brand voice: premium, quality-focused, premium pricing
- AND pricing targets premium testing strategy

### Requirement: Listing Completeness

The composed listing MUST include: title (≤ 60 chars), description (≥ 200 chars, HTML allowed), category ID from ML, required attributes per ML category, price from competition analysis, shipping mode, and image references. Missing fields SHALL be flagged.

#### Scenario: Complete listing generated

- GIVEN all product context is available
- WHEN the composer runs
- THEN all required ML fields are populated
- AND the listing is validatable against ML's `/categories/{id}/attributes/conditional`

### Requirement: Pricing Strategy

The composer SHOULD adapt pricing per account strategy: Plasticov targets competitive mid-market with `price_to_win` signal; Maustian tests premium positioning with higher margins. Pricing MAY be overridden by CEO during approval.

#### Scenario: Plasticov competitive pricing

- GIVEN `price_to_win` data shows $45–55 range
- WHEN composing for Plasticov
- THEN listing price is set within the competitive range

### Requirement: DeepSeek Cache Optimization

The composer MUST use lane-prefix caching for DeepSeek calls. The account-specific system prompt prefix SHALL serve as the cache prefix to maximize cache hits across repeated launches.

#### Scenario: Cache hit on repeated listing

- GIVEN two launches for Plasticov with different products
- WHEN both use the same Plasticov system prompt prefix
- THEN the second DeepSeek call hits the lane cache and incurs reduced cost
