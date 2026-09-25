# UI verification checklist

The packaged-extension browser smoke test in `tests/browser-smoke.ts` checks these behaviors in Chromium:

- [x] Repository overview mounts once, including fragment changes, repeated route changes, back/forward navigation, and GitHub DOM replacement.
- [x] Opening a repository and using a compatible cached result do not download an archive. Selecting Analyze starts the download.
- [x] Navigation and cancellation prevent a stale response from displaying on the new page.
- [x] Analyze receives keyboard focus with a visible outline. Enter closes and reopens the result disclosure.
- [x] The status has a polite live region in the accessibility tree and announces the completion state without repeating byte progress.
- [x] GitHub foreground/background tokens apply to the card; dark mode has a high-contrast fallback. Focus and borders remain visible in forced-colors mode through system colors.
- [x] A zero-code result shows 0.0% percentages without invalid numbers.
- [x] The options page can clear the public result cache through its visible control.

For a manual check in GitHub, tab to Analyze, activate it, open and close the result with Enter, then move between repository overviews with Back and Forward. Repeat in light, dark, high-contrast, and colorblind themes. A screen reader should announce the current state once when it changes, while the language list and coverage details remain available inside the disclosure.
