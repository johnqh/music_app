# Public Shell: Home, Community, Resources, Footers

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A visitor lands on a page that explains Moosiac, can browse the community and resources, and only meets the sign-in screen when they ask for it.

**Architecture:** Three of the four pieces already exist and are simply mis-wired — the home page is behind the auth gate, the community routes render outside the app shell (so they have no topbar or footer), and the footer picks the same variant on both branches of a ternary. Only Resources is new. The fix is mostly routing, plus a Resources page and a search box.

---

## What is actually wrong today

Verified in the current tree.

### The home page is behind the gate

`App.tsx` matches `/:lang/community` and `/:lang/p/:publicId` publicly, then sends `*` to `AuthGate`. `HomePage` is the index route _inside_ `AppRoutes`, which only renders after the gate — so a signed-out visitor gets the sign-in screen instead of the home page. That is the reported problem, and it is one route in the wrong place.

### The public routes have no app shell

`CommunityPage` and `PublishedView` are declared in `App.tsx` outside `<ScreenContainerLayout>`, so they render with **no topbar and no footer**. A visitor who lands on a shared snapshot has no way to reach anything else.

### The footer ternary does nothing

`ScreenContainer.tsx` reads:

```tsx
<AppPageLayout topBar={topBar} footer={isHomePage ? footer : footer} page={page}>
```

Both branches are the same value, and `footer` is always built with `variant: 'compact'`. So every page — home included — gets the compact footer. `sudojo_app` builds the two variants through `useFooterConfig('full' | 'compact')` and passes `full` only on the home page.

### Community has no search

`CommunityPage.tsx` contains no search or filter of any kind.

### Resources does not exist

No route, no page, no nav entry.

---

## Reference shape

Both `sudojo_app` and `shapeshyft_app` use `AppPageLayout` with a `TopBarConfig` and a `FooterConfig`. `sudojo_app`'s `useFooterConfig(variant)` returns:

- `compact` → `{ variant: 'compact', companyName, links: [...] }`
- `full` → `{ variant: 'full', sections: [{ title, links[] }, ...] }` — grouped columns plus a Company section.

`ScreenContainer` chooses by route depth: `isHomePage = pathParts.length <= 1`.

---

## Decisions needed from the repo owner

**1. Which sites does Resources link to?** These are outbound recommendations, so they should be ones you are happy to endorse. Proposed, all long-standing and free:

| Site                               | What for                                                           |
| ---------------------------------- | ------------------------------------------------------------------ |
| The Mod Archive (`modarchive.org`) | MOD/S3M/XM/IT modules — already the source of our decoder fixtures |
| BitMidi (`bitmidi.com`)            | MIDI files                                                         |
| FreePATS (`freepats.zenvoid.org`)  | Free instrument patches/soundfonts                                 |
| MuseScore (`musescore.com`)        | Sheet music and MusicXML                                           |
| IMSLP (`imslp.org`)                | Public-domain scores                                               |

**2. Home page copy.** The existing `HomePage` already has a hero and feature cards written for a signed-in user ("CTA leading to the projects dashboard"). For a visitor the CTA should be Sign in / Get started. Task 3 rewrites the CTA only, keeping the existing structure and voice unless you want new copy.

---

### Task 1: Make the shell public and fix the footer

**Files:** `src/app/App.tsx`, `src/app/router.tsx`, `src/components/shell/ScreenContainer.tsx`, `src/hooks/useFooterConfig.ts` (new)

- [ ] **Step 1: Move the public routes inside the shell**

In `App.tsx`, keep the gate for everything that needs auth, but render the public routes through `ScreenContainerLayout` so they get the topbar and footer. The index route moves out of `AppRoutes` and becomes public.

```tsx
<Routes>
  {/* Public: reachable signed-out, and rendered in the app shell so a
      visitor has somewhere to go from here. Matched before the catch-all,
      so the gate never sees them. */}
  <Route path="/:lang" element={<LanguageValidator />}>
    <Route element={<ScreenContainerLayout />}>
      <Route index element={<HomePage />} />
      <Route path="community" element={<CommunityPage />} />
      <Route path="resources" element={<ResourcesPage />} />
    </Route>
    <Route path="p/:publicId" element={<PublishedView />} />
  </Route>
  <Route path="*" element={<AuthGate store={store} />} />
</Routes>
```

`PublishedView` stays outside the shell: it is a full-bleed reader for one score, and that is deliberate — confirm against its current styling before changing it.

Remove the now-duplicated `index` route from `AppRoutes`.

- [ ] **Step 2: Build the two footer variants**

Create `src/hooks/useFooterConfig.ts`, modelled on `sudojo_app`'s:

```ts
export function useFooterConfig(variant: 'full' | 'compact'): FooterConfig {
  const { t } = useTranslation();
  const lang = useCurrentLanguage();
  if (variant === 'compact') {
    return {
      variant: 'compact',
      companyName: CONSTANTS.COMPANY_NAME,
      copyrightYear: '2026',
      rightsText: t('footer.rights'),
    };
  }
  return {
    variant: 'full',
    companyName: CONSTANTS.COMPANY_NAME,
    copyrightYear: '2026',
    rightsText: t('footer.rights'),
    sections: [
      {
        title: t('nav.dashboard'),
        links: [{ label: t('nav.dashboard'), href: `/${lang}/projects` }],
      },
      {
        title: t('nav.community'),
        links: [{ label: t('nav.community'), href: `/${lang}/community` }],
      },
      {
        title: t('nav.resources'),
        links: [{ label: t('nav.resources'), href: `/${lang}/resources` }],
      },
      {
        title: t('footer.company'),
        links: [{ label: t('nav.settings'), href: `/${lang}/settings` }],
      },
    ],
  };
}
```

Check `AppFooterForHomePageProps` for the exact `sections` field name before writing this — the shape above is from `sudojo_app` and must match the installed `building_blocks`.

- [ ] **Step 3: Use them**

In `ScreenContainer`, replace the dead ternary:

```tsx
const footer = useFooterConfig(isHomePage ? 'full' : 'compact');
...
<AppPageLayout topBar={topBar} footer={footer} page={page}>
```

- [ ] **Step 4: Verify**

`bun run verify`, then confirm by hand that `/en` renders signed-out with the full footer and `/en/community` with the compact one.

---

### Task 2: Resources

**Files:** `src/pages/ResourcesPage.tsx` (new), `public/locales/en/app.json`

- [ ] **Step 1: The page**

A `Section` + `Card` grid in the same shape as `HomePage`, one card per site, each an external link with `target="_blank" rel="noopener noreferrer"`. Group by what the user is looking for: **Modules** (Mod Archive), **MIDI** (BitMidi), **Sheet music** (MuseScore, IMSLP), **Instruments** (FreePATS).

Each card says what the site is _for_ in one line, and — the point of the page — which of our importers it feeds: modules go to Import → Module, MIDI to Import → MIDI, MusicXML to Import → MusicXML.

- [ ] **Step 2: Nav entry**

Add `{ id: 'resources', label: t('nav.resources'), href: `/${lang}/resources` }` to `menuItems` in `ScreenContainer`.

---

### Task 3: Community browse and search

**Files:** `src/features/community/CommunityPage.tsx`, its test

- [ ] **Step 1: Read what the page lists today**

It renders published snapshots. Read the component and the client hook it uses before adding anything — the filter belongs wherever the list is already built.

- [ ] **Step 2: Add a search box**

Client-side filter over the already-fetched list (title and author), debounced, with an empty state that says nothing matched rather than looking like an empty community. Server-side search is **out of scope** — it needs a `music_api` route and a plan of its own; say so in the code comment rather than leaving it implied.

- [ ] **Step 3: Nav entry**

Add `{ id: 'community', label: t('nav.community'), href: `/${lang}/community` }` to `menuItems`.

---

### Task 4: The visitor's home page

**Files:** `src/pages/HomePage.tsx`, `src/app/SignInScreen.tsx` (route), `public/locales/en/app.json`

- [ ] **Step 1: CTA for a visitor**

The hero CTA currently leads to the dashboard, which a signed-out visitor cannot reach. Make it conditional on `useAuth().user`: signed in → Projects; signed out → sign in.

- [ ] **Step 2: A sign-in route**

The gate currently _replaces_ the page when signed out. Give sign-in its own route (`/:lang/signin`) so the topbar's Sign in button and the home CTA have somewhere to point, and so a visitor is never bounced there without asking. `AuthActionAdapter`'s `onLoginClick` and `ScreenContainer`'s `onLoginClick` both target it.

- [ ] **Step 3: Verify signed-out**

An e2e that visits `/en` with no session and asserts the hero renders — not the sign-in form — and that the topbar shows Sign in. This is the regression that matters: it is the bug being fixed.

---

## Out of scope, deliberately

- **Server-side community search.** Needs a `music_api` route; the client filter covers the current list size.
- **PublishedView's chrome.** It is a deliberate full-bleed reader.
- **New home page copy.** Structure and voice are kept; only the CTA changes.
