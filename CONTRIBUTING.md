# Contributing

Thanks for stopping by. This repo is small and has no heavyweight process.

## Before opening a PR

```bash
pnpm install
pnpm typecheck   # must pass
pnpm lint        # must pass
pnpm format      # Prettier, run before committing
```

CI runs exactly those three commands plus `pnpm build`. PRs with red CI won't be reviewed.

## Things to know when making changes

- **Everything is in English except the voice.** Code, comments, commit
  messages, docs and UI labels are in English. What the car hears and says —
  spoken replies, LLM replies, test utterances — stays Vietnamese; that is the
  product.
- **Read `CONTEXT.md` first.** It pins down the shared domain vocabulary (zone,
  tool, fan speed…). Using the wrong word is the biggest source of bugs here.
- **The domain model is in `docs/domain-model.md`.** Adding or changing a tool
  starts there.
- **There is only one copy of the tool table.** Server routes import
  `src/domain/*` and `src/llm/*` directly; don't duplicate schemas.
- **Comments explain *why*, not *what*.** Look around the existing files to
  match the voice — comments here are long, and for a reason.
- **Changing the prompt or the model needs numbers.** The eval suite is in
  `src/eval/`; don't change things because of a vendor's benchmark table.
- **Decisions live next to the code.** Measurements and the reasoning behind
  them are recorded in comments and in `docs/domain-model.md`. If your change
  overturns one, update that note in the same PR.

## Reporting bugs

Include: Chrome version, on-device or cloud (which model), the Vietnamese
sentence you said, and the console log. For speech-recognition bugs, also
include the transcript the browser returned — the bug usually lives there, not
in the LLM.

Security vulnerabilities: don't open an issue, see `SECURITY.md`.
