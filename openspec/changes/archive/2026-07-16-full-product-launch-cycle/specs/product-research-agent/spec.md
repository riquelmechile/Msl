# product-research-agent Specification

## Purpose

DeepSeek-powered web research agent that searches the internet for product specifications, measurements, materials, official descriptions, and product images. Returns structured data for listing composition and image sourcing.

## Requirements

### Requirement: Web Search for Product Data

The agent MUST search the internet for the identified product and return structured data: specifications (dimensions, weight, materials), description candidates (2–3 variants), manufacturer name, and image URLs (3–5 clean product images). It SHOULD cross-reference multiple sources for accuracy.

#### Scenario: Product found across multiple sources

- GIVEN product "Nike Air Max 270 React" is identified
- WHEN the agent searches the internet
- THEN structured data is returned with specs, descriptions, and image URLs from at least 2 sources
- AND conflicting specs are flagged for CEO review

#### Scenario: No results found on internet

- GIVEN the product is obscure with no web results
- WHEN the agent searches exhaustively
- THEN it returns a partial result and falls back to ML catalog data
- AND the launch continues with a flag `web_search: partial`

### Requirement: Structured Output Contract

Research results MUST follow a contract: `{specs: Record<string,string>, descriptions: string[], imageUrls: string[], manufacturer: string, sources: string[]}`. Missing fields are permitted but MUST be explicitly `null`, not absent.

#### Scenario: Full results returned

- GIVEN research completes successfully
- WHEN results are stored in the launch context
- THEN all contract fields are present with values or explicit nulls

### Requirement: ML Catalog Fallback

When web search yields insufficient data, the agent MUST fall back to ML catalog sources (`domain_discovery/search`, category attributes). The fallback result SHALL be flagged so the CEO knows the data source.

#### Scenario: Fallback to ML catalog

- GIVEN web search returns no usable results
- WHEN the agent triggers fallback
- THEN ML catalog data is returned
- AND result is flagged `source: ml_catalog`
