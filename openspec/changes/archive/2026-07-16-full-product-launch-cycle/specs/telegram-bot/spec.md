# Delta for telegram-bot

## ADDED Requirements

### Requirement: Photo Message Handler

The bot MUST handle `message:photo` events. Upon receiving a photo, it MUST download the highest-resolution variant via `ctx.getFile()`, save it to `.msl/product-photos/{chatId}/{timestamp}.jpg`, extract the caption as an optional title hint, and enqueue a `ProductLaunchCoordinator` Work Session via the Agent Message Bus.

#### Scenario: Photo received — pipeline starts

- GIVEN the CEO sends a product photo via Telegram
- WHEN the bot receives the `message:photo` event
- THEN the highest-resolution photo is downloaded and saved locally
- AND a `ProductLaunch` is created in `photo_received` state
- AND a Work Session is enqueued for `ProductLaunchCoordinator`

#### Scenario: Photo with caption

- GIVEN the CEO sends a photo with caption "Nike Air Max 270 Negro"
- WHEN the bot processes the message
- THEN the caption is extracted and stored as the initial title hint in the product context

#### Scenario: No caption

- GIVEN the CEO sends a photo without a caption
- WHEN the bot processes the message
- THEN the product context is created with `titleHint: null`

### Requirement: Progressive Status Updates

The bot MUST forward progress updates from `ProductLaunchCoordinator` to the CEO via `sendProactiveMessage()`. Updates MUST be sent at each pipeline stage transition. The bot MUST allow the CEO to send additional photos or product links when prompted by the coordinator.

#### Scenario: CEO receives pipeline progress

- GIVEN the coordinator sends a progress update
- WHEN the bot receives it via the Agent Message Bus
- THEN the update is forwarded to the CEO's Telegram chat as a proactive message

#### Scenario: CEO sends additional photos on request

- GIVEN the coordinator has asked the CEO for more photos
- WHEN the CEO sends another photo within the same chat context
- THEN the new photo is attached to the existing `ProductLaunch` (not treated as a new launch)
- AND the coordinator resumes processing

### Requirement: File Storage

Product photos MUST be stored in a directory structure that isolates by chat: `.msl/product-photos/{chatId}/{timestamp}.jpg`. This ensures multi-CEO support with no file collisions.

#### Scenario: Multiple CEOs send photos

- GIVEN two different Telegram users send photos
- WHEN the bot saves both
- THEN each is stored in the correct `{chatId}` subdirectory
- AND there are no filename collisions
