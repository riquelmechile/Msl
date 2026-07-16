# image-sourcing-agent Specification

## Purpose

Searches the internet for product images, downloads them locally, and returns URIs suitable as MiniMax `subject_reference` inputs. Selects clean-background images when available.

## Requirements

### Requirement: Internet Image Search

The agent MUST search for product images using the product identity from the launch context. It MUST download and store images locally under `.msl/product-photos/{launchId}/sourced/`. It MUST return local file URIs compatible with MiniMax `subject_reference` format.

#### Scenario: Images found and downloaded

- GIVEN product "Nike Air Max 270 React" with search terms
- WHEN the agent searches and finds 5 images
- THEN 3–5 images are downloaded and stored locally
- AND local URIs are stored in the product context

#### Scenario: No images found

- GIVEN an obscure product with no web images
- WHEN the agent searches exhaustively
- THEN it flags `sourcing: failed` in the product context
- AND the launch continues — coordinator falls back to original photo as MiniMax reference

### Requirement: Image Selection Criteria

The agent SHOULD prefer images with clean/white backgrounds, ≥ 800×800 resolution, and unobstructed product view. Watermarked or collage images MUST NOT be selected.

#### Scenario: Filtering bad images

- GIVEN search returns 10 images, 3 with watermarks, 2 with cluttered backgrounds
- WHEN the agent selects images
- THEN only the 5 clean images are downloaded

### Requirement: MiniMax Compatibility

Downloaded images MUST be in JPEG or PNG format and MUST be resized to 1200×1200 if necessary before being passed to MiniMax.

#### Scenario: Image resized for MiniMax

- GIVEN a sourced image is 800×600
- WHEN the agent processes it
- THEN it is resized to 1200×1200 with padding preserving aspect ratio
