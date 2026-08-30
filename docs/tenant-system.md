# Tenant System

## Definition

Every business is an organization/tenant. A tenant may represent a hotel, resort, travel agency, tour operator, appointment business, rental business, marketplace, or another reservation business.

The business kind is descriptive. Product behavior should evolve through capabilities rather than separate duplicated applications.

## Implemented foundation

The current database contains organizations, users, and organization memberships. Server-side repository methods fetch organizations only when the requesting user has an active membership.

This is the beginning of tenant isolation, not a complete authorization system.

## Required security model

Every protected operation must eventually validate:

1. authenticated identity
2. active organization membership
3. required permission/capability
4. scope/ownership of the requested resource

A user from Organization A must never access Organization B data by changing an ID, URL, query string, request body, or API call.

## Future tenant-owned areas

- users/memberships
- roles/permissions
- branding/settings
- customers
- inventory/products/properties
- availability/rates
- bookings/payments
- integrations/domains
- email and booking configuration

## White label

Tenant branding is planned after the application shell. Branding should come from tenant configuration/design tokens rather than hardcoded component values and may eventually control business name, logo, favicon, colors, fonts, email branding, booking branding, domain, and contact details.
