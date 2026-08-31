# UI foundation

Issue #3 establishes the reusable NOC Orchestrator application shell and shared component language.

## Visual principles

The interface is desktop-first and optimized for engineering work:

- dense, readable information rather than oversized dashboard chrome
- clear page hierarchy and restrained surfaces
- dark charcoal / graphite palette with orange as the primary brand and interaction accent
- color is semantic, not decorative
- red is reserved for errors, destructive confirmation, blocked/invalid states, or other genuinely exceptional conditions
- green remains available for current/success states and amber for firmware attention/warning states
- common laptop widths remain the primary working target while navigation and data containers degrade sensibly on narrower screens

The canonical product icon and branding guidance live in `docs/branding.md`.

No general network-health, bandwidth, interface, CPU, memory, topology, or monitoring widgets are introduced by the shell.

## Application shell

The reusable route-group layout wraps all MVP application routes under `src/app/(app)`.

Primary navigation currently reserves:

- Dashboard
- Customers
- Devices
- Models
- Vendors
- Device types
- Contract types
- Firmware
- Planning
- Reports
- Settings

On large screens this is a fixed left navigation rail. On smaller screens the brand and horizontally scrollable primary navigation move to the top so every destination remains keyboard- and touch-accessible without requiring JavaScript menu state.

The root route redirects to `/dashboard`.

## Shared components

Reusable primitives live under `src/components/ui`:

- `PageHeader`
- `SummaryStat`
- `DataTable`
- `FilterBar`, `FilterSearch`, and `FilterSelect`
- `TechnicalStatusBadge`
- `WorkflowStatusBadge`
- `EmptyState`, `LoadingState`, and `ErrorState`
- `FormSection`, `FormField`, text/select/textarea controls, and `FormActions`
- `ConfirmationPanel`
- `Button`

These are intentionally small local components rather than a third-party design-system dependency.

## Status separation

Technical firmware/compliance state and operational workflow state are separate concepts and use different badge shapes.

Technical state uses a filled rounded pill with a status dot:

- `CURRENT`
- `ACTION_REQUIRED`
- `UNKNOWN`
- `NO_POLICY`

These are presentation names only until Issue #10 finalizes technical-state resolution.

Workflow state uses a compact outlined rectangular badge:

- `PLANNED`
- `IGNORED`
- `CUSTOMER_DECLINED`
- `DONE`

Orange may identify a planned workflow item because it is the application's primary brand/action color, but technical warning/success/error semantics remain distinct. This prevents a planned upgrade from being visually mistaken for the device's technical firmware status.

## Accessibility baseline

The shell and shared components provide a basic accessibility foundation:

- semantic `nav`, `main`, `table`, `fieldset`, labels, headings, and status roles
- `aria-current="page"` on active navigation
- visible `:focus-visible` treatment
- explicit table captions for assistive technology
- labelled filter/form controls
- loading uses `role="status"`/`aria-live`; errors use `role="alert"`
- horizontal overflow is contained for dense tables and compact navigation instead of clipping content

Feature-specific accessibility behavior should be preserved and expanded as forms and interactive workflows are implemented.
