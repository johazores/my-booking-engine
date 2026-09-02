# Tenant Branding and White-Label Settings

## Status

Tenant-owned white-label configuration is implemented for the authenticated SF workspace and the real public hospitality discovery surface. Configuration is persisted on `Organization`, validated centrally, permission checked server-side for management, and audited when it changes.

The public route `/book/[organization-slug]` now consumes the public-safe branding reader and applies persisted presentation/contact settings to live availability and pricing discovery. This does not mean the complete public self-service booking journey is finished: public hold, customer/guest ownership, confirmation, and payment collection still require a dedicated customer-safe write contract.

## Persisted tenant presentation

Each active organization can configure:

- business name through the existing organization settings workflow
- logo URL
- favicon URL
- primary, secondary, and accent colors
- controlled font family choice
- contact email, phone, and website
- email sender name and reply-to address
- public booking title and description
- intended custom booking domain

Custom domains are stored as canonical hostnames and are unique across organizations. Persisting a domain does not mean DNS ownership or routing has been verified. Domain verification and serving traffic on that hostname require a later infrastructure capability before the domain can be considered live.

## Security and tenant isolation

Authenticated branding reads require an active user and a revalidated active organization authorization context. Branding mutations require the existing `organization-settings:manage` capability and therefore cannot be authorized by browser state, route parameters, or the organization cookie alone.

Updates:

1. derive the actor from the validated server session
2. revalidate active organization context
3. require `organization-settings:manage`
4. normalize and validate every configurable value
5. update the active tenant inside a serializable transaction
6. write an `organization.branding.updated` audit event for material changes

The public-safe branding reader is deliberately narrower than the internal management reader. It resolves only an active, non-deleted organization from its canonical slug and exposes presentation/contact values needed by the public surface. It does not expose email delivery configuration such as sender/reply-to settings or accept a browser-supplied organization ID.

## Validation

The branding domain enforces:

- absolute HTTPS URLs for externally hosted logos, favicons, and websites
- lowercase full `#rrggbb` colors
- one of the supported controlled font choices (`INTER`, `SYSTEM`, `SERIF`, `MONO`)
- canonical lowercase email addresses
- bounded phone/contact text
- hostname-only custom domains without protocol, path, or port
- bounded customer-facing text

PostgreSQL constraints reinforce canonical colors, supported font values, canonical email fields, and canonical custom-domain storage. Custom domain uniqueness is also enforced in the database.

## Design-token application

Tenant colors and typography are not copied into individual components. The authenticated application shell resolves the active tenant branding and supplies these CSS variables at the workspace boundary:

- `--sf-primary`
- `--sf-secondary`
- `--sf-surface-strong`
- `--sf-accent`
- `--sf-font-family`

Existing shell components consume the variables, so dashboard, account, branding navigation, buttons, focus treatment, and other shared UI inherit tenant branding without tenant-specific CSS files.

The public hospitality surface follows the same principle with its public-route token boundary (`--sf-public-primary`, `--sf-public-secondary`, `--sf-public-accent`, and `--sf-public-font`). A configured tenant logo, favicon, booking title, description, contact details, and controlled font stack are applied without exposing internal configuration.

A configured tenant logo replaces the SF fallback mark in the authenticated sidebar. A configured favicon and tenant business name also feed route metadata for authenticated workspace sections and the public hospitality route.

## Management UI

`/branding` is part of the canonical authenticated workspace. It provides:

- an explicit no-active-tenant state
- a read-only state for users without settings permission
- current logo/color/domain preview
- validated management forms
- success and error feedback
- responsive desktop/mobile layouts
- labeled controls and visible keyboard focus

The page stores public booking presentation values. Those values now drive the real public availability/pricing discovery route, while unfinished self-service booking operations remain absent rather than being represented by fake actions.

## Verification

Dependency-free branding-domain tests cover normalization, clearing optional settings, unsafe input rejection, and controlled font stacks. The disposable PostgreSQL verification runner includes branding integration coverage for permission denial, persisted updates, canonical values, audit history, and public-safe reads.

Public discovery additionally reuses the existing tenant-scoped availability and persisted transactional-pricing domains. See `docs/public-booking-discovery.md` for its security boundary and remaining write-path dependency.

Live database execution still requires an explicitly confirmed disposable PostgreSQL target through `npm run test:database`. GitHub Actions are not used.
