# ext-design — Tokens, accesibilidad y regresión visual (extensión de dominio)

```yaml
extension:
  id: "ext-design"
  version: "1.0.0"
  requires_core: ">=5.0.0"
  provides_capabilities:
    - "TokensSemanticos"
    - "FuenteUnicaTokens"
    - "AccesibilidadAA"
    - "RegresionVisual"
```

> **Alcance:** toda la UI (`src/app`, `src/components`). La columna
> «Tecnología» es de dominio (genérica); el binding a build/CI concreto vive
> en `profile-ts-next-supabase.md`. Cada fila es una regla de primera clase
> (Manifiesto v5.0, Parte 2).

| ID | Garantía | Mecanismo | Tecnología | Evidencia |
|---|---|---|---|---|
| `EXT-DESIGN-001` | **Fuente única de tokens:** un valor de diseño vive en un solo lugar; nadie re-declara colores/espaciados. | Un único archivo de tokens; el resto los importa. Prohibido hardcodear valores. | Archivo de tokens canónico + build que los resuelve. | E1 grep invariante (una declaración por token); E2 test de importación. |
| `EXT-DESIGN-002` | **Tokens semánticos compilados en build:** los tokens se compilan a CSS/TS; un token roto rompe el build. | Generación de CSS/TS a partir de la fuente de tokens en el build; no hay tokens escritos a mano en dos formatos. | Paso de compilación en build. | E1 build gate (`npm run build` en verde); E2 test de salida de tokens. |
| `EXT-DESIGN-003` | **Accesibilidad — contraste AA 4.5:1** para texto normal (3:1 en texto grande). | Check de contraste en CI; parejas que no llegan a 4.5:1 fallan el gate. | Linter/checker de contraste (axe/contrast). | E1/E2 check de contraste en CI; informe AA. |
| `EXT-DESIGN-004` | **Foco visible:** todo elemento interactivo tiene foco perceptible; prohibido `outline: none` sin reemplazo. | Estilos de `:focus-visible` por defecto + grep que prohíbe `outline: none`/`outline: 0` sin sustituto. | CSS de foco + regla de lint/grep. | E1 grep invariante; E2/a11y scan. |
| `EXT-DESIGN-005` | **Jerarquía de encabezados:** un único `h1`, sin saltos de nivel (`h1→h3` sin `h2`). | Linter de a11y que valida orden de encabezados y unicidad de `h1`. | Regla de a11y (axe) en CI. | E1/E2 a11y scan en CI. |
| `EXT-DESIGN-006` | **Regresión visual:** un cambio no degrada el render aprobado sin que se detecte. | Snapshots visuales aprobados comparados en CI; diffs bloquean el merge. | Captura/comparación visual (screenshots en CI). | E2/E3 diffs de snapshot; baseline versionada. |

## Reglas de primer clase (Parte 2)

```yaml
rules:
  - { id: "EXT-DESIGN-001", property_protected: "integrity", evidence_level: "E1", exceptions: { allowed: false } }
  - { id: "EXT-DESIGN-002", property_protected: "integrity", evidence_level: "E1", exceptions: { allowed: false } }
  - { id: "EXT-DESIGN-003", property_protected: "availability", evidence_level: "E2", exceptions: { allowed: false } }
  - { id: "EXT-DESIGN-004", property_protected: "availability", evidence_level: "E2", exceptions: { allowed: false } }
  - { id: "EXT-DESIGN-005", property_protected: "availability", evidence_level: "E1", exceptions: { allowed: false } }
  - { id: "EXT-DESIGN-006", property_protected: "integrity", evidence_level: "E2", exceptions: { allowed: true, waiver_path: ".governance/waivers/" } }
```

> La accesibilidad es un invariante (Parte 8.2): las reglas de contraste/foco/
> encabezados no admiten waiver. La regresión visual (`EXT-DESIGN-006`) admite
> waiver acotado para cambios de layout deliberados, con baseline actualizada y
> aprobación documentada.
