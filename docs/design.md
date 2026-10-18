# Visual system retained from Agentframe

SDK keeps the composition, type, color, motion, and accessibility behavior described below. The numbered product claims describe the original template. They are not the live SDK product. Current behavior is in the README and `docs/decisions/PHASE_01_FOUNDATION.md`.

# Agentframe direction

1. Premise: an AI harness that gives agents a workspace, useful context, and explicit permissions.
2. Reference: follow Autosend’s composition closely: compact navigation, centered serif hero, landscape with a floating prompt, three introduction columns, and a bordered facts/wordmarks block.
3. Product story: vary the composition while retaining shared borders and typography. Use a split SDK panel, a run walkthrough, centered context heading with horizontal tabs and a wide preview, three divided use-case rows with numbered team roles, practical tasks, and output filenames, and a reversed control panel. A separate workspace panel introduces project switching.
4. Identity: an original interlocking frame mark and uppercase mono wordmark; files, tools, and approval states carry the product story.
5. Palette: neutral `#fafafa` paper, white panels, gray borders, and charcoal type; dark mode uses `#111111` with corresponding gray surfaces. Cobalt `#315bff` carries actions and selected states in both themes, with separate accent-text variants. Photography retains its natural color.
6. Typography: Lora regular and italic for the hero and editorial details, Geist for section headings and body copy, Geist Mono for navigation and interface labels. All load through `next/font`.
7. Landscape: Yoshi Takekawa’s Blanca Lake photograph becomes a 35-color pixel canvas with forest greens, turquoise water, cool rock, and warm cloud highlights. A 24fps loop gives the lake visible ripples and 15 drifting light glints while mountains remain still; reduced motion freezes the complete scene.
8. Geometry: one 1100px desktop container, a constant 64px header, square outer module borders, and restrained corners on interface surfaces. Reserve room for changing demo and billing states.
9. Interaction: a custom keyboard-accessible task selector, deterministic run/replay, keyboard-operated tabs, file and project selection, a local approval toggle, clipboard feedback, and native dialogs. Section entrances combine opacity and a 24px rise, with staggered foundations and article cards. The header and changing interface states reserve their geometry.
10. Routes: the homepage closes with integrations, three static quotes, three photographic field notes, and a compact final CTA. Pricing and FAQ live at `/pricing`; the original articles also have a `/notes` index and individual routes.

Component and page presentation uses Tailwind v4 utilities in TSX. The CSS-first theme, shared base defaults, reduced-motion safeguards, and named animation keyframes live in `app/globals.css`. Structural `data-ui` attributes connect related-element variants without component classes or stylesheets.
