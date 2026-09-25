# Full Desk Leads — Brand Kit v2.0

**Recruit & Conquer.**
September 2026 · fulldeskleads.com

The complete identity: master vectors, raster exports, favicons, social assets, licensed
fonts, developer tokens, and the written guidelines.

Start with **`brand-guidelines.pdf`** (8 pages). That's the document to send to anyone who
will touch the brand. `brand-guidelines.html` is the same document, self-contained with
fonts embedded, for an internal wiki.

---

## The mark

There is no symbol. The name is the mark.

`FullDeskLeads` set closed, with the capitals F, D and L at **132%** of the lowercase so
the eye still parses three words without a space between them. The capitals are drawn at a
**lighter weight (450)** than the lowercase (600), because enlarging a capital in a
high-contrast serif also thickens its stems — the lighter cut brings the stroke weights
back into optical agreement. Beneath it, **Recruit & Conquer** in uppercase at 0.23em
tracking, ruled on both sides like a line on an engraved instrument. The motto is set at
weight 600 rather than a lighter cut: at the size it occupies relative to the wordmark, the
Q's tail and the flanking rules are only a pixel or two thick, and a lighter weight loses
them entirely in print and at small screen sizes.

Closing the words has a practical benefit beyond the aesthetic: **the wordmark is the
domain.** Anyone who sees it already knows where to go, with no `.com` hanging off the end.

Every wordmark here is **converted to vector outlines**. Nothing depends on a font being
installed, and no logo file can be reflowed or font-substituted by a browser.

> The wordmark cannot be recreated by typing the name and scaling the capitals. The weight
> compensation means it is a drawn artefact. Always place the supplied file.

---

## Folders

### `/logos` — 32 SVG masters
The source of truth. Use these anywhere the format is supported.

| Variant | When to use |
|---|---|
| `primary` | Default signature. Homepage, marketing, decks, letterhead, formal documents. |
| `wordmark` | Motto removed. Nav bars, app headers, repeat placements, product UI. |
| `stacked` | Three lines with motto. Narrow columns, square formats, tall banners, signage. |
| `stacked-wordmark` | Three lines, no motto. Tightest vertical placements. |
| `tile-stacked` | Square tile, full name. Profile pictures at 400 px and above. |
| `monogram` | FDL in a square. App icons and avatars, 48–400 px. |
| `letter` | Single F, heavy cut. Favicon and browser tab, 16–48 px. |

| Colourway | Fill | Background | Use |
|---|---|---|---|
| `-green` | `#163E33` | transparent | Default. Light backgrounds. |
| `-white` | `#FFFFFF` | transparent | **Apparel and dark fields.** Green shirts, hats, embroidery, dark headers. |
| `-charcoal` | `#1E2221` | transparent | One-colour print, fax, engraving, laser. |
| `-on-ivory` | green | `#F8F8F5` | Where a solid light field is needed. |
| `-on-green` | white | `#163E33` | Avatars, tiles, solid brand blocks. |

> The `-white` files look blank in a file browser preview — white artwork on a transparent
> background. That is correct. Open one against something dark to see it. These are the
> files to hand an apparel printer or embroiderer.

### `/png` — raster exports
2400 px transparent PNG of every file, plus web-size cuts of the workhorses. For slides,
Word documents, email, and anywhere SVG is not supported.

### `/favicon` — browser and app icons
`favicon.ico` (16/32/48 bundled), `favicon.svg`, `icon-16/32/48/64/192/512.png`,
`apple-touch-icon.png` (180), `icon-maskable-512.png` (Android adaptive, 80% safe zone).

Note: the single-letter mark uses a **heavier** cut than the wordmark's capitals. A
high-contrast serif loses its hairlines below roughly 24 px, so it is thickened to survive.
All icons are rendered supersampled and downsampled, which keeps fine strokes as grey pixels
instead of dropping them.

### `/social` — pre-sized platform assets
| File | Size | Where |
|---|---|---|
| `og-image-1200x630.png` | 1200×630 | Link previews, X, Slack, LinkedIn |
| `og-image-green-1200x630.png` | 1200×630 | Dark alternate |
| `linkedin-banner-1584x396.png` | 1584×396 | LinkedIn company page cover |
| `avatar-1000.png` | 1000×1000 | Profile pictures (FDL monogram) |
| `avatar-stacked-1000.png` | 1000×1000 | Profile pictures (full name, for larger displays) |
| `square-post-1080.png` | 1080×1080 | Instagram, LinkedIn square posts |
| `email-header-2000x500.png` | 2000×500 | Email template masthead |

### `/fonts` — licensed typefaces
Playfair Display (display) and Inter (text), each as WOFF2, static TTF, and variable TTF.
Both **SIL Open Font License 1.1**: free for commercial use, no seat limits, no fees. The
two `OFL.txt` files must travel with any redistribution.

Self-host these. Do not hotlink Google's CDN.

### `/developer` — drop-in code
| File | Purpose |
|---|---|
| `tokens.css` | `@font-face` blocks and CSS custom properties for every colour, font and radius |
| `tokens.json` | The same values as data, plus CMYK, Pantone, and the wordmark construction spec |
| `head-snippet.html` | Favicon links, theme colour, Open Graph tags |
| `site.webmanifest` | PWA manifest wired to the icon set |

---

## Quick start — website

```html
<link rel="stylesheet" href="/brand/developer/tokens.css">
```
Paste `head-snippet.html` into `<head>` and copy the `/favicon` contents to the web root.
Reference `var(--fdl-green)` rather than pasting hex values, so a future palette change is
one edit rather than a search.

- Header: `/logos/fdl-wordmark-green.svg` at 200–260 px wide
- Dark footer: `/logos/fdl-wordmark-white.svg`
- Hero or about page: `/logos/fdl-primary-green.svg`

## Quick start — merchandise

Send the vendor `/logos/fdl-primary-white.svg` or `fdl-stacked-white.svg` for anything on
green or dark fabric, and the `-green` equivalents for white or natural fabric. Vector means
no resolution ceiling on embroidery digitising or screen printing.

Tell them the green is **Pantone 560 C** and ask for a strike-off before the run. Flag the
hairline motto rules explicitly — on embroidery, a rule that fine may need thickening or
dropping, and you want that decision made by you rather than by the digitiser.

---

## Quality assurance

Two automated audits run against all 32 SVG masters, and both were validated by
reintroducing a real defect and confirming they catch it.

**Stroke dropout.** Each file is rendered directly and again at 8× supersampled, then the
ink is compared. Any stroke falling below the rasteriser's threshold shows up as ink loss.
Run at 16, 32, 64, 130, 200, 320 and 600 px, each file tested only at or above its own
documented minimum.

**Canvas clipping.** Each file has its background field stripped and is checked for artwork
ink touching the canvas border. Artwork reaching the edge is artwork being cut off.

Both currently report a clean pass. This matters because v1 of this kit shipped with a real
defect: the canvas height was derived from the tagline's baseline, and the Q's tail descends
*below* that baseline, so it was sliced off by the edge of every file containing the motto.
It was not a rendering artefact — it was present in the artwork and would have reproduced
identically in every browser, print job and embroidery file. Every canvas is now sized from
measured ink bounds with a one-unit guard band, never from font metrics or assumed baselines.

If the mark is ever modified, re-run both audits before releasing.

---

## Hard rules

- Never re-type the name and scale the capitals by hand.
- Never re-space the words or insert gaps.
- Never add gradients, bevels, glows, outlines or shadows.
- Never recolour outside the five approved colourways.
- Never stretch, condense, rotate or skew.
- Never add `.com` — the closed wordmark already is the domain.
- Never add a symbol, icon or emblem alongside it.
- Minimums: primary 200 px, wordmark 130 px, stacked 90 px, icon 16 px.
- Clear space: 1× the cap height of the F on all four sides.

---

## Known open items

1. **Trademark clearance.** The wordmark has not been searched. Run a USPTO and common-law
   search before this goes on anything expensive.
2. **Typeface.** Playfair Display was chosen for its assertive capitals, which the 132%
   setting requires, and because it is open-licensed with no exposure. It is also widely
   used. If you want the mark to be unmistakably yours, having these thirteen characters
   custom-drawn is a small and affordable commission at this level of simplicity — and
   because the whole kit regenerates from one source, swapping the face is a rebuild rather
   than a redraw.
3. **Pantone proofing.** 560 C and 429 C are nearest digital matches. Proof on your actual
   stock before a production run.
4. **Motto rules at small scale.** The hairlines that flank *Recruit & Conquer* are the
   first thing to fail in embroidery, etching, and low-res print. Below 200 px, use the
   wordmark instead of thinning them further. Call this out to any vendor reproducing the
   mark by a process with a minimum stroke width.
