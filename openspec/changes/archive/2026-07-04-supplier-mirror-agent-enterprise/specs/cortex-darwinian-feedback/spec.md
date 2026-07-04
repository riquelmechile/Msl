# Delta for cortex-darwinian-feedback

## ADDED Requirements

### Requirement: Supplier Mirror Fallback Learning

The system MUST record Supplier Mirror user answers as Cortex fallback learning for pricing, target account policy, stock handling, notification suppression, supplier price-change responses, and error outcomes.

#### Scenario: Price-change answer learned
- GIVEN the CEO asks what to do after a supplier price change
- WHEN the user answers with a next action
- THEN Cortex MUST record the answer linked to supplier, item/category, policy context, and outcome

#### Scenario: Notification suppression learned
- GIVEN the user says not to receive an alert type anymore
- WHEN the alert context is identifiable
- THEN Cortex MUST record a suppression preference for future matching alerts

#### Scenario: Error outcome learned
- GIVEN a supplier sync, pause, or proposal fails or is rejected
- WHEN outcome recording runs
- THEN Cortex MUST store outcome evidence for future policy fallback
