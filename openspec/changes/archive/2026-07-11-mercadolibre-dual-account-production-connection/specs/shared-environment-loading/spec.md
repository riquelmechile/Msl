# shared-environment-loading Specification

## Purpose

Deterministic environment file loading usable from any working directory across the monorepo. Replaces ad-hoc env loading in scripts, the Next.js symlink workaround, and duplicated dotenv logic in packages.

## Requirements

### Requirement: Deterministic Repository Root Detection

The system MUST locate the repository root (nearest parent containing `package.json` with a `workspaces` field) regardless of the current working directory.

#### Scenario: Run from repo root → finds .env.local

- **GIVEN** the process working directory is `/home/sebastian/code/Msl` (repo root)
- **WHEN** `loadRepositoryEnvironment()` is called
- **THEN** the root is detected as `/home/sebastian/code/Msl`
- **AND** `/home/sebastian/code/Msl/.env.local` is loaded after `.env`

#### Scenario: Run from apps/web → finds root .env.local

- **GIVEN** the process working directory is `/home/sebastian/code/Msl/apps/web`
- **WHEN** `loadRepositoryEnvironment()` is called
- **THEN** the root is detected as `/home/sebastian/code/Msl`
- **AND** `/home/sebastian/code/Msl/.env.local` is loaded
- **AND** `apps/web/.env.local` is NOT loaded unless it is an explicit overlay

#### Scenario: Run from scripts/ → finds root .env.local

- **GIVEN** the process working directory is `/home/sebastian/code/Msl/scripts`
- **WHEN** `loadRepositoryEnvironment()` is called
- **THEN** the root is detected as `/home/sebastian/code/Msl`
- **AND** `.env` and `.env.local` at the repository root are loaded

#### Scenario: Run from packages/* → finds root .env.local

- **GIVEN** the process working directory is `/home/sebastian/code/Msl/packages/mercadolibre`
- **WHEN** `loadRepositoryEnvironment()` is called
- **THEN** the root is detected as `/home/sebastian/code/Msl`
- **AND** the root `.env.local` is loaded

### Requirement: Load .env then .env.local with Clear Precedence

The system MUST load `.env` first, then `.env.local`, such that `.env.local` values override `.env` values. Process environment variables already set SHALL NOT be overwritten by default.

#### Scenario: .env loaded first, .env.local overrides

- **GIVEN** `.env` contains `MERCADOLIBRE_SOURCE_CLIENT_ID=default-id`
- **AND** `.env.local` contains `MERCADOLIBRE_SOURCE_CLIENT_ID=real-id`
- **WHEN** `loadRepositoryEnvironment()` is called
- **THEN** `process.env.MERCADOLIBRE_SOURCE_CLIENT_ID` is `real-id`

#### Scenario: Process env vars already set are NOT overwritten

- **GIVEN** the process was started with `MERCADOLIBRE_SOURCE_CLIENT_ID=startup-id`
- **AND** `.env.local` contains `MERCADOLIBRE_SOURCE_CLIENT_ID=file-id`
- **WHEN** `loadRepositoryEnvironment()` is called
- **THEN** `process.env.MERCADOLIBRE_SOURCE_CLIENT_ID` remains `startup-id`
- **AND** the file value is silently skipped with a DEBUG-level log

### Requirement: CI/Container Mode Skips File Loading

When `MSL_SKIP_ENV_FILE=true` is set, the system MUST NOT attempt to read any `.env` or `.env.local` file. All configuration MUST come from the process environment injected by the container runtime.

#### Scenario: MSL_SKIP_ENV_FILE=true → no file loading

- **GIVEN** `process.env.MSL_SKIP_ENV_FILE=true`
- **WHEN** `loadRepositoryEnvironment()` is called
- **THEN** no file system reads are attempted for `.env` or `.env.local`
- **AND** the function returns immediately with no side effects

#### Scenario: Environment injected by container is preserved

- **GIVEN** `MSL_SKIP_ENV_FILE=true` and `MERCADOLIBRE_SOURCE_CLIENT_ID` was injected
  via Docker/Kubernetes env
- **WHEN** `loadRepositoryEnvironment()` is called
- **THEN** `MERCADOLIBRE_SOURCE_CLIENT_ID` retains its injected value
- **AND** no file-based value overwrites it

### Requirement: Server-Only — Never Exposes to Browser Bundles

`loadRepositoryEnvironment()` MUST be a server-only function. It SHALL use Node.js `fs` and `path` modules and MUST NOT be importable in browser or Edge runtime contexts.

#### Scenario: No NEXT_PUBLIC_* exposure

- **GIVEN** `loadRepositoryEnvironment()` is implemented
- **WHEN** static analysis or tree-shaking is applied
- **THEN** no environment variables loaded by this function are prefixed with `NEXT_PUBLIC_`
- **AND** the function is not bundled into client-side JavaScript

#### Scenario: Functions in Node.js only

- **GIVEN** a Next.js API route or a Node.js script
- **WHEN** `loadRepositoryEnvironment()` is imported and called
- **THEN** it executes successfully using `fs.readFileSync` and `path.resolve`
- **AND** it cannot be imported in `'use client'` modules

### Requirement: No Symlink Dependency

The shared loader MUST eliminate the need for `apps/web/.env.local` as a symlink to the repository root `.env.local`.

#### Scenario: apps/web works without apps/web/.env.local symlink

- **GIVEN** `apps/web/.env.local` does NOT exist (not even as a symlink)
- **WHEN** `npm run dev` is executed from `apps/web`
- **THEN** all seller-specific environment variables are available to the Next.js app
- **AND** no symlink creation is required in setup scripts or documentation

#### Scenario: App directory detection is automatic, not hardcoded

- **GIVEN** the shared loader is used from `apps/web`
- **WHEN** `loadRepositoryEnvironment()` detects the root
- **THEN** it uses `workspaces` in the root `package.json`, not a hardcoded path
- **AND** adding a new app directory (e.g., `apps/admin`) requires zero changes to the loader
