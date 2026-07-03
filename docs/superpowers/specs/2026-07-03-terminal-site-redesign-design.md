# Terminal site redesign

## Goal

Redesign `nirmit.dev` from a bold poster-style landing page into a memorable personal calling card that behaves like a minimal terminal session.

The site should feel developer-first, terse, and real enough to interact with. It should not become a fake operating system, a project portfolio, or a novelty shell.

## Current context

The site is a static, dependency-free personal page:

- `index.html`
- `css/style.css`
- `js/site.js`
- `resume_25_01.pdf`
- favicon assets

The current design has a large typographic name treatment, canvas dot grid, cursor glow, magnetic link pills, company chips, and company popovers. Those interactions fit the current poster-style page but should be removed for the terminal redesign.

## Approved direction

Use a real terminal session as the primary experience.

The page should open with a complete transcript and then leave the visitor at a prompt. The transcript should render through a quick command/output animation by default. If the visitor prefers reduced motion, render it instantly.

Visual treatment:

- Minimal modern shell
- Dark by default
- Monospace-first
- Centered terminal window on desktop
- Near full-screen terminal on mobile
- Strong contrast
- No retro CRT scanlines
- No decorative status-panel dashboard

## First-load transcript

The first-load transcript should include these commands in order:

1. `whoami`
2. `work`
3. `links`
4. `help`

After the transcript finishes, focus should land on the command input.

The transcript should be useful without requiring discovery. A visitor who never types should still understand who Nirmit is and how to reach him.

## Commands

Supported commands:

- `whoami`
- `work`
- `links`
- `resume`
- `github`
- `linkedin`
- `email`
- `help`
- `clear`
- `date`
- `theme`

Aliases:

- `about` maps to `whoami`
- `contact` maps to `links`
- `cv` maps to `resume`
- `cls` maps to `clear`

There should be no `projects` command.

### Command output

`whoami` prints a short identity summary:

- Nirmit Shah
- Software developer in New York City
- Georgia Tech '20
- Interested in AI/ML and data visualization

`work` prints the full company list:

- Square
- Lyft
- Riot Games
- Block
- Citadel
- a private company

The company list should be text-first and terminal-native, not badges or popovers.

`links` prints clickable terminal-style link tokens:

- Email
- GitHub
- Resume
- LinkedIn

`resume`, `github`, `linkedin`, and `email` open the matching destination and print a short confirmation line. Email may use a `mailto:` link.

Link targets:

- Email: `mailto:nirmitshah0113@gmail.com`
- GitHub: `https://github.com/kermitnirmit`
- Resume: `resume_25_01.pdf`
- LinkedIn: `https://www.linkedin.com/in/nirmit-shah-b6b957a2/`

`help` prints the command list and aliases.

`clear` clears command history from the visible transcript and starts a fresh prompt.

`date` prints the current local date and time.

`theme` toggles between the default dark shell and a light shell. Do not add extra novelty themes.

Unknown commands should print a concise error with a suggestion to run `help`.

## Terminal behavior

The shell should include the useful affordances of a terminal without overbuilding:

- Real text input inside a form
- Submit on Enter
- Command history with Up and Down arrows
- Tab completion for command names and aliases
- Aliases resolved before execution
- Prompt remains visible after each command
- Focus returns to the input after command execution
- Links remain real anchors

The prompt format can be simple, for example:

```text
visitor@nirmit.dev:~$
```

## Implementation shape

Keep the site dependency-free.

`index.html` should become a terminal shell layout with:

- Document metadata and existing favicon links
- Terminal title bar
- Transcript/output region
- Prompt form
- Real anchor elements for contact links where possible
- A small `noscript` fallback with the identity summary and links

`css/style.css` should define:

- Terminal layout
- Theme variables
- Dark and light shell themes
- Responsive behavior
- Focus states
- Reduced-motion behavior
- Link token styling
- Stable dimensions so the layout does not jump during output changes

`js/site.js` should own:

- Current year if a year remains visible
- Initial transcript rendering
- Reduced-motion detection
- Command registry
- Alias handling
- Command execution
- Visible transcript updates
- Command history
- Tab completion
- Theme toggle
- Link shortcut behavior

## Accessibility

The redesign should be keyboard-first.

Requirements:

- The command input receives focus after the initial transcript completes.
- Visitors can tab to all real links.
- Focus states are visible.
- Commands submit through a real form.
- Output changes should be announced politely where useful, without making the whole terminal noisy for screen readers.
- Reduced-motion users get instant transcript rendering.
- Text must not overflow on mobile.
- Color contrast must remain readable in both dark and light themes.

## Responsive behavior

Desktop:

- Center the terminal window.
- Keep comfortable margins around the shell.
- Preserve a focused single-screen feel.

Mobile:

- Use a near full-screen terminal.
- Avoid tiny title-bar controls.
- Allow long command output and links to wrap cleanly.
- Keep the input reachable and readable.

## Out of scope

- Project portfolio sections
- `projects` command
- Fake file system
- `ls`, `cat`, or directory navigation unless a later design explicitly adds them
- CRT scanline styling
- Canvas background
- Cursor glow
- Magnetic pills
- Company popovers
- Build system or frontend framework
- New dependencies

## Verification

Run the static site locally and verify:

- First-load transcript appears in the approved order.
- Transcript animates quickly by default.
- Transcript renders instantly with reduced motion.
- Prompt receives focus after transcript completion.
- `help`, `whoami`, `work`, `links`, `resume`, `github`, `linkedin`, `email`, `date`, `theme`, and `clear` work.
- `about`, `contact`, `cv`, and `cls` aliases work.
- Up and Down command history works.
- Tab completion works for commands and aliases.
- Unknown commands produce a concise help suggestion.
- Contact links open the right targets.
- Desktop layout is centered and stable.
- Mobile layout has no text overlap or horizontal overflow.
- Light and dark themes have readable contrast.

## Open decisions

None.
