# GitHub Automation Policy

Target repository visibility: PUBLIC.

GitHub is the canonical code store before any Contabo deployment.
Automation is split by cost and authority:
- Push/PR: syntax, unit/contract/integration fixtures, source/compose gates.
- PR when public: dependency review.
- Public repository: CodeQL for JavaScript.
- Nightly/manual when public: full active regression + legacy authority regression + Docker build.
- Dependabot: weekly npm and GitHub Actions updates.
- Heavy live AI/API/Contabo E2E stays outside ordinary push CI and is run only after source/CI gates pass.

No GitHub workflow may deploy to Contabo automatically until a separate explicit production-deploy authority is approved.
