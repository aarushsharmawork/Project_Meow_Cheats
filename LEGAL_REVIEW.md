# Release review — 18 October 2026

This is a source/documentation review of the browser extension at commit `c0d09e1` plus the changes described below. It is not a legal opinion, a full intellectual-property audit, or a certification that a store, school, employer or service provider will permit the software. No Mac app files were reviewed or changed for this task.

## Addressed in this update

- Restored the original MPL 2.0 licence unmodified. Several legacy source files were confirmed byte-for-byte identical to `brian-girko/always-active` revision `5eb1f15`, so treating the repository as wholly independent code would be inaccurate.
- Added upstream attribution, source-distribution guidance, the educational/authorized-testing disclaimer and a privacy notice. Intended-use wording does not impose extra restrictions on MPL recipients or eliminate statutory liability.
- Included the licence, attribution, disclaimer and privacy notice inside `v3`, which users load/package as the extension.
- Changed the active extension's homepage/support/bug links to MeowCheats instead of presenting the upstream project as its support provider. Removed inherited automatic install/update FAQ navigation and uninstall feedback registration from `v3`; legacy `v2` remains preserved as upstream-derived source.
- A targeted scan of current tracked text files found no private-key blocks, common GitHub/Google/AWS key patterns, tracked `.env` files or tracked generated setup-ID JSON files. This was not an audit of every Git-history object or every possible secret format.

## Still requires verification before public distribution

1. **Gemini embedding and provider terms.** `v3/data/gemini.js` removes `X-Frame-Options` and CSP headers for selected embedded Gemini app responses. Google prohibits bypassing protective measures in its service terms. This implementation therefore presents a potential service-terms and store-review issue; neither the opt-in nor an educational disclaimer establishes permission. Obtain appropriate review/authorization or use a supported integration before claiming compliance. Google's actual interpretation and applicable terms must be checked for the release and region.
2. **Reference-extension code and assets.** Confirm the licence or permission for any material copied/adapted from the supplied Auto Typer reference, and the provenance of icons/logo artwork. Having extension source available is not evidence that it is open source or that redistribution is allowed. No blanket clearance of that reference or artwork was established here; restore its notices or replace unlicensed material as appropriate.
3. **Browser-store privacy review.** Verify that the published privacy notice, permission justification, store disclosures and actual screenshot/Gemini behavior agree. Screenshots can disclose third-party personal/confidential information; attaching may upload before Send. Document any future analytics, backend or retention changes before release. Chrome Web Store requirements are separate from GitHub hosting.
4. **Identifiers and legacy packaging.** The inherited Firefox ID remains in `v3/manifest.json`; do not publish a fork under another publisher's identity. Assign an appropriate ID during a Firefox-specific release without silently breaking existing installations. `v2` retains upstream naming/URLs and references missing icons; it is legacy source, not the supported MeowCheats package.
5. **Claims, branding and authorization.** Verify trademark/name rights before marketing. Do not promise undetectability, guaranteed privacy/protection, assessment approval, confirmed IDE vulnerabilities or complete legal immunity. An authorized test result is not blanket authorization to test other sites or share other people's data.
6. **Binary/source obligations.** Include notices and access to the exact corresponding MPL-covered source with helper binaries or other compiled distributions. Do not rely on a future GitHub push or the current branch as proof that a shipped binary's corresponding source is available.

## Primary references

- [Mozilla Public License 2.0, sections 3, 6 and 7](https://www.mozilla.org/en-US/MPL/2.0/)
- [Mozilla MPL FAQ, including modified source and executable distribution](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)
- [Google Terms of Service — service use and protective measures](https://policies.google.com/terms)
- [Chrome Web Store policies](https://developer.chrome.com/docs/webstore/program-policies/policies)
- [Chrome Web Store privacy requirements and screenshots](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
- [Gemini Apps Privacy Hub](https://support.google.com/gemini/answer/13594961)

A qualified lawyer can assess enforceability, applicable local law and third-party permissions for the actual release. This review does not guarantee the absence of other legal risks.
