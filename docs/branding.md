# NOC Orchestrator branding

The canonical application icon is:

```text
public/brand/noc-orchestrator-icon.png
```

The PNG is used directly by the application shell and browser metadata. Keep this path stable so there is one source of truth for the product mark.

## Asset guidance

- Prefer a transparent square PNG when the source artwork is raster/generated.
- Keep the original high-resolution source rather than upscaling a smaller export.
- A genuine vector SVG may be added later if an original vector source exists, but do not auto-trace the PNG solely to obtain SVG.
- Do not create separate manually maintained favicon artwork unless a future platform requirement makes that necessary.

## Theme

The application uses a dark charcoal / graphite foundation with orange as the primary brand and interaction color.

Shared theme tokens live in `src/app/globals.css`. Feature UI should prefer those tokens instead of introducing unrelated primary colors.

Orange is used for:

- primary actions
- active navigation
- page eyebrows and brand accents
- focus treatment
- selected text treatment
- planned workflow emphasis where appropriate

Semantic state colors remain distinct:

- green for current/success/done
- amber for firmware attention/warning
- red for destructive/error states
- neutral/slate for unknown/no-policy states

Branding must not make technical firmware state and lifecycle workflow visually indistinguishable.
