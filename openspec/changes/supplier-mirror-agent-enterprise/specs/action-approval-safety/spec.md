# Delta for Action Approval Safety

## ADDED Requirements

### Requirement: Supplier Mirror Safety Gates

Supplier Mirror MUST NOT blind mass publish, blindly mutate prices, or bypass approval/autonomy gates. Emergency stock pauses MAY execute only after short verification, configured permission, sufficient evidence, audit logging, and CEO notification.

#### Scenario: Blind mass publishing attempted
- GIVEN many supplier items are discovered without approvals or target policy
- WHEN publication is requested
- THEN the system MUST block mass publishing and require CEO-approved policy

#### Scenario: Verified emergency pause allowed
- GIVEN a mapped approved item has confirmed supplier stock break
- WHEN emergency pause policy allows auto-pause
- THEN the listing MAY be paused with audit evidence and CEO notification

#### Scenario: Pause not permitted
- GIVEN a stock break is confirmed but target policy disallows auto-pause
- WHEN safety evaluates the action
- THEN the system MUST not pause and MUST ask the CEO for next action
