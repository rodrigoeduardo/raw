# RAW contributor guidance

RAW is an installable issue-driven agent workflow for Claude Code and Codex. The files under
`template/` are what users receive.

- `template/.claude/skills` is the canonical workflow skill source.
- `.agents/skills` is the Codex compatibility link; never duplicate skills between `.claude` and
  `.agents`.
- Use targeted search and bounded reads; workflow Markdown can be large.
- Preserve both Claude and Codex runner behavior. Their agent schemas are not interchangeable.
- After changing init/update logic, run `npm test` and the installer/YAML smoke checks in CI.
- Modify template sources, not generated/install output, unless a test fixture explicitly requires
  installed output.
