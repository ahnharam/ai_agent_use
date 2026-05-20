## Migration Source

- Upstream repository:
- Upstream PR or sync PR:
- Upstream base SHA:
- Upstream head SHA:
- Changed-file source:

## Compatibility Review

- [ ] Preserves `Haram AI Agent -- AI Software Company` product identity.
- [ ] Preserves `haram-ai-agent` extension name.
- [ ] Preserves `haramAi.*` settings prefix.
- [ ] Preserves `haram-ai-agent.*` or `haramAi.*` command namespace.
- [ ] Preserves `~/.haram-ai-brain` default brain path.
- [ ] Preserves `<brain>/_company` default company directory.
- [ ] Preserves the 9-agent model: `ceo`, `business`, `planner`, `architect`, `designer`, `frontend`, `backend`, `dba`, `qa`.
- [ ] Does not re-expose YouTube, Instagram, PayPal, content operations, comment queues, or channel analytics in the v0 default flow.

## Review Classification

- [ ] Safe auto-apply candidate: security, dependency, compile, VS Code API, utility, test, or build-script fix.
- [ ] Needs human review: agent structure, command IDs, settings, brain paths, dashboard UX, external integrations, storage schema, or major upgrades.

## Verification

- [ ] `npm install`
- [ ] `npm run compile`
- [ ] `npm audit`
- [ ] Legacy exposure scan completed.
- [ ] Haram identifier scan completed.
- [ ] Agent-role scan completed.

## Notes

