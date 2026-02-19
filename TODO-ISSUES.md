# notioncli Feature Backlog

Run these to create GitHub issues:

```bash
# Callout blocks
gh issue create --repo JordanCoin/notioncli --title "feat: Add callout block support" --body "Add support for callout blocks with customizable icons and colors.

\`\`\`bash
notion append <page> \"Important note\" --type callout --icon 💡 --color yellow
\`\`\`"

# Toggle blocks
gh issue create --repo JordanCoin/notioncli --title "feat: Add toggle block support" --body "Add support for toggle (collapsible) blocks for FAQs, collapsible sections."

# Quote and code blocks
gh issue create --repo JordanCoin/notioncli --title "feat: Add quote and code block support" --body "Support --type quote and --type code --language <lang>"

# Page icons and covers
gh issue create --repo JordanCoin/notioncli --title "feat: Set page icons and covers" --body "notion icon <page> 💪 and notion cover <page> --url <url>"

# Page duplicate/template
gh issue create --repo JordanCoin/notioncli --title "feat: Page duplicate/template system" --body "notion duplicate and notion template save/apply for reusable page structures"

# Database views
gh issue create --repo JordanCoin/notioncli --title "feat: Database view management" --body "Create/list/delete views (table, board, calendar, gallery, timeline)"

# Batch updates
gh issue create --repo JordanCoin/notioncli --title "feat: Batch update operations" --body "notion batch-update <db> --filter X --prop Y for bulk operations"
```
