# agent-skill-registry Specification

## Purpose

Durable self-declared skill registration per agent with SQLite-backed CRUD, admin-gated tools, and Block C context injection.

## Requirements

### Requirement: Self-Declared Skill Registration
Agents SHALL declare skills with label, category, description, and proficiency level. Skills are self-declared metadata per agent — no CEO-defined skill catalog exists.

#### Scenario: Agent declares a new skill
- GIVEN a registered agent with admin authorization
- WHEN `declare_agent_skill` is called with `{ agent_id, label, category, description, proficiency }`
- THEN the skill SHALL be persisted with `skill_id`, `declared_at`, and `updated_at` timestamps

#### Scenario: Duplicate skill label per agent blocked
- GIVEN an agent already has a skill with label "pricing"
- WHEN `declare_agent_skill` is called with label "pricing" for the same agent
- THEN the system SHALL reject with a controlled error

### Requirement: Skill CRUD Store
The system SHALL provide `insertAgentSkill`, `listAgentSkills`, and `updateAgentSkill` backed by the `agent_skills` SQLite table.

#### Scenario: List skills filters by agent
- GIVEN multiple agents have registered skills
- WHEN `listAgentSkills` is called with a specific `agent_id`
- THEN only skills belonging to that agent SHALL be returned

#### Scenario: Update skill modifies proficiency or description
- GIVEN a skill exists with proficiency 0.5
- WHEN `updateAgentSkill` is called with `{ proficiency: 0.8 }`
- THEN the record SHALL be updated and `updated_at` SHALL reflect the change

#### Scenario: Update non-existent skill returns error
- GIVEN no skill exists with the given `skill_id`
- WHEN `updateAgentSkill` is called
- THEN the system SHALL return a controlled error

### Requirement: Skill Context Injection in Block C
The system SHALL inject skill summaries into Block C context for the active agent via `buildBlockCContext`. Skill context SHALL NOT appear in Block A or B.

#### Scenario: Active agent has declared skills
- GIVEN the active agent has 3 registered skills
- WHEN `buildBlockCContext` assembles context
- THEN labels, categories, and proficiency levels SHALL be appended for that agent

#### Scenario: Agent has no declared skills
- GIVEN the active agent has zero registered skills
- WHEN `buildBlockCContext` assembles context
- THEN the skill section SHALL be omitted without error

### Requirement: Admin Authorization for Skill Tools
The system SHALL gate `declare_agent_skill`, `list_agent_skills`, and `update_agent_skill` behind `companyAgentAdminAuthorized`. Unauthorized requests SHALL be rejected.

#### Scenario: Admin-authorized skill tool succeeds
- GIVEN the caller has `companyAgentAdminAuthorized` flag set
- WHEN any skill tool is invoked
- THEN the operation SHALL execute normally

#### Scenario: Unauthorized request is blocked
- GIVEN the caller lacks admin authorization
- WHEN any skill tool is invoked
- THEN the system SHALL reject with an authorization error
