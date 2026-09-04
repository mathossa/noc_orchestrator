# UI foundation

Issue #3 established the first reusable NOC Orchestrator application shell and shared component language. Issue #72 evolves that foundation for the larger inventory, importer, firmware-policy, planning, and reporting workspaces without coupling their domain logic together.

## Visual principles

The interface is desktop-first and optimized for engineering work:

- dense, readable information rather than oversized dashboard chrome
- clear page hierarchy and restrained surfaces
- dark charcoal / graphite palette with orange as the primary brand and interaction accent
- color is semantic, not decorative
- red is reserved for errors, destructive confirmation, blocked/invalid states, or other genuinely exceptional conditions
- green remains available for current/success states and amber for firmware attention/warning states
- common laptop widths remain the primary working target while navigation and data containers degrade sensibly on narrower screens
- shared primitives should remain small and composable instead of becoming feature-specific mega-components

The canonical product icon and branding guidance live in `docs/branding.md`.

No general network-health, bandwidth, interface, CPU, memory, topology, or monitoring widgets are introduced by the shell.

## Application shell

The reusable route-group layout wraps all MVP application routes under `src/app/(app)`.

Primary navigation is grouped around engineer workflows rather than exposing every reference table at the same visual level:

- **Overview**
  - Dashboard
- **Inventory**
  - Customers
  - Sites
  - Devices
- **Firmware**
  - Catalog
  - Models
- **Operations**
  - Planning
  - Reports
- **Administration**
  - Vendors
  - Device types
  - Contract types
  - Settings

The grouping is presentation-only: existing routes remain stable. Future policy, exception, planning, or reporting screens should extend the appropriate group instead of creating another flat top-level navigation list.

On large screens this remains a fixed left navigation rail. On smaller screens the brand stays in a compact top bar and a labelled menu button opens the same grouped navigation vertically. Route changes remount the mobile menu in its closed state.

Active-state logic remains route-aware for nested detail pages, including Customer/Site routes. The root route redirects to `/dashboard`.

## Shared components

Reusable primitives live under `src/components/ui`:

- `PageHeader`, with optional breadcrumbs, description, metadata, and actions
- `SummaryStat`
- `DataTable`, with dense/comfortable modes, sticky headers, numeric alignment, overflow containment, and row-state hooks
- `FilterBar`, `FilterSearch`, and `FilterSelect`, including optional filter context/summary
- generic `StatusBadge` plus `TechnicalStatusBadge` and `WorkflowStatusBadge`
- `EmptyState`, `LoadingState`, and `ErrorState`
- `WorkspacePanel`, `WorkspaceSectionHeader`, and `StickyWorkspaceActions`
- `FormSection`, `FormField`, text/select/textarea controls, and `FormActions`
- `ConfirmationPanel`
- `Button`

These are intentionally small local components rather than a third-party design-system dependency.

Feature work should reuse these primitives where they fit, but domain-specific behavior remains owned by the relevant feature. For example, importer virtualization/grouping belongs to Issue #50 and firmware compatibility semantics belong to Issue #57; shared UI components must not reproduce either engine.

## Operational list baseline

Large operational lists should favor compact, scan-friendly presentation:

- contain horizontal overflow inside the list surface rather than the full page
- retain visible table headers while scrolling within a list region where practical
- use tabular/numeric alignment for counts and similar values
- show clear hover, keyboard-focus, and selected-row states
- expose a labelled focusable region when a wide table itself needs horizontal keyboard scrolling
- preserve explicit empty/no-result states instead of rendering an unexplained blank panel

Virtualization, server pagination, grouping, and bulk-selection semantics are feature responsibilities layered on top of this presentation baseline.

## Status separation

Technical firmware/compliance state and operational workflow state remain separate concepts.

The generic `StatusBadge` provides semantic visual tones (`neutral`, `accent`, `success`, `warning`, `danger`, and `info`) for non-domain-specific status presentation. Domain badges map their own meaning onto those tones instead of using color as the state model.

The current legacy technical presentation states remain:

- `CURRENT`
- `ACTION_REQUIRED`
- `UNKNOWN`
- `NO_POLICY`

They are transitional presentation names until the richer policy-aware compliance resolver replaces them.

The current legacy workflow presentation states remain:

- `PLANNED`
- `IGNORED`
- `CUSTOMER_DECLINED`
- `DONE`

Later firmware compliance, exceptions, and work-planning issues may evolve those domain enums. The UI foundation should consume those results rather than defining their semantics.

## Accessibility baseline

The shell and shared components provide a basic accessibility foundation:

- semantic `nav`, `main`, `table`, `fieldset`, labels, headings, and status roles
- `aria-current="page"` on active navigation
- labelled and stateful mobile navigation (`aria-expanded` / `aria-controls`)
- visible `:focus-visible` treatment
- explicit table captions for assistive technology
- labelled focusable regions for wide operational tables
- labelled filter/form controls
- loading uses `role="status"`/`aria-live`; errors use `role="alert"`
- horizontal overflow is contained for dense tables instead of clipping content
- semantic status text remains visible so meaning never depends on color alone

Feature-specific accessibility behavior should be preserved and expanded as forms and interactive workflows are implemented.
